---
layout: post
title: Finding documents in MongoDB using C#
categories:
tags: [MongoDB, .NET, C#]
description: How to find documents in MongoDB using C# .NET
comments: true
---

MongoDB is a very flexible database and is renowned for its easy of use and scalability. It gets rid of all the nasty database tasks that you'd normally end up doing with a more traditional database and just allows you to get on with developing your application, thus making creating your application cheaper and iterations faster.

A lot of people are using MongoDB with [Node.js](https://nodejs.org/en/), however there are loads of support for other [languages and platforms](https://docs.mongodb.com/ecosystem/drivers/).

One of these platforms is .NET, and MongoDB still has the same benefits too.

One of the main problems with starting off with MongoDB and C# is most of the examples are based around the Node.js driver or using the MongoDB shell. So we're going to look at how we map queries written in the MongoDB shell to C#.

## Finding a document

When you want to query a document in MongoDB, the driver actually sends a document which represents the query, this document looks something like the below:

```json
{ _id: ObjectId("507f1f77bcf86cd799439011")}
```

The above query will return documents where the `_id` property of the object exactly matches the object id of `ObjectId("507f1f77bcf86cd799439011")`.

MongoDB has a large range of [query selectors](https://docs.mongodb.com/manual/reference/operator/query/#query-selectors) that can be combined to target documents. These are operators such as `$eq`, `$ne`, `$lte` and `$gte`, we can also use logical operators like `$and` and `$or`.

So say we are looking for all documents outside a date ranges, it would look like this:

```json
{
    "$or": [
        {"date" : { "$lt": ISODate("2021-01-01") } },
        {"date" : { "$gte": ISODate("2020-01-01") } }
    ]
}
```

## Finding a document using C#

We've not really talked about how this is achieved in C#, but like most things in software development there is lots of ways to achieve the same outcome but they all have their own caveats. So we'll go through a few examples.

Before we even start finding documents we need to create a `MongoClient` which we will then use to fetch the database and collection instances.

```csharp
var client = new MongoClient();

var database = client.GetDatabase("test");

var events = database.GetCollection<BsonDocument>("events");
```

As you might have noticed we have passed in `BsonDocument` as a generic argument to the `GetCollection` method, alternatively we could create our own typed class to represent our event data in the document.

```csharp
public class Event
{
    public ObjectId Id { get; set; }

    public string Name { get; set; }

    public DateTime At { get; set; }
}

var events = database.GetCollection<Event>("events");
```

This means we can model our documents as typed objects in C# and they'll automatically get serialized and deserialized when required.

### Basic

The most basic way to find a document using the C# driver is just to pass a string json object in to the `Find` method on the collection, this means we can take our above matching and pass it as a string.

```csharp
var @event = await _collection.Find($"{ { _id: ObjectId('507f1f77bcf86cd799439011') } }")
    .SingleAsync(); 
```

In theory we can parameterize the string by using string concatenation, which will allow us to pass in any object Id.

```csharp
var id = new ObjectId("507f1f77bcf86cd799439011");

var @event = await _collection.Find($"{ { _id: ObjectId('{id}') } }")
    .SingleAsync(); 
```

Be careful though, if you are accepting arbitrary input as string from the user they might be able to execute something that you wasn't expecting.

### Expressions

Another way to find the document is to pass in an expression, if you're familiar with `.Where` in LINQ it's very similar.

```csharp
var id = new ObjectId("507f1f77bcf86cd799439011");

var @event = await _collection.Find(x => x.Id == id)
        .SingleAsync();
```

This stops the problem before with our arbitrary input, but it's harder to compose parts of queries together.

### Builders

Within the MongoDB C# driver we have a `Builders<T>` object that allows us to build up filter expressions.

```csharp
var filter = Builders<Event>.Filter.Eq(x => x.Id, id);

var @event = await _collection.Find(filter)
        .SingleAsync();
```

Using `Builders<T>.Filter` has the benefit that it allows us to compose filters together.

```csharp
var filter = Builders<Event>.Filter.Gt(x => x.At, date);
if (filterName)
{
    filter = filter & Builders<Event>.Filter.Eq(x => x.Name, name);
}

var @event = await _collection.Find(filter)
    .SingleAsync();
```

Our above example allows us to compose filters together, even with conditions of what filters we want to apply and when.

### BsonDocument

The last approach is to use a `BsonDocument`, this is an object that represents the dynamic data of the Bson document but in a typed way, because of this it allows us to do anything we really want.

```csharp
var filter = new BsonDocument { { "_id", id } };

var @event = await _collection.Find(filter)
    .SingleAsync();
```

`BsonDocument` is useful when the `Builders<T>` object has not been updated with the latest version of the query operators, compared to what is available on the database engine.

### Overall

As you can see there are many way to find documents using the C# MongoDB Driver, however the most type safe and flexible way is to use the `Builders<T>` object.

