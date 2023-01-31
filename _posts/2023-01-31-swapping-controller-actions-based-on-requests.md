---
layout: post
title: Swapping controller actions based on requests
categories:
tags: [ASP.NET Core, .NET]
description: How to swapping controller actions based on requests
comments: true
---

## Background

Let's pretend we've got 2 api customers who have different requirements for an endpoint however we want our URLs and Verbs to stay the same. Ideally we'd like 2 controllers like the following so we can build the APIs like normal.

```csharp
[ApiController]
[Route("tickets")]
public class TicketsController : ControllerBase
{
    [HttpGet]
    public IActionResult Get()
    {
        return Ok(new[]
        {
            new { id = 1, price = 100m },
            new { id = 2, price = 200m },
            new { id = 3, price = 300m }
        });
    }
}

[ApiController]
[Route("tickets")]
public class SpecialTicketsController : ControllerBase
{
    [HttpGet]
    public IActionResult Get()
    {
        return Ok(new[]
        {
            new { id = 1, name = "Standard", price = 100m },
            new { id = 2, name = "Advanced", price = 200m },
            new { id = 3, name = "Magical", price = 300m }
        });
    }
}

```

For simplicity of this example we'll make it so that any request that comes in with a query string key of `special` uses our special controller, I'd imagine your own logic would be more complex.

## Matcher Policy

The `MatcherPolicy` is a class that applies behaviors to URL matching, we can create a simple `SpecialMatcherPolicy`

```csharp
public class SpecialMatcherPolicy : MatcherPolicy
{
    public override int Order { get; } = 100;   
}
```

We want our policy to filter endpoints which are applicable to a given request, to do this we can implement the `IEndpointSelectorPolicy` interface.

```csharp
public class SpecialMatcherPolicy : MatcherPolicy, IEndpointSelectorPolicy
{
    public override int Order { get; } = 100;
    
    public bool AppliesToEndpoints(IReadOnlyList<Endpoint> endpoints)
        => throw new NotImplementedException();
 
    public async Task ApplyAsync(HttpContext httpContext, CandidateSet candidates)
        => throw new NotImplementedException();
}
```

The interface requires the implementing 2 methods; `AppliesToEndpoints` which returns a boolean value of whether the policy applies to any of the endpoints supplied in the arguments. Then `ApplyAsync` which applies the current policy to a `CandidateSet` which is a set of endpoints.

Our `AppliesToEndpoints` method can check all the endpoints and get the `ControllerActionDescriptor` metadata associated with the endpoint, if that metadata includes a controller name that starts with `Special` then it will apply the current policy.

```csharp
public bool AppliesToEndpoints(IReadOnlyList<Endpoint> endpoints)
{
    return endpoints.Select(endpoint => endpoint.Metadata.GetMetadata<ControllerActionDescriptor>())
        .Any(x => x?.ControllerName.StartsWith("Special") == true);
}
```

We can then use the `ApplyAsync` method to flag the validity of each endpoint against this policy, to start with we'll check if we've got a special request (as mention before a request with a query string key of `special`, however, this could be based on anything within the request), then we'll compare that with the endpoint metadata for the controller name.

```csharp
 public async Task ApplyAsync(HttpContext httpContext, CandidateSet candidates)
{
    var isSpecialRequest = IsSpecialRequest(httpContext);

    for (var i = 0; i < candidates.Count; i++)
    {
        var candidate = candidates[i];
        var capOnTapEndpoint = candidate.Endpoint.Metadata.GetOrderedMetadata<ControllerActionDescriptor>()
            .Any(x => x.ControllerName.StartsWith("Special"));

        if (capOnTapEndpoint)
        {
            candidates.SetValidity(i, isSpecialRequest);
        }
        else
        {           
            candidates.SetValidity(i, !isSpecialRequest);
        }

    }
}

private static bool IsSpecialRequest(HttpContext httpContext)
{
    // Check request
    return httpContext.Request.Query.ContainsKey("special");
}

```

One last thing we'll need to register this policy within the IoC container on startup.

```csharp
var builder = WebApplication.CreateBuilder(args);
// snip..
builder.Services.AddSingleton<MatcherPolicy, SpecialMatcherPolicy>();
```

## Testing the policy

Now we can do a few `curl` commands to our endpoint and if the request has a query string of `special` then we'll get our special controller invoked.

## Extending

It's also possible to use attributes to select endpoints for the request, this is how the underlining ASP.NET Core selects your actions based on Http Verbs too. (Checkout the code on GitHub [HttpMethodMatcherPolicy](https://github.com/dotnet/aspnetcore/blob/077d0883e943bebbe8151ead202d4c18cc3bee6b/src/Http/Routing/src/Matching/HttpMethodMatcherPolicy.cs))