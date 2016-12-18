---
layout: post
title: Unit testing Service Fabric stateful services
categories:
tags: [Service Fabric, C#, Testing, Unit Testing, xUnit]
description: How to test your stateful services within Service Fabric
comments: true
---

# Building your service with tests

When working on a Service Fabric application, one of the first things that you will probably notice is that there is no easy way to get started with writing tests around your service.

To build a stateful service within Service Fabric we inherit from a class called `StatefulService` and override a protected `RunAsync` method:

```csharp

public sealed class MyStatefulService : StatefulService
{
    public MyStatefulService(StatefulServiceContext context, IReliableStateManagerReplica reliableStateManagerReplica)
        : base(context, reliableStateManagerReplica)
    { }

    protected override async Task RunAsync(CancellationToken cancellationToken)
    {
        while (true)
        {
            cancellationToken.ThrowIfCancellationRequested();

            // Do Work.
        }
    }
}

```

# Calling RunAsync

Due to the protection level of the method there is no way for us to call it within our tests. `new MyStatefulService(...).RunAsync(...);` will give us the following error
>_Cannot access method 'RunAsync' here due to its protection level_.

So let's find out what calls in to our RunAsync method, `StatefulServiceBase` is the base class of `StatefulService` and has been interface of `IStatefulUserServiceReplica` which also has a `RunAsync` method but it is explicitly implemented thus hiding the details of `IStatefulUserServiceReplica`. So instead we can cast our service to the interface and then call the method.

```csharp

var service = (IStatefulUserServiceReplica)new MyStatefulService(...);
service.RunAsync(...);

```

The above also fails on referencing `IStatefulUserServiceReplica` with the following error
>_'IStatefulUserServiceReplica' is inaccessible due to its protection level	MyStatefulService_

Everything else down the chain that calls `IStatefulUserServiceReplica` is all internal too, so we've got no luck here.

So for calling our `RunAsync` method we will have to hand roll some reflection code that invokes the protected method 🤮.

```csharp
var runAsyncMethodInfo = typeof(StatefulServiceBase)
                              .GetMethod("RunAsync" BindingFlags.Instance | BindingFlags.NonPublic);

var service = new MyStatefulService(...);
await (Task) runAsyncMethodInfo.Invoke(Service, new object[] { new CancellationTokenSource().Token });

```

# RunAsync continuous loop

The next problem we face is that the `RunAsync` method never returns to its caller. Calling the method directly within our tests will never end execution. We do however have a cancellation token that we can trigger to force an exception to be thrown, this will allow us to break out of the infinite while loop.

The standard practice within a stateful service is to start a transaction and then commit the transaction after the work is completed.

```csharp

while (true)
{
    cancellationToken.ThrowIfCancellationRequested();

    using (var tx = this.StateManager.CreateTransaction())
    {
        // Do Work.

        await tx.CommitAsync();
    }
}

```

So if we could mock out a transaction object to trigger the cancellation token on disposal then this would give us one iteration of the while loop. The below code uses `moq` to create a mock of a `ITransaction` object that will trigger `Cancel` on a `CancellationTokenSource` object when the `Dispose` method is called. We also need to wrap the running of the service in a try/catch block as we'll be expecting a `OperationCanceledException` to be thrown.

```csharp
var cancellationTokenSource = new CancellationTokenSource();
var transaction = new Mock<ITransaction>();
transaction.Setup(x => x.CommitAsync())
    .Returns(Task.FromResult(0));
transaction.Setup(x => x.Dispose())
    .Callback(() => cancellationTokenSource.Cancel());

var reliableStateManagerReplica = new Mock<IReliableStateManagerReplica>();
reliableStateManagerReplica.Setup(x => x.CreateTransaction())
    .Returns(transaction.Object);

var service = new MyStatefulService(null, reliableStateManagerReplica.Object,null);

try
{
    await Run(service, cancellationTokenSource.Token);
}
catch (OperationCanceledException)
{  }

```

# Base test fixture

Now we have got all of the building blocks, we can start to build a base test fixture. Below is an example of a test fixture that uses a template pattern to force the user to override a `CreateService` for create a `StatefulService`. It also has a `RunServiceTransactionOnce` method that will allow derived classes to run the service for one transaction.

```csharp
public abstract class StatefulServiceFixture<TStatefulService>
    where TStatefulService : StatefulService
{
    private static readonly MethodInfo RunAsyncMethodInfo = typeof(StatefulServiceBase)
                              .GetMethod("RunAsync", BindingFlags.Instance | BindingFlags.NonPublic);

    protected StatefulServiceContext StatefulServiceContext { get; }

    protected Mock<IReliableStateManagerReplica> ReliableStateManagerReplica { get; }

    protected Mock<ITransaction> Transaction { get; }

    protected TStatefulService Service { get; }

    protected StatefulServiceFixture()
    {
        StatefulServiceContext = new StatefulServiceContext(
            new NodeContext(string.Empty, new NodeId(0, 0), 0, string.Empty, string.Empty),
            Mock.Of<ICodePackageActivationContext>(),
            string.Empty,
            new Uri("fabric:/Mock"),
            new byte[0],
            Guid.NewGuid(),
            0);

        Transaction = new Mock<ITransaction>();
        Transaction.Setup(x => x.CommitAsync())
            .Returns(Task.FromResult(0));
        ReliableStateManagerReplica = new Mock<IReliableStateManagerReplica>();
        ReliableStateManagerReplica.Setup(x => x.CreateTransaction())
            .Returns(Transaction.Object);

        Service = CreateService(StatefulServiceContext, ReliableStateManagerReplica, Transaction);
    }

    protected abstract TStatefulService CreateService(StatefulServiceContext statefulServiceContext,
        Mock<IReliableStateManagerReplica> reliableStateManagerReplica, Mock<ITransaction> transaction);

    protected async Task RunServiceTransactionOnce()
    {
        var cancellationTokenSource = new CancellationTokenSource();
        Transaction.Setup(x => x.Dispose())
            .Callback(() => cancellationTokenSource.Cancel());

        try
        {
            await (Task) RunAsyncMethodInfo.Invoke(Service, new object[] { cancellationTokenSource.Token });
        }
        catch (OperationCanceledException)
        {
            // We expect the task to be cancelled after one transaction.
            return;
        }

        throw new Exception("RunAsync method should have been cancelled");
    }
}

```

# Real life example

We can now map this to a real life example. We have requirements to create a microservice that listens to a `orders` queue and dequeue an item off each iterations within our loops, every `Order` that is received off the queue is checked to see if it requires a receipt to be generated and then dispatches the `Order` to the `ReceiptGenerator`. The xUnit tests for this are below:

```csharp
public class OrderServiceTests : StatefulServiceFixture<OrderService>
{
    private Mock<IReceiptGenerator> _orderTaker;

    protected override OrderService CreateService(StatefulServiceContext statefulServiceContext,
        Mock<IReliableStateManagerReplica> reliableStateManagerReplica,
        Mock<ITransaction> transaction)
    {
        _orderTaker = new Mock<IReceiptGenerator>();

        return new OrderService(statefulServiceContext, reliableStateManagerReplica.Object, _orderTaker.Object);
    }

    [Fact]
    public async void ShouldGenerateReceipt_WhenOrderRequiresReceipt()
    {
        var order = new Order() {RequiresReceipt = true};

        var orderQueue = new Mock<IReliableQueue<Order>>(MockBehavior.Strict);
        orderQueue.Setup(x => x.TryDequeueAsync(Transaction.Object))
            .ReturnsAsync(new ConditionalValue<Order>(true, order));

        ReliableStateManagerReplica.Setup(x => x.GetOrAddAsync<IReliableQueue<Order>>("orders"))
            .ReturnsAsync(orderQueue.Object);

        await RunServiceTransactionOnce();

        _orderTaker.Verify(x => x.Generate(order), Times.Once);
    }

    [Fact]
    public async void ShouldNotGenerateReceipt_WhenOrderDoesNotRequiresReceipt()
    {
        var order = new Order() { RequiresReceipt = false };

        var orderQueue = new Mock<IReliableQueue<Order>>(MockBehavior.Strict);
        orderQueue.Setup(x => x.TryDequeueAsync(Transaction.Object))
            .ReturnsAsync(new ConditionalValue<Order>(true, order));

        ReliableStateManagerReplica.Setup(x => x.GetOrAddAsync<IReliableQueue<Order>>("orders"))
            .ReturnsAsync(orderQueue.Object);

        await RunServiceTransactionOnce();

        _orderTaker.Verify(x => x.Generate(order), Times.Never);
    }
}
```

For completeness the `OrderService` implemention is below to cross reference with the tests.

```csharp
public sealed class OrderService : StatefulService
{
    private readonly IReceiptGenerator _receiptGenerator;

    public OrderService(StatefulServiceContext context, IReliableStateManagerReplica reliableStateManagerReplica, IReceiptGenerator receiptGenerator)
        : base(context, reliableStateManagerReplica)
    {
        this._receiptGenerator = receiptGenerator;
    }

    protected override async Task RunAsync(CancellationToken cancellationToken)
    {
        var orderQueue = await this.StateManager.GetOrAddAsync<IReliableQueue<Order>>("orders");

        while (true)
        {
            cancellationToken.ThrowIfCancellationRequested();

            using (var tx = this.StateManager.CreateTransaction())
            {
                var result = await orderQueue.TryDequeueAsync(tx);

                if (result.HasValue && result.Value.RequiresReceipt)
                {
                    await _receiptGenerator.Generate(result.Value);
                }

                await tx.CommitAsync();
            }
        }
    }
}

```