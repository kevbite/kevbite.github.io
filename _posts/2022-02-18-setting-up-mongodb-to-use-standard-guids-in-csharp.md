---
layout: post
title: Setting up MongoDB to Use Standard GUIDs in C#
categories:
tags: [.NET, C#, MongoDB, GUID]
description: How to setup a MongoDB to Use Standard GUIDs within C#
comments: true
---

If you've ever use MongoDB across multiple languages and tools, you might have noticed that the GUIDs get represented totally different. It becomes a big issue as when you pass the string representation of that GUID to another system and it can't find that document due to the how the GUIDs are represented.

It was common for people to write a bunch of conversion methods between each type of representation, here's an example of [uuidHelpers.js](https://gist.github.com/davideicardi/b0228fbc0d2e0a65bfc0f70a3cb8d9cf) which is file full of JavaScript helper functions.

Let's take some C# code for example and see what gets saved in the database to start with

```csharp
var mongoClient = new MongoClient();
var mongoDatabase = mongoClient.GetDatabase("test");
var mongoCollection = mongoDatabase.GetCollection<Data>("data");

await mongoCollection.InsertOneAsync(new Data
{
    Guid1 = Guid.NewGuid()
});

var result = await mongoCollection.Find(Builders<Data>.Filter.Empty).ToListAsync();

foreach (var data in result)
{
    Console.WriteLine("{0}: {1}", data.Id, data.Guid1);
}

public class Data
{
    public ObjectId Id { get; set; }
    public Guid Guid1 { get; set; }
}
```

When we run the above code we'll see that we get a BinData sub type 3 stored for our Guid1 field.
```shell
> db.data.find()
{ "_id" : ObjectId("620fdff2cb04aa50d3c13d19"), "Guid1" : BinData(3,"xi6M3jaSUESCpLCKKWIRrA==") }
```

The BinData sub type of 3 is a "UUID (Old)" which you can find within the [BSON spec](https://bsonspec.org/spec.html).

The default setup for the C# driver is to use the GUID representation of C# legacy, however, I'd recommended to use the GUID representation of standard.

We can set the driver to use the standard representation before we do any operations with the MongoDB driver, This is done by registering a new BSON serializer for the GUIDs.

```csharp
BsonSerializer.RegisterSerializer(new GuidSerializer(GuidRepresentation.Standard));
```

Now if we execute the same code again we'll get the following results
```shell
> db.data.find()
{ "_id" : ObjectId("620fe184a350da97127fcae5"), "Guid1" : UUID("9b927360-b531-4bb9-9e09-1a3093f8507a") }
```

This is now using the new UUID BinData sub type which will make it easier to deal with.

However, mentioned in the comments not all queries seem to work using this method. If you take the following code for example.

```csharp

var guid = Guid.NewGuid();
await collection.InsertOneAsync(new Data
{
    Guid1 = guid
});

var result = await collection.Find(Builders<Data>.Filter.Eq(x => x.Guid1, guid)).SingleAsync();

Console.WriteLine("{0}: {1}", result.Id, result.Guid1);
```
It'll throw an `InvalidOperationException` exception with a message of `Sequence contains no elements` as nothing is returned in the query.

To fix this issue we'll also need to set the `GuidRepresentationMode` to `V3`. We'll also need to disable some warnings as the property is obsolete and will be removed in the next version of the driver.

```csharp
#pragma warning disable CS0618
BsonDefaults.GuidRepresentation = GuidRepresentation.Standard;
BsonDefaults.GuidRepresentationMode = GuidRepresentationMode.V3;
#pragma warning restore CS0618
BsonSerializer.RegisterSerializer(new GuidSerializer(GuidRepresentation.Standard));
```

Now when we run the above `find` query we'll get the correct results.

More information on this can be found by reading [C# GUID Style dont work article](https://www.mongodb.com/community/forums/t/c-guid-style-dont-work/126901/4)