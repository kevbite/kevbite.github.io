---
layout: post
title: Desired-State MongoDB Indexes in C#
categories:
tags: [MongoDB, C#, .NET, Testing, Migrations]
description: Why I'd rather declare the indexes a MongoDB collection should have and let a tool work out the changes, and how to prove they work with WebApplicationFactory
comments: true
---

In my last post, [MongoDB Migrations in C# from GitHub Actions](https://kevsoft.net/2026/11/02/mongodb-migrations-in-csharp-from-github-actions.html), we got migrations running once per deploy, before any new code, with a record of everything they did. There was one thing I quietly skipped over, though: indexes.

If you've ever looked after MongoDB indexes with migrations, you'll know how this story goes. It starts innocently enough, and a couple of years later your migrations folder looks something like this:

```text
M20240311_AddEmailIndexToCustomers
M20240802_AddCustomerOrdersIndex
M20241119_MakeEmailIndexCaseInsensitive     -- drop, then create
M20250204_AddSessionsTtlIndex
M20250630_ShortenSessionTtl                 -- drop, then create? collMod? who knows
M20251015_DropOrdersStatusIndex
M20260120_PutOrdersStatusIndexBack          -- oops
```

Quick question: which indexes does `orders` have right now? Is the email index still case-insensitive? Did anyone ever make that reference index sparse?

You can't tell without reading every one of them, and even then you still don't really know, because someone added an index by hand in Compass during an incident last spring and never told anyone.

Migrations are brilliant at describing *changes*. Indexes, though, are much better described as *state*: "this collection should have these indexes, with these options". Then something compares that with what's actually on the server and makes only the changes needed to get there. It's the same idea as Terraform or CDK for your infrastructure. You stop keeping track of what's been created, dropped or tweaked, because the tool works it out every time.

## What about creating them on startup?

I've tried a simpler approach before. In [Creating MongoDB indexes in ASP.NET Core 3.1](https://kevsoft.net/2020/03/06/creating-mongodb-indexes-in-asp-net-core-3-1.html), I used a hosted service to create indexes when the application starts. Calling create again for an index that already exists is fine, and for a small application that's a nice, straightforward place to start.

The trouble is that creating indexes isn't quite the same as managing their desired state. The hosted service doesn't compare options or tidy up indexes that have changed, and as you scale out, every instance runs that startup work. Index builds can take time and put extra load on the database, and they can hold up application startup too. That's not quite what I want every time a new instance starts.

So I went looking for a way to describe the indexes I want and let something else work out the changes.

## Doesn't Terraform already do this?

Terraform is great at desired state, but the [MongoDB Atlas provider](https://registry.terraform.io/providers/mongodb/mongodbatlas/latest/docs) doesn't support ordinary database indexes. It does support [Atlas Search indexes](https://registry.terraform.io/providers/mongodb/mongodbatlas/latest/docs/resources/search_index), but those are a different thing.

What about scripting it? The Atlas CLI has [`atlas clusters indexes create`](https://www.mongodb.com/docs/atlas/cli/current/command/atlas-clusters-indexes-create/), which does a rolling build through the Atlas Admin API, but it only creates. There's no list, change or drop to go with it. And you could absolutely do the whole lot in `mongosh`: read `getIndexes()`, compare, call `createIndex`, `dropIndex` and `collMod`. You'd just be writing the clever bit, the comparing, yourself.

I'd much rather have it in C#, though, for a few reasons:

- **It's the same language as the app**, so the index on `Email` can point at the actual `Email` property on the actual `Customer` class.
- **It runs everywhere the migrations already run.** In our setup that's a Fargate task inside a private network, with an IAM role that only the migrations get. Nothing else needs a way in to the database.
- **It runs in your integration tests.** This one's my favourite, and we'll get to it near the end.

## Declaring what a collection should look like

[Kevsoft.MigrateMongo](https://github.com/kevbite/Kevsoft.MigrateMongo.Tool) (yes, the tool from the last post, and yes, I wrote it) has something it calls *collection definitions*. Next to your migrations, you write a class per collection that says which indexes it should have:

```csharp
[ManagedCollection("customers")]
public sealed class Customers : ICollectionDefinition<Customer>
{
    public void Define(CollectionBuilder<Customer> collection) =>
        collection.Indexes
            .Add(k => k.Ascending(c => c.Email), new()
            {
                Name = "email_unique",
                Unique = true,
                Collation = new Collation("en", strength: CollationStrength.Secondary),
            });
}

[ManagedCollection("sessions")]
public sealed class Sessions : ICollectionDefinition<Session>
{
    public void Define(CollectionBuilder<Session> collection) =>
        collection.Indexes
            .Add(k => k.Ascending(s => s.LastSeenAt), new() { ExpireAfter = TimeSpan.FromDays(30) })
            .Add(k => k.Ascending(s => s.CustomerId));
}

[ManagedCollection("orders")]
public sealed class Orders : ICollectionDefinition<Order>
{
    public void Define(CollectionBuilder<Order> collection) =>
        collection.Indexes
            .Add(k => k.Ascending(o => o.CustomerId).Descending(o => o.CreatedAt))
            .Add(k => k.Ascending(o => o.Reference));
}
```

The keys and options are the driver's own `IndexKeysDefinition` and `CreateIndexOptions`, so there's nothing new to learn. The email index uses a collation with `strength: 2`, which makes it case-insensitive: `sam@example.com` and `Sam@Example.com` count as the same email. Hold that thought, as we'll be testing it later.

Because the definitions are typed, the keys go through the driver's class maps and conventions. Our app uses camel case, so the migrations project registers the same conventions before the runner starts:

```csharp
ShopMongo.Register(); // the app's ConventionRegistry setup
return await MigrateMongoRunner.RunAsync(args);
```

Why does that matter? The property names in C# aren't necessarily the field names stored in MongoDB. If the migrations project uses different conventions from the app, it can end up looking for indexes on the wrong field names.

The tool has a guard for one sign of this: if none of the fields in a collection's declared indexes match any fields in its existing indexes, it stops and asks you to check the plan. That gives you a chance to spot a convention mismatch before it builds a second set of indexes. It's a useful warning, but not a replacement for registering the same conventions in both places.

Here's `plan` against an empty database:

```text
$ migrate-mongo plan
  ⟳ customers
      + create   email_unique   { email: 1 }  unique, collation { locale: "en", strength: 2 }
  ⟳ orders
      + create   customerId_1_createdAt_-1   { customerId: 1, createdAt: -1 }
      + create   reference_1                 { reference: 1 }
  ⟳ sessions
      + create   lastSeenAt_1   { lastSeenAt: 1 }  expireAfterSeconds 2592000
      + create   customerId_1   { customerId: 1 }
Would change 3 collection(s).
```

`plan` exits with code `2` when there's something to do, so it can gate a deploy if you like. The best part is that `up`, the very same command our pipeline already runs, applies the migrations first and then brings every collection in line with its definition, all under the same lock. The pipeline from the last post didn't need a single change.

## Running migrations and indexes on startup

A separate migration task isn't the only option. If running everything as part of your service is easier, the tool's `Kevsoft.MigrateMongo.Hosting` package can apply the migrations and bring the collection definitions to their desired state at startup:

```csharp
builder.Services.AddMongoMigrations(o => o.DatabaseName = "shop")
    .FromAssemblyContaining<Customers>()
    .RunOnStartup();
```

This uses the `IMongoClient` registered by the application. Unlike the hosted service in my [old post on creating indexes at startup](https://kevsoft.net/2020/03/06/creating-mongodb-indexes-in-asp-net-core-3-1.html), it works out the changes needed to reach the declared state.

As I mentioned in that post, doing this at startup isn't always a great fit, especially for bigger applications. Each instance will attempt the startup work, so allow for lock contention and potentially slow starts during index changes. Your application also needs the database permissions to run migrations and manage indexes. For our setup, I still prefer running it once before the deploy, but startup can be a good fit for a simpler service.

Whichever way you run it, the interesting bit is how it decides what needs changing.

## How it works out what to do

Before it can decide anything, the tool has to work out which declared index is which index on the server. It matches them on their keys, collation and partial filter, because those are what MongoDB uses to tell two indexes on the same fields apart. Names don't come into it, so an existing database gets adopted as it is, and nothing needs renaming first.

Once it has matched them up, it compares the rest of the options:

| What's changed | What `up` does |
|---|---|
| Declared, but not on the server | Creates it |
| TTL (added or changed) or `hidden` | `collMod`, in place |
| Made unique | `collMod` with `prepareUnique`, then `unique` |
| Any other option (`sparse`, say) | Drops it and creates it again, under the same name |
| On the server, but not declared | Up to you (more on that later) |

That second row is the one I want to talk about.

## Changing a TTL without rebuilding

Let's say we've decided 30 days of sessions is too many and a week will do. If you've only ever used `createIndex`, your first try will probably be this:

```js
db.sessions.createIndex({ lastSeenAt: 1 }, { expireAfterSeconds: 604800 })
```

```text
IndexOptionsConflict: An equivalent index already exists with the same name but different options.
```

So you drop it and create it again. That works, but while it rebuilds there's no index at all, and on a big collection that can take a while.

But you don't have to. The [`collMod`](https://www.mongodb.com/docs/manual/reference/command/collMod/) command can change an existing index's `expireAfterSeconds` in place, and the [TTL docs](https://www.mongodb.com/docs/manual/core/index-ttl/) even say so: you *can't* use `createIndex()` to change it, so use `collMod`.

```js
db.runCommand({ collMod: "sessions", index: { name: "lastSeenAt_1", expireAfterSeconds: 604800 } })
```

The good news is you don't need to remember any of that. Change `FromDays(30)` to `FromDays(7)` and the tool spots that `collMod` will do:

```text
$ migrate-mongo up
Acquired lock (run bfc5b4ac06e44fa5ba9d30c7974652e8).
✔ customers   (in sync)
✔ orders   (in sync)
⟳ sessions
  ~ modify   lastSeenAt_1   expireAfterSeconds 2592000 → 604800
✔ sessions   (0.05s)
Changed 1 collection(s).
```

That's 0.05 seconds, and the index was there the whole time. One thing to watch out for, though: shortening a TTL can make an awful lot of documents expire in one go. My test collection went from 5,000 sessions to 1,169 within a couple of minutes, as the TTL monitor caught up. The docs warn that this can cause a burst of deletes, so maybe don't do it at peak time.

It works the other way too. Since MongoDB 5.1, `collMod` can turn an existing single-field index into a TTL index, and the tool does that in place as well rather than rebuilding it.

`collMod` has a couple more tricks up its sleeve, and the tool uses both: hiding an index from the query planner, and making an existing index unique.

## Making an index unique when the data says no

Order references should be unique, so let's say so:

```csharp
.Add(k => k.Ascending(o => o.Reference), new() { Unique = true });
```

The tool doesn't drop and re-create the index. It turns on `prepareUnique` first, which makes MongoDB reject any *new* duplicates, then asks it to convert the index to unique, which checks the ones already there. Unless, of course, there are some:

```text
$ migrate-mongo up
Acquired lock (run 14d3a3226829477cb990f639881f00d5).
✔ customers   (in sync)
⟳ orders
✖ orders: MongoCommandException: Command collMod failed: Cannot convert the index to unique. Please resolve conflicting documents before running collMod again.
    3 operation(s) recorded, 1 failed – migrate-mongo show orders
✖ Collection orders failed.
```

Which is exactly what you want. The index is left as it was, `prepareUnique` is switched back off, and nothing was dropped.

Fixing the data is what migrations are for, so here's one that gives the duplicates a suffix and keeps the oldest order's reference as it is:

```csharp
[Migration("20261102150000", "renumber-duplicate-order-references")]
public sealed class RenumberDuplicateOrderReferences : IMigration
{
    public async Task UpAsync(MigrationContext context, CancellationToken cancellationToken)
    {
        var orders = context.Track(context.Database.GetCollection<BsonDocument>("orders"), "renumbered");

        // The oldest order keeps its reference; the rest get -2, -3, ...
        var duplicates = await orders.Collection.Aggregate(context.Session!)
            .Sort(Builders<BsonDocument>.Sort.Ascending("createdAt"))
            .Group(BsonDocument.Parse("""{ _id: "$reference", ids: { $push: "$_id" } }"""))
            .Match(BsonDocument.Parse("""{ "ids.1": { $exists: true } }"""))
            .ToListAsync(cancellationToken);

        var renames = duplicates.SelectMany(d => d["ids"].AsBsonArray.Skip(1).Select((id, i) =>
            new UpdateOneModel<BsonDocument>(
                Builders<BsonDocument>.Filter.Eq("_id", id),
                Builders<BsonDocument>.Update.Set("reference", $"{d["_id"].AsString}-{i + 2}")))).ToList();

        if (renames.Count > 0)
        {
            await orders.BulkWriteAsync(renames, cancellationToken: cancellationToken);
            context.Results.Note($"Renumbered duplicates of {string.Join(", ", duplicates.Select(d => d["_id"].AsString))}");
        }
    }

    public Task DownAsync(MigrationContext context, CancellationToken cancellationToken) => Task.CompletedTask;
}
```

Because `up` runs the migrations before the collection definitions, one run fixes the data and then makes the index unique:

```text
$ migrate-mongo up
Acquired lock (run 3b0ec522f19046cdb021cf0bcebdf14b).
▶ 20261102150000 renumber-duplicate-order-references
  info: Renumbered duplicates of ORD-113002, ORD-100417
✔ 20261102150000 renumber-duplicate-order-references   (0.13s, transaction)
    renumbered  inserted 0 · matched 3 · modified 3 · deleted 0 · upserted 0
    1 operation(s) recorded – migrate-mongo show 20261102150000
✔ customers   (in sync)
⟳ orders
  ~ modify   reference_1   unique: false → true
✔ orders   (0.03s)
✔ sessions   (in sync)
Applied 1 migration(s) in batch 1 and changed 1 collection(s).
```

This is the split I've ended up liking: migrations change *data*, and definitions describe *structure*.

## The ones that do need a rebuild

Not everything can be done in place. Here's a change that can't: draft orders don't get a reference until checkout, so our unique index needs to skip documents without one. That's what `sparse` is for:

```csharp
.Add(k => k.Ascending(o => o.Reference), new() { Unique = true, Sparse = true });
```

`collMod` can't change `sparse`, and MongoDB won't let two indexes on the same keys differ only by options like that. So the only way is to drop the index and create it again. The tool keeps the name, so anything that hints the index by name keeps working. And if the new one fails to build, it puts the old one back.

There's still a window where the collection has no index at all, though, and for a unique index, no constraint either. That might be fine on your laptop, but you may not want it happening in production without someone noticing. So the config can refuse rebuilds, per environment:

```yaml
environments:
  production:
    indexes:
      onRebuild: fail
```

```text
$ migrate-mongo plan --env production
  ⟳ customers   in sync
  ⟳ orders
      ↻ rebuild  reference_1   sparse: false → true (drop, then create)   ✖ blocked: indexes.onRebuild is fail
  ⟳ sessions   in sync
error: orders: rebuilding reference_1 drops it before the new one builds, and indexes.onRebuild is fail. A new name alone won't build it alongside the old one: MongoDB doesn't allow two indexes with the same keys, collation and partial filter. Give the declared index a new name and a partial filter or collation, or run with --allow-rebuild orders.reference_1.
✖ Would change 1 collection(s).
```

That exits with code `4` before touching anything, so the deploy stops. As the error says, you then have two choices:

- **Approve this one rebuild** with `--allow-rebuild orders.reference_1`, at a quiet time.
- **Build the new one alongside the old one.** For that, the new index needs a different identity as well as a different name. Here, a [partial index](https://www.mongodb.com/docs/manual/core/index-partial/) does the job. The docs suggest them over sparse indexes when you want more control, and the filter counts as part of the identity:

```csharp
.Add(k => k.Ascending(o => o.Reference), new()
{
    Name = "reference_unique",
    Unique = true,
    PartialFilterExpression = Builders<Order>.Filter.Type(o => o.Reference, BsonType.String),
});
```

```text
  ⟳ orders
      + create   reference_unique   { reference: 1 }  unique, partialFilterExpression { reference: { $type: 2 } }
      - hide     reference_1        not declared
```

The new index builds first, and only then is the old one dealt with. Here it's hidden, which we'll come to in a moment. Changes always run in that order: new indexes first, removals last.

## Indexes nobody declared

Which brings us to the index someone added by hand. Out of the box (`prune: report`), the tool leaves anything it wasn't told about alone and lists it as `keep`. That's the right default when you're adopting an existing database, and you can `Ignore("adhoc_*")` anything a different team or process looks after.

It also notices when a declared index has been changed behind its back. Say someone tweaks the TTL in Compass, and also adds a `status_1` index while they're in there. `status --check` exits with `2` when a collection is out of line with its definition:

```text
$ migrate-mongo status --check
 ID              Name                                 State    Batch  Applied              Results
 20261102150000  renumber-duplicate-order-references  applied  1      2026-11-03 09:57:24  renumbered: inserted 0 · matched 3 · modified 3 · deleted 0…

 Collection  State    Reconciled           Changes
 customers   in sync  2026-11-03 09:56:56
 orders      in sync  2026-11-03 09:57:34  1 kept
 sessions    changes  2026-11-03 09:57:08  1 modify
1 collection(s) out of line with their definitions.
```

`orders` still counts as in sync, because `status_1` is known about and kept on purpose. `sessions` doesn't, because its TTL no longer matches what we declared. Run that on a schedule, using the migrations task from the last post with `status --check` as its command, and hand-made drift turns into a failed job instead of a surprise.

Once you trust your definitions, you can be stricter. `prune: drop` drops anything undeclared, after recording exactly what it was. My favourite, though, is `prune: hide`:

```text
$ migrate-mongo up
Acquired lock (run 22698ba4a96c4783940bef6a0ceef57b).
✔ customers   (in sync)
⟳ orders
  - hide     status_1   not declared
✔ orders   (0.05s)
⟳ sessions
  ~ modify   lastSeenAt_1   expireAfterSeconds 2592000 → 604800
✔ sessions   (0.01s)
Changed 2 collection(s).
```

While it was there, it put the TTL back too.

A [hidden index](https://www.mongodb.com/docs/manual/core/index-hidden/) isn't used by the query planner, but it's still kept up to date on every write. If a query suddenly falls off a cliff because it was secretly relying on that index, unhiding it is instant. There's no rebuild, and you just declare it again. After a week (`dropHiddenAfter`), it's dropped for real. It's "expand, then contract" from the last post, applied to indexes.

One gotcha worth knowing: a hidden *unique* index still enforces its unique constraint. Hiding is about queries, not writes. So in the partial index example above, the old `reference_1` carries on enforcing its rules until it's finally dropped.

## Is anything still using it?

`prune: hide` is a good safety net, but I'd still rather not need it. So before I delete an index from a definition, I ask MongoDB whether anything actually uses it, with [`$indexStats`](https://www.mongodb.com/docs/manual/reference/operator/aggregation/indexStats/):

```js
db.sessions.aggregate([
  { $indexStats: {} },
  { $project: { _id: 0, name: 1, host: 1, ops: "$accesses.ops", since: "$accesses.since" } }
])
```

```text
[
  { name: 'lastSeenAt_1', host: 'laptop:27017', ops: Long('0'), since: ISODate('2026-11-02T23:51:12.316Z') },
  { name: 'customerId_1', host: 'laptop:27017', ops: Long('7'), since: ISODate('2026-11-02T23:54:22.320Z') },
  { name: '_id_', host: 'laptop:27017', ops: Long('0'), since: ISODate('2026-11-02T23:51:12.316Z') }
]
```

`ops` is how many operations have used the index since `since`. I'd looked up seven customers' sessions, so `customerId_1` is clearly earning its keep. But `lastSeenAt_1` says zero, and in the minute before I ran that, the TTL monitor had used it to delete 25 expired sessions. The numbers need reading with care, and I tried each of these on a throwaway database before believing it:

- **Only your own operations count.** Finds and updates that look things up through the index count. TTL deletes don't, and neither do inserts, so a unique index can turn away duplicates all day and still say zero. For TTL and unique indexes, `ops` doesn't tell you much. The real question is whether you still need the rule.
- **The counters reset.** A restart resets them all, and any `collMod` on an index resets that one. `customerId_1`'s `since` is three minutes later than the others because I'd hidden and unhidden it while testing. The tool's in-place changes are `collMod`s too, so changing a TTL resets the counter. Always check `since` before trusting a zero.
- **Each member only counts for itself.** `$indexStats` reports on the member it runs on, hence the `host`. If anything reads from secondaries, run it on each member. Watch out for the "Usage" column in Atlas's Data Explorer as well, because it only shows the primary.
- **It needs `clusterMonitor`.**

Atlas's [Performance Advisor](https://www.mongodb.com/docs/atlas/performance-advisor/drop-indexes/) will do some of the legwork for you. It suggests dropping indexes that haven't been used for 7 days, hidden ones, and redundant ones, where one index is just the start of another, like `{ a: 1 }` next to `{ a: 1, b: -1 }`.

Once I'm happy, I delete the `.Add(...)` and let `prune: hide` take it from there. Just don't expect `$indexStats` to tell you anything during that week. Hiding is a `collMod`, so it resets the counter, and the planner can't use a hidden index, so it'll sit at zero. For that week, keep an eye on your slow queries instead.

## Every change, written down

Just like migrations, every index operation is recorded, and `show` puts a collection's whole story on one screen:

```text
$ migrate-mongo show orders
orders (collection)
  State      in sync
  Reconciled 2026-11-03 09:57:44 by kev@laptop (0.01s)
  Declared   sha256:e744fc74ff707cd2e1e33de6ccdc29d6eb6c3b66fb6d270845d4d028bc8a5698
  Source     csharp Shop.Migrations.Collections.Orders
  Run        22698ba4a96c4783940bef6a0ceef57b

Indexes
  _id_                       { _id: 1 }
  customerId_1_createdAt_-1  { customerId: 1, createdAt: -1 }
  reference_1                { reference: 1 }  unique, sparse
  status_1                   { status: 1 }  hidden  undeclared, hidden 2026-11-03 09:57

Pending
  ! keep     status_1   hidden; dropped after 2026-11-10 09:57

Last change

Operations
  1. runCommand orders  (0.00s)
       command: { collMod: "orders", index: { name: "status_1", hidden: true } }

History
 At                   ID      Name    Event       Batch  Run       Host    Error
 2026-11-03 09:57:16  orders  Orders  failed             14d3a322  laptop  MongoCommandException: Command collMod failed: Cannot convert the index to unique. Please resolve conflicting documents before running collMod again.
 2026-11-03 09:57:24  orders  Orders  reconciled         3b0ec522  laptop
 2026-11-03 09:57:34  orders  Orders  reconciled         de2e3c92  laptop
 2026-11-03 09:57:44  orders  Orders  reconciled         22698ba4  laptop
```

Anything that gets dropped is recorded with its full definition *before* it goes. Here's the history entry for the sparse rebuild, straight out of `_migrations.history`, trimmed a little:

```js
{
  migrationId: 'orders', event: 'reconciled', kind: 'collection',
  operations: [
    { kind: 'dropIndex', collection: 'orders',
      index: { name: 'reference_1', keys: { reference: 1 }, options: { unique: true } },
      counts: { dropped: 1 }, durationMs: 9 },
    { kind: 'createIndex', collection: 'orders',
      keys: { reference: 1 }, options: { name: 'reference_1', unique: true, sparse: true },
      counts: { created: 1 }, durationMs: 124 }
  ]
}
```

## Testing your indexes with WebApplicationFactory

Now for my favourite bit. I'm a big advocate for testing and TDD, and if you know me, you'll know I'm a little obsessed with making sure we have the right level of coverage. I want tests that give us confidence in how the application actually behaves.

For me, that means testing the service from the outside in: send a request to the API and exercise its real internal dependencies, including MongoDB, rather than replacing them with fakes. It's the same idea behind my post on [testing authentication and authorisation](/2026/08/30/how-i-test-authentication-and-authorisation-in-my-asp-dotnet-core-apis.html), where the tests exercise the real endpoints and policies. Here we can take that further by running against a real database with the indexes our application needs.

A unique index isn't just a performance detail; it's *behaviour*. Our API is meant to return `409 Conflict` when someone registers an email that's already taken:

```csharp
app.MapPost("/customers", async (NewCustomer request, IMongoDatabase db) =>
{
    var customer = new Customer { Email = request.Email, Name = request.Name };
    try
    {
        await db.GetCollection<Customer>("customers").InsertOneAsync(customer);
    }
    catch (MongoWriteException e) when (e.WriteError.Category == ServerErrorCategory.DuplicateKey)
    {
        return Results.Conflict($"{request.Email} is already registered");
    }

    return Results.Created($"/customers/{customer.Id}", new { Id = customer.Id.ToString() });
});
```

That only works if the index exists, with the right options and the right collation. An in-memory fake won't enforce any of it, and a test database with indexes someone created by hand will drift from production sooner or later. What I want is for the tests to build their database the same way production does.

That's where the hosting package we saw earlier comes in. Our production app doesn't use it, because the pipeline runs migrations before the deploy, but the test host can. Here's a [`WebApplicationFactory`](https://learn.microsoft.com/aspnet/core/test/integration-tests) that starts MongoDB in a container with [Testcontainers](https://dotnet.testcontainers.org/modules/mongodb/) and applies everything before the first request:

```csharp
public sealed class ShopApiFactory : WebApplicationFactory<Program>, IAsyncLifetime
{
    private readonly MongoDbContainer _mongo = new MongoDbBuilder("mongo:8.0").WithReplicaSet().Build();

    public async ValueTask InitializeAsync() => await _mongo.StartAsync();

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseSetting("ConnectionStrings:Mongo", _mongo.GetConnectionString());

        builder.ConfigureTestServices(services =>
            services.AddMongoMigrations(o => o.DatabaseName = "shop")
                .FromAssemblyContaining<Customers>()
                .RunOnStartup());
    }

    public override async ValueTask DisposeAsync()
    {
        await base.DisposeAsync();
        await _mongo.DisposeAsync();
    }
}
```

A few things worth pointing out:

- **`RunOnStartup()`** applies the migrations and the collection definitions before any hosted service starts. So by the time the test server takes its first request, the database has exactly the indexes production will have.
- **There's no connection string for the migrations.** `AddMongoMigrations` picks up the `IMongoClient` the app already registers.
- **`WithReplicaSet()`** gives you transactions, just like Atlas, and making an index unique in place needs MongoDB 6.0 or later, so it's worth testing against the version you actually run.

The test project references the API and the migrations project, and the API needs a `public partial class Program;` so the factory can find it. Then the tests are just HTTP:

```csharp
public sealed class CustomerTests(ShopApiFactory factory) : IClassFixture<ShopApiFactory>
{
    private readonly HttpClient _client = factory.CreateClient();

    [Fact]
    public async Task Registering_an_email_twice_is_a_conflict_whatever_its_case()
    {
        var first = await _client.PostAsJsonAsync("/customers", new { Email = "sam@example.com", Name = "Sam" });
        var second = await _client.PostAsJsonAsync("/customers", new { Email = "Sam@Example.com", Name = "Sam" });

        Assert.Equal(HttpStatusCode.Created, first.StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, second.StatusCode);
    }

    [Fact]
    public async Task A_customer_can_have_more_than_one_draft_order()
    {
        var customer = await _client.PostAsJsonAsync("/customers", new { Email = "alex@example.com", Name = "Alex" });
        var location = customer.Headers.Location;

        var first = await _client.PostAsync($"{location}/orders", null);
        var second = await _client.PostAsync($"{location}/orders", null);

        Assert.Equal(HttpStatusCode.Created, first.StatusCode);
        Assert.Equal(HttpStatusCode.Created, second.StatusCode);
    }
}
```

The first test proves the collation is right. Drop `strength: 2` and `Sam@Example.com` sails straight in.

The second test failed the first time I ran it, which is exactly why I like doing this:

```text
failed Shop.Api.Tests.CustomerTests.A_customer_can_have_more_than_one_draft_order (1s 031ms)
  Assert.Equal() Failure: Values differ
  Expected: Created
  Actual:   InternalServerError
```

```text
E11000 duplicate key error collection: shop.orders index: reference_1 dup key: { reference: null }
```

I'd made the index sparse so draft orders without a reference wouldn't clash. But a draft's `Reference` is `null`, and the driver happily writes `reference: null` into the document. The [sparse index docs](https://www.mongodb.com/docs/manual/core/index-sparse/) are quite clear about this, if you read them: sparse indexes "only contain entries for documents that have the indexed field, even if the index field contains a null value". A null field is still there, so it's still indexed, and the second draft clashed with the first.

The fix is one attribute, so the field is left out altogether when it's null:

```csharp
[BsonIgnoreIfNull]
public string? Reference { get; set; }
```

(Or use the partial index from earlier, which only indexes strings.) Both tests pass now. The container, the indexes and the HTTP calls take just under ten seconds on my machine. Every run also proves the definitions apply cleanly to an empty database, which is precisely what a brand-new environment will do.

I'd much rather find that bug here than in production, on the first busy Saturday after we started saving draft orders.

## Seeing index changes on the pull request

The tests prove the indexes *behave*. I also want reviewers to *see* what a pull request does to them, because adding `Sparse = true` and adding a brand-new index both look like a one-line diff. Only one of them drops a unique index in production.

The last post's pipeline doesn't let a pull request anywhere near a real database, and I'd like to keep it that way. Luckily, you don't need production to work out what a pull request changes. Bring a throwaway database up to date with the target branch, then `plan` the pull request against it:

{% raw %}
```yaml
jobs:
  # ...build, test and deploy-production as before

  index-plan:
    if: github.event_name == 'pull_request'
    runs-on: ubuntu-latest
    services:
      mongo:
        image: mongodb/mongodb-atlas-local:8.0
        ports: ["27017:27017"]
        options: --health-interval 5s
    env:
      MONGODB_URL: mongodb://localhost:27017/?directConnection=true
    steps:
      - uses: actions/checkout@v7
        with:
          ref: ${{ github.event.pull_request.base.sha }}
      - uses: actions/setup-dotnet@v6
      - run: dotnet tool restore
      - run: dotnet migrate-mongo up
      - uses: actions/checkout@v7
      - run: dotnet tool restore # in case the pull request updates the tool
      - name: Plan against production's rules
        run: |
          code=0
          dotnet migrate-mongo plan --env production 2>&1 | tee plan.txt || code=$?
          { echo '```text'; cat plan.txt; echo '```'; } >> "$GITHUB_STEP_SUMMARY"
          [ "$code" -eq 0 ] || [ "$code" -eq 2 ]
```
{% endraw %}

Here's what's going on:

- **The first checkout is the target branch**, and `up` gives the database exactly the indexes `main` declares. The second checkout is the pull request, merged into `main`, which is what `actions/checkout` gives you for a pull request. So `plan` shows only what the pull request changes.
- **`--env production` brings production's rules with it.** A rebuild that production would refuse exits with `4`, with the same message we saw earlier, and the check goes red. So the "when do we rebuild this?" conversation happens on the pull request, not halfway through a deploy.
- **Exit code `2` only means "there are changes"**, which is the whole point here, so it's let through.
- **The plan goes in the job summary**, one click away from the pull request's checks. If you'd rather post it as a comment, `--json` puts the whole plan on its last line as JSON.

Say a pull request swaps `customerId_1` on sessions for `{ customerId: 1, lastSeenAt: -1 }`, so "this customer's latest sessions" doesn't need a sort any more. Here's the summary it gets:

```text
  ⟳ customers   in sync
  ⟳ orders   in sync
  ⟳ sessions
      + create   customerId_1_lastSeenAt_-1   { customerId: 1, lastSeenAt: -1 }
      - hide     customerId_1                 not declared
Would change 1 collection(s).
```

A reviewer can see at a glance that nothing gets rebuilt, and that the old index is only hidden. The queries that used `customerId_1` will be fine too. `customerId` is the first field of the new index, so it can do everything the old one did.

It can't tell you everything, though. It compares the pull request with what `main` *declares*, not with what production actually has, so hand-made drift is still `status --check`'s job. And anything that depends on the data, like duplicates stopping an index from going unique, only shows up against real data.

## Wrapping up

Indexes describe what a collection *is*, not what happened to it along the way. Declare them that way, and let the tool work out the difference every time:

- You stop keeping a mental (or wiki) list of what's been created, dropped and tweaked.
- Adding or changing a TTL, hiding, and making an index unique happen in place with `collMod`, with no rebuild.
- Rebuilds are spelled out, and can be refused in production.
- Hand-made drift shows up in `status --check`.
- `$indexStats` tells you whether an index is still used, as long as you read it carefully.
- Pull requests show exactly what they do to your indexes, and fail early if production would refuse.
- Every change is recorded, including the full definition of anything that was dropped.
- And your integration tests run against exactly the indexes production has.

There's plenty of documentation in the [wiki](https://github.com/kevbite/Kevsoft.MigrateMongo.Tool/wiki) to help you get started. The [usage guide](https://github.com/kevbite/Kevsoft.MigrateMongo.Tool/blob/main/USAGE.md#managing-collections) has the details on managing collections.

How do you keep track of your indexes? Migrations, a script someone runs by hand, or a quiet hope that nobody's touched them in Compass? Let me know in the comments.
