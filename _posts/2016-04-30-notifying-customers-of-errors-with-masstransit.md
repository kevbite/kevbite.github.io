---
layout: post
title: Notifying Customers of Errors with MassTransit
categories:
tags: [.NET, C#, MassTransit, Error Handing, SOA]
description: Easy way to notify customers of errors with MassTransit
comments: true
---

# Using a Service Bus

We all know there's lots of benefits to using a service bus architecture, so depending if you need a way to scale out or the ability to retried failed processes it might be worth giving a service bus a try.
There are however limiting factors when using a service bus architecture, the main one that most people hit is the asynchronous nature and how to relay this back to the end user in a way that will not cause frustration.

# Happy case
Normally without a service bus we'd just do the actions on behalf of the user straight away on the users request, but when using a service bus we would send off a message on to the bus then wait for a completed message:

```csharp
static class Program
{
    static void Main()
    {
        var busControl = Bus.Factory.CreateUsingRabbitMq(cfg =>
        {
            cfg.Host(new Uri("rabbitmq://localhost"), host =>
            {
                host.Username("guest");
                host.Password("guest");
            });

            cfg.ReceiveEndpoint("client", endpointCfg =>
            {
                endpointCfg.Consumer<SquareCompletedConsumer>();
            });
        });

        busControl.Start();

        for (;;)
        {
            Console.Write("Request a square size: ");
            int size = 0;
            if (int.TryParse(Console.ReadLine(), out size))
            {
                busControl.Publish(new SquareRequested() {Size = size});
                Console.WriteLine("Square requested");
            }
        }
    }
}
public class SquareCompletedConsumer : IConsumer<SquareCompleted>
{
    public Task Consume(ConsumeContext<SquareCompleted> context)
    {
        Console.ForegroundColor = ConsoleColor.Green;
        Console.WriteLine();
        Console.WriteLine("Got you a square!");
        Console.WriteLine(context.Message.Square);
        Console.ResetColor();

        return Task.CompletedTask;
    }
}
```

The above will wait for a user input and then raises a `SquareRequested` message, for the sake of this example we'll assume drawing a square takes time and resources and that's why we've offloaded it on to the service bus for processing.

We'll also have another process and handler listening to that message which will handle our `SquareRequested` message:

```csharp
static class Program
{
    static void Main()
    {
        var busControl = Bus.Factory.CreateUsingRabbitMq(cfg =>
        {
            cfg.Host(new Uri("rabbitmq://localhost"), host =>
            {
                host.Username("guest");
                host.Password("guest");
            });

            cfg.ReceiveEndpoint("drawer", endpointCfg =>
            {
                endpointCfg.Consumer<SquareRequestedConsumer>();
            });
        });

        busControl.Start();

        Console.ReadKey();
    }
}

public class SquareRequestedConsumer : IConsumer<SquareRequested>
{
    public async Task Consume(ConsumeContext<SquareRequested> context)
    {
        Console.WriteLine("Making square...");
        await Task.Delay(3000);
        var stringBuilder = new StringBuilder();
        var line = new string('*', context.Message.Size);
        for (int i = 0; i < context.Message.Size; i++)
        {
            stringBuilder.AppendLine(line);
        }

        await context.Publish(new SquareCompleted() {Square = stringBuilder.ToString()});
    }
}
```

This now allows us to notify back to the user once it's completed:

![Demo][demo]

# Failure case

Within our scenario if something went wrong with generating a square within our drawer endpoint, the user would not be notified and it would just sit in our error queue until it was manually worked, Try requesting a square of -1:

![Drawer error][drawer-error]

I've seen before where people just wrap the whole body of the handler in a try catch and then raise another message if something went wrong:

```csharp
// Bad example.
public class SquareRequestedConsumer : IConsumer<SquareRequested>
{
    public async Task Consume(ConsumeContext<SquareRequested> context)
    {
        try
        {
            // Do the work...
        }
        catch (Exception)
        {
            await context.Publish(new SquareFailed());
        }
    }
}
```

This isn't ideal as you'll lose the exception details and they wont even get pushed in to your error queue to investigate at a later date, but rest assure MassTransit comes with some built in filters for dealing with errors.

Within MassTransit when it moves the message to the error queue it will also raise a `Fault<T>` message, within our case it would be a `Fault<SquareRequested>` message. So all we need to do in our client is create another `Consumer` to handle a `Fault<SquareRequested>` message:

```csharp
public class SquareRequestedFaultConsumer : IConsumer<Fault<SquareRequested>>
{
    public Task Consume(ConsumeContext<Fault<SquareRequested>> context)
    {
        Console.ForegroundColor = ConsoleColor.Red;
        Console.WriteLine();
        Console.WriteLine("There was an error with requesting a square of size {0}", context.Message.Message.Size);
        Console.ResetColor();

        return Task.CompletedTask;
    }
}
```

Now when there's an error the user will be notified straight away:
![User notified][user-notified]

And we will also have the full exception message and be able to reply it from the error queue if we wish:
![drawer error queue][drawer-error-queue]

As you can see MassTransit makes it a lot easier for your other endpoints to be notified if something went wrong, you could even use it as a way to push out notifications in to slack.

[drawer-error]: /assets/posts/2016-04-30-notifying-customers-of-errors-with-masstransit/drawer-error.jpg "Drawer error"
[demo]: /assets/posts/2016-04-30-notifying-customers-of-errors-with-masstransit/demo.jpg "Demo"
[user-notified]: /assets/posts/2016-04-30-notifying-customers-of-errors-with-masstransit/user-notified.jpg "User notified"
[drawer-error-queue]: /assets/posts/2016-04-30-notifying-customers-of-errors-with-masstransit/drawer-error-queue.jpg "Drawer error queue"
