---
layout: post
title: "GUID v7 in MongoDB with .NET: Ordering, Timestamps, and Protecting"
categories:
tags: [.NET, C#, MongoDB, GUID, ASP.NET Core, Security]
description: How UUID v7 in .NET gives you ordered, timestamp-embedded IDs that store efficiently in MongoDB, and how to protect them publicly when you can't afford to leak operational timing data.
comments: true
---

For a long time, if you used `Guid.NewGuid()` as your MongoDB `_id`, you were silently paying a performance tax. Random GUIDs scatter inserts across a B-tree index. Every write is potentially a page split and every read is a cache miss. The fix existed, you just had to reach for a library.

I used [NewId](https://github.com/MassTransit/MassTransit/tree/develop/src/MassTransit.Abstractions/NewId) from MassTransit for years. It generates sequentially-ordered GUIDs that insert efficiently into MongoDB indexes, includes machine and process identifiers, and handles high-throughput generation well. If you're already in the MassTransit ecosystem it remains an excellent option. But since .NET 9, you no longer need a library for the core problem:

```csharp
var id = Guid.CreateVersion7();
```

UUID version 7 is defined in [RFC 9562](https://www.rfc-editor.org/rfc/rfc9562) and is now part of the .NET standard library. It embeds a Unix timestamp in the first 48 bits, which means IDs generated later will always sort after earlier ones, which is exactly what a B-tree index needs to stay efficient.

This post covers how to use GUID v7 with MongoDB, how it compares to `ObjectId` and the other ordered-ID libraries, what the embedded timestamp means for security in regulated environments, and how to protect IDs at the API boundary using ASP.NET Core Data Protection.

## Setting up MongoDB to use Standard GUIDs

Before anything else: byte ordering matters. The MongoDB C# driver has several ways to serialise a `Guid`, and the default (legacy C# representation) does not preserve chronological sort order. You must use `GuidRepresentation.Standard`.

```csharp
BsonSerializer.RegisterSerializer(new GuidSerializer(GuidRepresentation.Standard));
```

Register this once, before any MongoDB operations. I covered the history of why this is necessary in an [earlier post](/2022/02/18/setting-up-mongodb-to-use-standard-guids-in-csharp).

## GUID v7 is sequential by default

With standard serialisation in place, using GUID v7 is just a default value on your model:

```csharp
public class Order
{
    public Guid Id { get; init; } = Guid.CreateVersion7();
    public string CustomerName { get; set; } = string.Empty;
    public decimal Total { get; set; }
}
```

Insert a few documents:

```csharp
BsonSerializer.RegisterSerializer(new GuidSerializer(GuidRepresentation.Standard));

var client = new MongoClient("mongodb://localhost:27017");
var db = client.GetDatabase("shop");
var orders = db.GetCollection<Order>("orders");

var order1 = new Order { CustomerName = "Alice", Total = 149.99m };
await Task.Delay(10);
var order2 = new Order { CustomerName = "Bob",   Total = 89.50m  };
await Task.Delay(10);
var order3 = new Order { CustomerName = "Carol", Total = 214.00m };

await orders.InsertManyAsync(new[]
{
    order1,
    order2,
    order3,
});
```

Query them back in mongosh and they come back in insertion order even without an explicit sort, because the `_id` index is already ordered:

```javascript
shop> db.orders.find({}, { _id: 1, CustomerName: 1 })
[
  {
    _id: UUID('019ee65b-8a07-7e4c-a92a-0a84bb1b53ef'),
    CustomerName: 'Alice'
  },
  {
    _id: UUID('019ee65b-8a14-7bd0-9ee7-68dc88ab116f'),
    CustomerName: 'Bob'
  },
  {
    _id: UUID('019ee65b-8a1f-7662-8d0a-73e1ca5676db'),
    CustomerName: 'Carol'
  }
]
```

Notice the first segment of each UUID increments; those are the millisecond timestamps. MongoDB's `_id` index is a B-tree, and a B-tree is fastest when new keys are always appended to the rightmost leaf. With GUID v4, every insert is effectively random and lands somewhere in the middle of the tree, causing page splits, extra I/O, and a working set that never fits in cache. With GUID v7, inserts are sequential and the tree grows cleanly to the right.

## GUID v7 versus other ordered-ID approaches

Before GUID v7 was standardised, solving this problem required a third-party library. The ecosystem produced several:

| Type      | Size     | Time-ordered  | Standard  | .NET built-in |
|-----------|----------|---------------|-----------|---------------|
| ObjectId  | 12 bytes | ✅ (seconds)  | MongoDB   | ❌            |
| GUID v4   | 16 bytes | ❌            | RFC       | ✅            |
| GUID v7   | 16 bytes | ✅ (ms)       | RFC 9562  | ✅ (.NET 9+)  |
| NewId     | 16 bytes | ✅            | n/a       | ❌            |
| ULID      | 16 bytes | ✅            | Community | ❌            |

**NewId** is the one I would still consider in specific cases. Beyond timestamp ordering it includes a worker identifier and a sequence number, giving stronger monotonic guarantees under high concurrency and across multiple nodes. If you're generating millions of IDs per second on distributed hardware, it's worth evaluating. For most applications, `Guid.CreateVersion7()` is simpler and has no external dependency.

**ULID** (`01JW1TX17Y95M2K16KB6D4E6RD`) is still popular, particularly where a URL-friendly, human-readable ID is preferable. MongoDB stores them as strings or binary; they sort correctly as strings. If your API consumers value readable IDs, ULIDs are worth knowing about.

## ObjectId, the native MongoDB ID

MongoDB's native `ObjectId` is only 12 bytes, which is 4 bytes smaller than a GUID. At scale this is significant. In BSON, a Binary value (which is how UUIDs are stored) carries 5 bytes of overhead that an ObjectId doesn't need: 4 bytes for the length integer and 1 byte for the subtype. You can see this directly in mongosh:

```javascript
shop> bsonsize({ _id: ObjectId() })
22
shop> bsonsize({ _id: new UUID('00000000-0000-7000-8000-000000000000') })
31
```

That's a 9-byte difference per document just on `_id`. Run the numbers:

- **10 million documents:** ~86 MB extra for `_id` values alone
- **100 million documents:** ~860 MB
- **Every index** that references an ID field carries the same overhead, multiplied by the number of index entries

If other collections hold references to this ID, such as line items referencing orders or events referencing aggregates, the overhead multiplies across every collection. At 100 million documents with a few referencing collections, you're looking at several gigabytes of extra storage and proportionally larger index pages that take longer to traverse.

ObjectId also has a very useful built-in feature: `CreationTime`. You get the document's creation timestamp derived directly from the ID, with no extra field on your model:

```csharp
var id = new ObjectId("6a36e2292d363fdcf284612e");
DateTime createdAt = id.CreationTime; // UTC, seconds precision
```

```javascript
shop> db.orders.findOne()._id.getTimestamp()
ISODate('2026-06-20T18:55:37.000Z')
```

This is handy. One less field to manage, one less index, and the information is always there. The caveat is that the precision is seconds, not milliseconds.

## Why prefer GUID over ObjectId?

ObjectId is a first-class type in the MongoDB ecosystem but outside it, almost nobody knows what it is. A `Guid` is understood everywhere: every .NET framework, every language, every distributed system protocol. That universality has practical value:

- Model validation with `[Required]`, FluentValidation, and DataAnnotations all work natively on `Guid` with no custom validators
- REST APIs, gRPC contracts, and message schemas (MassTransit, NServiceBus, Azure Service Bus) have first-class UUID support
- Downstream services don't need any MongoDB-specific knowledge to parse or validate an ID
- If data ever needs to move between systems, GUID is common currency

For internal services where MongoDB is the only consumer, ObjectId is a perfectly reasonable choice. You get the storage savings and the free timestamp. For anything that crosses a service boundary, GUID wins on interoperability.

## Extracting the timestamp from a GUID v7

GUID v7 gives you a creation timestamp at higher precision than ObjectId. The first 48 bits are a Unix timestamp in milliseconds. There's no built-in API in .NET yet to extract it, but the helper is straightforward:

```csharp
public static DateTimeOffset? GetTimestamp(Guid guid)
{
    // 1. Project the Guid into a read-only span of bytes without copying
    ReadOnlySpan<byte> bytes = MemoryMarshal.CreateReadOnlySpan(
        ref MemoryMarshal.GetReference(MemoryMarshal.AsBytes(MemoryMarshal.CreateReadOnlySpan(ref guid, 1))), 
        16
    );

    // 2. Direct version check on byte index 7 (due to .NET internal storage order)
    // .NET stores Guid component _c (bytes 6 and 7) in little-endian.
    // The RFC 9562 7th byte ends up at array index 7 in memory.
    // We isolate the 4 most significant bits.
    if ((bytes[7] >> 4) != 7)
    {
        return null; // Not a Version 7 GUID
    }

    // 3. Extract the 48-bit Unix timestamp from the mixed-endian structure
    long ms = ((long)bytes[3] << 40) |
                ((long)bytes[2] << 32) |
                ((long)bytes[1] << 24) |
                ((long)bytes[0] << 16) |
                ((long)bytes[5] << 8)  |
                bytes[4];

    return DateTimeOffset.FromUnixTimeMilliseconds(ms);
}
```

```csharp
var order = new Order { CustomerName = "Alice", Total = 149.99m };
await orders.InsertOneAsync(order);

var created = GetTimestamp(order.Id);
Console.WriteLine(created); // 06/27/2025 18:22:19 +00:00
```

The millisecond precision is a genuine advantage over ObjectId's seconds. In event-sourced systems, audit trails, or anywhere you're writing multiple documents in a tight loop, knowing the order within the same second matters. With ObjectId, you can only tell that two events happened in the same second. With GUID v7 you know which came first within a millisecond window.

## The security concern, IDs that tell a story

UUID v7 intentionally embeds a creation timestamp. In most applications that's purely a benefit, but it does mean that anyone who can collect your public IDs can derive information from them.

Take two invoice IDs from an API response:

```
019ee664-8bae-76ce-b87d-3d7062bcf31a
019ee664-8bbc-7e8d-b6c0-349e4d61adab
```

The first 12 hex characters encode the Unix timestamp in milliseconds. From two IDs an observer can calculate exactly how many milliseconds apart the invoices were created. Collect enough IDs over time and you can:

- Estimate total transaction volume over any period
- Identify peak trading hours and quiet periods
- Correlate a customer's sign-up time with their first order
- Infer seasonal patterns in business activity

ObjectId has the same characteristic; its first 4 bytes are a Unix timestamp in seconds. NewId and ULID also embed timestamps. Only GUID v4 is genuinely opaque because it's random.

For most applications this is not a concern. But in some regulated environments it is. PCI DSS doesn't explicitly forbid timestamp-embedded IDs, but internal security policies and some auditors treat externally visible operational timing data as information leakage. In healthcare or government systems, knowing *when* a record was created can reveal more than it should. A public URL like:

```
https://api.example.com/invoices/019ee664-8bae-76ce-b87d-3d7062bcf31a
```

gives a determined party a data point they didn't pay for, and in a PCI DSS environment that audit paper trail can become a compliance conversation you'd rather not have.

## Hiding IDs at the boundary with ASP.NET Core Data Protection

The fix is to keep the ordered GUID v7 inside the database, retaining all the index efficiency, and never expose the raw ID externally. Encrypt it at the API boundary using ASP.NET Core Data Protection.

Data Protection is almost certainly already wired into your application. It's required for:

- **Cookie encryption**: auth cookies are Data Protection payloads
- **Antiforgery tokens**: the `__RequestVerificationToken` used in forms
- **Session state**: session cookies are Data Protection-backed
- **Load balancing**: multiple instances must share a key ring so tokens issued by one node can be read by another; without it, a user hitting a different instance loses their session

```csharp
builder.Services.AddDataProtection();
```

A straightforward first approach puts the protector directly in the controller:

```csharp
[ApiController]
[Route("orders")]
public class OrdersController(
    IMongoCollection<Order> collection,
    IDataProtectionProvider provider) : ControllerBase
{
    private readonly IDataProtector _protector =
        provider.CreateProtector("orders.public-id");

    [HttpGet]
    public async Task<IEnumerable<object>> List()
    {
        var orders = await collection
            .Find(Builders<Order>.Filter.Empty)
            .ToListAsync();

        return orders.Select(o => new
        {
            Id = _protector.Protect(o.Id.ToString()),
            o.CustomerName,
            o.Total
        });
    }

    [HttpGet("{protectedId}")]
    public async Task<IActionResult> Get(string protectedId)
    {
        Guid rawId;
        try
        {
            rawId = Guid.Parse(_protector.Unprotect(protectedId));
        }
        catch (CryptographicException)
        {
            return BadRequest("Invalid ID.");
        }

        var order = await collection.Find(x => x.Id == rawId).SingleOrDefaultAsync();
        return order is null ? NotFound() : Ok(order);
    }
}
```

The protected ID looks like `CfDJ8MIfgTQh7XqLkN2RbA4P1eKz9fV...`. It's tamper-resistant, altering a single character causes decryption to fail, and it reveals nothing about when the order was created or how many orders exist.

This works, but if you have many controllers and a DDD model with strongly-typed IDs per aggregate, you end up calling `_protector.Protect` and `_protector.Unprotect` in every action. There's a better place for this.

### A DDD-friendly `ProtectedId` base type

If you're doing Domain-Driven Design, you likely already define a strongly-typed ID per aggregate root. Combine that pattern with a custom JSON converter and the protect/unprotect concern moves entirely into the serialisation layer, so controllers and mappings never touch the protector.

Start with an abstract base type:

```csharp
public abstract record ProtectedId(Guid Value)
{
    public static implicit operator Guid(ProtectedId id) => id.Value;
}
```

Then a type per aggregate root:

```csharp
public record OrderId(Guid Value) : ProtectedId(Value)
{
    public static OrderId New() => new(Guid.CreateVersion7());
}

public record CustomerId(Guid Value) : ProtectedId(Value)
{
    public static CustomerId New() => new(Guid.CreateVersion7());
}
```

The compile-time benefit: you cannot pass an `OrderId` where a `CustomerId` is expected. The type system enforces aggregate boundaries.

Now a generic `JsonConverter<T>` that handles protect and unprotect for any `ProtectedId` subtype:

```csharp
public class ProtectedIdJsonConverter<T>(IDataProtectionProvider provider)
    : JsonConverter<T> where T : ProtectedId
{
    // Using the concrete type name as the purpose string means an OrderId token
    // cannot be submitted where a CustomerId is expected, giving you runtime
    // isolation to match the compile-time isolation the type system already provides.
    private readonly IDataProtector _protector =
        provider.CreateProtector($"protected-id.{typeof(T).Name}");

    public override T Read(
        ref Utf8JsonReader reader,
        Type typeToConvert,
        JsonSerializerOptions options)
    {
        var token = reader.GetString()
            ?? throw new JsonException("Expected a non-null string.");

        var rawId = Guid.Parse(_protector.Unprotect(token));
        return (T)Activator.CreateInstance(typeof(T), rawId)!;
    }

    public override void Write(
        Utf8JsonWriter writer,
        T value,
        JsonSerializerOptions options)
        => writer.WriteStringValue(_protector.Protect(value.Value.ToString()));
}
```

Because the converter needs `IDataProtectionProvider` from the DI container, register it via `IConfigureOptions<JsonOptions>` rather than inside `AddJsonOptions` (which doesn't have access to the container at that point):

```csharp
public class ConfigureJsonOptions(IDataProtectionProvider provider)
    : IConfigureOptions<JsonOptions>
{
    public void Configure(JsonOptions options)
    {
        options.JsonSerializerOptions.Converters.Add(
            new ProtectedIdJsonConverter<OrderId>(provider));
        options.JsonSerializerOptions.Converters.Add(
            new ProtectedIdJsonConverter<CustomerId>(provider));
    }
}
```

For route and query-string parameters like `GET /orders/{id}`, where `id` arrives as a protected string, ASP.NET Core needs a model binder. A generic binder paired with a provider that auto-applies to any `ProtectedId` subtype keeps this zero-maintenance as you add new ID types:

```csharp
public class ProtectedIdModelBinder<T>(IDataProtectionProvider provider) : IModelBinder
    where T : ProtectedId
{
    private readonly IDataProtector _protector =
        provider.CreateProtector($"protected-id.{typeof(T).Name}");

    public Task BindModelAsync(ModelBindingContext bindingContext)
    {
        var value = bindingContext.ValueProvider
            .GetValue(bindingContext.ModelName).FirstValue;

        if (value is null)
        {
            bindingContext.Result = ModelBindingResult.Failed();
            return Task.CompletedTask;
        }

        try
        {
            var rawId = Guid.Parse(_protector.Unprotect(value));
            var id = (T)Activator.CreateInstance(typeof(T), rawId)!;
            bindingContext.Result = ModelBindingResult.Success(id);
        }
        catch (CryptographicException)
        {
            bindingContext.ModelState.AddModelError(
                bindingContext.ModelName, "Invalid or tampered ID.");
            bindingContext.Result = ModelBindingResult.Failed();
        }

        return Task.CompletedTask;
    }
}

public class ProtectedIdModelBinderProvider(IDataProtectionProvider provider)
    : IModelBinderProvider
{
    public IModelBinder? GetBinder(ModelBinderProviderContext context)
    {
        if (!context.Metadata.ModelType.IsAssignableTo(typeof(ProtectedId)))
            return null;

        var binderType = typeof(ProtectedIdModelBinder<>)
            .MakeGenericType(context.Metadata.ModelType);

        return (IModelBinder)Activator.CreateInstance(binderType, provider)!;
    }
}

public class ConfigureMvcOptions(IDataProtectionProvider provider)
    : IConfigureOptions<MvcOptions>
{
    public void Configure(MvcOptions options)
        => options.ModelBinderProviders.Insert(0,
            new ProtectedIdModelBinderProvider(provider));
}
```

The full `Program.cs` wiring everything together:

```csharp
var builder = WebApplication.CreateBuilder(args);

BsonSerializer.RegisterSerializer(new GuidSerializer(GuidRepresentation.Standard));

builder.Services.AddDataProtection();

builder.Services.AddSingleton<IMongoClient>(_ =>
    new MongoClient("mongodb://localhost:27017"));

builder.Services.AddSingleton(sp =>
    sp.GetRequiredService<IMongoClient>()
      .GetDatabase("shop")
      .GetCollection<Order>("orders"));

builder.Services.AddSingleton<IConfigureOptions<JsonOptions>, ConfigureJsonOptions>();
builder.Services.AddSingleton<IConfigureOptions<MvcOptions>, ConfigureMvcOptions>();

builder.Services.AddControllers();

var app = builder.Build();
app.MapControllers();
app.Run();
```

The controller now has zero protector calls. The JSON converter and model binder handle everything at the serialisation boundary:

```csharp
public class Order
{
    public Guid Id { get; init; } = Guid.CreateVersion7();
    public string CustomerName { get; set; } = string.Empty;
    public decimal Total { get; set; }
}

public record OrderResponse(OrderId Id, string CustomerName, decimal Total);
public record CreateOrderRequest(string CustomerName, decimal Total);

[ApiController]
[Route("orders")]
public class OrdersController(IMongoCollection<Order> collection) : ControllerBase
{
    [HttpGet]
    public async Task<IEnumerable<OrderResponse>> List()
    {
        var orders = await collection
            .Find(Builders<Order>.Filter.Empty)
            .ToListAsync();

        return orders.Select(o =>
            new OrderResponse(new OrderId(o.Id), o.CustomerName, o.Total));
    }

    [HttpGet("{id}")]
    public async Task<IActionResult> Get(OrderId id)
    {
        var order = await collection
            .Find(x => x.Id == (Guid)id)
            .SingleOrDefaultAsync();

        return order is null
            ? NotFound()
            : Ok(new OrderResponse(new OrderId(order.Id), order.CustomerName, order.Total));
    }

    [HttpPost]
    public async Task<IActionResult> Create([FromBody] CreateOrderRequest request)
    {
        var order = new Order
        {
            CustomerName = request.CustomerName,
            Total = request.Total
        };

        await collection.InsertOneAsync(order);

        return Ok(new OrderResponse(new OrderId(order.Id), order.CustomerName, order.Total));
    }
}
```

The raw GUID v7 lives only inside MongoDB. Every external representation, whether response bodies or route parameters, is a Data Protection token. Adding a new aggregate ID type means defining a new record inheriting from `ProtectedId` and adding one line to `ConfigureJsonOptions`. MongoDB still receives monotonically increasing keys and the B-tree stays efficient.

### Time-limited share links with `ITimeLimitedDataProtector`

There's a variation worth knowing about: `ITimeLimitedDataProtector`. Tokens have a cryptographic expiry baked in, so no database table of used tokens, no background cleanup job, and no cache invalidation. When the token expires, `Unprotect` throws. It's useful for shareable links such as password resets, document previews, and download links where you want the link to stop working after a fixed window.

```csharp
[ApiController]
[Route("orders")]
public class OrderShareController(
    IMongoCollection<Order> collection,
    IDataProtectionProvider provider) : ControllerBase
{
    private readonly ITimeLimitedDataProtector _protector = provider
        .CreateProtector("orders.share-link")
        .ToTimeLimitedDataProtector();

    // POST /orders/{id}/share  →  issues a token valid for 30 minutes
    [HttpPost("{id}/share")]
    public async Task<IActionResult> CreateShareLink(OrderId id)
    {
        var order = await collection
            .Find(x => x.Id == (Guid)id)
            .SingleOrDefaultAsync();

        if (order is null) return NotFound();

        var token = _protector.Protect(order.Id.ToString(), TimeSpan.FromMinutes(30));
        var shareUrl = Url.Action(nameof(RedeemShareLink), new { token })!;

        return Ok(new { shareUrl, expiresInMinutes = 30 });
    }

    // GET /orders/shared/{token}  →  redeems the token, 404 after 30 minutes
    [HttpGet("shared/{token}")]
    public async Task<IActionResult> RedeemShareLink(string token)
    {
        Guid rawId;
        try
        {
            rawId = Guid.Parse(_protector.Unprotect(token, out _));
        }
        catch (CryptographicException)
        {
            return BadRequest("This link has expired or is invalid.");
        }

        var order = await collection.Find(x => x.Id == rawId).SingleOrDefaultAsync();
        return order is null
            ? NotFound()
            : Ok(new OrderResponse(new OrderId(order.Id), order.CustomerName, order.Total));
    }
}
```

Note that `"orders.share-link"` is a different purpose string from `"protected-id.OrderId"` used by the converter. A share-link token cannot be submitted to the normal order endpoint and vice versa, as each purpose is independently keyed.

## Wrapping up

- `Guid.CreateVersion7()` is the standard answer for ordered IDs in .NET, no extra library needed
- You must configure `GuidRepresentation.Standard` in the C# MongoDB driver or the sort ordering will be wrong
- ObjectId is 9 bytes smaller per document in BSON, has `CreationTime` built in, but is a MongoDB-specific type that doesn't travel well across service boundaries
- GUID v7 gives millisecond timestamp precision, universal portability, and native validation in every framework
- The embedded timestamp can be a concern in regulated environments, so protect IDs at the API boundary using ASP.NET Core Data Protection, which you almost certainly already have wired up
- Wrapping `ProtectedId` with DDD-style typed IDs and a generic `JsonConverter<T>` moves the protect/unprotect concern out of your controllers entirely. Using the type name as the purpose string gives you token-type isolation for free, so an `OrderId` token cannot be submitted where a `CustomerId` is expected
