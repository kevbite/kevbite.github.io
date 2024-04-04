---
layout: post
title: Consuming Rebus Messages with MassTransit
categories:
tags: [MassTransit, Rebus, C#, .NET]
description: How to configure MassTransit to consume messages published by Rebus
comments: true
---

There's many reasons why you'd interop between [Rebus](https://rebus.fm/) and [MassTransit](https://masstransit.io/) to start handing messages with MassTransit in your system when you've previously used Rebus.

MassTransit is praised for its simplicity and easy of use, it offers a high level abstraction without losing the detail of having a ultra flexible configuration when you need to deviate from the defaults. It's built on top of all the normal .NET abstractions (Configuration, Logging, Dependency injection etc...), It also has a much bigger community behind the open source project, meaning that problems you face will likely have already been answered on [StackOverflow](https://stackoverflow.com/questions/tagged/masstransit) or [GitHub Discussions](https://github.com/MassTransit/MassTransit/discussions), and lastly the testability of MassTransit is the best of its kind, with the ability to swap out the message broker to be in-memory and wait for messages to be consumed within tests.

## The Rebus Publisher

To start with we'll have a simple `Echo` message which Rebus will publish on a schedule. For our case this can just be a simple record class within C#.

```csharp
public record Echo(string Message);
```

We can then have a simple default one way Rebus setup for publishing the Echo message every second.

```csharp
using Rebus.Config;
using Rebus.Handlers;
using Timer = System.Timers.Timer;

var bus = Configure.OneWayClient()
    .Transport(t => 
        t.UseRabbitMqAsOneWayClient(
            connectionString: "amqp://localhost"))
    .Start();

var timer = new Timer();
timer.Elapsed += delegate
{
    var message = new Echo("Hello " + Guid.NewGuid());
    bus.Publish(message);
};
timer.Interval = 1000;
timer.Start();

Console.WriteLine("Press enter to quit");
Console.ReadLine();
```

This will publish a Echo message every second with a unique GUID every time which we can display on the consumer side.

> Note: Within your application that is using Rebus you'll be able to leave the configuration exactly the same, as there's no extra configure is required to consumed published messages.

## The MassTransit Consumer

Within our MassTransit consumer app we can start by having the default setup for a consumer of `EchoConsumer` which is connected to the RabbitMQ transport. we'll also give it a `EchoConsumerDefinition` where we can configure the receive endpoint.

```csharp
using MassTransit;

var builder = Host.CreateApplicationBuilder(args);
builder.Services.AddMassTransit(x =>
{
    x.AddConsumer<EchoConsumer, EchoConsumerDefinition>();

    x.UsingRabbitMq((context,cfg) =>
    {
        cfg.Host("localhost", "/", h => {
            h.Username("guest");
            h.Password("guest");
        });
        
        cfg.ConfigureEndpoints(context);
    });
});

var host = builder.Build();
host.Run();
```

```csharp
public class EchoConsumer : IConsumer<Echo>
{
    public Task Consume(ConsumeContext<Echo> context)
    {
        Console.WriteLine("Rebus Say: {0}", context.Message.Message);
        return Task.CompletedTask;
    }
}
```

Now we can configure the receive endpoint of the echo consumer to bind to the `RebusTopics` exchange (Which is the default to Rebus to publish to), and set a `RoutingKey` of `"Messages.Say, Messages"` which is the message type and the assembly name.

We also need to set MassTransit to use the raw json deserializer as Rebus messages are not published with an envelope wrapper unlike MassTransit.

```csharp
public class EchoConsumerDefinition : ConsumerDefinition<EchoConsumer>
{
    protected override void ConfigureConsumer(IReceiveEndpointConfigurator endpointConfigurator,
        IConsumerConfigurator<EchoConsumer> consumerConfigurator)
    {
        if(endpointConfigurator is IRabbitMqReceiveEndpointConfigurator rabbit)
        {
            rabbit.Bind("RebusTopics", configurator =>
            {
                configurator.ExchangeType = "topic";
                configurator.RoutingKey = "RebusToMassTransit.Messages.Say, RebusToMassTransit.Messages";
            });
        }
        endpointConfigurator.UseRawJsonDeserializer();
    }
}
```

> Note: We also had to set the `ExchangeType` to `topic` as this what Rebus creates, if we leave it as the MassTransit default of `fanout` then the exchange will not be updated with any new bindings.

Once you start up the MassTransit consumer application it will re-configure the Rebus exchange and add in the correct bindings to start processing Rebus published messages.
