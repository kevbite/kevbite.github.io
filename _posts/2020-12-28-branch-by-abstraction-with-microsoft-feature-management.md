---
layout: post
title: Branch by Abstraction with Microsoft Feature Management
categories:
tags: [C#, Feature Management, .NET, ASP.NET Core]
description: How to use Branch by Abstraction pattern with the new .NET Core Feature Management libraries
comments: true
---

With the new .NET Core Feature Management libraries we now have an opinionated way in .NET to provide feature flags in your application.

A common way to use feature flags is to toggle on and off new parts of functionality using a pattern called "Branch by Abstraction", this is where you abstract the current functionality in to an abstraction layer and then implement the new part of functionality with that abstraction and finally swap the two implementations. More of this pattern can be found on Martin Fowler's [BranchByAbstraction](https://martinfowler.com/bliki/BranchByAbstraction.html) article.

This technique means that we can continue releasing our software with new changes with the feature turned off until we're fully comfortable with it.

## Simple Solution

Let's start off with a simple ASP.NET Core solution which has an API Controller that returns `"Hello World"`.

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

Imagine we want to make it say Hello and the persons name, but we want to do these changes gradually and behind a feature toggle. We can start by abstracting away our current implementation in to a interface and the current implementation.

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

Now we want to add in our feature toggle to be able to switch between our current version and a possible new version.

To start with we can add the [Microsoft.FeatureManagement.AspNetCore](https://www.nuget.org/packages/Microsoft.FeatureManagement.AspNetCore/) NuGet package from the command line. Alternately if you're not using any of the ASP.NET Core features you can install the base package, [Microsoft.FeatureManagement](https://www.nuget.org/packages/Microsoft.FeatureManagement/).

```shell
dotnet add package Microsoft.FeatureManagement.AspNetCore
```

You can also install the package via your own IDE of choice via the NuGet browser in the IDE.

Once this is installed we need to setup the the service collection with the feature management components.

```csharp
public void ConfigureServices(IServiceCollection services)
{
    // ...
    services.AddFeatureManagement();
}
```

Then we can alter the configuration of the service collection for the `ISayHello` to the following.

```csharp
services.AddTransient<SayHelloWorld>();
services.AddTransient<SayHelloName>();

services.AddTransient<ISayHello>(async serviceProvider =>
{
    var featureManager = serviceProvider.GetRequiredService<IFeatureManagerSnapshot>();
    if (await featureManager.IsEnabledAsync("HelloName"))
    {
        return serviceProvider.GetRequiredService<SayHelloName>();
    }
    return serviceProvider.GetRequiredService<SayHelloWorld>();
});
```

Once we've done this you'll notice that this won't build anymore due to the following build error.

> Startup.cs(34, 68): [CS4010] Cannot convert async lambda expression to delegate type 'Func<IServiceProvider, ISayHello>'. An async lambda expression may return void, Task or Task<T>, none of which are convertible to 'Func<IServiceProvider, ISayHello>'.

This is because async/await and Task based service resolution are not supported within the .NET dependency injection, more information on this can be found on the [Microsoft dependency injection guidelines recommendations](https://docs.microsoft.com/en-us/dotnet/core/extensions/dependency-injection-guidelines#recommendations).

We can change the statement where the async method is being called to have a `.Result` directly on the `IsEnabledAsync` method to resolve the returned task, however, this can cause deadlocks and is also classified as an [Async DI factories anti-pattern](https://docs.microsoft.com/en-us/dotnet/core/extensions/dependency-injection-guidelines#async-di-factories-can-cause-deadlocks).

```csharp
services.AddTransient<ISayHello>(serviceProvider =>
{
    var featureManager = serviceProvider.GetRequiredService<IFeatureManagerSnapshot>();
    if (featureManager.IsEnabledAsync("HelloName").Result)
    {
        return serviceProvider.GetRequiredService<SayHelloName>();
    }
    return serviceProvider.GetRequiredService<SayHelloWorld>();
});
```

### Abstracting in to a factory

We can fix-up this anti pattern by creating a factory which will get resolved if the feature is enabled and pass back the correct implementation. We will also inject in `Func<T>` to support for lazy initialization for each implementation for `ISayHello`.

```csharp
public class SayHelloFactory
{
    private readonly IFeatureManager _featureManager;
    private readonly Func<SayHelloWorld> _sayHelloWorldFactory;
    private readonly Func<SayHelloName> _sayHelloNameFactory;

    public SayHelloFactory(
        IFeatureManagerSnapshot featureManager,
        Func<SayHelloWorld> sayHelloWorldFactory,
        Func<SayHelloName> sayHelloNameFactory)
    {
        _featureManager = featureManager;
        _sayHelloWorldFactory = sayHelloWorldFactory;
        _sayHelloNameFactory = sayHelloNameFactory;
    }

    public async Task<ISayHello> Create()
    {
        if (await _featureManager.IsEnabledAsync("HelloName"))
        {
            return _sayHelloNameFactory();
        }

        return _sayHelloWorldFactory();
    }
}
```

Now we've got the factory sorted we'll have to change around our IoC registration due to the default microsoft service container does not support lazy initialization. However, if we switch out the default service container for [AutoFac](https://autofac.org/) or another that supports lazy initialization we can omit this extra configuration.

```csharp
services.AddTransient<SayHelloWorld>();
services.AddSingleton<Func<SayHelloWorld>>(x => () => x.GetRequiredService<SayHelloWorld>());
services.AddTransient<SayHelloName>();
services.AddSingleton<Func<SayHelloName>>(x => () => x.GetRequiredService<SayHelloName>());

services.AddTransient<SayHelloFactory>();
```

One last small change we need to do is in our controller, we need to utilize our factory that we've just created.

```csharp
[HttpGet]
public async Task<string> Get(string name,
    [FromServices] SayHelloFactory sayHelloFactory)
{
    var sayHello = await sayHelloFactory.Create();
    return sayHello.SayHello(name);
}
```

As you can see, we now await the call to the factory and have to change the signature of our action to a `Task<T>`.

## New ISayHello Implementation

Now we can start implementing our new `ISayHello` implementation, for us this is simple but in a more complex scenario this might take some time, however, with this abstraction in place we can keep pushing the changes to production without any effects.

```csharp
public class SayHelloName : ISayHello
{
    public string SayHello(string name)
        => $"Hello, {name}";
}
```

## The Switching

We can now switch the abstraction layer using the default microsoft feature management configuration. This is done with many of the .net [configuration providers](https://docs.microsoft.com/en-us/dotnet/core/extensions/configuration-providers) but for simplicity we'll just change the appsettings.json

```json
{
  "FeatureManagement": {
    "HelloName": true
  }
}
```

## A Generic Approach

While this approach might be great for one or two abstraction layers, you might end up requiring more and at this point you most likely don't want 10+ factories creating all these branch by abstractions.

What we can do here is create a generic approach, to start with we'll make our factory generic.

```csharp
public interface IBranchFactory<TInterface>
{
    Task<TInterface> Create();
}

public class BranchFactory<TInterface, TImpl1, TImpl2>
    : IBranchFactory<TInterface>
    where TImpl1 : class, TInterface
    where TImpl2 : class, TInterface
{
    private readonly IFeatureManager _featureManager;
    private readonly Func<TImpl1> _factory1;
    private readonly Func<TImpl2> _factory2;
    private readonly string _featureName;

    public BranchFactory(
        IFeatureManagerSnapshot featureManager,
        Func<TImpl1> factory1,
        Func<TImpl2> factory2,
        string featureName)
    {
        _featureManager = featureManager;
        _factory1 = factory1;
        _factory2 = factory2;
        _featureName = featureName;
    }

    public async Task<TInterface> Create()
    {
        if (await _featureManager.IsEnabledAsync(_featureName))
        {
            return _factory1();
        }

        return _factory2();
    }
}
```

We can then abstract away all our service container configuration in to an extension method called `AddBranchByAbstraction`, in which we can call many time for each branching.

```csharp
public static class ServiceCollectionBranchByAbstractionExtensions
{
    public static IServiceCollection AddBranchByAbstraction<TInterface, TImpl1, TImpl2>(
            this IServiceCollection services,
            string featureName)
        where TImpl1 : class, TInterface
        where TImpl2 : class, TInterface
    {
        services.AddTransient<TImpl1>();
        services.AddSingleton<Func<TImpl1>>(x => x.GetRequiredService<TImpl1>);
        services.AddTransient<TImpl2>();
        services.AddSingleton<Func<TImpl2>>(x => x.GetRequiredService<TImpl2>);
        services.AddTransient<IBranchFactory<TInterface>>(provider =>
            new BranchFactory<TInterface, TImpl1, TImpl2>(
                provider.GetRequiredService<IFeatureManagerSnapshot>(),
                provider.GetRequiredService<Func<TImpl1>>(),
                provider.GetRequiredService<Func<TImpl2>>(),
                featureName
            ));

        return services;
    }
}
```

Now within our `ConfigureServices` we can call the `AddBranchByAbstraction` method to setup each branch by abstraction.

```csharp
public void ConfigureServices(IServiceCollection services)
{
    services.AddBranchByAbstraction<ISayHello, SayHelloName, SayHelloWorld>("HelloName");
}
```

We'll also need to swap over our current action to use the generic interface for the factory and everything will be working the same as before.

```csharp
[HttpGet]
public async Task<string> Get(string name,
    [FromServices] IBranchFactory<ISayHello> branchFactory)
{
    var sayHello = await branchFactory.Create();
    return sayHello.SayHello(name);
}
```

## Wrapping up

Using the branch by abstraction technique is a great approach to keeping your continuous delivery pipeline as slick as possible, we don't end up with [merge hell](https://dev.to/pencillr/merge-conflict-hell-46on) and can keep pushing our changes in to a main branch while continuously shipping the product with the features turned off.

Also, as you can see we can couple this to the new feature management package within .NET which can be configured with many different [configuration providers](https://docs.microsoft.com/en-us/dotnet/core/extensions/configuration-providers) and also we can use [feature filter](https://docs.microsoft.com/en-us/dotnet/api/microsoft.featuremanagement.ifeaturefilter) to toggle the abstractions based on any scenario. One of the really useful ones is being able to toggle using `TimeWindowFilter` which allows you you to set a period of time when the feature will be enabled (and disabled).
