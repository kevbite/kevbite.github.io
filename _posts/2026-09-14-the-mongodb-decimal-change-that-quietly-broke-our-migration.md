---
layout: post
title: "The MongoDB Decimal Change That Quietly Broke Our Migration"
categories:
tags: [MongoDB, C#, .NET, Serialization, Migrations]
description: How the default decimal representation flipped between MongoDB C# driver v2 and v3, why our update aggregation fell over, and how we fixed it
comments: true
---

Every so often you upgrade a dependency, watch the tests go green, ship it, and think nothing more of it. Then weeks later something falls over in a way that has you staring at a migration that swears blind it ran, yet somehow changed nothing at all. That's exactly what happened to us when we moved the MongoDB C# driver from v2 to v3, and the culprit was a one-line default that flipped under our feet: how a `decimal` gets stored.

This one bit us on a real system, so before we go any further I'm going to recast the domain. The actual code was part of an estate management platform doing sums over physical share holdings, but that carries a lot of baggage you don't need. So for the rest of this post we're a humble online shop, and every share holding becomes an **order line** where `LineTotal = UnitPrice × Quantity`. Same shape, same bug, far fewer things to explain.

## What actually changed between v2 and v3

Here's the whole of it. In the MongoDB C# driver **before v3**, a `decimal` was serialised as a **BSON string** by default. From **v3 onwards**, it's serialised as a **`Decimal128`**. Straight from the [driver's upgrade notes](https://www.mongodb.com/docs/drivers/csharp/upgrading/):

> By default, the driver serializes `Decimal128` and `decimal` values as BSON `Decimal128` values. In previous versions of the driver, the driver serialized these values as BSON string values by default.

I've written [about storing decimals in MongoDB before](https://kevsoft.net/2020/07/02/how-to-store-decimal-fields-in-mongodb-with-csharp.html), back when the string default was the thing you had to work around. The v3 change is the driver finally doing the right thing out of the box, and honestly it's long overdue. `Decimal128` is a real numeric BSON type, so the server can compare it, sort it, and do arithmetic on it. A string can't do any of that. So as a default, this is a strict improvement.

The trouble is never the new default on its own. It's what happens to the data you already have.

## What saving looks like, old and new

Take a tiny order model:

```csharp
public record Order(ObjectId Id, string Reference, OrderLine[] Lines);
public record OrderLine(string Sku, decimal UnitPrice, int Quantity, decimal LineTotal);
```

Save one order line under the **v2** driver and the money lands as strings:

```json
{
  "Sku": "WIDGET-1",
  "UnitPrice": "9.99",
  "Quantity": 3,
  "LineTotal": "29.97"
}
```

Save the identical model under **v3** and you get proper decimals:

```json
{
  "Sku": "WIDGET-1",
  "UnitPrice": NumberDecimal("9.99"),
  "Quantity": 3,
  "LineTotal": NumberDecimal("29.97")
}
```

Same C#, same collection, two very different documents. Here's the split at a glance:

| | Driver v2 (and earlier) | Driver v3 |
|---|---|---|
| Default `decimal` representation | BSON string | `Decimal128` |
| Server-side arithmetic (`$multiply`, `$sum`) | ✗ | ✓ |
| Sorts and range queries numerically | ✗ (lexical) | ✓ |

Now here's the bit that makes this properly sneaky. Our handlers don't replace whole documents, they `$set` their own little slice of one. So after an upgrade you don't get a clean "old collection" and "new collection". You get individual orders where some fields were last written by v2 and some by v3, so a single document can hold `UnitPrice` as a string and `LineTotal` as a `Decimal128` at the same time. The data is a patchwork, and nothing tells you.

## Why nothing looked broken

For weeks, everything was fine. Reads worked, writes worked, nobody noticed a thing.

That's because the driver's `DecimalSerializer` is perfectly happy to **read** either representation. Point a `decimal` property at a document and it doesn't care whether the value on disk is `"9.99"` or `NumberDecimal("9.99")`. It deserialises both to the same `9.99m`. So every POCO round-trip kept working, old documents and new documents alike, and the mixed state stayed completely invisible.

Which is the worst kind of bug, really. The one that lets you believe everything is fine right up until the moment it very much isn't.

## Where it fell over

The moment came with a migration. Not a normal write, but an **update aggregation pipeline**, the kind where the server computes the new values from the existing ones. We were backfilling `LineTotal` for every order line by multiplying the price by the quantity, entirely server-side:

```csharp
var pipeline = new EmptyPipelineDefinition<BsonDocument>()
    .AppendStage<BsonDocument, BsonDocument, BsonDocument>(new BsonDocument("$set", new BsonDocument
    {
        { "Lines", new BsonDocument("$map", new BsonDocument
            {
                { "input", "$Lines" },
                { "as", "line" },
                { "in", new BsonDocument("$mergeObjects", new BsonArray
                    {
                        "$$line",
                        new BsonDocument("LineTotal",
                            new BsonDocument("$multiply", new BsonArray { "$$line.UnitPrice", "$$line.Quantity" }))
                    })
                }
            })
        }
    }));

await orders.UpdateManyAsync(Builders<BsonDocument>.Filter.Empty,
    Builders<BsonDocument>.Update.Pipeline(pipeline));
```

For every order written by v3, `UnitPrice` is a `Decimal128` and `$multiply` is delighted. For every order still carrying a v2 string, the server throws:

```text
MongoDB.Driver.MongoCommandException: Command update failed:
Plan executor error during update :: caused by ::
$multiply only supports numeric types, not string.
```

That's the real message, error code **14 (`TypeMismatch`)**. `$multiply` will not multiply a string, and no amount of hoping changes its mind.

And here's the sting in the tail. `updateMany` stops at the **first** document it can't write and reports back. Wrap that in a "run the migration, log the result, move on" background job and what you see is a job that starts, throws, gets retried, throws again on the very same document, and makes zero forward progress. Quietly, for as long as you leave it. It's not that the migration didn't run. It's that it ran, hit the first stringy order, and gave up before touching anything behind it.

## Taking control of the representation

Before we fix the data, it's worth knowing you're not stuck with whatever the default happens to be. You've got three choices, and picking one deliberately is the whole game.

**Keep the old string behaviour**, even on v3. Handy if you can't migrate everything at once and you want new writes to match the existing string documents. Do it per property:

```csharp
public record OrderLine(
    string Sku,
    [property: BsonRepresentation(BsonType.String)] decimal UnitPrice,
    int Quantity,
    [property: BsonRepresentation(BsonType.String)] decimal LineTotal);
```

Or globally, for every `decimal` in the app, via a serializer registration or a class map, with no attributes needed:

```csharp
BsonSerializer.RegisterSerializer(typeof(decimal), new DecimalSerializer(BsonType.String));
BsonSerializer.RegisterSerializer(typeof(decimal?),
    new NullableSerializer<decimal>(new DecimalSerializer(BsonType.String)));
```

**Go all-in on `Decimal128`**, which is what v3 now does for you anyway. Swap `BsonType.String` for `BsonType.Decimal128` in either snippet above and every new write is a real number.

So you can happily **fall back to all strings** under v3 if you genuinely want to, and nothing's forcing your hand. Just know what you're giving up: a string decimal can't be summed, multiplied, sorted or range-queried on the server. For a value you only ever read back into C#, that might be a perfectly reasonable trade. For anything you want to do maths on in an aggregation, it's the exact trap we just fell into.

We wanted the maths, so `Decimal128` it was. Which meant getting rid of the strings first.

## Finding the blast radius

Before changing anything, work out how much is affected. MongoDB lets you query by BSON type, so finding every order still holding a string price is a one-liner:

```csharp
var filter = Builders<BsonDocument>.Filter.Type("Lines.UnitPrice", BsonType.String);
var affected = await orders.CountDocumentsAsync(filter);
```

Which is just this on the wire:

```js
db.orders.countDocuments({ "Lines.UnitPrice": { $type: "string" } })
```

Two things worth knowing. A dotted path like `Lines.UnitPrice` reaches straight through the array, so this matches an order if **any** line holds a string, with no `$elemMatch` gymnastics required. And it's a genuinely cheap way to watch a migration finish: run it before, run it after, and when the count hits zero you're done.

## The fix: rewrite the strings to Decimal128

The migration itself is an update aggregation, same family as the one that broke, but this time its only job is to change a type. For each decimal field, we guard a conversion behind a type test: if it's a string, `$convert` it to a decimal; otherwise leave it exactly as it is.

```csharp
static BsonDocument ConvertIfString(string field) =>
    new("$cond", new BsonDocument
    {
        { "if", new BsonDocument("$eq", new BsonArray { new BsonDocument("$type", $"${field}"), "string" }) },
        { "then", new BsonDocument("$convert", new BsonDocument
            {
                { "input", $"${field}" },
                { "to", "decimal" },
                { "onError", $"${field}" }
            })
        },
        { "else", $"${field}" }
    });
```

That `onError` clause is the important bit and it's doing real work: a value representing money is not something to guess at. If a string somehow won't parse, we write it **back exactly as it was** rather than nulling it or defaulting it to zero. It stays a string, so it stays matched by our `$type` filter, so it stays visible to the next run instead of silently becoming a wrong number.

Because order lines live in an array, we map over them and rebuild each one, only touching the fields we mean to:

```csharp
var update = Builders<BsonDocument>.Update.Pipeline(
    new EmptyPipelineDefinition<BsonDocument>()
        .AppendStage<BsonDocument, BsonDocument, BsonDocument>(new BsonDocument("$set", new BsonDocument
        {
            { "Lines", new BsonDocument("$map", new BsonDocument
                {
                    { "input", "$Lines" },
                    { "as", "line" },
                    { "in", new BsonDocument("$mergeObjects", new BsonArray
                        {
                            "$$line",
                            new BsonDocument
                            {
                                { "UnitPrice", ConvertIfString("$line.UnitPrice") },
                                { "LineTotal", ConvertIfString("$line.LineTotal") }
                            }
                        })
                    }
                })
            }
        })));
```

The pattern generalises nicely. Give it the list of paths that hold decimals, whether they're top-level fields, sub-documents, or arrays nested inside arrays, and you can build the same guarded `$convert` for each one, `$mergeObjects` at every level so anything you don't mention is left untouched. That's exactly what we did on the real system: a small tree describing every decimal position, driving one pipeline that rebuilds the document in place. The nice property of the whole thing is that it's **idempotent**, since only ever a string gets rewritten, so running it twice does no harm, and a run that gets interrupted just gets picked up next time.

One last lesson, learned the hard way. Don't run this as a single `updateMany` over the entire collection and walk away. Remember it stops at the first document it can't write. We batch the ids and, if a batch fails, drop to updating that batch one document at a time so a single stubborn order costs its own batch a retry and nothing more, rather than wedging the whole migration behind it and appearing to run while quietly getting nowhere.

## Why two migrations, not one

You'll have spotted that we now have two migrations that both touch the same fields: one to convert strings to `Decimal128`, and then the original one to compute `LineTotal` from `UnitPrice × Quantity`. We could have folded the conversion into the calculation and done it all in a single pass. We deliberately didn't.

They're two different jobs. The first is a pure, boring type change: rewrite strings, touch nothing else, safe to run over and over. The second is business logic, and it carries a wrinkle of its own. `LineTotal` isn't *always* a calculation. We added an **override**, so a line can carry a `LineTotal` that was set by hand, and the migration only computes one where no override exists. Tangle that conditional logic up with a type sweep and you've got a migration that's harder to reason about, harder to re-run safely, and harder to point at when something looks off. Kept apart, each one does a single thing you can describe in a sentence, and either can be re-run on its own without a second thought.

## Wrapping up

The whole saga came down to a default flipping from string to `Decimal128` between two major versions of the driver. Reads kept working, so nothing surfaced, until an update aggregation tried to do arithmetic on a value that was still a string and the server said, quite reasonably, no. The fix was two small migrations: one to make every decimal a real number, guarded so a dodgy string never becomes a wrong one, and one to do the maths once the data could actually take it.

The lesson I keep relearning: know how your data is actually stored, not just how your objects look in C#. A `decimal` in your model can be a string or a number on disk, and the difference is invisible right up until you ask the database to do something a string can't.

Have you been caught out by a serialization default changing under you? I'd love to hear how it bit you.
