---
layout: post
title: Storing GUIDs as strings in MongoDB with C#
categories:
tags: [MongoDB, C#, Serialization]
description: How to store GUID fields as strings when serializing objects in MongoDB with C#
comments: true
---

It's fairly common within C# to use GUIDs as IDs even when we're storing data inside MongoDB. It does have a little overhead as the size of a GUID is 128 bits compared to ObjectIDs which are 96 bits. However, for most application the performance overhead is negotiable.

One thing we'll notice is that the GUID is stored as [`BinData`](https://docs.mongodb.com/manual/reference/bson-types/). If we execute the following C#, we'll get a document in our collection with BinData for the `_id` field.

```csharp
internal class Order
{
    public Guid Id { get; set; }

    public Guid? ShippingReference { get; set; }

    public string Name { get; set; }
}

var client = new MongoClient();
var database = client.GetDatabase("test");
var orders = database.GetCollection<Order>("orders");

await orders.InsertOneAsync(new Order
{
    Id = new Guid("FF0186C5-C3A5-4668-9641-83FDFC111571"),
    Name = "My Order 1"
});
```

`shell>`
```javascript
> db.orders.findOne()
{
    "_id" : BinData(3,"xYYB/6XDaEaWQYP9/BEVcQ=="),
    "ShippingReference" : null,
    "Name" : "My Order 1"
}
```

Having the field as BinData makes it hard work when reading the document, however there is a method on BinData object to return a hex string of the value.

```javascript
order._id.hex()

c58601ffa5c36846964183fdfc111571
```

But as we see it returns a similar yet different string than the original C# GUID. This is because the C# driver uses the byte order returned by the ToByteArray method of the Guid class.

There's a bunch of javascript helper functions within [uuidhelpers.js](https://github.com/mongodb/mongo-csharp-driver/blob/master/uuidhelpers.js) that can be used in the mongo console to convert these BinData back and forth between a C# GUID available for atomic operations. 

```javascript
BinData(3,"xYYB/6XDaEaWQYP9/BEVcQ==").ToCSUUID()

CSUUID("ff0186c5-c3a5-4668-9641-83fdfc111571")
```

An alternative approach, when we've got access to save the data in a different form, is to override the default on the `BsonDefaults` object to be `GuidRepresentation.Standard`. This will then output the correct ordering of bytes.

```csharp
BsonDefaults.GuidRepresentation = GuidRepresentation.Standard;

await orders.InsertOneAsync(new Order
{
    Id = new Guid("FF0186C5-C3A5-4668-9641-83FDFC111571"),
    Name = "My Order 1"
});
```

`shell>`
```javascript
var order = db.orders.findOne();
> order
{
    "_id" : UUID("ff0186c5-c3a5-4668-9641-83fdfc111571"),
    "ShippingReference" : null,
    "Name" : "My Order 1"
}
```

Also, as we can see, the console shows us directly that it's a UUID. There is currently some work going on in the C# Driver to improve how GUIDs are handled and they can be tracked here [CSHARP-2074](https://jira.mongodb.org/browse/CSHARP-2074).

However, for some compatibility between systems you might also want to store your GUID as a string representation. This can have bigger performance implications due to the whooping 36 bytes size of the stringified version compared to 128 bits of the BinData! But depending on your system this might be required.

## Globally replacing the serializer

One of the ways to serialize GUIDs in C# to strings in MongoDB, is to replace the GUID Serializer. We can do this by registering the `GuidSerializer` with a constructor argument of `BsonType.String`.

```csharp
BsonSerializer.RegisterSerializer(new GuidSerializer(BsonType.String));

await orders.InsertOneAsync(new Order
{
    Id = new Guid("FF0186C5-C3A5-4668-9641-83FDFC111571"),
    Name = "My Order 1"
});
```

Now if we drop in to the console we'll see the document `_id` GUID value as a string.

```javascript
db.orders.find().pretty();
{
    "_id" : "ff0186c5-c3a5-4668-9641-83fdfc111571",
    "ShippingReference" : null,
    "Name" : "My Order 1"
}
```

This approach is a bit heavy handed as anything within your system that wants to serialize to BSON will be using a string representation for GUIDs.

As a side note, this approach also works fine with `Nullable<Guid>` too.

```csharp

await orders.InsertOneAsync(new Order
{
    Id = new Guid("FF0186C5-C3A5-4668-9641-83FDFC111571"),
    // ShippingReference is a Guid? (Nullable<Guid>)
    ShippingReference = new Guid("51034BA9-4AF8-4165-9239-B66A10EED11D"),
    Name = "My Order 1"
});
```

## Using BsonClassMaps

Another approach is to use [BsonClassMaps](https://mongodb.github.io/mongo-csharp-driver/2.3/reference/bson/mapping/), a way to describe how a normal C# class maps to a BSON document. This gives us a lot more power as we can have certain GUID fields serialized to strings and others that use the default serialization.

```csharp
BsonClassMap.RegisterClassMap<Order>(
    map =>
    {
        map.AutoMap();
        map.MapProperty(x => x.Id).SetSerializer(new GuidSerializer(BsonType.String));
    });

await orders.InsertOneAsync(new Order
{
    Id = new Guid("FF0186C5-C3A5-4668-9641-83FDFC111571"),
    ShippingReference = new Guid("51034BA9-4AF8-4165-9239-B66A10EED11D"),
    Name = "My Order 1"
});
```

Here, we are auto mapping the class based on current conventions and then applying a property map to change the serializer to be a `GuidSerializer` with a string representation.

Executing the above code will end up with the following in out collection.

```javascript
> db.orders.find().pretty()
{
    "_id" : "ff0186c5-c3a5-4668-9641-83fdfc111571",
    "ShippingReference" : BinData(3,"qUsDUfhKZUGSObZqEO7RHQ=="),
    "Name" : "My Order 1"
}
```

As you can see we've now got a mix of representations in one document. 

### Guid? in BsonClassMap

In the previous example, we set a plain GUID to serialize as string. However, if we just swap the serializer of a Nullable<Guid> (Guid?) it will throw an exception

```csharp
BsonClassMap.RegisterClassMap<Order>(
    map =>
    {
        map.AutoMap();
        map.MapProperty(x => x.Id).SetSerializer(new GuidSerializer(BsonType.String));
        map.MapProperty(x => x.ShippingReference).SetSerializer(new GuidSerializer(BsonType.String));
    });

await orders.InsertOneAsync(new Order
{
    Id = new Guid("FF0186C5-C3A5-4668-9641-83FDFC111571"),
    ShippingReference = new Guid("51034BA9-4AF8-4165-9239-B66A10EED11D"),
    Name = "My Order 1"
});
```

The above throws the following exception.

>System.ArgumentException: 'Value type of serializer is System.Guid and does not match member type System.Nullable`1[[System.Guid, System.Private.CoreLib, Version=4.0.0.0, Culture=neutral, PublicKeyToken=7cec85d7bea7798e]]. (Parameter 'serializer')'

This is because we're trying to tell the GuidSerializer to serialize a nullable guid, which has no idea who to do that. What we need to do here is wrap it in a `NullableSerializer` which will take care of the null and unwrap the value.

```csharp
BsonClassMap.RegisterClassMap<Order>(
    map =>
    {
        map.AutoMap();
        map.MapProperty(x => x.Id)
            .SetSerializer(new GuidSerializer(BsonType.String));
        map.MapProperty(x => x.ShippingReference)
            .SetSerializer(new NullableSerializer<Guid>(new GuidSerializer(BsonType.String)));
    });

await orders.InsertOneAsync(new Order
{
    Id = new Guid("FF0186C5-C3A5-4668-9641-83FDFC111571"),
    ShippingReference = new Guid("51034BA9-4AF8-4165-9239-B66A10EED11D"),
    Name = "My Order 1"
});
```
Now if we pop back in to the console we'll see the `ShippingReference` field as a string.

```javascript
> db.orders.find().pretty()
{
    "_id" : "ff0186c5-c3a5-4668-9641-83fdfc111571",
    "ShippingReference" : "51034ba9-4af8-4165-9239-b66a10eed11d",
    "Name" : "My Order 1"
}
```

## Using Convention

Using `BsonClassMap` gives us a lot of control and flexibility, however, it does mean that we'd need to go through every class that we want GUIDs represented as string, which isn't the most maintainable approach.

One of the cool features within class mapping is the ability to use a [convention based](https://mongodb.github.io/mongo-csharp-driver/2.3/reference/bson/mapping/conventions/) approach. A lot of the underling class mappings that are set by default are mapped from conventions. 

We can create a simple convention of our own that checks each property if it's a `Guid` or a `Nullable<Guid>` type and set the correct serializer.

```csharp
public class GuidAsStringRepresentationConvention : ConventionBase, IMemberMapConvention
{
    public void Apply(BsonMemberMap memberMap)
    {
        if (memberMap.MemberType == typeof(Guid))
        {
            memberMap.SetSerializer(
                new GuidSerializer(BsonType.String));
        }
        else if (memberMap.MemberType == typeof(Guid?))
        {
            memberMap.SetSerializer(
                new NullableSerializer<Guid>(new GuidSerializer(BsonType.String)));
        }
    }
}
```

We can then create a convention pack and register it with the registry.

```csharp
var pack = new ConventionPack();
pack.Add(new GuidAsStringRepresentationConvention());

ConventionRegistry.Register(
    "GUIDs as strings Conventions",
    pack,
    type => type.Namespace.StartsWith(
        typeof(Order).Namespace));
```

This convention will get applied to all classes that match the third expression argument in the register function. Which in our case returns true if the class is in the same namespace as our `Order` class.

Now if we insert our document again in to the collection we'll get our GUIDs serialized as strings.

```csharp
await orders.InsertOneAsync(new Order
{
    Id = new Guid("FF0186C5-C3A5-4668-9641-83FDFC111571"),
    ShippingReference = new Guid("51034BA9-4AF8-4165-9239-B66A10EED11D"),
    Name = "My Order 1"
});
```

```javascript
db.orders.find().pretty()
{
    "_id" : "ff0186c5-c3a5-4668-9641-83fdfc111571",
    "ShippingReference" : "51034ba9-4af8-4165-9239-b66a10eed11d",
    "Name" : "My Order 1"
}
```

## Best practice

In my personal experience, if you need to store your IDs as GUIDs I'd go for setting the `BsonDefaults.GuidRepresentation` to `GuidRepresentation.Standard`, that way your GUIDs across the system will be stored in a standard way which is also more accessible from other systems and more performant than using string.

However, if you need to use strings for cross system compatibility then I'd go down the route of creating a convention that suit your needs. That way if you take on a 3rd party library in your software that uses MongoDB driver also then you don't get weird serialization issues.