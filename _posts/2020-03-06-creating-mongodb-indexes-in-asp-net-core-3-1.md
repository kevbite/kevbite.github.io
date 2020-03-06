---
layout: post
title: Creating MongoDB indexes in ASP.NET Core 3.1
categories:
tags: [MongoDB, .NET, C#]
description: How to Create indexes in MongoDB when using ASP.NET Core 3.1
comments: true
---

MongoDB is like other database and requires indexes to be configured based on your query patterns to have efficient queries.

MongoDB is a little different in the fact that people commonly configure the indexes in their applications, compared to traditionally creating extra scripts and a whole extra deployment process for these scripts.

## ASP.NET Hosted Services

ASP.NET Core has a feature called _[hosted services](https://docs.microsoft.com/en-us/aspnet/core/fundamentals/host/hosted-services?)_, These are great for background tasks.

A hosted service is created and a start method is executed before the processing pipeline is started, this way we can use a hosted service to run our index creation on startup of our application thus every time we deploy it will ensure all our indexes for our application are created.

To start with we need to create a class that implements `IHostedService`.

```csharp
public class ConfigureMongoDbIndexesService : IHostedService
{ 
    public Task StartAsync(CancellationToken cancellationToken)
        => Task.CompletedTask;


    public Task StopAsync(CancellationToken cancellationToken)
        => Task.CompletedTask;
}
```

Then within our `Startup.cs` we'll need to add some configuration in to the `ConfigureServices` method, we'll need to add a mongo client that we'll use later and also the hosted service that we've just created.

```csharp
public void ConfigureServices(IServiceCollection services)
{
    services.AddSingleton<IMongoClient>(new MongoClient());
    services.AddHostedService<ConfigureMongoDbIndexesService>();
}
```

## Configuring indexes
Now we've configured our service to start up every time our application starts up we can start to think about creating our indexes.

This can be done like we'd normally setup indexes in C#, we can take the above hosted service and extend it to create a basic index:

```csharp
public class ConfigureMongoDbIndexesService : IHostedService
{
    private readonly IMongoClient _client;
    private readonly ILogger<ConfigureMongoDbIndexesService> _logger;

    public ConfigureMongoDbIndexesService(IMongoClient client, ILogger<ConfigureMongoDbIndexesService> logger)
        => (_client, _logger) = (client, logger);

    public async Task StartAsync(CancellationToken cancellationToken)
    {
        var database = _client.GetDatabase("example");
        var collection = database.GetCollection<Event>("events");
        
        _logger.LogInformation("Creating 'At' Index on events");
        var indexKeysDefinition = Builders<Event>.IndexKeys.Ascending(x => x.At);
        await collection.Indexes.CreateOneAsync(new CreateIndexModel<Event>(indexKeysDefinition), cancellationToken: cancellationToken);
    }


    public Task StopAsync(CancellationToken cancellationToken)
        => Task.CompletedTask;
}
```

This now will create a index on the `events` collection within our `example` database.

## Ordering

Hosted services configured in the `Startup.cs` in the `ConfigureServices` method will all get executed first before the rest of the asp.net pipeline runs, this means that if your `Start` method takes a long time to run then it will be blocking asp.net from handling requests.

If we run the code above we'll get the following logs from the console that proves that our index creation service is running first before asp.net kicks in to handle requests.

```text
info: MongoAspIndex.ConfigureMongoDbIndexesService[0]
      Creating 'At' Index on events
info: Microsoft.Hosting.Lifetime[0]
      Now listening on: https://localhost:5001
info: Microsoft.Hosting.Lifetime[0]
      Now listening on: http://localhost:5000
info: Microsoft.Hosting.Lifetime[0]
      Application started. Press Ctrl+C to shut down.
info: Microsoft.Hosting.Lifetime[0]
      Hosting environment: Development
```

This might be ideal for your application but other applications might want to be able to handle requests while setting up indexes in the background.

If we want to setup that style of configuration then we need to remove our hosted service from the `ConfigureServices` method:
```csharp
public void ConfigureServices(IServiceCollection services)
{
    services.AddSingleton<IMongoClient>(new MongoClient());
}
```

Then we'll need to add it to the `CreateHostBuilder` method inside our `Program.cs` file.
```csharp
public static IHostBuilder CreateHostBuilder(string[] args) =>
    Host.CreateDefaultBuilder(args)
        .ConfigureWebHostDefaults(webBuilder =>
        {
            webBuilder.UseStartup<Startup>();
        })
        .ConfigureServices(services =>
        {
            services.AddHostedService<ConfigureMongoDbIndexesService>();
        });
```

Now if we run our application again we'll notice from the logs that asp.net pipeline gets setup first and then our index creation service gets ran.

```text
info: Microsoft.Hosting.Lifetime[0]
      Now listening on: https://localhost:5001
info: Microsoft.Hosting.Lifetime[0]
      Now listening on: http://localhost:5000
info: MongoAspIndex.ConfigureMongoDbIndexesService[0]
      Creating 'At' Index on events
info: Microsoft.Hosting.Lifetime[0]
      Application started. Press Ctrl+C to shut down.
info: Microsoft.Hosting.Lifetime[0]
      Hosting environment: Development
```

You might have noticed already that we can keep calling the create index method and it won't try to create an index if an index with the same signature exists.