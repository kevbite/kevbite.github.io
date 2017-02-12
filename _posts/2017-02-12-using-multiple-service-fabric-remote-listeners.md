---
layout: post
title: Using multiple Service Fabric remote listeners
categories:
tags: [Service Fabric, C#, Azure]
description: A walk though of how to use multiple Service Fabric remote listeners
comments: true
---

# Multiple FabricTransportServiceRemotingListeners

There are many reasons why you would want to have multiple Service Fabric remoting listeners. I wanted to have my primary services within the replica partitions doing all the work and writing its state. The state would then be replicated to the secondary services and I would then read the state from the secondaries. This would allow higher read though-put. The second reason was code separation, as I didn't want my `StatefulService` to become a massive facade that would just forward requests on to other classes to handle. Instead, I wanted to tell service fabric `XyzService` to handle these requests from the listener but have them hosted under the same Service Fabric service and then share the state for that service.

So, say we have a stateful service called `MyStatefulService` that implements the contracts of `IQueryNames` and `IAppendName` which we will be exposing over service remoting listeners, our class would look something like the following:

```csharp
public sealed class MyStatefulService : StatefulService, IQueryNames, IAddName
{
    public MyStatefulService(StatefulServiceContext serviceContext, IReliableStateManagerReplica reliableStateManagerReplica)
        : base(serviceContext, reliableStateManagerReplica) { }

    public Task<string[]> GetNames()
    {
        //...
    }

    public Task AddName(string name)
    {
        //...
    }

    protected override IEnumerable<ServiceReplicaListener> CreateServiceReplicaListeners()
    {
        return new[]
        {
            new ServiceReplicaListener(this.CreateServiceRemotingListener)
        };
    }
}
```

Our service would override the `CreateServiceReplicaListeners` method and return one service remoting listener, which is created using the extension method of `CreateServiceRemotingListener`. So let's look at moving our 2 bits of functionality `GetNames` and `AddNames` in to their own classes.

## Single responsibility

To keep this simple we will just create a class called `QueryNamesHandler` and `AddNameHandler`.

```csharp
public class QueryNamesHandler : IQueryNames
{
    public Task<string[]> GetNames()
    {
        //...
    }
}

public class AddNameHandler : IAddName
{
    public Task AddName(string name)
    {
        //...
    }
}
```

## Wiring up the listeners

We will then need to modify the overridden method `CreateServiceInstanceListeners` to explicitly create two `FabricTransportServiceRemotingListener` and pass in a instance of each of our handlers. When we use 2 or more listeners we will have to explicitly name each one. Service Fabric uses these names to keep track of the listeners so they need to be unique.

```csharp
protected override IEnumerable<ServiceInstanceListener> CreateServiceInstanceListeners()
{
    return new []
    {
        new ServiceInstanceListener(context =>
            new FabricTransportServiceRemotingListener(context, new QueryNamesHandler()),
                "QueryNamesHandlerListener"),
        new ServiceInstanceListener(context =>
            new FabricTransportServiceRemotingListener(context, new AddNameHandler()),
                "AddNameHandlerListener")
    };
}
```

The above needs to be modified a bit more so we can run 2 listeners. The above code works smoothly with some listeners but the `FabricTransportServiceRemotingListener` will not share the same Endpoint configuration with another listener, even if we are not declaring any special configuration. Due to this fact, we will need to pass in a `FabricTransportListenerSettings` to the listener to change the `EndpointResourceName`. For this example we will use the names of `QueryNamesHandlerEndpoint` and `AddNameHandlerEndpoint`

```csharp
protected override IEnumerable<ServiceInstanceListener> CreateServiceInstanceListeners()
{
    return new []
    {
        new ServiceInstanceListener(context => new FabricTransportServiceRemotingListener(context, new QueryNamesHandler(),
            new FabricTransportListenerSettings()
            {
                EndpointResourceName = "QueryNamesHandlerEndpoint"
            }), "QueryNamesHandlerListener"),
        new ServiceInstanceListener(
            context => new FabricTransportServiceRemotingListener(context, new AddNameHandler(),
                new FabricTransportListenerSettings()
                {
                    EndpointResourceName = "AddNameHandlerEndpoint"
                }), "AddNameHandlerListener")
    };
}

```

Now we have changed the endpoint name we will have to change the `ServiceManifest.xml` to reflect these changes.

```xml
<?xml version="1.0" encoding="utf-8"?>
<ServiceManifest Name="MyStatelessServicePkg"
                 Version="1.0.0"
                 xmlns="http://schemas.microsoft.com/2011/01/fabric"
                 xmlns:xsd="http://www.w3.org/2001/XMLSchema"
                 xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <ServiceTypes> <!-- ... --> </ServiceTypes>
  <CodePackage Name="Code" Version="1.0.0"> <!-- ... --> </CodePackage>
  <ConfigPackage Name="Config" Version="1.0.0" />

  <Resources>
    <Endpoints>
      <!-- These are required even if we're not specifying any overrides -->
      <Endpoint Name="AdderServiceEndpoint" />
      <Endpoint Name="MultiplierServiceEndpoint" />
    </Endpoints>
  </Resources>
</ServiceManifest>
```

## Consuming

Consuming the endpoints is a little different compared to normal. We can still use the `ServiceProxy` but we will need to specify the `listenerName` when creating the proxy. Below is a simple example of how to consume our services.

```csharp
var adder = ServiceProxy.Create<IAdder>(new Uri("fabric:/MultipleListeners/MyStatelessService"), new PartitionKey(0), listenerName: "AdderListener");
var result = await adder.Add(a, b).ConfigureAwait(false);
```

This now should give you a basic understanding of how we can use multiple service fabric listeners within one service.