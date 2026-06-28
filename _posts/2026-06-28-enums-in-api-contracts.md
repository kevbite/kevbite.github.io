---
layout: post
title: "Enums in API Contracts: Don't Let Your Status Values Break the World"
categories:
tags: [.NET, C#, API, Enums, System.Text.Json]
description: How to consume enum values over APIs in a non-breaking way, and why the string-backed value type pattern is worth reaching for before you default to a plain C# enum.
comments: true
---

## The enum problem nobody talks about until it bites them

I've hit the same problem at almost every company I've worked at. You're consuming an API, it returns a status field, you deserialise it into a C# enum, everything works beautifully. Six months later the API team adds a new status value and your application starts throwing exceptions, or silently swallowing values you never expected. Either way, something breaks.

At [Crezco](https://www.crezco.com) we had a lot of this. PayRuns, Batches, Groups, Payables, all of them had status enums. We'd had to consolidate statuses a few times because they were too fine-grained, and adding new values downstream was always a conversation about which consumers it would break. We also extended statuses to handle FX transactions, which added new states that the original enum design hadn't anticipated. It's not a unique problem, but it's one that catches people off guard.

The [Companies House .NET client](https://github.com/kevbite/CompaniesHouse.NET) I maintain is a good public example of how painful this gets when you don't own the API at all. Companies House mention API versioning in their docs but don't actually honour it, and the result is a steady stream of issues caused by new enum values appearing in responses: [#187](https://github.com/kevbite/CompaniesHouse.NET/issues/187), [#183](https://github.com/kevbite/CompaniesHouse.NET/issues/183), [#209](https://github.com/kevbite/CompaniesHouse.NET/issues/209), [#218](https://github.com/kevbite/CompaniesHouse.NET/issues/218). Each one is a consumer's application falling over because a string that wasn't there last week is now arriving in a response.

This post is about how to handle that better, both as a consumer and as a publisher.

## Why plain enums are fragile at API boundaries

When you deserialise a JSON response into a standard C# enum with `System.Text.Json`, an unrecognised string value throws a `JsonException`. That's the default behaviour, and it means every new value your API publisher adds is a potential runtime failure for every consumer who hasn't updated their client.

```csharp
public enum PaymentStatus
{
    Pending,
    Approved,
    Rejected
}
```

```json
{ "status": "Refunded" }
```

If "Refunded" gets added to the API and your client hasn't been updated, that deserialisation fails. No matter how carefully the publisher versions their API, if your deployed client is ahead of your update cycle you have a window of breakage.

## Approach 1: Fallback to Unknown with a custom converter

The first thing most people reach for is a fallback value. Add an `Unknown` member to the enum and write a custom `JsonConverter` that maps anything unrecognised to it.

```csharp
public enum PaymentStatus
{
    Unknown,
    Pending,
    Approved,
    Rejected
}

public class PaymentStatusConverter : JsonConverter<PaymentStatus>
{
    public override PaymentStatus Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        var value = reader.GetString();
        return Enum.TryParse<PaymentStatus>(value, ignoreCase: true, out var result)
            ? result
            : PaymentStatus.Unknown;
    }

    public override void Write(Utf8JsonWriter writer, PaymentStatus value, JsonSerializerOptions options)
        => writer.WriteStringValue(value.ToString());
}
```

Register the converter on the enum itself or in your `JsonSerializerOptions` and you stop throwing on unknown values.

This works fine for basic scenarios. The application doesn't crash when a new status appears, and you can route `Unknown` to some default handling path.

The problem is that you've lost the raw value. The original string that came back from the API ("Refunded", "InReview", whatever it was) is gone. You've swallowed it. That matters if:

- You want to log it for observability and debugging
- You need to round-trip the value back to another API
- The value carries information useful to higher layers even if you can't act on it yet
- You want to surface it in your own API responses or event streams

For simple internal scenarios where you genuinely don't care about unknown values, `Unknown` as a fallback is fine. But once you start caring about what you've received, you're stuck. I've seen this come up in the Companies House client too, where consumers wanted access to the raw string rather than a mapped enum value: [#156](https://github.com/kevbite/CompaniesHouse.NET/issues/156).

## Approach 2: The string-backed value type

This is the approach I prefer, and it's the one I'd reach for in any non-trivial system.

Instead of a C# enum, you define a `readonly record struct` that wraps a string. It exposes your known values as static properties and lets anything else pass through as-is.

```csharp
public readonly record struct PaymentStatus(string Value)
{
    public static PaymentStatus Pending  => new("Pending");
    public static PaymentStatus Approved => new("Approved");
    public static PaymentStatus Rejected => new("Rejected");

    public bool IsKnown =>
        this == Pending ||
        this == Approved ||
        this == Rejected;
}
```

You get the raw string value preserved. You can pattern match on the known values. You can introduce `IsKnown` to branch on whether you understand it. Code that was written against `Pending`, `Approved`, and `Rejected` continues to work exactly as before when `Refunded` arrives. It just ends up in whatever branch handles unknown values.

Serialisation with `System.Text.Json` needs a small push:

```csharp
public class PaymentStatusConverter : JsonConverter<PaymentStatus>
{
    public override PaymentStatus Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
        => new(reader.GetString()!);

    public override void Write(Utf8JsonWriter writer, PaymentStatus value, JsonSerializerOptions options)
        => writer.WriteStringValue(value.Value);
}
```

The converter is now trivial. It's just reading and writing a string. No lookup, no fallback, no loss of information. And if you need to round-trip an unknown value back to another system, you have it.

## When prefixes matter

The string-backed type gets even more useful when the API uses structured enum values, a pattern I've seen quite a bit with workflow statuses.

Suppose a payment goes through several processing sub-states that share a prefix:

```json
{ "status": "Processing-KnowYourCustomer" }
{ "status": "Processing-Authorization" }
{ "status": "Processing-FraudCheck" }
```

With a plain enum you'd need a case for every possible processing state. With the string-backed type, you can reason about the prefix without knowing every possible suffix in advance:

```csharp
public readonly record struct PaymentStatus(string Value)
{
    public static PaymentStatus Pending  => new("Pending");
    public static PaymentStatus Approved => new("Approved");
    public static PaymentStatus Rejected => new("Rejected");

    public bool IsProcessing => Value.StartsWith("Processing-", StringComparison.OrdinalIgnoreCase);

    public string? ProcessingStep => IsProcessing
        ? Value["Processing-".Length..]
        : null;

    public bool IsKnown =>
        this == Pending ||
        this == Approved ||
        this == Rejected ||
        IsProcessing;
}
```

Now a consumer can check `status.IsProcessing` without caring which specific step the payment is on. New processing sub-states added by the API publisher won't break anything.

## Looking ahead: discriminated unions

One of the things that makes the string-backed value type slightly awkward is that switch expressions over it are working against raw strings rather than types:

```csharp
var message = status switch
{
    _ when status == PaymentStatus.Pending  => "Awaiting processing",
    _ when status == PaymentStatus.Approved => "Payment complete",
    _ when status == PaymentStatus.Rejected => "Payment declined",
    _ when status.IsProcessing              => $"In progress: {status.ProcessingStep}",
    _                                       => $"Unknown status: {status.Value}"
};
```

It works, but it's verbose. C# discriminated unions, being shaped for a future release, would let you express this much more naturally with compiler-checked exhaustiveness, something like:

```csharp
public abstract record PaymentStatus
{
    public record Pending   : PaymentStatus;
    public record Approved  : PaymentStatus;
    public record Rejected  : PaymentStatus;
    public record Processing(string Step) : PaymentStatus;
    public record Unknown(string RawValue) : PaymentStatus;
}
```

```csharp
var message = status switch
{
    PaymentStatus.Pending              => "Awaiting processing",
    PaymentStatus.Approved             => "Payment complete",
    PaymentStatus.Rejected             => "Payment declined",
    PaymentStatus.Processing { Step: var step } => $"In progress: {step}",
    PaymentStatus.Unknown { RawValue: var raw }  => $"Unknown status: {raw}"
};
```

The compiler enforces that every case is handled and refactoring is much easier. Today you can approximate this with a class hierarchy and the pattern matching that's already in the language, but the ergonomics are a bit rough. Once native discriminated unions land, this becomes the obvious way to model these kinds of open-ended values.

For a library-based approach that gives you similar switch ergonomics today, [OneOf](https://github.com/mcintyre321/OneOf) is worth a look, though it doesn't give you the raw-value-preservation story out of the box. I wrote about it in more detail in [OneOf&lt;&gt; vs FluentResults](https://kevsoft.net/2025/06/20/one-of-vs-fluent-results.html), and also did a [short lightning talk on the OneOf library](https://kevsoft.net/events/2020-02-04-dotnetsheff-oneof-library.html) at dotnetsheff if you want a quick intro.

## What about generated API clients?

Tools like [Kiota](https://learn.microsoft.com/en-us/openapi/kiota/overview) are genuinely useful, especially when you're iterating quickly against a spec. They save a lot of mechanical work and keep your client aligned with the API shape.

The catch is that generated clients tend to generate plain enums. They don't know that a particular status field is likely to grow, they just map what's in the spec today. The business knowledge of "this enum will expand, handle it defensively" isn't in the OpenAPI document, so it doesn't end up in the client.

If you're using a generated client and you know a particular field is volatile, it's worth wrapping that field at the edge of your domain with a string-backed type rather than letting the generated enum propagate through your codebase. Treat the generated client as a transport layer and translate at the boundary.

## What publishers should do

Most of this post is written from the consumer's side, but publishers have a role here too.

If an enum field in your API is expected to grow over time, say so. That's an API contract decision and your consumers deserve to know about it. Some ways to signal this:

- Document the field explicitly as "extensible" or "open-ended" in your OpenAPI spec or API docs
- Recommend a string-backed type or similar pattern in your client documentation
- Add a note that your consumers should handle unknown values gracefully

What you should avoid is the opposite: publishing a status field, telling consumers it's stable, and then adding values to it without a version bump or any warning. That's what happened with Companies House, and it means every affected consumer breaks silently until someone notices and files an issue.

If you do need to extend an enum in a versioned API, consider whether you can introduce it in a non-breaking way, new values that don't affect existing workflows, and communicate the addition clearly in your changelog rather than leaving consumers to discover it in production.

## Wrapping up

Plain C# enums at API boundaries are fine when you fully control both sides. Anywhere else, they're a liability. The further the value travels, across teams, across organisations, across deployment cycles, the more likely it is that a new value arrives before your client handles it.

The `Unknown` fallback pattern is a reasonable starting point but loses the raw value, which creates problems of its own. The string-backed value type is more work upfront but preserves everything, composes well with prefix-based logic, and makes adding new known values a straightforward, non-breaking change. When discriminated unions arrive natively in C#, the switch ergonomics improve further without giving up any of those properties.

Start defensive, stay defensive, and make sure your API contract is honest about what might change.
