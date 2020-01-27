---
layout: post
title: Paging data in MongoDB with C#
categories:
tags: [MongoDB, Paging, Facets, C#, Aggregation]
description: Paging data in MongoDB with C# using aggregation and facet stages
comments: true
---

At some stage you are going to have to page some data to the users so they have faster responses. This is fairly easy in MongoDB by creating 2 queries, but isn't the most efficient way due to round tripping to the database and doing the filter multiple times.

We can declare a filter at the top and pass that down in to a `find`, which will have a `skip` and `limit` on it. We will also send the same filter to a `CountDocumentsAsync` so that we can work out the total pages based on the page size.

```csharp
int pageSize = 5;
int page = 1;
var filter = Builders<Person>.Filter.Eq(x => x.FirstName, "Bob");

var data = await collection.Find(filter)
    .Sort(x => x.Surname)
    .Skip((page - 1) * pageSize)
    .Limit(pageSize)
    .ToListAsync();

var count = await collection.CountDocumentsAsync(filter);
```


## MongoDB Aggregation

Within MongoDB we have the ability to create a data processing pipeline that will get executed against our data once, we can take advantage of [MongoDB’s aggregation framework](https://docs.mongodb.com/manual/aggregation/#aggregation-pipeline) to optimise the above way to do paging.

We will start with a simple aggregation pipeline that will use our filter and match every document and return the results:

```csharp
var client = new MongoClient();
var database = client.GetDatabase("test");
var collection = database.GetCollection<Person>("people");
var filter = Builders<Person>.Filter.Eq(x => x.FirstName, "Bob");

var aggregateFluent = await collection.Aggregate()
    .Match(filter)
    .ToListAsync();
```

From this we need to extend the pipeline to contain a [facet stage](https://docs.mongodb.com/manual/reference/operator/aggregation/facet/), this will allow us to run 2 more aggregation pipelines after the match.

```csharp
var aggregation = await collection.Aggregate()
    .Match(filter)
    .Facet(countFacet, dataFacet)
    .ToListAsync();
```

### Count Facet

Let's now create the count facet, this will be a simple aggregation stage of count, We can use the `PipelineStageDefinitionBuilder` to help us create this stage.

```csharp
var countFacet = AggregateFacet.Create("count",
    PipelineDefinition<Person, AggregateCountResult>.Create(new[]
    {
        PipelineStageDefinitionBuilder.Count<Person>()
    }));
```

### Data Facet

We'll also need a data facet, we'll use this to sort the data and do the skip and limiting of the results for the paging.

```csharp
var dataFacet = AggregateFacet.Create("data",
    PipelineDefinition<Person, Person>.Create(new[]
    {
        PipelineStageDefinitionBuilder.Sort(Builders<Person>.Sort.Ascending(x => x.Surname)),
        PipelineStageDefinitionBuilder.Skip<Person>((page - 1) * pageSize),
        PipelineStageDefinitionBuilder.Limit<Person>(pageSize),
    }));
```

### Aggregation Result

The response from the aggregation call will give us a `List<AggregateFacetResults>` with only one `AggregateFacetResults` inside. This `AggregateFacetResults` will have a list of facets which have the names create above of `data` and `count`.

We can now use this to project out our data in C#:

```csharp
var count = aggregation.First()
    .Facets.First(x => x.Name == "count")
    .Output<AggregateCountResult>()
    .First()
    .Count;

var data = aggregation.First()
    .Facets.First(x => x.Name == "data")
    .Output<Person>();
```

## Complete Solution

Now we've gone through all the parts we need to achieve paging with aggregation here's a little example of the usage in a .NET Core console app.

```csharp
class Program
{
    static async Task Main(string[] args)
    {
        var client = new MongoClient();
        var database = client.GetDatabase("test");
        var collection = database.GetCollection<Person>("people");

        await SeedNames(collection);

        int pageSize = 5;
        int page = 1;
        var results = await QueryByPage(page, pageSize, collection);
        WriteResults(page, results.readOnlyList);

        for (page = 2; page < results.totalPages; page++)
        {
            results = await QueryByPage(page, pageSize, collection);
            WriteResults(page, results.readOnlyList);
        }
    }

    private static async Task<(int totalPages, IReadOnlyList<Person> readOnlyList)> QueryByPage(int page, int pageSize, IMongoCollection<Person> collection)
    {
        var countFacet = AggregateFacet.Create("count",
            PipelineDefinition<Person, AggregateCountResult>.Create(new[]
            {
                PipelineStageDefinitionBuilder.Count<Person>()
            }));

        var dataFacet = AggregateFacet.Create("data",
            PipelineDefinition<Person, Person>.Create(new[]
            {
                PipelineStageDefinitionBuilder.Sort(Builders<Person>.Sort.Ascending(x => x.Surname)),
                PipelineStageDefinitionBuilder.Skip<Person>((page - 1) * pageSize),
                PipelineStageDefinitionBuilder.Limit<Person>(pageSize),
            }));

        var filter = Builders<Person>.Filter.Empty;
        var aggregation = await collection.Aggregate()
            .Match(filter)
            .Facet(countFacet, dataFacet)
            .ToListAsync();

        var count = aggregation.First()
            .Facets.First(x => x.Name == "count")
            .Output<AggregateCountResult>()
            .First()
            .Count;

        var totalPages = (int)count / pageSize;

        var data = aggregation.First()
            .Facets.First(x => x.Name == "data")
            .Output<Person>();

        return (totalPages, data);
    }


    private static int i = 1;

    private static void WriteResults(int page, IReadOnlyList<Person> readOnlyList)
    {
        Console.WriteLine($"Page: {page}");

        foreach (var person in readOnlyList)
        {
            Console.WriteLine($"{i}: {person.FirstName} {person.Surname}");
            i++;
        }
    }
    private static async Task SeedNames(IMongoCollection<Person> collection)
    {
        var firstNames = new[]
        {
            "Liam",
            "Noah",
            "William",
            "James",
            "Logan",
            "Benjamin",
            "Emma",
            "Olivia",
            "Ava",
            "Isabella",
            "Sophia",
            "Mia"
        };

        var surnames = new[]
        {
            "Smith",
            "Johnson",
            "Williams",
            "Jones",
            "Brown",
        };

        var people = firstNames.SelectMany(firstName =>
                surnames.Select(surname => new Person { FirstName = firstName, Surname = surname }))
            .ToArray();

        await collection.InsertManyAsync(people);
    }
}

public class Person
{
    public ObjectId Id { get; set; }

    public string FirstName { get; set; }

    public string Surname { get; set; }
}

```

## Generic solution

The above full solution is very specific to the `Person` type, we can extend this a little more so we can use any of our object types of any collection. This will allow us to reuse this code over and over again.

```csharp
public static class MongoCollectionQueryByPageExtensions
{
    public static async Task<(int totalPages, IReadOnlyList<TDocument> data)> AggregateByPage<TDocument>(
        this IMongoCollection<TDocument> collection,
        FilterDefinition<TDocument> filterDefinition,
        SortDefinition<TDocument> sortDefinition,
        int page,
        int pageSize)
    {
        var countFacet = AggregateFacet.Create("count",
            PipelineDefinition<TDocument, AggregateCountResult>.Create(new[]
            {
                PipelineStageDefinitionBuilder.Count<TDocument>()
            }));

        var dataFacet = AggregateFacet.Create("data",
            PipelineDefinition<TDocument, TDocument>.Create(new[]
            {
                PipelineStageDefinitionBuilder.Sort(sortDefinition),
                PipelineStageDefinitionBuilder.Skip<TDocument>((page - 1) * pageSize),
                PipelineStageDefinitionBuilder.Limit<TDocument>(pageSize),
            }));


        var aggregation = await collection.Aggregate()
            .Match(filterDefinition)
            .Facet(countFacet, dataFacet)
            .ToListAsync();

        var count = aggregation.First()
            .Facets.First(x => x.Name == "count")
            .Output<AggregateCountResult>()
            .First()
            .Count;

        var totalPages = (int)count / pageSize;

        var data = aggregation.First()
            .Facets.First(x => x.Name == "data")
            .Output<TDocument>();

        return (totalPages, data);
    }
}

```

This can then be called with the following:

```csharp
var results = await collection.AggregateByPage(
    Builders<Person>.Filter.Empty,
    Builders<Person>.Sort.Ascending(x => x.Surname),
    page: 2,
    pageSize: 5);
```

## Under the hood

While this is all written in C# it's always nice to see what is happening under the hood. We can drop in to the mongo shell (`mongo.exe`) and run the following command to enable profiling:

```javascript
db.setProfilingLevel(2,1)
```

Once the profiler is enabled we can run our C# app and the profile will collect data in the `db.system.profile` for us. Once the query has run we can the execute a find on this collection to see what happened. Here we'll see the following aggregation command being ran

```json
[
    {
        "$match": {

        }
    },
    {
        "$facet": {
            "count": [
                {
                    "$count": "count"
                }
            ],
            "data": [
                {
                    "$sort": {
                        "Surname": 1
                    }
                },
                {
                    "$skip": 5
                },
                {
                    "$limit": 5
                }
            ]
        }
    }
]
```

Just what we expected right? 😉
