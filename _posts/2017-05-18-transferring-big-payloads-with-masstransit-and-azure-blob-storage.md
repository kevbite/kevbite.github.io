---
layout: post
title: Transferring big payloads with MassTransit and Azure Blob Storage
categories:
tags: [MassTransit, Azure, Blob Storage, C#, ServiceBus, MessageData]
description: How to use cloud storage providers to transfer large payloads with MassTransit
comments: true
---

# Message Queues and Big Payloads

There is a lot of information out there regarding sending large files across message-based systems. No matter if you are using RabbitMQ or Azure Service Bus, it is always advised to use one of the two approaches below.

## Message Chunking

One approach is chunking the payload into smaller parts and then sending each chunk in a separate message. The publisher of the large payload would need to split the message up into separate chunks then publish a message for each chunk. At the consumers end, it would then need to wait for all the message to be received and reassemble the payload. This allows the message brokers to keep running at high speeds without being compromised with large payloads.

## Externally storing payload

Another approach is to externally store the large payload in external storage such as [Azure Blob Storage](https://azure.microsoft.com/en-us/services/storage/blobs/) or [AWS S3](https://aws.amazon.com/s3/). When we publish the message containing the payload, we upload it to our external storage and then include a reference inside the message of how or where the corresponding payload can be found. This keeps our message sizes small and keeps our message brokers happily running along.

# MassTransit External Message Data Storage Feature

MassTransit has a feature called [External Message Data Storage](https://lostechies.com/chrispatterson/2015/06/16/masstransit-v3-update/) that implements the latter approach to sending large payloads across our systems, it handles all the magic of un-wiring the data from the message so you can concentrate on writing your business logic.

```csharp
public class MessageConsumer : IConsumer<Message>
{
    public async Task Consume(ConsumeContext<Message> context)
    {
        var data = await context.Message.LargeData.Value;

        // Do something with LargeData.
    }
}
```

This is purely magical as from our consumer it doesn't need to care about how it is getting the data as it is all abstracted away.

I personally like this approach as within our consumers we can receive the message and also do some business logic without caring what is stored within our message data.

```csharp
public class OrderTakenConsumer : IConsumer<OrderTaken>
{ 
    public async Task Consume(ConsumeContext<OrderTaken> context)
    {
        await _orderCounter.IncrementAsync();
    }
}
```

Within MassTransit there are currently 4 message data repositories within the core MassTransit project;`InMemoryMessageDataRepository`, `FileSystemMessageDataRepository`, `MongoDbMessageDataRepository` and `EncryptedMessageDataRepository`.

### InMemoryMessageDataRepository

The in-memory storage is used for testing and also useful for demoing functionality to other people, it is self contained which makes it really easy to setup. It is however advised not to use in-memory storage due to potential data loss.

### FileSystemMessageDataRepository

The file system stores the files physically on disk based on a path, this however has its limitations as the services all have to reside on the same machine or have access to a central file share.

### MongoDbMessageDataRepository

Back in [April 2016](https://github.com/MassTransit/MassTransit/blob/master/src/Persistence/MassTransit.MongoDbIntegration/readme.md), a colleague and I extended MassTransit to allow storing message data within the MongoDB GridFS. This worked great for a distributed system but you have to have a MongoDB cluster running just to send data around your system. You can read more about the MongoDB integration [here](http://blundell89.github.io/data/2016/02/16/sharing-large-message-between-your-services-with-masstransit-and-mongodb.html).

### EncryptedMessageDataRepository

The encrypted message data repository is merely just a wrapper around any `IMessageDataRepository` which encrypts the payload before storing it to the wrapped repository.

## Cloud first

At the start of 2017 most companies were moving in to an era of _"cloud first"_, so we need to be able to store our data cost efficiently within our cloud provider of choice; for example if we are hosting on AWS we would use S3, Azure we would use Azure Blob Storage and Digital Ocean we have Block Storage. The problems arise as each one of these providers have their own APIs and their own ways of connecting to each of these services. What we need is some storage abstraction. This is where we can take advantage of an open source project called [Enchilada](https://github.com/sparkeh9/Enchilada), which is a file system abstraction.

## Azure Blob Storage and MassTransit with Enchilada

### Configuration

To get started we need to install the [Enchilada MessageData](https://www.nuget.org/packages/MassTransit.MessageData.Enchilada/) nuget package for MassTransit, this can be achieved by dropping in to the command line and running:

```bash
$ dotnet add package MassTransit.MessageData.Enchilada
```

The next package we will install is [Azure Enchilada](https://www.nuget.org/packages/Enchilada.Azure/), this contains everything we need to connect to Azure Blob Storage.

```bash
$ dotnet add package Enchilada.Azure
```

Once we have the package installed, we can configure a Enchilada adapter to use Azure Blob Storage.

```csharp
var adapter = new BlobStorageAdapterConfiguration
{
    AdapterName = "blob_filesystem",
    CreateContainer = true,
    ConnectionString = "UseDevelopmentStorage=true;",
    ContainerReference = "test",
}
```

We then just need to pass our adapter in to the `EnchiladaMessageDataRepositoryFactory` to create us a `MessageDataRepository` that can be used throughout our project.

```csharp
var factory = new EnchiladaMessageDataRepositoryFactory();
var messageDataRepository = factory.Create(adapter);
```

### Sending a message

To send a message with a large payload, all we have to do is use the message data repository to store the payload before sending the message.

```csharp
var bytes = new byte[] {3, 1, 0, 4, 5, 5, 8 };

var message = new BigMessage
{
    Name = "Bob",
    BigPayload = await messageDataRepository.PutBytes(bytes)
};
```

### Receive a message

The configuration on the receive endpoint needs to have the same repository configured as the send endpoint. However for the receive endpoint we need a little more configuration to tell MassTransit which repository we want to use for each type of message we receive.

```csharp
cfg.ReceiveEndpoint("my_queue", e =>
{
    e.UseMessageData<BigMessage>(messageDataRepository);
}
```

## Other storages and MassTransit with Enchilada

Now we are using a file system abstraction, this means we can use any of Enchilada's abstractions on top of MassTransit. A full list of these can be found on the main Enchilada [github](https://github.com/sparkeh9/Enchilada) page.

Enchilada also supports ASP.NET Core configuration, which allows you to configure how MassTransit will store the large payloads, using `appsettings.json` configuration files.

## What's next?

If you are interested in finding out more about MassTransit with Enchilada you can checkout the [github](https://github.com/kevbite/MassTransit.MessageData.Enchilada) page. Here you will find a bunch of functional tests showing working examples of how to use `MassTransit.MessageData.Enchilada`.