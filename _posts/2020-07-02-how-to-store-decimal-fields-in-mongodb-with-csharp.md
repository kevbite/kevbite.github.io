---
layout: post
title: Storing decimals values in MongoDB with C#
categories:
tags: [MongoDB, C#, Serialization, Decimal]
description: How to store decimal fields in MongoDB with C#
comments: true
---

If we're dealing with any numerical value such as money that requires exact precision, we'll need to store these in MongoDB so we don't occur any loss of data.

Prior MongoDB version 3.4 there was no [Decimal BSON Type](http://bsonspec.org/spec.html), if we wanted to store any numerical value where we needed exact precision we'd store it as a string. This has problems with queries and aggregations because we can't use any arithmetic operations as our data is just being stored as a plain string. Within the latest version of MongoDB engine there is however lots of conversion operations ([$toDecimal](https://docs.mongodb.com/manual/reference/operator/aggregation/toDecimal/)), however, these won't be as performant due to not being able to utilize indexes on the string fields.

By default, in version [2.10.4](https://www.nuget.org/packages/MongoDB.Driver/2.10.4) of the C# driver it stores C# decimals are strings in MongoDB.

```csharp
var Order = new MongoClient();
var db = Order.GetDatabase("test");
var collection = db.GetCollection<Order>("orders");

await db.DropCollectionAsync(collection.CollectionNamespace.CollectionName);

await collection.InsertOneAsync(new Order
{
    Total = 40.20m
});

class Order
{
    public ObjectId Id { get; set; }

    public decimal Total { get; set; }
}
```

```javascript
> db.orders.findOne()
{ "_id" : ObjectId("5efe3d97477d4a46c9ec9c59"), "Total" : "40.20" }
```

## Storing Decimals as BSON decimal

As we've mentioned previously there is downsides to storing the values as string, so we really want to store our decimals as BSON decimals in MongoDB.

There's a few approaches to achieving, but depending on how we're developing our application a certain approach might fit better.

### BSON Decimal128 with Attributes

The simplest approach is to add a C# `BsonRepresentation` attribute on the properties that you want to represent as `Decimal128`.

```csharp
internal class Order
{
    public ObjectId Id { get; set; }
    
    [BsonRepresentation(BsonType.Decimal128)]
    public decimal Total { get; set; }
}
```
Now when we save a the order in to our database we'll get the following store.

```javascript
> db.orders.findOne()
{
    "_id" : ObjectId("5efe3db7477d4a46c9ec9c5a"),
    "Total" : NumberDecimal("40.20")
}
```

The nice thing about to approach is it very precise on which properties we want to store as Decimal128. We can alternately do these as [ClassMap](https://mongodb.github.io/mongo-csharp-driver/2.10/reference/bson/mapping/)


### BSON Decimal128 with ClassMaps

We can also declaratively describe our mapping to BSON with a `ClassMap` this can be created using the C# below.

```csharp
BsonClassMap.RegisterClassMap<Order>(map =>
{
    map.AutoMap();
    map.MapProperty(x => x.Total)
        .SetSerializer(new DecimalSerializer(BsonType.Decimal128));
});
```

This sets the serializer for our `Total` property to a decimal serializer that stores it as BSON Decimal128.

```javascript
> db.orders.findOne()
{
    "_id" : ObjectId("5efe3dc0477d4a46c9ec9c5b"),
    "Total" : NumberDecimal("40.20")
}
```

### Settings a Global Serializer

If we want our whole application to store C# decimals as BSON Decimals we can register the `DecimalSerializer` globally within our application. This has a short downside that anything that stores decimals in to MongoDB will automatically get saved as BSON Decimals.

```csharp
BsonSerializer.RegisterSerializer(new DecimalSerializer(BsonType.Decimal128));
```

```javascript
> db.orders.findOne()
{
    "_id" : ObjectId("5efe3dce477d4a46c9ec9c5c"),
    "Total" : NumberDecimal("40.20")
}
```

## What Should We Choose?

I feel for most applications setting the `DecimalSerializer` globally with the representation of `BsonType.Decimal128` is totally fine and should be the default, however, due to the legacy of MongoDB not supporting decimal from the start, I can see why it defaults to strings for backwards compatibility.