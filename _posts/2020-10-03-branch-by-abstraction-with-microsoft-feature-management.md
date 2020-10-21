---
layout: post
title: Branch by Abstraction with Microsoft Feature Management
categories:
tags: [C#, Feature Management, .NET, ASP.NET Core]
description: How to use Branch by Abstraction pattern with the new .NET Core Feature Management libraries
comments: true
---

With the new .NET Core Feature Management libraries we now have a opinionated way in .NET to provide feature flags in your application.

A common way to use feature flags is to toggle on and off new bits on functionality using a pattern called "Branch by Abstraction", this is where you abstract the current functionality in to an abstraction layer and then implement a new bit of functionality with that abstraction and finally swap out the two implementations. More of this pattern can be found on Martin Fowler's [BranchByAbstraction](https://martinfowler.com/bliki/BranchByAbstraction.html) article.

This technique means that we can continue releasing our software with new changes with the feature turned off until we're fully comfortable with it.

## Simple Solution

Let's start off with a simple asp.net core solution which has an API controller than returns `"Hello World"`.

```csharp
[ApiController]
[Route("[controller]")]
public class HelloController : ControllerBase
{
    [HttpGet]
    public string Get()
    {
        return "Hello World";
    }
}
```

Imagine we want to make it say Hello and the persons name, but we want to do these changes gradually and behind a feature toggle. We can start by abstracting away our current implementing in to a interface and the implementation.

```csharp
[ApiController]
[Route("[controller]")]
public class HelloController : ControllerBase
{
    [HttpGet]
    public string Get(string name, [FromServices]ISayHello sayHello)
    {
        return sayHello.SayHello(name);
    }

}

public interface ISayHello
{
    string SayHello(string name);
}

public class SayHelloWorld : ISayHello
{
    public string SayHello(string name)
    {
        return "Hello World";
    }
}

public class SayHelloName : ISayHello
{
    public string SayHello(string name)
        => throw new NotImplementedException();
}
```

We'll also need to register `SayHelloWorld` within our IoC which can be found in our `Startup` class.

```csharp
public void ConfigureServices(IServiceCollection services)
{
    services.AddTransient<ISayHello, SayHelloWorld>();

    //...
}
```

At the moment, none of the functionality has changed within our API.

## Adding in the Feature Switch

Now we want to add in our feature toggle to be able to switch between our current version and our new version. 