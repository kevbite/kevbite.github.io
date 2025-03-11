---
layout: post
title: Updating Arrays in MongoDB with C#
categories:
tags: [MongoDB, .NET, C#]
description: How to update complex documents containing arrays in MongoDB with C#
comments: true
---

MongoDB allows us to store complex documents with arrays, arrays of documents and even arrays of arrays. This is great from an application perspective as it allows us to directly map documents to our domain objects with no friction. 

However there might come a time where you need to update your arrays and you'll need to do it with atomic operations to avoid concurrency issues with anything else trying to modify the document. And you will have concurrency problems if you just replace the whole document! So let's explore a few ways to avoid that.

## Update a single item in an array

Sometimes our document contains arrays with single items. Below is an example of a members collection where each document contains an array of friends. This array of friends holds just an id of their friends member document. Note: For simplicity we've used an integer here, however in a real world application you'd want to consider something more scalable like [ObjectId](https://docs.mongodb.com/manual/reference/method/ObjectId/) which is MongoDB's default for a primary key.

```javascript
db.members.find().pretty()
{ "_id" : 1, "Friends" : [ 2, 3, 4 ] }
{ "_id" : 2, "Friends" : [ 1, 3 ] }
{ "_id" : 3, "Friends" : [ 1 ] }
{ "_id" : 4, "Friends" : [ 1, 3 ] }
```

To start with, we will need a C# class to model the documents in MongoDB. We could use a [BsonDocument](https://mongodb-documentation.readthedocs.io/en/latest/ecosystem/tutorial/use-csharp-driver.html#bsondocumentm), but it's much nicer to work with typed objects.

```csharp
public class Member
{
    public int Id { get; set; }

    public int[] Friends { get; set; }
}
```

We also need to get a reference to the MongoDB collection so we can start doing some operations.

```csharp
var client = new MongoClient();
var database = client.GetDatabase("test");
var members = database.GetCollection<Member>("members");
```

Now, say we want to update the member with an `_id` of `1` and their friends `3` value to `10`. We could create an update statement to find that individual document with that friend id and update it to `10`.

```csharp
var filter = Builders<Member>.Filter.Eq(x => x.Id, 1)
    & Builders<Member>.Filter.AnyEq(x => x.Friends, 3);

var update = Builders<Member>.Update.Set(x => x.Friends.FirstMatchingElement(), 10);

await members.UpdateOneAsync(filter, update);
```

Now, if we take a look at members collection we'll see that the id has now been updated.

```javascript
db.members.find().pretty()
{ "_id" : 1, "Friends" : [ 2, 10, 4 ] }
{ "_id" : 2, "Friends" : [ 1, 3 ] }
{ "_id" : 3, "Friends" : [ 1 ] }
{ "_id" : 4, "Friends" : [ 1, 3 ] }
```

You might find it weird that we're using the `FirstMatchingElement()` in our set expression as this is bespoke to MongoDB LINQ3. The update statement which is generated is equivalent to the following:

```javascript
const filter = { "_id" : 1, "Friends" : 3 };
const update = { "$set" : { "Friends.$" : 10 } };

db.members.updateOne(filter, update)
```

We can also write the update statement as the following, however it's not type safe.

```csharp
var update = Builders<Member>.Update.Set("Friends.$", 10);
```

> Note that previous to MongoDB Driver v[2.19.0](https://www.nuget.org/packages/MongoDB.Driver/2.19.0) or where [LINQ3](https://www.mongodb.com/docs/drivers/csharp/current/fundamentals/linq/) was explictly configured in MongoDB Driver greater than or equal to v[2.16.0](https://www.nuget.org/packages/MongoDB.Driver/2.16.0) we'd have to use the indexer of `-1` of the array. For example:

```csharp
var filter = Builders<Member>.Filter.Eq(x => x.Id, 1)
    & Builders<Member>.Filter.AnyEq(x => x.Friends, 3);

var update = Builders<Member>.Update.Set(x => x.Friends[-1], 10);
```

This would generate exactly the same output as above, however does generate a compiler warning of "CS0251 Indexing an array with a negative index (array indices always start at zero)" which you may want to supress.

## Update a single array document

We can extend our friends array to be an array of documents instead of a single item. Our C# class might look something like the following.

```csharp
public class Member
{
    public int Id { get; set; }

    public Friend[] Friends { get; set; }
}

public class Friend
{
    public int Id { get; set; }

    public string Name { get; set; }
}
```

Which would be related to data in our database like the following.

```javascript
db.members.find().pretty()
{
        "_id" : 1,
        "Friends" : [
                {
                        "_id" : 2,
                        "Name" : "Liam"
                },
                {
                        "_id" : 3,
                        "Name" : "Charlotte"
                },
                {
                        "_id" : 4,
                        "Name" : "Oliver"
                }
        ]
}
```

We can use the same concept as above if we want to update the `Name` field inside the array document to `"Bob"`.

```csharp
var filter = Builders<Member>.Filter.Eq(x => x.Id, 1)
    & Builders<Member>.Filter.ElemMatch(x => x.Friends, Builders<Friend>.Filter.Eq(x => x.Id, 3));

var update = Builders<Member>.Update.Set(x => x.Friends[-1].Name, "Bob");

await members.UpdateOneAsync(filter, update);
```

Notice that we're now using an [$elemMatch query](https://docs.mongodb.com/manual/reference/operator/query/elemMatch/) with a [$eq operator](https://docs.mongodb.com/manual/reference/operator/query/eq/) to match on the inner document id.

If we check our collection now we'll see that `"Charlotte"` had been changed to `"Bob"`. 

```javascript
db.members.find().pretty()
{
        "_id" : 1,
        "Friends" : [
                {
                        "_id" : 2,
                        "Name" : "Liam"
                },
                {
                        "_id" : 3,
                        "Name" : "Bob"
                },
                {
                        "_id" : 4,
                        "Name" : "Oliver"
                }
        ]
}
```

## Update all documents in an array

So far we've looked at updating one item in an array, but let's assume we want to update all the items in an array. We'll take the same example as above with the friends but this time we want to change all the friends names of `"Bob"`. We can do this with a [all positional ($[])](https://docs.mongodb.com/manual/reference/operator/update/positional-all/).
The problem with the all positional operator is that there is no type safe way to express an update query in C# so we need to fall back to a string statement.

```csharp
var filter = Builders<Member>.Filter.Eq(x => x.Id, 1);
var update = Builders<Member>.Update.Set("Friends.$[].Name", "Bob");

await members.UpdateOneAsync(filter, update);
```

If we execute the above and take a look at our collection we'll see the following.

```javascript
db.members.find().pretty()
{
    "_id" : 1,
        "Friends" : [
                {
                        "_id" : 2,
                        "Name" : "Bob"
                },
                {
                        "_id" : 3,
                        "Name" : "Bob"
                },
                {
                        "_id" : 4,
                        "Name" : "Bob"
                }
        ]
}
```

As we can see all our friends names for member id 1 have all been updated to `"Bob"`, even if we add an extra condition on the filter, we'll still get the update applied to all array items.

## Updating individual documents in an array

Within [MongoDB 3.6](https://docs.mongodb.com/manual/release-notes/3.6/#arrayfilters) array filters were introduced for many update commands. These allow you to create an identifier which can be used to match within the update operation. These filters can be extremely powerful as you can have arrays of arrays and match at each level.

Lets continue using our members collection but we want to match either id `2` or `4` and update their name to `"Bob"`.

```csharp
var filter = Builders<Member>.Filter.Eq(x => x.Id, 1);

var update = Builders<Member>.Update.Set("Friends.$[f].Name", "Bob");

var arrayFilters = new[]
{
    new BsonDocumentArrayFilterDefinition<BsonDocument>(
        new BsonDocument("f._id",
                new BsonDocument("$in", new BsonArray(new [] { 2, 4 })))),
};

await members.UpdateOneAsync(filter, update, new UpdateOptions{ArrayFilters = arrayFilters});
```

Our filter now just matches on the exact document based on id. The array filtering is done within the array filter options which include an identifier and then the filter on that identifier, in our case we're using a `$in` operator, is matching a selection of ids from an array `new [] {2, 4}`.
This identifier is then used within the update statement with the `[<identifier>]` to reference the match.

Now if we check our members collection we'll see everything updated as expected

```csharp
db.members.find().pretty()
{
        "_id" : 1,
        "Friends" : [
                {
                        "_id" : 2,
                        "Name" : "Bob"
                },
                {
                        "_id" : 3,
                        "Name" : "Charlotte"
                },
                {
                        "_id" : 4,
                        "Name" : "Bob"
                }
        ]
}
```

Using `BsonDocument`'s can get a bit ugly and complex depending on your situation, so you might prefer the alternative approach of using a json strings instead. This can be achieved by creating a `JsonArrayFilterDefinition<T>` instead of a `BsonDocumentArrayFilterDefinition<T>`.

```csharp
var arrayFilters = new[]
{
    new JsonArrayFilterDefinition<BsonDocument>(@"{ ""f._id"" : { $in : [ 2, 4 ] } }")
};
```

These json strings are the same that you'd normally use in the mongo console. But you need to be careful as you might end up with some injection attacks if you're concatenating invalidated strings inputs.

## Wrapping up

MongoDB can cater for all your needs of updating an array, and arrays of documents. However, keep in mind that complexity increases for more demanding requirements. So, start off with the simple positional operators on update statements and if there's a good use for them, do try out the array filters.