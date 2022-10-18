---
layout: post
title: URL Shortener API in .NET by Utilising Minimal APIs
categories:
tags: [.NET, Minimal APIs, URL Shortener]
description: How to Create a URL Shortener with Minimal APIs in .NET.
comments: true
---

## Prerequisites

Before we get started we will need to have at least .NET 6 installed, this can be installed on any platform (Windows, Linux, MacOs).
- [https://dotnet.microsoft.com/en-us/download](https://dotnet.microsoft.com/en-us/download)

Once installed, feel free to download one of the many IDEs that can help you write .NET code.
- [JetBrains Rider](https://www.jetbrains.com/rider/download/)
- [Microsoft Visual Studio](https://visualstudio.microsoft.com/downloads/)
- [Microsoft Visual Studio Code](https://code.visualstudio.com/)
  - [Visual Studio Code C# Plugin](https://marketplace.visualstudio.com/items?itemName=ms-dotnettools.csharp)

## Project Setup

To start with we need to create ourself a folder to create our project, I like to keep all my development work under `c:\dev\`, however, if you're not on Windows or want to place it somewhere else feel free.

So let's create a empty folder, and navigate in to it.
```powershell
mkdir c:\dev\ShortUrl

cd c:\dev\ShortUrl
```

Now we want to create the API foundations by using the `dotnet new` command, for this project we can use the `web` template which will give us a minimal ASP.NET Core API.
```powershell
dotnet new web
```

Once run you will notice a few files have appears in the directory.
```powershell
ls

    Directory: C:\dev\ShortUrl

    Name
    ----
    appsettings.Development.json
    appsettings.json
    Program.cs
    ShortUrl.csproj
```

### appsettings.*.json

The `appsettings.json` file is an application configuration file used to store configuration settings such as database connections strings, and any application scope global variables. By default `appsettings.json` is loaded then `appsettings.{environment_name}.json` is loaded on top. For more information about .NET Configuration please checkout one of my previous talks, [Everything You Need To Know About Configuration In .NET
](https://kevsoft.net/events/2021-09-07-dotnetsheff-everything-you-need-to-know-about-configuration-in-dotnet.html).

### Program.cs

The `Program.cs` is the entry point for the application, by default this uses [Top-level statements](https://learn.microsoft.com/en-us/dotnet/csharp/whats-new/csharp-9#top-level-statements) (a new-ish C# 9 feature). This means that you can write code directly in to the file without wrapping it in any [classes](https://learn.microsoft.com/en-us/dotnet/csharp/fundamentals/types/classes) or [methods](https://learn.microsoft.com/en-us/dotnet/csharp/programming-guide/classes-and-structs/methods).

### ShortUrl.csproj

The `*.csproj` file is the C# project file which contains information on how to build the project. This includes things like the SDK version, properties and also the required dependencies.


## Running template

Now we've got the API template in place we can run the project.
```powershell
dotnet run
```

Once running you'll get some logging within the console explaining which port the API is listening on.
```
info: Microsoft.Hosting.Lifetime[14]
      Now listening on: https://localhost:7077
```

We can also then test the `Hello World` example by running a quick curl command

```powershell
curl https://localhost:7077

Hello World!
```

If we take a look at the code inside the `program.cs` we'll see the following code

```csharp
var builder = WebApplication.CreateBuilder(args);
var app = builder.Build();

app.MapGet("/", () => "Hello World!");

app.Run();
```

As you can see our `app` has one `GET` request mapped to the root (`/`) which returns a `"Hello World"` string.

## Building URL Shortener API

Now everything is running and working we can start adding more endpoints to our API to flesh out our _URL Shortener API_.

### Endpoints

The following table describes the endpoints we need to add to our API

| Verb | Path    | Description                |
|------|---------|----------------------------|
| POST | /slugs   | Creating a short url slug  |
| GET  | /{slug} | Redirect endpoint for slug |

#### POST /slug Endpoint

To start with we need an endpoint to create our slug urls for our short urls. Let's create a model to represent our slug resource.
```csharp
public record SlugResourceRepresentation(
    string Slug,
    Uri Url
);
```

Then we'll need to map a post endpoint for `/slugs`, we'll just create a locally scoped `ConcurrentDictionary` for storing our captured slugs in memory.

```csharp
ConcurrentDictionary<string, SlugResourceRepresentation> slugs = new ();

app.MapPost("/slugs", (SlugResourceRepresentation resourceRepresentation) => {
    if (slugs.TryAdd(resourceRepresentation.Slug, resourceRepresentation))
    {
        return Results.Ok(resourceRepresentation);
    }

    return Results.Conflict();
});
```

Now if we run our API again we can hit it with cURL to test out the new endpoint 

```powershell
curl --request POST \
     --url https://localhost:7077/slugs \
     --header 'content-type: application/json' \
     --data '{"slug": "kevsoft","url": "https://kevsoft.net"}'
```

#### GET /{slug} Endpoint

Next we'll map the get endpoint for `/{slug}` which will do the redirect if the slug exists in our `ConcurrentDictionary`.

```csharp
app.MapGet("/{slug}", (string slug) => {
    if (slugs.TryGetValue(slug, out var resourceRepresentation))
    {
        return Results.Redirect(resourceRepresentation.Url.AbsoluteUri);
    }

    return Results.NotFound();
});
```

## Wrapping up

We now have a fully working URL Shortener API, it has some caveats such as once the web server gets suspended then all our slugs are lost as they're stored in memory, it will not be able to scale, as there's no backing data store for multiple web servers to be running. However, this gives you an starting point and an idea of what is achievable with speed with Minimal APIs within .NET 
