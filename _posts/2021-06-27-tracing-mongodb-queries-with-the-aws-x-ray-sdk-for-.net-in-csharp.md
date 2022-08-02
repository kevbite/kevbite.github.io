---
layout: post
title: Tracing MongoDB queries with the AWS X-Ray SDK for .NET in C#
categories:
tags: [XRay, AWS, .NET, MongoDB, C#]
description: How to configure the AWS X-Ray SDK for .NET to trace MongoDB queries
comments: true
---

## AWS X-Ray

X-Ray is a great tool for AWS developers, It allows you to analyze and debug distributed applications by monitoring application traces which can include performance metrics of down stream components or services.

## X-Ray SDK for .NET
The X-Ray SDK for .NET comes with a range of built handlers to allow you to trace segments within your application and push them to X-Rays.

These currently include:
- [Instrumenting incoming HTTP requests](https://docs.aws.amazon.com/xray/latest/devguide/xray-sdk-dotnet-messagehandler.html)
- [Tracing calls to downstream HTTP](https://docs.aws.amazon.com/xray/latest/devguide/xray-sdk-dotnet-httpclients.html)
- [Tracing SQL queries](https://docs.aws.amazon.com/xray/latest/devguide/xray-sdk-dotnet-sqlqueries.html)

## MongoDB

MongoDB is a document-oriented database that has had rapid growing since 2009, this is due to it's flexibility in the development lifecycle which allows products to be shipped faster. It was also built with a scale-out architecture, which when needed can scale to billions of users.

## Tracing MongoDB Calls in .NET

The X-Ray SDK for .NET doesn't come with anything to trace MongoDB operations, however, I recently created a [NuGet package](https://www.nuget.org/packages/Kevsoft.AWSXRayRecorder.Handlers.MongoDB/) to allow tracing of MongoDB calls.

This package can be installed via the dotnet CLI or the package manager.

```bash
dotnet add package Kevsoft.AWSXRayRecorder.Handlers.MongoDB
```

## Setup MongoClient with X-Ray

When we create a new instance of a `MongoClient` we'll need to pass in a X-Ray configured `MongoClientSettings`. You can do this by calling the `ConfigureXRay` extension method on the `MongoClientSettings` object. This `ConfigureXRay` has an optional `MongoXRayOptions` object that we'll cover later.

```csharp
using Kevsoft.AWSXRayRecorder.Handlers.MongoDB;

var settings = MongoClientSettings.FromConnectionString("mongodb://localhost");
settings = settings.ConfigureXRay();

var client = new MongoClient(settings);
```

Normally once we've got the MongoClient created we can register it as a singleton with our dependency injection (DI) container of choice. 

Anytime we do any operation (`find`, `update`, `aggregate`) on our configured `MongoClient`  they will be trace with X-Ray subsegments.

```csharp
var database = mongoClient.GetDatabase("test");
var collection = database.GetCollection<BsonDocument>("test");
var docs = await collection.Find(x => true).ToListAsync();
```

![XRay Trace Details](/assets/posts/2021-06-27-tracing-mongodb-queries-with-the-aws-x-ray-sdk-for-.net-in-csharp/x-ray-trace-details.png "XRay Trace Details")

The trace also includes extra information on the remote subsegment.

![XRay MongoDB Subsegment Overview](/assets/posts/2021-06-27-tracing-mongodb-queries-with-the-aws-x-ray-sdk-for-.net-in-csharp/x-ray-mongodb-subsegment-overview.png "XRay MongoDB Subsegment Overview")

## X-Ray Subsegment Annotations

The package adds extra data to the segments traced by X-Ray, these are added as annotations.

![XRay MongoDB Subsegment Annotations](/assets/posts/2021-06-27-tracing-mongodb-queries-with-the-aws-x-ray-sdk-for-.net-in-csharp/x-ray-mongodb-subsegment-annotations.png "XRay MongoDB Subsegment Annotations")

There are 5 annotations added to each subsegment that is created by the package; `duration`, `endpoint`, `database`, `command_name`, `command`.

### Duration

The duration is the time taken for the command to execute, by default any command over 4 hours is *not* traced.

### Endpoint

This is the server that the command was sent to.

### Database

This is the database that the command has executed on.

### Command Name

This is the command that was sent to the database.

### Command

This is the full command text that was sent to the server.

## Extra Mongo XRay Options

When we configure the `ConfigureXRay` we can pass in a `MongoXRayOptions` which allows us to specify some extra options:

```csharp
new MongoXRayOptions()
{
    FilteredCommands = new (){"find"},
    MaxQueryTime = TimeSpan.FromMinutes(30),
    EnableMongoCommandTextInstrumentation = false
}
```

More information on these options can be found on the [GitHub Page](https://github.com/kevbite/Kevsoft.AWSXRayRecorder.Handlers.MongoDB#mongo-xray-options).


## Monitor is Key

Modern day application software development requires monitoring to be at the forefront of software development, especially now we're heading towards working with distributed applications.

X-Ray can start to help with problems within your application and spot issues before your customers.



