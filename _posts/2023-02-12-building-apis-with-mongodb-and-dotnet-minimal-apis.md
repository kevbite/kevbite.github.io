---
layout: post
title: Building APIs with MongoDB and .NET Minimal APIs
categories:
tags: [ASP.NET Core, .NET]
description: How to building APIs with MongoDB and .NET Minimal APIs
comments: true
---

## Prerequisites

Before we get started we will need to have at least .NET (currently .NET 7) installed, this can be installed on any platform (Windows, Linux, MacOs).
- [https://dotnet.microsoft.com/en-us/download](https://dotnet.microsoft.com/en-us/download)

Once installed, feel free to download one of the many IDEs that can help you write .NET code.
- [JetBrains Rider](https://www.jetbrains.com/rider/download/)
- [Microsoft Visual Studio](https://visualstudio.microsoft.com/downloads/)
- [Microsoft Visual Studio Code](https://code.visualstudio.com/)
  - [Visual Studio Code C# Plugin](https://marketplace.visualstudio.com/items?itemName=ms-dotnettools.csharp)

We'll also need MongoDB running locally, the simplest way to have MongoDB running is via running the following docker command
- [Get Docker](https://docs.docker.com/get-docker/)
```shell
docker run -p 27017:27017 mongo
```

## What we're going to build

We're going to build a simple API that allows us to create and list companies, companies are also going to have a list of offices associated with them too. Let's take the following example requests as what we'll be building.


### List companies

```http
GET /companies

[
    {
        "id": "5a934e000102030405000000",
        "name": "NVIDIA",
        "offices" : [
            {
                "id": "Reading",
                "address" : {
                        "line1" : "100 Brook Dr",
                        "line2" : "Reading",
                        "postalCode": "RG2 6UJ",
                        "country": "United Kingdom"
                    }
                }
        ]
    },
    {
        "id": "5a934e000102030405000001",
        "name": "Google",
        "offices" : [
            {
                "id": "Brussels",
                "address" : {
                        "line1" : "Chaussee d'Etterbeek 180",
                        "line2" : "Brussels",
                        "postalCode": "1040",
                        "country": "Belgium"
                    }
                },
            {
                "id": "London–6PS",
                "address" : {
                    "line1" : "6 Pancras Square",
                    "line2" : "London",
                    "postalCode": "N1C 4AG",
                    "country": "United Kingdom"
                }
            }
        ]
    },
    
]
```

### Add new company

```http
POST /companies
{
    "name": "NVIDIA",
    "offices" : [
        {
            "id": "Reading",
            "address" : {
                    "line1" : "100 Brook Dr",
                    "line2" : "Reading",
                    "postalCode": "RG2 6UJ",
                    "country": "United Kingdom"
                }
            }
    ]
}

{
    "id": "5a934e000102030405000000",
    "name": "NVIDIA",
    "offices" : [
        {
            "id": "Reading",
            "address" : {
                    "line1" : "100 Brook Dr",
                    "line2" : "Reading",
                    "postalCode": "RG2 6UJ",
                    "country": "United Kingdom"
                }
            }
    ]
}
```

### Get company addresses

```http
GET /companies/5a934e000102030405000000/offices

[
    {
        "id": "Reading",
        "address" : {
                "line1" : "100 Brook Dr",
                "line2" : "Reading",
                "postalCode": "RG2 6UJ",
                "country": "United Kingdom"
            }
    }
]
```

## Project setup

Let's start by setting up a new API project within .NET, we can do this via the command line using the dotnet CLI. Navigate to a new empty directory where you want to put the project and execute the following command.
```bash
dotnet new web
```

Next we'll install the MongoDB driver so we can talk to the database, this again can be done via the dotnet CLI.
```bash
dotnet add package MongoDB.Driver 
```

### Database models

We'll create a few database models for our service, these will be `Company`, `Office` and `Address` and will match the above data. We'll use the record type within .NET to make these immutable.

```csharp
public record Company(ObjectId Id, string Name, IReadOnlyCollection<Office> Offices);
public record Office(string Id, Address Address);
public record Address(string Line1, string Line2, string PostalCode, string Country);
```

### Service collection setup

We'll need to also add a few items to the service collection within .NET, this is so that our endpoints can access MongoDB. If we open the `Program.cs` file then we can add the following lines for adding extra configuration to the builder.

```csharp
var builder = WebApplication.CreateBuilder(args);
builder.Services.AddSingleton<MongoClient>(_ => new MongoClient());
builder.Services.AddSingleton<IMongoDatabase>(
    provider => provider.GetRequiredService<MongoClient>().GetDatabase("building-apis"));
builder.Services.AddSingleton<IMongoCollection<Company>>(
    provider => provider.GetRequiredService<IMongoDatabase>().GetCollection<Company>("companies"));
```

### Building the endpoints

#### Get / Create Companies

We'll add the 2 endpoints for getting and creating companies, this is fairly simple within minimal apis, we just need to call the `MapGet` and `MapPost` methods on `app`

```csharp
var app = builder.Build();

app.MapGet("/companies", async (IMongoCollection<Company> collection)
    => TypedResults.Ok(await collection.Find(Builders<Company>.Filter.Empty).ToListAsync()));

app.MapPost("/companies", async (IMongoCollection<Company> collection, Company company)
    =>
{
    // Make sure the Id is set to Empty so that the database generates us a new Id
    company = company with { Id = ObjectId.Empty };
    await collection.InsertOneAsync(company);
    return TypedResults.Ok(company);
});
```

If we try out the above code we'll notice that the `id`'s that are getting returned look like the following:
```json
{
  "id": {
    "timestamp": 1676208890,
    "machine": 16007445,
    "pid": 15784,
    "increment": 4971809,
    "creationTime": "2023-02-12T13:34:50Z"
  },
  // ...
}
```

This is because `System.Text.Json` doesn't understand what to do with the `ObjectId` for serialization so it'll traverse the object and serialize each property instead. We can get around this by adding our own custom `JsonConverter`, we'll not go in the full details but this can be found on the Microsoft Website - [How to write custom converters](https://learn.microsoft.com/en-us/dotnet/standard/serialization/system-text-json/converters-how-to).

```csharp
public class ObjectIdJsonConverter : JsonConverter<ObjectId>
{
    public override ObjectId Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
        => new (reader.GetString());
    
    public override void Write(Utf8JsonWriter writer, ObjectId value, JsonSerializerOptions options)
        => writer.WriteStringValue(value.ToString());
}
```

We can then reconfigure the `JsonOptions` options on startup to include this extra convertor.

```csharp
builder.Services.Configure<JsonOptions>(options =>
{
    options.SerializerOptions.Converters.Add(new ObjectIdJsonConverter());
});
```

Now you'll notice our response gets generated correctly
```json
{
  "id": "63e8ed91117cdedb48a3dac5",
  "name": "NVIDIA",
  "offices": [
    {
      "id": "Reading",
      "address": {
        "line1": "100 Brook Dr",
        "line2": "Reading",
        "postalCode": "RG2 6UJ",
        "country": "United Kingdom"
      }
    }
  ]
}
```

#### Get company offices

The other endpoint we want to get is to just be able to fetch all of a single companies offices. We can add another `MapGet` configuration which fetches a company based on id and projects the offices.

```csharp
app.MapGet("/companies/{companyId}/offices", async (IMongoCollection<Company> collection, ObjectId companyId)
    =>
{
    var offices = await collection.Find(
            Builders<Company>.Filter.Eq(x => x.Id, companyId))
        .Project(x => x.Offices)
        .FirstOrDefaultAsync();
    
    return TypedResults.Ok(offices);
});
```
