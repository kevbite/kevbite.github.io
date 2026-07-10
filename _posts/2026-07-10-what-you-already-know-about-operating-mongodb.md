---
layout: post
title: "What You Already Know About Operating MongoDB"
categories:
tags: [.NET, C#, MongoDB, LINQ, Performance]
description: If you write LINQ, you already understand MongoDB's query model. Operating it well just means knowing what's underneath, shown in both C# and mongosh.
comments: true
---

I first used MongoDB back in 2013, when I was a technical lead at Alpharooms. Our Managing Director at the time was the one who put it in front of us, he'd heard it was "super fast" and we needed to speed up search aggregation across hotels and flights. Fair enough, it turned out to be exactly the right tool for that job, but at the time I had zero context for it. I'd only ever worked with Oracle, MySQL, and SQL Server. No document databases, no NoSQL of any flavour, it genuinely wasn't the norm yet.

This was also right around when MongoDB went properly open source, and it was still 10gen back then, MongoDB Inc and Atlas didn't exist. Almost everything I learned about MongoDB in those early days came from 10gen's own online courses and webinars, which have since grown into MongoDB University, and there's still some genuinely excellent free content there if you haven't looked. What I brought to it wasn't NoSQL experience, it was years of tuning SQL indexes and reading execution plans, plus a healthy dislike of ORMs earned from fighting LLBLGen and Linq to SQL. So I skipped the abstraction entirely and just learned the native query language. There wasn't much of a mature C# driver to abstract it away with at that point anyway.

Fast forward to today and most .NET developers handed a MongoDB project are in a completely different spot to the one I was in back then, and usually a much better one. The first reaction is still often panic, new query language, new tools, new mental model, better clear your calendar for the next month, and it's almost always an overreaction.

## What you already know

Here's the thing most .NET developers don't stop to notice: you probably don't write raw SQL either. You write LINQ. Entity Framework, Dapper, LINQ to SQL, whatever the flavour, the actual SQL underneath is mostly invisible to you day to day. That's not a gap in your knowledge, it's just the level of abstraction most of us work at, and it's a perfectly productive one.

MongoDB works the same way. You write C#, strongly typed collections, LINQ expressions, the EF Core provider, and the driver handles the query language underneath. If you've used `.Where()`, `.GroupBy()`, or `.OrderBy()`, you already understand MongoDB's query model conceptually. You just didn't know it yet.

Where you've bumped into SQL concepts before, transactions, indexes, isolation levels, MongoDB has equivalents. Different names, similar ideas. And just like knowing raw SQL makes you a sharper EF developer when a query is slow, knowing MongoDB's native query language (MQL) and its shell, mongosh, makes you a sharper MongoDB developer when something needs tuning. That's the thread running through this whole post: the C# you'll write every day, and the mongosh underneath it that shows you what's actually happening.

Even the basic vocabulary maps more directly than you'd expect. An instance is an instance, the same running server process you'd connect to on SQL Server or Postgres. A database is a database, and you still type `use` to switch between them in mongosh, exactly like you would in `sqlcmd` or `psql`. A collection is the rough equivalent of a table, it's where your documents live. The one place the analogy breaks, and it matters, is what you put inside it. A table wants flat, normalised rows. A collection wants documents modelled around how you actually read the data back out, embedded and nested where that makes sense, not forced flat just because that's the shape you're used to reaching for.

## Querying: you already write this

If you can write `.Where()`, you already understand MongoDB filtering. If you can write `.GroupBy()`, you already understand MongoDB aggregations. The concepts aren't foreign, only the syntax is different.

LINQ expresses a pipeline: filter, transform, shape, sort, page. MongoDB's aggregation pipeline is that exact same idea made explicit, as a sequence of named stages. Once you see the mapping, it stops looking like a new thing to learn and starts looking like a new name for something you already do:

- Filtering with `.Where()` is a `$match` stage
- Shaping with `.Select()` is a `$project` stage
- Grouping with `.GroupBy()` is a `$group` stage
- Sorting with `.OrderBy()` is a `$sort` stage
- Paging with `.Skip()` / `.Take()` is `$skip` / `$limit`
- Joining with `.Join()` is a `$lookup` stage

That's recognition, not translation. You're not learning a new way to think about queries, you're learning what MongoDB calls the thing you already do.

Say you're working with an `orders` collection (`Status`, `CustomerId`, `Amount`, `CreatedAt`) and you want the top ten customers by spend among active orders. In C#, using the aggregation fluent API against an injected `IMongoCollection<Order>`:

```csharp
var results = await collection
    .Aggregate()
    .Match(o => o.Status == "active")
    .Group(o => o.CustomerId, g => new
    {
        CustomerId = g.Key,
        TotalValue = g.Sum(o => o.Amount),
        OrderCount = g.Count()
    })
    .SortByDescending(r => r.TotalValue)
    .Limit(10)
    .ToListAsync();
```

That reads like a LINQ query because it basically is one. Here's the same query as a raw aggregation pipeline, which is what the driver actually sends to MongoDB underneath:

```javascript
// The same query in mongosh, one layer down
db.orders.aggregate([
  { $match: { status: "active" } },
  { $group: {
      _id: "$customerId",
      totalValue: { $sum: "$amount" },
      orderCount: { $sum: 1 }
  }},
  { $sort: { totalValue: -1 } },
  { $limit: 10 }
])
```

Line for line, stage for stage, it's the same shape. That's not a coincidence, it's the point.

The performance angle is worth planting here, because it comes back later. Knowing SQL lets you look at what EF generates and understand why it's slow. Knowing the aggregation pipeline in mongosh does the same job for MongoDB. The LINQ path is the right default for day to day work. But when a query is slow, being able to read and tweak the pipeline directly in mongosh is what separates "I have no idea why this is slow" from "I can fix this in five minutes."

One stage worth flagging because it's genuinely interesting: `$facet`. It runs several sub-pipelines against the same input in a single round trip, so you can get a result set, a total count, and a category breakdown back from one query instead of three. There's no LINQ equivalent for this, and it's worth knowing it exists even if you don't reach for it often.

I've been caught out by this before, `$facet` never uses an index, no matter what's inside its sub-pipelines. If `$facet` is the first stage in your pipeline, MongoDB runs a full `COLLSCAN` before it even fans out into the facets, even if every sub-pipeline opens with a `$match` on an indexed field. The fix is to move the filtering `$match` (or a `$sort`) to a stage before `$facet`. That earlier stage can use the index, and `$facet` then operates on the already-filtered set rather than the whole collection.

## Read replicas and routing: built into the driver

If you've heard of read replicas, from SQL Server, Postgres, or just the general idea, MongoDB has the same concept and calls it a replica set. The difference is that routing a read to a replica is a single parameter in your C# code, not a separate connection string or an infrastructure decision someone else has to make.

A replica set is a group of MongoDB nodes holding the same data. One node is the primary and takes writes. The others are secondaries, replicating from the primary and available to serve reads. This isn't an advanced feature you opt into, it's the default: every production MongoDB deployment, including every Atlas cluster, is a replica set.

If the primary goes down, the secondaries elect a new one within seconds, and the .NET driver reconnects transparently. Your application code doesn't change.

**Read Preference** is how you tell the driver where reads should go. There are five options: `Primary` (the default), `PrimaryPreferred`, `Secondary`, `SecondaryPreferred`, and `Nearest`, which picks whichever node has the lowest network latency.

A common use case is keeping heavy analytics or reporting queries off the primary so they don't compete with write traffic:

```csharp
// Route this analytics query to a secondary, keeps write traffic off the primary
var analyticsCollection = database
    .GetCollection<Order>("orders")
    .WithReadPreference(ReadPreference.SecondaryPreferred);

var monthlySummary = await analyticsCollection
    .Aggregate()
    .Match(o => o.CreatedAt >= DateTime.UtcNow.AddMonths(-1))
    .Group(o => o.Status, g => new { Status = g.Key, Total = g.Sum(o => o.Amount) })
    .ToListAsync();
```

Setting it in code like that works, but the more common way to do it, and usually the better one, is on the connection string itself:

```
mongodb+srv://user:pass@cluster.mongodb.net/shop?readPreference=secondaryPreferred
```

That turns "route reads to secondaries" into a configuration change rather than a code change and a redeploy. Ops can flip it, canary it against one instance, or roll it back without the application ever knowing. `WithReadPreference` in code is still the right tool when you want per-query control, most of your traffic hits the primary and just one reporting query should go to a secondary, but for a blanket policy across a whole service, the connection string is the natural place to set the default.

Read Preference also supports **tag sets**, custom key/value labels you attach to replica set members so you can route reads more precisely than a plain Primary/Secondary split. Tag a couple of secondaries `{ region: "eu-west" }` or `{ workload: "reporting" }` and you can target reads at exactly those nodes, handy when you've provisioned secondaries specifically for reporting, or spread them across regions and want reads served from the nearest one.

```csharp
// Route reads only to secondaries tagged for the eu-west region
var readPreference = new ReadPreference(
    ReadPreferenceMode.SecondaryPreferred,
    [new TagSet([new Tag("region", "eu-west")])]);

var reportingCollection = database
    .GetCollection<Order>("orders")
    .WithReadPreference(readPreference);
```

Same tag set on the connection string:

```
mongodb+srv://user:pass@cluster.mongodb.net/shop?readPreference=secondaryPreferred&readPreferenceTags=region:eu-west
```

This is a genuinely useful pattern in production, not just a theoretical one. At Oakbrook Finance we tagged a couple of secondaries `{ workload: "reporting" }` specifically so the risk team could run their own queries directly against production data without the application ever feeling it. We also set `priority: 0` on those nodes in the replica set configuration, so they could never be elected primary, even during a failover, they existed purely to serve reads and would never take writes or become the primary. The risk team didn't care whether their view of the data was a few seconds behind, so the eventual consistency you get from reading off a secondary was the right trade-off for them rather than a compromise.

The nuance to keep in mind more generally: secondaries replicate asynchronously, so a read from a secondary can be slightly behind the primary. If you write something and need to read it back immediately, use a causally consistent session, one extra option on the session object that guarantees your read sees your own prior write regardless of which node handles it.

## Indexes and execution plans: your instincts are correct

If you've ever added an index to speed something up, or pulled an execution plan to work out why a query was slow, you already know how to think about MongoDB performance. The tool names are different, the diagnostic loop is identical.

**Indexes** in MongoDB work the way indexes work everywhere: a sorted structure that lets the engine find documents without scanning the whole collection. You get single field indexes and compound (multi-field) indexes, and the field order in a compound index matters. The rule of thumb is ESR, equality fields first, sort fields second, range fields last.

**`explain()`** runs on any query and shows you what the engine actually did. Two things to look for:

- `COLLSCAN` in the winning plan means no index was used, a full collection scan happened. Add an index.
- `IXSCAN` means an index was used. Good.
- Compare `totalDocsExamined` to `nReturned`. If the engine examined 50,000 documents to return 3, your index isn't selective enough.

There are three things worth knowing that catch relational developers off guard the first time:

1. **Multikey indexes.** Index an array field and MongoDB automatically creates one index entry per element. Querying `{ tags: "urgent" }` against a `tags: ["urgent", "b2b"]` field just works, with no extra setup.
2. **TTL indexes.** Add `expireAfterSeconds` to a date field index and MongoDB deletes the document automatically once it expires. Session stores, ephemeral logs, cache-like data, no application cleanup job, no Redis needed.
3. **Hidden indexes.** You can make an index invisible to the query planner without dropping it, test what happens if it didn't exist, then unhide it if you were wrong. A safe, reversible way to evaluate whether an index is still earning its keep.

Creating a compound index:

```csharp
// Compound index following ESR order
await collection.Indexes.CreateOneAsync(
    new CreateIndexModel<Order>(
        Builders<Order>.IndexKeys
            .Ascending(o => o.Status)       // Equality
            .Descending(o => o.CreatedAt)   // Sort
            .Ascending(o => o.Amount)       // Range
    )
);
```

```javascript
// Same index in mongosh
db.orders.createIndex(
  { status: 1, createdAt: -1, amount: 1 },
  { name: "status_date_amount" }
)
```

That's explain run against a query you already know about. The harder problem in practice is not knowing which query needs it in the first place, that's what the profiler is for.

## The profiler and slow query log: operations you can own

Most developers hand this off to a DBA, or wait for an alert from whatever monitoring tool is in place. In MongoDB, the profiler is accessible from C# or mongosh, and the slow query log, `system.profile`, is itself a MongoDB collection you can query with the same `Find()` or aggregation syntax you use everywhere else.

Before you can find a slow query, it helps to make queries identifiable in the first place. Two small things pay for themselves here: tag the connection with an application name, and tag individual queries with a comment, the same idea as EF Core's `.TagWith()`, which drops a comment into the generated SQL so you can trace a slow query in the log back to the line that issued it.

```csharp
// Every connection this client opens is tagged with an application name
var client = new MongoClient("mongodb://localhost:27017/?appName=OrdersService");

// Tag the individual query too, same idea as EF Core's .TagWith()
var options = new FindOptions { Comment = "OrdersController.GetPendingOrders" };
var pendingOrders = await collection
    .Find(o => o.Status == "pending", options)
    .ToListAsync();
```

Both show up wherever MongoDB surfaces the operation, `$currentOp`, the server logs, and the profiler:

```javascript
// Same query, commented, in mongosh
db.orders.find({ status: "pending" }).comment("OrdersController.GetPendingOrders")
```

The profiler has three levels: 0 is off, 1 logs operations slower than a configurable threshold, safe to leave on in production, and 2 logs everything, which you should not leave running in production. A sensible starting threshold is 100ms.

A couple of other tools worth knowing:

- `$currentOp` shows you what's running right now, active queries, lock wait states, how long each has been running. It's the same instinct as opening Activity Monitor in SQL Server Management Studio, except it's accessible from code.
- `db.killOp(opid)` kills a running operation by its id, the same instinct as killing a blocked process.

This is exactly where the `appName` and query `Comment` from above pay off. Both are captured on the profiled operation, so you can filter `system.profile` by `appName` to see one service's traffic in isolation, and the comment tells you precisely which query in your codebase you're looking at, without having to guess from the shape of the filter alone.

Enabling profiling and querying slow queries, in mongosh:

```javascript
// Enable profiling
db.setProfilingLevel(1, { slowms: 100 })

// Slow queries, system.profile is just a collection
db.system.profile
  .find({ ts: { $gt: new Date(Date.now() - 3600000) } })
  .sort({ millis: -1 })
  .limit(10)

// Collection scans specifically, the ones that definitely need an index
db.system.profile.find({
  planSummary: "COLLSCAN",
  ts: { $gt: new Date(Date.now() - 86400000) }
})

// Just this service's traffic, using the appName from the connection string
db.system.profile.find({ appName: "OrdersService" })

// The exact query, using the Comment tagged on it in code
db.system.profile.find({ "command.comment": "OrdersController.GetPendingOrders" })

// What's running right now
db.aggregate([{ $currentOp: {} }])

// Kill a slow operation by its opid
db.killOp(12345)
```

Once the profiler points you at the exact query, drop into mongosh and run explain on it directly:

```javascript
// Once the profiler points you at a slow query, explain it directly in mongosh
db.orders.find({ status: "pending" })
         .explain("executionStats")
```

This is the "know what's underneath" argument in practice. `appName` and `Comment` are the always-on, low-ceremony habit in C#. The profiler, and `explain()` once it's pointed you at something, is where you actually read what's happening in mongosh.

## Transactions: same concept, explicit controls

MongoDB supports multi-document ACID transactions and they work exactly the way you'd expect: start one, do your work, commit or roll back. The real difference from a relational database isn't how transactions behave, it's how often you actually need one, and it's worth understanding why.

In a relational database, related data usually lives across separate tables, so updating an order and its line items together needs a transaction to keep them consistent. In MongoDB, related data is often embedded in a single document. Updating an order and its embedded line items is one atomic write, no transaction required. Transactions exist for the cases where data genuinely spans multiple collections, like moving money between two account documents.

Two settings are worth understanding directly rather than mapping to SQL isolation level names most people don't have memorised anyway:

**Write Concern** answers "how many nodes need to confirm this write before I get an acknowledgement back?" `w: 1` means only the primary has confirmed it. `w: "majority"` means more than half the replica set has confirmed it, so the write survives a primary failure. For anything you actually care about, use `majority`.

**Read Concern** answers "how fresh does this data need to be?" The default, `local`, gives you the fastest read from whichever node serves it. `majority` only returns data a majority of nodes have confirmed, so there's no risk of reading something that later gets rolled back.

*(If you do know SQL: write concern is roughly synchronous versus asynchronous commit. Read concern maps loosely to isolation levels, local is close to READ UNCOMMITTED, majority is close to REPEATABLE READ, and snapshot is close to SERIALIZABLE.)*

A classic multi-document case, transferring funds between two accounts:

```csharp
using var session = await client.StartSessionAsync();
session.StartTransaction(new TransactionOptions(
    readConcern: ReadConcern.Snapshot,   // consistent view of the data at transaction start
    writeConcern: WriteConcern.WMajority // write survives a primary failure
));
try
{
    await accounts.UpdateOneAsync(session,
        a => a.Id == sourceId,
        Builders<Account>.Update.Inc(a => a.Balance, -amount));

    await accounts.UpdateOneAsync(session,
        a => a.Id == destinationId,
        Builders<Account>.Update.Inc(a => a.Balance, amount));

    await session.CommitTransactionAsync();
}
catch
{
    await session.AbortTransactionAsync();
    throw;
}
```

Same transaction in mongosh:

```javascript
const session = db.getMongo().startSession()
session.startTransaction({
  readConcern: { level: "snapshot" },
  writeConcern: { w: "majority" }
})
try {
  const accounts = session.getDatabase("bank").accounts
  accounts.updateOne({ _id: sourceId }, { $inc: { balance: -amount } })
  accounts.updateOne({ _id: destinationId }, { $inc: { balance: amount } })
  session.commitTransaction()
} catch(e) {
  session.abortTransaction()
  throw e
}
```

## Schema validation: constraints when you want them

MongoDB is schema-flexible, not schema-free. You can add validation rules whenever you're ready for them, at collection creation, or later, once the model has settled down.

MongoDB's schema validation uses JSON Schema, a widely used open standard rather than anything MongoDB-specific. You define which fields are required, what types they must be, and what values are allowed.

There are two validation actions. `error` rejects the write outright. `warn` allows the write through but logs the violation, which is genuinely useful when you're adding validation to a live collection and don't want to immediately break existing writes that don't conform yet.

Honestly, I don't reach for this much day to day. My C# models are already tight, strongly typed properties, required fields, validation attributes, and that gives me the safety net at the application layer before anything gets near the database. Adding a second, separate schema definition at the database level for the same shape is often just duplication.

Where it earns its keep is when more than one application writes to the same collection. Once you've got two or three services all producing documents into `orders`, nothing at the database level stops one of them drifting from the shape the others expect. That's the exact problem stored procedures used to solve in a relational world, a single, enforced entry point that every caller had to go through, with the business rules living in one place rather than scattered across however many applications happened to be writing. Most of us traded that model in for services sitting behind an HTTP or gRPC API instead, which gives you the same kind of control, just at the application boundary rather than the database boundary. Usually that's enough, and schema validation at the database level is belt and braces on top of it.

It still depends on what you're building though. Say you've got two applications, and one of them is consuming the collection through change streams rather than talking to the other application directly. In that case it's worth being explicit about the contract at the database level too, so the shape is enforced no matter which application is doing the writing, rather than trusting that both sides of an implicit contract stay in sync forever.

In mongosh:

```javascript
db.runCommand({
  collMod: "orders",
  validator: {
    $jsonSchema: {
      bsonType: "object",
      required: ["status", "customerId"],
      properties: {
        status: {
          bsonType: "string",
          enum: ["pending", "active", "fulfilled", "cancelled"]
        },
        amount: {
          bsonType: "double",
          minimum: 0
        }
      }
    }
  },
  validationAction: "error"
})
```

## Wrapping up

Two layers to take away from this. The first: if you write LINQ, you already understand MongoDB's query model. The C# driver and the EF Core provider are built specifically so that transfers directly, and you can be productive from day one without touching mongosh at all.

The second: the developers who get the most out of MongoDB are the ones who learn what's underneath it. Not because they write MQL day to day, but because when something is slow, they can open mongosh, run an `explain()`, check `system.profile`, and actually understand what they're looking at. The abstraction is the floor, not the ceiling.

If you want a concrete next step rather than a vague "go learn MongoDB": add `appName` to a connection string and a `Comment` to one query in something you're already working on, then find it in the profiler and run `explain("executionStats")` on it in mongosh. Look at two numbers, `totalDocsExamined` and `nReturned`. If they're far apart, you've just found a tuning opportunity, and now you know how to go find the next one.

One thing I've deliberately left out here: data modelling, when to embed related data in a document versus when to reference it across collections. That decision is genuinely different from relational thinking, and it probably has the biggest single impact on performance of anything in this post. It deserves its own write-up.
