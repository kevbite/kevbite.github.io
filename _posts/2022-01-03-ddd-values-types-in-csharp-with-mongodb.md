---
layout: post
title: DDD Values Types in C# with MongoDB
categories:
tags: [.NET, C#, MongoDB, DDD]
description: Domain Driven Design value types in C# with MongoDB
comments: true
---

## Records in C#9/10

Class record types were released in C#9 and recently with the release of C#10, we now have the ability to use struct record types.

These are declared very similar, with the class record type you can however omit the `class` keyword for shorthand.

```csharp
// Class Record
class record Order(Guid Id, Money Total);
// or
record Order(Guid Id, Money Total);

// Struct Record
struct record Money(int Amount);
// or
readonly struct record Money(int Amount);
```

Records have loads of benefits, one of the main ones is immutability. Records also make it super easy for us to start creating DDD (Domain Driven Design) Value Types, as previously in C# we'd end up with lots of boiler plate code.

Our money example above is a great value type, it also allows us to make sure that it's always in a valid state. It also means that methods that we're passing money in to are the correct types and we don't get any type miss matches.

```csharp
new Order(Guid.NewGuid, 100)
// Compiler Warning
// Program.cs: [CS1503] Argument 2: cannot convert from 'int' to 'Money'
```

## Values Types in MongoDB with C#

Let's start off by saving a `Order` in to a `orders` collection with all the default MongoDB driver settings.

```csharp
var client = new MongoClient();
var db = client.GetDatabase("test");
var collection = db.GetCollection<Order>("orders");

var order = new Order(Guid.NewGuid(), new Money(100));
await collection.InsertOneAsync(order);

public record Order(Guid Id, Money Amount);
public readonly record struct Money(int Amount);
```

If we query MongoDB with the Shell we can checkout what was stored.

```bash
> db.orders.find()
{ "_id" : BinData(3,"y+y4k9Kjvke5zdPCwMCc2w=="), "Amount" : { "Amount" : 100 } }
```

As you can see we get an document with an embedded document of `Amount` with the amount value on that document.
What we really want to see is the below where the value is at the root level.
```json
{ "_id" : BinData(3,"y+y4k9Kjvke5zdPCwMCc2w=="), "Amount" : 100 }
```

## Write a Custom Serializer

To achieve the above, we need to create a custom serializer. The C# Driver comes with a base class of `SerializerBase<T>` which we can derive from and implement our code.

```csharp
public class MoneySerializer : SerializerBase<Money>
{
    private readonly IBsonSerializer<int> _intSerializer;
    public MoneySerializer(IBsonSerializer<int> intSerializer) => _intSerializer = intSerializer;

    public override Money Deserialize(BsonDeserializationContext context, BsonDeserializationArgs args)
        => new Money(_intSerializer.Deserialize(context, args));

    public override void Serialize(BsonSerializationContext context, BsonSerializationArgs args, Money value)
        => _intSerializer.Serialize(context, args, value.Amount);
}
```

Above we're creating a `MoneySerializer` that requires a `IBsonSerializer<int>` which we'll use to serialize and deserialize our amount value which is stored as a `int`. Most of our custom serializer is delegation code.

Now to register our new serializer we have to call the static method `RegisterSerializer` on the `BsonSerializer` class.

```csharp
var intBsonSerializer = BsonSerializer.SerializerRegistry.GetSerializer<int>();
BsonSerializer.RegisterSerializer(new MoneySerializer(intBsonSerializer));
```

Also note we're also finding the `IBsonSerializer<int>` that our custom serializer requires from the `SerializerRegistry` which is also on the `BsonSerializer` class.

Now if we run the same code as above, and checkout the values from the shell we'll get some different values.

```shell
> db.orders.find()
{ "_id" : BinData(3,"xaCYobzzLkS/QgCV5zw3PQ=="), "Amount" : 100 }
```

Now we can embrace using value types within our C# projects and get the MongoDB driver to serialize them as we expect them to be written to the database. 