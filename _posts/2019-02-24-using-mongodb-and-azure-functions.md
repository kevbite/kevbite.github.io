---
layout: post
title: Using MongoDB and Azure Functions
categories:
tags: [Azure, Functions, MongoDB, C#, FaaS, Serverless]
description: Building serverless applications fast with Azure Functions and MongoDB.
comments: true
---

If you've heard about Azure Functions or any other FaaS offering out there such as AWS Lambda you will know about the great benefits of writing serverless applications.

Two of the main benefits that get actively talked about are; you don't need to worry about the underlining infrastructure the code is running on, and the infrastructure will scale as needed, and the cost benefit that you only pay for the time your code runs.

Azure Functions also gives the benefit of allowing you to use _[Triggers](https://docs.microsoft.com/en-us/azure/azure-functions/functions-triggers-bindings)_ and _[Bindings](https://docs.microsoft.com/en-us/azure/azure-functions/functions-triggers-bindings)_, this allows you to create a declaratively way to connect resources together.

## Setting Up an Azure Functions Application

Before we get started you'll need [Node.js](https://nodejs.org/en/download/) and [.NET Core](https://dotnet.microsoft.com/download) pre-installed.


We will also need to install the [Azure Functions Core Tools](https://www.npmjs.com/package/azure-functions-core-tools), which can be installed via npm using the following command:

```bash
> npm i -g azure-functions-core-tools --unsafe-perm true
```

Once the tools are installed we can setup a new Azure Functions project by running the following command from a terminal:
```bash
> func init --worker-runtime dotnet
```

This will create us 3 files; a project file (`AzFuncWithMongo.csproj`), a host configuration file (`host.json`) and a local settings file (`local.settings.json`).


## Installing MongoDB Bindings

We can install the [MongoDB Azure Function Bindings](https://www.nuget.org/packages/Kevsoft.Azure.WebJobs.Extensions.MongoDB/) by running a `dotnet add package` from the command line:
```bash
> dotnet add package Kevsoft.Azure.WebJobs.Extensions.MongoDB
```

This package allows us to use the `[MongoDB]` attributes on our function arguments.

## Simple Create/Read API

We'll create a couple of functions within our Azure Functions application to see how easy it is for us to work with data from MongoDB using the Azure Functions Bindings.

Let's start by creating a new class to model a `Company`:
```csharp
public class Company
{
    public ObjectId Id { get; set; }

    public string Name { get; set; }

    public string CompanyNumber { get; set; }
}
```

Basic, I know, but it's just to get an idea.

### Create a Document

Now we'll start off with creating a basic HTTP Post endpoint that will accept a company and insert it in to MongoDB. We can base this on the `HttpTrigger` function template. So let's drop back in to the terminal and run the following command:

```bash
> func new --language C# --template HttpTrigger --name HttpPostTrigger

The function "HttpPostTrigger" was created successfully from the "HttpTrigger" template.
```

Now we have got our `HttpPostTrigger` let's alter a few things, we'll need it to only be triggered on the `POST` HTTP Verb.

```csharp
[HttpTrigger(AuthorizationLevel.Function, "post", Route = null)] HttpRequest req
```

We will then change the route to only be triggered by a route of `companies`.

```csharp
[HttpTrigger(AuthorizationLevel.Function, "post", Route = "companies")] HttpRequest req
```

And finally we want to bind the `HttpTrigger` directly to our `Company` class, that way we get the framework to deal with the deserialization.

```csharp
[HttpTrigger(AuthorizationLevel.Function, "post", Route = "companies")] Company company
```

Now we should have a function that looks similar to the following:

```csharp
[FunctionName("HttpPostTrigger")]
public static async Task<IActionResult> Run(
    [HttpTrigger(AuthorizationLevel.Function, "post", Route = "companies")] Company company,
    ILogger logger)
{
    // ...    
}
```

Let's add a `MongoDB` binding to allow us to collect the companies that are posted to this method and add them in to our database. We'll append the following to the function signature:

```csharp
[MongoDB("test", "companies", ConnectionStringSetting = "MongoDbUrl")] IAsyncCollector<Company> companies
```

The first argument of the attribute is the database name that we want MongoDB to use, the second argument is the collection name. If you've used any of the other Azure Functions bindings such as `Queue` or `Table` you will have most likely used a `IAsyncCollector<>` before. To add the company we can just call the `AddAsync` method, passing in the `company` object.

We also need to specify the connection string to the database, we specify which configuration value to use by setting the `ConnectionStringSetting` property on the attribute, the above is set to `"MongoDbUrl"`. Now we'll need to add this value to our local settings file (`local.settings.json`):

```json
{
    "IsEncrypted": false,
    "Values": {
        "AzureWebJobsStorage": "UseDevelopmentStorage=true",
        "FUNCTIONS_WORKER_RUNTIME": "dotnet",
        "MongoDbUrl": "mongodb://localhost"
    }
}
```

The MongoDB bindings use the standard [MongoDB URI format](https://docs.mongodb.com/manual/reference/connection-string/) which allows you to set various connection properties such as authentication, ssl and read/write preferences.

Once we've setup the MongoDB binding and wired it together with the HttpTrigger binding we will have a function that looks like the following:

```csharp
public static class HttpPostTrigger
{
    [FunctionName("HttpPostTrigger")]
    public static async Task<IActionResult> Run(
        [HttpTrigger(AuthorizationLevel.Function, "post", Route = "companies")] Company company,
        [MongoDb("test", "companies", ConnectionStringSetting = "MongoDbUrl")] IAsyncCollector<Company> companies,
        ILogger logger)
    {
        await companies.AddAsync(company);

        return new OkObjectResult($"Created company '{company.Name}' with an id of '{company.Id}'");
    }
}
```
### Testing Creating a Company

We can spin up the Azure Function runtime by calling `func start`, this will build and then run our function locally, once running we will be presented with the endpoints that we can call:

```bash
Http Functions:

        HttpPostTrigger: [POST] http://localhost:7071/api/companies
```

Now using our favorite http client, let's post some data. We'll be using PowerShell due to the ease of replicating it by copying and pasting commands, but feel free to use [curl](https://curl.haxx.se/docs/manpage.html), [Postman](https://www.getpostman.com/) or even [REST Client](https://marketplace.visualstudio.com/items?itemName=humao.rest-client) for VS Code.

```powershell
PS> $company = @{name="Jay2Base";companyNumber="10440441"}
PS> Invoke-RestMethod -Method POST -Uri "http://localhost:7071/api/companies" -Body ($company|ConvertTo-Json)

Created company 'Jay2Base' with an id of '5c72d67fe62d59293c45cebb'
```

Our function has responded with a string telling us that our company was created with a give ID, so let's go look inside MongoDB to see what we see.

```bash
>mongo.exe
MongoDB shell version v4.0.0
connecting to: mongodb://127.0.0.1:27017
MongoDB server version: 4.0.0

> use test
switched to db test
> db.companies.find().pretty()
{
        "_id" : ObjectId("5c72d67fe62d59293c45cebb"),
        "Name" : "Jay2Base",
        "CompanyNumber" : "10440441"
}
```

### Read a Document

Now we've got a way to get companies in to our database, it'd be also great to be able to query for them too!

Once again, we will start with a `HttpTrigger` template and then alter it for our needs:

```bash
> func new --language C# --template HttpTrigger --name HttpGetTrigger

The function "HttpGetTrigger" was created successfully from the "HttpTrigger" template.
```

We will want to change the `HttpTrigger` to only trigger on the `get` verb and also on a route of `companies/{id}` this way we can pass in the `id` to our document to fetch. We can even enforce a regex to be applied by the route so that we always get a valid `ObjectId` passed in to the id route value. To do this we'd apply the regex constraint of `^[a-f\d]{{24}}$`:

After these changes our `HttpTrigger` should look similar to:

```csharp
[HttpTrigger(AuthorizationLevel.Function, "get", Route = @"companies/{id:regex(^[a-f\d]{{24}}$)}")] HttpRequest req,
```

Like before we will be applying a `MongoDB` binding on to the function but this time we will specify an extra argument to the constructor to be used for the ID and we'll bind directly to a `Company` object.

```csharp
[MongoDb("test", "companies", "{id}", ReadOnly = true, ConnectionStringSetting = "MongoDbUrl")] Company company,
```

You will notice that we have specified an extra property of `ReadOnly` this tells the binding not to update the document after the function is run, this is useful if don't want to change any of the properties of company.

Now with them changes in place we will have a function that looks like the following:

```csharp
[FunctionName("HttpGetTrigger")]
public static async Task<IActionResult> Run(
    [HttpTrigger(AuthorizationLevel.Function, "get", Route = @"companies/{id:regex(^[a-f\d]{{24}}$)}")] HttpRequest req,
    [MongoDb("test", "companies", "{id}", ConnectionStringSetting = "MongoDbUrl")] Company company)
{
    return new OkObjectResult(company);
}
```

### Testing Reading a Company

Let's get the function host started again with `func start`, and we will see another endpoint exposed.

```bash
>func start

Hosting environment: Production
Content root path: .\bin\output
Now listening on: http://0.0.0.0:7071
Application started. Press Ctrl+C to shut down.
Http Functions:

        HttpGetTrigger: [GET] http://localhost:7071/api/companies/{id:regex(^[a-f\d]{{24}}$)}

        HttpPostTrigger: [POST] http://localhost:7071/api/companies

```

Using the id of the previously inserted document let's call the get endpoint, again below is an example of using PowerShell but feel free to use your own tool of choice.

```powershell
PS> Invoke-RestMethod -Uri "http://localhost:7071/api/companies/5c72d67fe62d59293c45cebb"

id                       name     companyNumber
--                       ----     -------------
5c72d67fe62d59293c45cebb Jay2Base 10440441
```

Also, notice if we specify an id that does not match the regex we will be returned a 404 Not Found:
```powershell
PS> Invoke-RestMethod -Uri "http://localhost:7071/api/companies/not-an-object-id"

Invoke-RestMethod : The remote server returned an error: (404) Not Found.
```

### Simplicity

As you may have notice we've not really written much code to create a basic API to get and save documents in MongoDB using Azure Functions. Most of the code is taken care of by the azure function bindings.

It's also worth noting that you can use parameters from the trigger within the database and collection names too, so a function signature like the following is totally valid.

```csharp
[FunctionName("HttpGetTrigger")]
public static async Task<IActionResult> Run(
    [HttpTrigger(AuthorizationLevel.Function, "get", Route = @"{database}/{collection}/{id}")] HttpRequest req,
    [MongoDb("{database}", "{collection}", "{id}")] BsonDocument doc)
```



