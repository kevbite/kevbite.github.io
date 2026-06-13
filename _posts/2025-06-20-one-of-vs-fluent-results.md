---
layout: post
title: OneOf<> vs FluentResults
categories:
tags: [C#, .NET, OneOf, FluentResults]
description: This post shows why using the OneOf<> library in .NET can be a better choice than the FluentResults package for modeling multiple, distinct outcomes in your application.
comments: true
---

# Why I’d Rather Let the Type System Do the Talking

Over the years I’ve tried a fair few libraries to model outcomes in .NET. One that comes up a lot and one I’ve used plenty is [FluentResults](https://github.com/altmann/FluentResults). It gives you a `Result<T>` that wraps success/failure, helps with chaining, and avoids throwing exceptions like it’s the 2000s.

But after using [OneOf](https://github.com/mcintyre321/OneOf) in a few real-world projects, I’ve come to prefer it, not because it’s newer or shinier, but because it leans harder into what the compiler *can* and *should* do.

Here’s why.

## FluentResults is elegant, until things get messy

Let’s start with the basics:

```csharp
Result<User> result = GetUserById(id);

if (result.IsSuccess)
{
    return Ok(result.Value);
}
else
{
    return BadRequest(result.Errors);
}
```

Not bad. FluentResults wraps things up nicely. You can attach metadata, reasons, even build a failure pipeline.

But then you hit the real world: not all errors are “errors”. Sometimes the user’s *not found*. Sometimes they’re *unauthorized*, or *locked out*, or the request is *already being processed*.

You start doing this:

```csharp
return Result.Fail<User>(new Error("NotFound").WithMetadata("Reason", "NotFound"));
```

Now the “failure” is carrying a magic string and some metadata that you need to unpack downstream. You’ve turned structured outcomes into tagged bags of data and it’s on *you* to manage the discipline.


## OneOf makes the outcomes *explicit*

With `OneOf`, you just say what your method *can return*:

```csharp
public OneOf<User, NotFound, Unauthorized, LockedOut> GetUser(Guid id)
```

Now your consumer knows exactly what to expect. They have to *handle it*, and the compiler keeps them honest:

```csharp
return result.Match(
    user => Ok(user),
    notFound => NotFound(),
    unauthorized => Forbid(),
    lockedOut => Redirect("/locked-out")
);
```

No magic strings. No assumptions. Just data structures and a match expression.

It’s not just cleaner, it’s *safer*.


## FluentResults is okay at composition — until it isn't

One of FluentResults' selling points is chaining:

```csharp
var result = GetUser(id)
    .Bind(EnsureAccountIsActive)
    .Bind(SendWelcomeEmail);
```

That looks nice... until you need to propagate *why* something failed. Suddenly you're enriching errors, carrying metadata around, and trying to reverse-engineer a flow from a blob of `Result.Failure`.

With `OneOf`, each method can return exactly what it needs to:

```csharp
public OneOf<User, NotFound> GetUser(...) { }
public OneOf<Success, EmailFailure> SendWelcomeEmail(...) { }
```

You can use pattern matching, compose results clearly, and stop encoding failure reasons as strings or dynamic metadata.


## It’s about the shape of your domain

The real win with OneOf isn’t code brevity or “clean syntax”. It’s that your return types model your *domain*.

If your business logic can result in:

* `AlreadyProcessed`
* `RateLimited`
* `UserLockedOut`
* `ValidationError`

then *those* should be the types you return.

FluentResults puts everything into a single failure bucket. OneOf lets you explode your outcome space in a controlled, compiler-friendly way.


## But what about FluentResults' extras?

FluentResults gives you error reasons, metadata, logging, a result base class. It’s got some nice toys.

If you need a result abstraction that travels well through a pipeline or logs everything out-of-the-box, it might be a better fit.

But if you care more about *type safety*, *explicit modeling*, and *idiomatic use of modern C#*, I think OneOf wins.

## TL;DR

| Feature                     | OneOf<>       | FluentResults                   |
| --------------------------- | ------------- | ------------------------------- |
| Multiple explicit outcomes  | ✅           | 🚫 (workarounds with metadata)  |
| Exhaustive pattern matching | ✅           | 🚫                              |
| Structured domain modeling  | ✅           | ❌                              |
| Functional-style chaining   | 😐 (manual)  | ✅                              |
| Built-in metadata / logging | ❌           | ✅                              |

Both libraries are solid. But if you’re working on a codebase where outcomes are more nuanced than “good” vs “bad”, and you want your types to speak for themselves. OneOf is the better tool.

No magic strings. No duck-typed errors. Just data, types, and clarity.

If you’ve been using FluentResults and it’s working for you, that's cool. But if your result objects are starting to look like dynamic dictionaries of sadness, give OneOf a spin. Your future self (and your compiler) will thank you.
