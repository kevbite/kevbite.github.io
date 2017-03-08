---
layout: post
title: Reactive reliable queue in Service Fabric
categories:
tags: [Service Fabric, C#]
description: Building Reactive reliable queues within Service Fabric
comments: true
---

# Reliable queues

The reliable state within service fabric is great, it allows us to store state required to do our job and it be safely replicated to the rest of the services incase of a disaster. One of the reliable states types is a `IReliableQueue<>` this allows us to queue up items and then have a consumer process the items later on, for simplicity we can just think of this being like an ordinary `Queue<T>` but with transactions and replication. So lets look at some code for a common pattern for using queues inside service fabric.

## Publisher and Consumer

To start with we need a method to schedule our services to do some work, this could be exposed external from the service either by http or service fabric remoting. We will get the instance of the queue using `GetOrAddAsync`, create a transaction, then add the item of work to the queue and then commit the transaction.

```csharp
public async Task DoWork(string work)
{
    var queue = await StateManager.GetOrAddAsync<IReliableQueue<string>>("queue");

    using (var tx = StateManager.CreateTransaction())
    {
        await queue.EnqueueAsync(tx, work);

        await tx.CommitAsync();
    }
}
```

On the consumer side we will need to constantly read the queue and check if there is any work to process. In service fabric terms this is just a long running process and you would most likely start the execution of this from the `RunAsync` method.

```csharp
protected override async Task RunAsync(CancellationToken cancellationToken)
{
    var queue = await StateManager.GetOrAddAsync<IReliableQueue<string>>("queue");

    while (true)
    {
        cancellationToken.ThrowIfCancellationRequested();

        using (var tx = StateManager.CreateTransaction())
        {
            var result = await queue.TryDequeueAsync(tx);

            if (result.HasValue)
            {
                // Do the work
            }

            await tx.CommitAsync();
        }

        await Task.Delay(TimeSpan.FromSeconds(1));
    }
}
```

This seems to be a very common approach to the consumer side of reliable queue within service fabric, but we have a few problems; we have a single line of execution and also constantly polling with a given set interval. If we imagine that we have 3 queues of work one after each other the time to process could have a delay of 3 seconds without taking in to consideration the compute time of task. Obviously this isn't ideal in a production system as our customers always want items to be processed as fast as possible, and no matter how much hardware we throw at this situation there will always be that given delay due to the polling mechanism. We could lower or remove the `Task.Delay` but this will hog the CPU.

# Get Reactive

What we really want is more of a push model instead of a poll model, so every time we add an item to our queue we get a notification at the other side that an item is available to consume. We can create a gated execution by using `SemaphoreSlim`, as stated on [MSDN](https://msdn.microsoft.com/en-us/library/system.threading.semaphoreslim(v=vs.110).aspx)
> _SemaphoreSlim Represents a lightweight alternative to Semaphore that limits the number of threads that can access a resource or pool of resources concurrently._

## Reactive Publisher and Consumer

To start making our publisher and consumer more reactive we need to create a class member of `SemaphoreSlim`, and every time we add an item to the queue then also release the semaphore. On our consumer side we can wait on the semaphore until it is released and then consume from our queue.

```csharp
private SemaphoreSlim _semaphoreSlim = new SemaphoreSlim(0);

public async Task DoWork(string work)
{
    // ...
    await queue.EnqueueAsync(tx, work);
    
    _semaphoreSlim.Release();
    // ...
}

protected override async Task RunAsync(CancellationToken cancellationToken)
{
    // ...
    await _semaphoreSlim.WaitAsync();
    var result = await queue.TryDequeueAsync(tx);
    // ... 
}
```

The above code will only work in certain circumstances, If the primary node goes down within the replica set then the `SemaphoreSlim` won't be released even if there is items in the queue. We could however solve this problem if we release the semaphore for count of the queue.

## Encapsulating

What we really want is our reactive queue to look and feel like we are using the standard queues, we want to hide away our details so that we can agnostically consume our queue. So lets wrap this in a simple example, let's create a class called `ReactiveReliableQueue` which takes in a `IReliableQueue` and wrap the enqueue and dequeue methods with a `SemaphoreSlim`.

```csharp
public interface IReactiveReliableQueue<T>
{
    Task EnqueueAsync(ITransaction tx, T item);

    Task<ConditionalValue<T>> TryDequeueAsync(ITransaction tx, CancellationToken cancellationToken);
}

public class ReactiveReliableQueue<T> : IReactiveReliableQueue<T>
{
    private readonly IReliableQueue<T> _queue;
    private readonly SemaphoreSlim _signal;

    public ReactiveReliableQueue(IReliableQueue<T> queue)
    {
        _queue = queue;
        _signal = new SemaphoreSlim(1);
    }

    public async Task EnqueueAsync(ITransaction tx, T item)
    {
        await _queue.EnqueueAsync(tx, item);

        _signal.Release();
    }

    public async Task<ConditionalValue<T>> TryDequeueAsync(ITransaction tx, CancellationToken cancellationToken)
    {
        await _signal.WaitAsync(cancellationToken)
            .ConfigureAwait(false);

        var result = await _queue.TryDequeueAsync(tx)
            .ConfigureAwait(false);

        var countDiff = await GetCountDiff(tx);

        if (countDiff > 0)
            _signal.Release(countDiff);

        return result;
    }

    private async Task<int> GetCountDiff(ITransaction tx)
    {
        return (int) await _queue.GetCountAsync(tx).ConfigureAwait(false) - _signal.CurrentCount;
    }
}
```

You might have noticed this is a little more complex than our original example, we've started off with our `SemaphoreSlim` to have an initial count of one this may read from the queue when it is empty but for this simple example that is fine. We are also comparing the queue count to the semaphores count every time we dequeue an item to make sure they are both synchronized.

To make this work we will only need to create one `ReactiveReliableQueue` per queue, we will achieve this by creating a `ReactiveReliableQueueManager` to keep track of wrapped queue and only create a `ReactiveReliableQueue` once.

```csharp
public interface IReactiveReliableQueueManager
{
    IReactiveReliableQueue<T> GetOrCreateAsync<T>(IReliableQueue<T> queue);
}

public class ReactiveReliableQueueManager : IReactiveReliableQueueManager
{
    private readonly ConcurrentDictionary<Uri, object> _reactiveReliableQueues
        = new ConcurrentDictionary<Uri, object>();

    public IReactiveReliableQueue<T> GetOrCreateAsync<T>(IReliableQueue<T> queue)
    {
        var wrappedQueue = _reactiveReliableQueues.GetOrAdd(queue.Name, x => new ReactiveReliableQueue<T>(queue));

        return (IReactiveReliableQueue<T>) wrappedQueue;
    }
}
```

Now we have our class to for keeping track of all our wrapped queues, let us use a bit of extension method magic so we can just access our wrapped queues by calling `StateManager.GetOrAddReactiveReliableQueue<int>("name")`.

```csharp
public static class ReliableStateManagerExtensions
{
    private static readonly IReactiveReliableQueueManager _reactiveReliableQueueManager 
        = new ReactiveReliableQueueManager();

    public static async Task<IReactiveReliableQueue<T>> GetOrAddReactiveReliableQueue<T>(this IReliableStateManager reliableStateManager, string name)
    {
        var queue = await reliableStateManager.GetOrAddAsync<IReliableQueue<T>>(name)
            .ConfigureAwait(false);

        return _reactiveReliableQueueManager.GetOrCreateAsync(queue);
    }
}
```

## Back to the start

Now going back to our orignial example we can change our queues to fetch our new reactive reliable queue, remove the delay and consume like normal.

```csharp
public async Task DoWork(string work)
{
    var queue = await StateManager.GetOrAddReactiveReliableQueue<string>("queue");

    using (var tx = StateManager.CreateTransaction())
    {
        await queue.EnqueueAsync(tx, work);

        await tx.CommitAsync();
    }
}

protected override async Task RunAsync(CancellationToken cancellationToken)
{
    var queue = await StateManager.GetOrAddReactiveReliableQueue<string>("queue");

    while (true)
    {
        cancellationToken.ThrowIfCancellationRequested();

        using (var tx = StateManager.CreateTransaction())
        {
            var result = await queue.TryDequeueAsync(tx, cancellationToken);

            if (result.HasValue)
            {
                // Do the work
            }

            await tx.CommitAsync();
        }
    }
}
```

# Thoughts

This is an overly simplistic way of how we could achieve such a push model using service fabric. It would be worth considering more how we'd deal with processing errors and also we'd deal with deadlocks within our scenario but this is just a basic raw foundations of what we could possibly achieve.