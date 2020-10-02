---
layout: post
title: Augmenting MongoDB LINQ with low level mongo query.
categories:
tags: [MongoDB, C#, LINQ]
description: How to augmenting MongoDB LINQ with low level mongo query.
comments: true
---

.NET landscape change back in November 2017 when .NET Framework 3.5 was released which included the Language Integrated Query, which we all call today as "LINQ". This release also included some new C#3 language features that enabled us to write a SQL-like language in the middle of our C# code.

```csharp
var q = from x in data
            where x % 2 == 1
            orderby x descending
            select x * x;
```

However, the alternate (and also more common today) way to write LINQ is using the functions with lambdas.

```csharp
var q = data.Where(x => x % 2 == 1)
          .OrderByDescending(x => x)
          .Select(x => x * x);
```

LINQ release back in 2017 was revolutionary due to many reasons. It is a general-purpose query language, this means that it works with any types and collections, which means we can use collections of objects, databases, JSON, XML and our query syntax is always the same.

The reduction in the amount of code to be written was substantial as all the loops were taken care of by LINQ, thus making it a lot easier to read and maintain.

As a C# developer in 2020, even the simplest bits of aggregation in collections are done by LINQ as it's simple, concise, and easy to maintain.

## MongoDB and LINQ

MongoDB C# Driver has support for LINQ, this means that we can write the above style queries without having to care about how that gets translated and executed on our MongoDB Database.

```csharp
var client = new MongoClient();
var db = client.GetDatabase("test");
var collection = db.GetCollection<Book>("test");

var result = await collection.AsQueryable()
    .Where(x => x.Title == "Matching title")
    .Select(x => x.Title)
    .ToListAsync();
```

As you can see above we're calling a method `.AsQueryable()` on our MongoDB collection, which is then returning an `IQueryable<Book>`. This means we can do all our normal LINQ operations on it.

## Not Everything is Supported

As you can imagine not everything is going to be supported in LINQ, this is due to LINQ being an abstraction, it is general-purpose and not just designed for MongoDB. This is a limitation that other LINQ Providers have too such as Entity Framework.

For example, if we change around the code above to find every book that has its title having more than 5 'a' characters, The MongoDB LINQ Provider will throw an `InvalidOperationException`.

```csharp
var result = await collection.AsQueryable()
    .Where(x => x.Title.Count(c => c == 'a') > 5)
    .Select(x => x.Title)
    .ToListAsync();
```

```text
System.InvalidOperationException: '{document}{Title}.Count(c => (Convert(c, Int32) == 97)) is not supported.'
```

However, if we ran the same code with just a `List<T>` instead of a MongoDB collection it would run perfectly fine.

This also works the other way too, where MongoDB supports more features than what LINQ can provide. For this, we can't use tell MongoDB to use a text search or geolocation search by just using LINQ. This is where we need to augment our LINQ statement with some lower level MongoDB query.

## Augmenting LINQ

Most LINQ providers have a way to inject in some custom support to enable some more native support for a feature. For example, it's common for people using EF Core to use the `EF.Property` static method to access shadow properties when executing queries using LINQ.

```csharp
context.Blogs
    .OrderBy(b => EF.Property<DateTime>(b, "LastUpdated"));
```

MongoDB Driver like other LINQ providers supports a way to inject in more functionality.

We can build up extra queries with the [MongoDB filter definition builders](https://mongodb.github.io/mongo-csharp-driver/2.7/reference/driver/definitions/#filter-definition-builder) and then inject these into LINQ queries.

Below is an example of how to create a text search and then inject it in to our LINQ query that MongoDB Driver will execute.

```csharp
var collection = db.GetCollection<Book>("test");

var filter = Builders<Book>.Filter.Text("Mary Doe");

var results = await collection.AsQueryable()
    .Where(_ => filter.Inject())
    .Select(x => x.Title)
    .ToListAsync();
```

We can take any filter definition and call the `Inject` extension method within a `where` statement and the MongoDB LINQ provider will do some magic to inject in that query at the right point.

This is great for querying for anything that is not native to LINQ such as geo queries, text queries.

## Augmenting LINQ Caveat

The caveat to injecting in a native MongoDB query is that now the LINQ statement will only run on a LINQ provider that understands what to do when the `Inject` method is called within a where expression.

If we try to run the above LINQ statement on just a standard `List<Book>` type, you'll be presented with an `InvalidOperationException` with a message of `The LinqExtensions.Inject method is only intended to be used in LINQ Where clauses.`.

This can make it hard to test if you're just testing your LINQ queries in isolation to the database.
