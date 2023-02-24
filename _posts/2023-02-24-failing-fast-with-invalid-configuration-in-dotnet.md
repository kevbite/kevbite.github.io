---
layout: post
title: Failing fast with invalid configuration in .NET
categories:
tags: [ASP.NET Core, .NET, Configuration, Validation]
description: How abort your application when configuration is invalid within .NET applications
comments: true
---

## Introduction

When building applications we need to be able to add configuration which can be swapped without having to rebuild the application every time we do a change. This is normally configuration that changes per environment or it's secrets and keys that can't live with the application itself due to security concerns.

The current .NET has a great way to implement configuration in a typed way via the [options pattern](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/configuration/options). It also has a way to layer configuration providers, for example the [default setup](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/configuration/#default-application-configuration-sources) for ASP.NET Core will take environment variables over `appsettings.json` giving us a way to supplement override configuration per environment.

## Example
Below is a small API that takes advantage of configuration (currently from `appsettings.json`) and returns that configuration when a `GET` request is sent to the root `/` of the API.


### program.cs
```csharp
var builder = WebApplication.CreateBuilder();

builder.Services.Configure<AppOptions>(builder.Configuration.GetSection("App"));

var app = builder.Build();

app.MapGet("/", (IOptions<AppOptions> myOptions)
    => new
    {
        myOptions.Value.Min,
        myOptions.Value.Max,
        myOptions.Value.Message,
    });

await app.RunAsync();

sealed class AppOptions
{
    public int Min { get; init; }
    public int Max { get; init; }
    public string Message { get; init; }
}
```
### appsettings.json
```json
{
  "App": {
    "Min": 1,
    "Max": 50,
    "Message": "Hello World"
  }
}

```

### Running app
If we run the app and do a `GET` request we'll have the following response.

```json
{"min":1,"max":50,"message":"Hello World"}
```

### The problem
If we configure this application correctly, it'll work perfectly fine, however, with lots of application the configuration gets loaded in from different source; from `appsettings.json` files to [Azure Key Vault](https://learn.microsoft.com/en-us/azure/key-vault/general/basic-concepts). It can be hard to figure out if the app is configured correctly until it's too late, for example if we remove our `App` section within our `appsettings.json` and run our application, we'll just get a weird output.

```json
{"min":0,"max":0,"message":null}
```

If we're using these values to do calculations or actions then we'll start getting weird behaviors from our applications. These types of bugs are also harder to identify as they're normally changes between environments which will work perfectly fine locally. One thing we can do to solve this problem is to add validation to our configuration.

## Config Validation
The .NET configuration has a few built in ways to configure the options, both ways are done when configuring the options within the IoC container.

### Data annotations
One of the most common ways to validate models within .NET is to use data annotations, this way of validation has been around a long time and it's very extensible with the ability to create your own annotations by inheriting from `ValidationAttribute` or implementing the `IValidatableObject` interface on your model. 

Let's add some attributes to our `AppOptions` model.
```csharp
public sealed class AppOptions
{
    [Required, Range(0, 100)]
    public int Min { get; init; }
    [Required, Range(0, 100)]
    public int Max { get; init; }
    [Required, MinLength(1)]
    public string Message { get; init; }
}
```
Now we can update our IoC code to add validate on to our configuration. Notice now we're using the `AddOptions<T>` method with a `Bind` to the config and also `ValidateDataAnnotations` chained to the end to make this work.

```csharp
builder.Services.AddOptions<AppOptions>()
    .Bind(builder.Configuration.GetSection("App"))
    .ValidateDataAnnotations();
```

Now if we run our application and do a `GET` request to the `/` endpoint we'll get the following exception raised and a `500` Server Error returned to the consumer

```text
info: Microsoft.AspNetCore.Routing.EndpointMiddleware[1]
      Executed endpoint 'HTTP: GET /'
fail: Microsoft.AspNetCore.Diagnostics.DeveloperExceptionPageMiddleware[1]
      An unhandled exception has occurred while executing the request.
      Microsoft.Extensions.Options.OptionsValidationException: DataAnnotation validation failed for 'AppOptions' members: 'Message' with the error: 'The Message field is required.'.
         at Microsoft.Extensions.Options.OptionsFactory`1.Create(String name)
         at Microsoft.Extensions.Options.UnnamedOptionsManager`1.get_Value()
         at Program.<>c.<<Main>$>b__0_0(IOptions`1 myOptions) in C:\dev\throw-away\FailFastConfig\Program.cs:line 13
         at lambda_method1(Closure, Object, HttpContext)
         at Microsoft.AspNetCore.Routing.EndpointMiddleware.Invoke(HttpContext httpContext)
      --- End of stack trace from previous location ---
         at Microsoft.AspNetCore.Diagnostics.DeveloperExceptionPageMiddlewareImpl.Invoke(HttpContext context)
info: Microsoft.AspNetCore.Hosting.Diagnostics[2]
      Request finished HTTP/1.1 GET http://localhost:5000/ - - - 500 - text/html;+charset=utf-8 112.1840ms
```

This is great because now we can straight away see that our application isn't configured correctly.

### Validation via delegate
Even though data annotations are normally the standard way to validate models in .NET, you might have more complex requirements that are better expressed in code. This is where validation via delegates come in to play. Similar to the data annotations configuration, the delegates for validation are setup on the IoC setup.

```csharp
builder.Services.AddOptions<AppOptions>()
    .Bind(builder.Configuration.GetSection("App"))
    .Validate(options
        => options is {
            Min: >= 1, Max: <= 100, Message.Length: > 0
        });
```

It's also possible to get access to any other register service within the IoC container to validate the options against. For example the below code uses `IWebHostEnvironment` pulled from the container to check the `EnvironmentName` and apply different validation rules.

```csharp
builder.Services.AddOptions<AppOptions>()
    .Bind(builder.Configuration.GetSection("App"))
    .Validate((AppOptions options, IWebHostEnvironment webHostEnvironment)
        => webHostEnvironment.EnvironmentName switch
        {
            "Development" => options is { Min: >= 1, Max: <= 20, Message.Length: > 0 },
            "Staging" => options is { Min: >= 1, Max: <= 50, Message.Length: > 0 },
            "Production" => options is { Min: >= 1, Max: <= 100, Message.Length: > 0 },
        });
```

### Validation problem
Having validation on our options is great, it straight away highlights the problem when misconfiguration has happened within our application, however, we still need to wait until the application get to a point of resolving (or accessing the `.Value` property) of the `IOptions<T>` object.

## Fail fast on validation issues
When configuring our options within the IoC container there's an extra method we can chain to the end of the configuration `ValidateOnStart`, This enforces options validation check on start rather than in runtime. Which in our example will be done when the `StartAsync` is called.

```csharp
builder.Services.AddOptions<AppOptions>()
    .Bind(builder.Configuration.GetSection("App"))
    .ValidateDataAnnotations()
    .ValidateOnStart();
```

```text
dotnet run
Unhandled exception. Microsoft.Extensions.Options.OptionsValidationException: DataAnnotation validation failed for 'AppOptions' members: 'Message' with the error: 'The Message field is required.'.
   at Microsoft.Extensions.Options.OptionsFactory`1.Create(String name)
   at System.Lazy`1.ViaFactory(LazyThreadSafetyMode mode)
   at System.Lazy`1.ExecutionAndPublication(LazyHelper executionAndPublication, Boolean useDefaultConstructor)
   at System.Lazy`1.CreateValue()
   at Microsoft.Extensions.Options.OptionsCache`1.GetOrAdd[TArg](String name, Func`3 createOptions, TArg factoryArgument)
   at Microsoft.Extensions.Options.OptionsMonitor`1.Get(String name)
   at Microsoft.Extensions.DependencyInjection.OptionsBuilderExtensions.<>c__DisplayClass0_1`1.<ValidateOnStart>b__1()
   at Microsoft.Extensions.DependencyInjection.ValidationHostedService.StartAsync(CancellationToken cancellationToken)
```

Under the hood the `ValidateOnStart` method adds a [hosted service](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/host/hosted-services) of `ValidationHostedService` which runs the validation before our API starts up.

Every time we now ship our application we'll be able to know straight away if the application is configured correctly as it'll fail to start.