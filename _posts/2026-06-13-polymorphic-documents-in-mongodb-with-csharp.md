---
layout: post
title: Polymorphic documents in MongoDB with C#
categories:
tags: [.NET, C#, MongoDB, Polymorphism]
description: Why MongoDB is a great fit for polymorphic domain models, how to set them up with the C# driver, and what the discriminator convention choice means for your indexes.
comments: true
---

## Overview

At [Exizent](https://www.exizent.com/products) we build software to help professionals administer a deceased person's estate: probate, asset collection, tax returns, distributions to beneficiaries, the whole lot. One of the core concepts in the platform is the **estate itself**: a single aggregate that holds everything we know about what the deceased owned and owed at the point of death.

In domain terms, a `Case` is the aggregate root and embedded inside it is a collection of `EstateItem` documents. An estate can contain bank accounts, ISAs, pensions, vehicles, buildings, mortgages, credit cards, cryptocurrency, premium bonds... the list goes on. Each of these is fundamentally an estate item and they all share a common identity, a location, timestamps, archival state, but each has its own shape. A `BankAccount` has a sort code and account number. A `Vehicle` has a registration plate, mileage, and year of manufacture. A `Pension` has a plan reference.

That's a textbook polymorphic collection, and MongoDB handles it beautifully. This post covers how to wire it up with the C# driver, what actually ends up in the database, and most importantly, how the choice of discriminator convention has real consequences for your indexes.

## The Domain Model

To keep examples grounded, here's a example of the type hierarchy we're working with:

```csharp
public abstract record EstateItem(
    Guid Id,
    DateTime CreatedAt,
    DateTime UpdatedAt,
    string? Notes,
    bool IsArchived,
    bool IsComplete
);

public record BankAccount(
    Guid Id,
    DateTime CreatedAt,
    DateTime UpdatedAt,
    string? Notes,
    bool IsArchived,
    bool IsComplete,
    string? SortCode,
    string? AccountNumber,
    decimal? Balance
) : EstateItem(Id, CreatedAt, UpdatedAt, Notes, IsArchived, IsComplete);

public record Pension(
    Guid Id,
    DateTime CreatedAt,
    DateTime UpdatedAt,
    string? Notes,
    bool IsArchived,
    bool IsComplete,
    string? PlanReference
) : EstateItem(Id, CreatedAt, UpdatedAt, Notes, IsArchived, IsComplete);

public record Vehicle(
    Guid Id,
    DateTime CreatedAt,
    DateTime UpdatedAt,
    string? Notes,
    bool IsArchived,
    bool IsComplete,
    string? RegistrationPlate,
    int? Mileage,
    decimal? Value
) : EstateItem(Id, CreatedAt, UpdatedAt, Notes, IsArchived, IsComplete);
```

And the `Case` aggregate holds a list of them:

```csharp
public record Case(
    Guid Id,
    IReadOnlyList<EstateItem> EstateItems,
    DateTime CreatedAt,
    DateTime UpdatedAt
);
```

## Setting Up Polymorphic Serialization

The C# MongoDB driver uses **class maps** to control how types are serialised to and from BSON. For a polymorphic hierarchy you register the base type first, marking it as the root, then register each concrete subtype:

```csharp
BsonClassMap.RegisterClassMap<EstateItem>(map =>
{
    map.AutoMap();
    map.SetIsRootClass(true);
});

BsonClassMap.RegisterClassMap<BankAccount>(map => map.AutoMap());
BsonClassMap.RegisterClassMap<Pension>(map => map.AutoMap());
BsonClassMap.RegisterClassMap<Vehicle>(map => map.AutoMap());
```

`SetIsRootClass(true)` is the key call. It tells the driver that `EstateItem` is the top of a polymorphic hierarchy and that a discriminator field (`_t`) must be written for every document in the collection, regardless of which concrete type it is.

`AutoMap()` on a derived type does everything you'd expect, it runs all the applicable [convention packs](https://www.mongodb.com/docs/drivers/csharp/current/serialization/#conventions). You can customise individual member maps afterwards, for example to suppress optional fields when they're empty:

```csharp
BsonClassMap.RegisterClassMap<Pension>(map =>
{
    map.AutoMap();
    map.GetMemberMap(x => x.PlanReference)
       .SetShouldSerializeMethod(o => o is Pension { PlanReference.Length: > 0 });
});
```

### What ends up in MongoDB

Once wired up, a `BankAccount` stored inside a `Case` document looks roughly like this:

```json
{
  "_id": "...",
  "estateItems": [
    {
      "_t": "BankAccount",
      "_id": "a1b2c3d4-...",
      "sortCode": "30-00-00",
      "accountNumber": "12345678",
      "balance": 8450.00,
      "isArchived": false,
      "isComplete": true,
      "createdAt": { "$date": "2025-01-15T09:00:00Z" },
      "updatedAt": { "$date": "2025-03-01T14:22:00Z" }
    },
    {
      "_t": "Pension",
      "_id": "e5f6a7b8-...",
      "planReference": "AV-9988776",
      "isArchived": false,
      "isComplete": false,
      "createdAt": { "$date": "2025-01-15T09:05:00Z" },
      "updatedAt": { "$date": "2025-01-15T09:05:00Z" }
    }
  ]
}
```

The `_t` field is the discriminator. When the driver deserialises the `estateItems` array it reads `_t` on each element, looks up the registered class map, and returns the correct concrete type. From your application's perspective you just get back a `List<EstateItem>` and you can pattern match on the concrete types as you normally would.

## Polymorphism at the Root Level

The same pattern is not limited to embedded documents. The root document stored in a MongoDB collection can be polymorphic too, and wiring it up works exactly the same way.

In the estate administration world you might have different *kinds* of case. A `ProbateCase` is one where the deceased left a valid will, a `IntestacyCase` is one where they did not. Both share the same core structure but carry different fields:

```csharp
public abstract record Case(
    Guid Id,
    IReadOnlyList<EstateItem> EstateItems,
    DateTime CreatedAt,
    DateTime UpdatedAt
);

public record ProbateCase(
    Guid Id,
    IReadOnlyList<EstateItem> EstateItems,
    DateTime CreatedAt,
    DateTime UpdatedAt,
    DateTime WillDate,
    string? WillLocation
) : Case(Id, EstateItems, CreatedAt, UpdatedAt);

public record IntestacyCase(
    Guid Id,
    IReadOnlyList<EstateItem> EstateItems,
    DateTime CreatedAt,
    DateTime UpdatedAt,
    bool NextOfKinLocated,
    string? NextOfKinDetails
) : Case(Id, EstateItems, CreatedAt, UpdatedAt);
```

Register them the same way as before:

```csharp
BsonClassMap.RegisterClassMap<Case>(map =>
{
    map.AutoMap();
    map.SetIsRootClass(true);
});

BsonClassMap.RegisterClassMap<ProbateCase>(map => map.AutoMap());
BsonClassMap.RegisterClassMap<IntestacyCase>(map => map.AutoMap());
```

### GetCollection\<T\>

When you retrieve the collection from the database you use the base type as the generic parameter:

```csharp
IMongoCollection<Case> collection = database.GetCollection<Case>("cases");
```

This is the key point: the collection is typed to `Case`, not to any specific subtype. When you read from it the driver inspects `_t` on each root document and deserialises to the correct concrete type automatically. When you write, the discriminator is included automatically. You do not need separate collections for `ProbateCase` and `IntestacyCase`, they all live together in `cases`.

A `ProbateCase` document in the collection looks like this:

```json
{
  "_t": "ProbateCase",
  "_id": "c9d0e1f2-...",
  "willDate": { "$date": "2020-05-01T00:00:00Z" },
  "willLocation": "Solicitor safe",
  "estateItems": [],
  "createdAt": { "$date": "2025-01-15T09:00:00Z" },
  "updatedAt": { "$date": "2025-01-15T09:00:00Z" }
}
```

Notice that `_t` sits at the root of the document rather than nested inside an array element. MongoDB indexes and queries it in exactly the same way.

### Filtering by concrete type at the root

The `OfType<T>` filter works at the collection level too:

```csharp
// All probate cases
var probateCases = await collection
    .Find(Builders<Case>.Filter.OfType<ProbateCase>())
    .ToListAsync();

// Probate cases where the will is held at a specific location
var filter = Builders<Case>.Filter.OfType<ProbateCase>(
    Builders<ProbateCase>.Filter.Eq(c => c.WillLocation, "Solicitor safe"));

var results = await collection.Find(filter).ToListAsync();
```

The driver translates the first query to `{ "_t": "ProbateCase" }` and the second to a compound filter that also matches on `willLocation`. All of the concrete-type fields are fully queryable even though the collection is typed to the abstract base.

## Scalar vs Hierarchical Discriminator Conventions

The driver ships with two conventions that control the shape of `_t`. Choosing between them has knock-on effects for indexing, so it's worth understanding both before you pick one.

### ScalarDiscriminatorConvention

This is the default. The discriminator is a **single string** containing the name of the concrete type:

```json
{ "_t": "BankAccount" }
```

You register it explicitly (which also serves as documentation of the choice):

```csharp
BsonSerializer.RegisterDiscriminatorConvention(
    typeof(EstateItem),
    StandardDiscriminatorConvention.Scalar);
```

Querying for all bank accounts across cases looks like this at the MongoDB level:

```json
{ "estateItems._t": "BankAccount" }
```

And in the C# driver:

```csharp
var filter = Builders<Case>.Filter.ElemMatch(
    c => c.EstateItems,
    Builders<EstateItem>.Filter.OfType<BankAccount>());
```

The driver generates the `_t` equality check for you.

### HierarchicalDiscriminatorConvention

With this convention the discriminator becomes an **array** that includes every type in the inheritance chain from the root down to the concrete type:

```json
{ "_t": ["EstateItem", "BankAccount"] }
```

Registered as:

```csharp
BsonSerializer.RegisterDiscriminatorConvention(
    typeof(EstateItem),
    StandardDiscriminatorConvention.Hierarchical);
```

The upside is that you can query for all items that are *any subtype* of a given base using a single `_t` equality filter, without knowing the concrete type names:

```json
{ "estateItems._t": "EstateItem" }
```

That could be handy if you had intermediate abstract types in your hierarchy. For instance if we had a `FinancialAccount` sitting between `EstateItem` and `BankAccount`, and you wanted to find all financial accounts without listing every leaf type. In a flat hierarchy like ours the benefit largely disappears.

## Indexing Considerations

This is where the convention choice starts to matter in production.

### Scalar keeps _t a plain string

With `Scalar`, `estateItems._t` is a string field inside an array of sub-documents. A standard ascending index on that field works exactly as you'd expect:

```javascript
db.cases.createIndex({ "estateItems._t": 1 })
```

MongoDB treats this as a **multikey index** because `estateItems` is an array, but the indexed field itself (`_t`) is a scalar within each element. This is the normal, well-understood case for indexing into an array of objects.

### Hierarchical turns _t into an array of arrays, a true multikey field

With `Hierarchical`, each `estateItems` element looks like `{ "_t": ["EstateItem", "BankAccount"], ... }`. Now `_t` is itself an array. That means the index on `estateItems._t` becomes a **multikey index over an array field within an array**. MongoDB must index every combination, which is more expensive to maintain and comes with a set of constraints worth knowing about.

#### 1. Only one array field per compound index

MongoDB does not allow a compound index where more than one indexed field comes from an array. With `Hierarchical` the `_t` field is itself an array, so if you try to build a compound index that also covers another array-derived field on the same sub-document:

```javascript
// This will fail at index creation time
db.cases.createIndex({
  "estateItems._t": 1,
  "estateItems.jointOwners": 1
})
```

You get an error along the lines of `"cannot index parallel arrays"`. With `Scalar`, `_t` is a string, not an array, so this restriction only applies when *both* fields you are combining are arrays, a much rarer situation.

#### 2. The equality-before-array-before-range rule still applies, but array is now earlier

The classic ESR (Equality, Sort, Range) index design rule tells you to put equality predicates first, sort fields second, and range predicates last. When multikey fields are involved there is an additional consideration: array fields should come *after* equality fields but *before* range fields, because an index on an array field cannot be used to satisfy a sort and range in the same pass as efficiently as a scalar field can.

With `Scalar`, `_t` is a scalar, so it slots neatly into the equality position:

```javascript
// Scalar: _t is equality, then range on a scalar field - efficient
db.cases.createIndex({ "estateItems._t": 1, "estateItems.balance": 1 })
```

With `Hierarchical`, `_t` is an array field, meaning it is already in the "array" slot. That pushes your other fields around and limits how useful the compound index can be when you combine type filtering with range queries.

#### 3. Sorting after a multikey field can require an in-memory sort

This is the one most likely to bite you in a real application. MongoDB can satisfy a sort from an index when the sort fields form a prefix (or a continuation) of the index key pattern and none of the preceding fields are multikey. Once a multikey field appears in the index, MongoDB can no longer guarantee that the index order matches the sort order for documents matching the query, and it may fall back to an in-memory (blocking) sort.

With `Scalar`, `_t` acts like any other string equality field. A query that filters on `_t` and sorts on `updatedAt` can be served entirely from an index:

```javascript
db.cases.createIndex({ "estateItems._t": 1, "estateItems.updatedAt": -1 })
```

With `Hierarchical`, the same index shape may not be able to satisfy the sort from the index alone if MongoDB determines that the multikey nature of `_t` prevents it from walking the index in sort order. You would see `"stage": "SORT"` (an in-memory sort) in `explain()` output rather than `"stage": "IXSCAN"` driving the sort directly.

For a collection that holds thousands of cases each with dozens of estate items, an in-memory sort on a query that runs frequently is a meaningful difference.

### The practical takeaway

Unless you have a deep inheritance hierarchy where querying by an intermediate base type is a genuine requirement, `Scalar` is the safer default. The discriminator stays a plain string, indexes behave predictably, and you avoid the multikey-within-multikey constraints entirely. That is why we register it explicitly in our codebase. It makes the intent clear and prevents the driver from silently applying `Hierarchical` if the default ever changes.

## Querying and Updating Just Works

One of the nicest things about this setup is that once the class maps are registered, the C# driver handles the discriminator transparently in both directions.

### Filtering by concrete type

```csharp
// Find all cases that contain at least one bank account
var filter = Builders<Case>.Filter.ElemMatch(
    c => c.EstateItems,
    Builders<EstateItem>.Filter.OfType<BankAccount>());

var cases = await collection.Find(filter).ToListAsync();
```

The driver rewrites this to `{ "estateItems._t": "BankAccount" }` behind the scenes. You never write the discriminator value by hand.

You can combine type filters with field filters on the concrete type:

```csharp
// Cases with a bank account balance over £10,000
var bankAccountFilter = Builders<EstateItem>.Filter.OfType<BankAccount>(
    Builders<BankAccount>.Filter.Gt(b => b.Balance, 10_000m));

var filter = Builders<Case>.Filter.ElemMatch(c => c.EstateItems, bankAccountFilter);
```

### Pushing a new item into the array

```csharp
var newPension = new Pension(
    Id: Guid.NewGuid(),
    CreatedAt: DateTime.UtcNow,
    UpdatedAt: DateTime.UtcNow,
    Notes: null,
    IsArchived: false,
    IsComplete: false,
    PlanReference: "SW-112233");

var update = Builders<Case>.Update
    .Push(c => c.EstateItems, newPension)
    .CurrentDate(c => c.UpdatedAt);

await collection.UpdateOneAsync(
    Builders<Case>.Filter.Eq(c => c.Id, caseId),
    update);
```

The driver serialises the `Pension` record with `"_t": "Pension"` automatically as part of the `$push`. You do not need to set the discriminator yourself.

### Updating a specific item within the array

Using positional array filters you can update a field on a specific estate item by its id, regardless of its concrete type:

```csharp
var update = Builders<Case>.Update
    .Set("estateItems.$[item].isComplete", true)
    .CurrentDate(c => c.UpdatedAt);

var options = new UpdateOptions
{
    ArrayFilters = [new BsonDocumentArrayFilterDefinition<EstateItem>(
        new BsonDocument("item._id", estateItemId))]
};

await collection.UpdateOneAsync(
    Builders<Case>.Filter.Eq(c => c.Id, caseId),
    update,
    options);
```

The string path `"estateItems.$[item].isComplete"` is unavoidable here. The C# driver's expression-based `Set` overload does not support the positional filtered operator (`$[<identifier>]`), so the field path has to be written as a string. Everything else (the filter, the array filter definition, and the update itself) is as strongly typed as the driver allows for this operation.

If you want a deeper look at the different ways to update array elements in MongoDB with C#, I have a dedicated post covering all the positional operators: [Updating arrays in MongoDB with C#](https://kevsoft.net/2020/03/23/updating-arrays-in-mongodb-with-csharp.html).

## Conclusion

MongoDB's document model is a natural fit for polymorphic aggregates. Embedding a heterogeneous collection like `EstateItems` inside a `Case` document gives you a clean, self-contained representation of an estate with no joins and no discriminator tables.

Getting the C# driver to serialise and deserialise that collection correctly is a matter of registering the base class with `SetIsRootClass(true)` and calling `AutoMap()` on each concrete type. After that, filters, pushes, and positional updates all handle the discriminator for you.

The one decision that deserves real thought before you go to production is the discriminator convention. `Scalar` keeps `_t` as a plain string and behaves predictably with compound indexes. `Hierarchical` turns `_t` into an array of type names, which enables ancestor-type queries but introduces multikey index constraints (only one array field per compound index, reduced ability to drive sorts from the index) that can be hard to work around at scale. For a flat hierarchy, `Scalar` wins almost every time.






