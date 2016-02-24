---
layout: post
title: AutoMapper and Autofac Revisited
categories:
tags: [.NET, C#, AutoMapper, Autofac]
description: Wiring up the new v4.2.0 AutoMapper with Autofac
comments: true
---

## What’s happened?
Back in September 2015 I posted about how we can simplify some of the pains within AutoMapper with a little help from Autofac – [Getting along with AutoMapper and Autofac](/2015/09/14/getting-along-with-automapper-and-autofac.html)
Since September 2016 there has been a release [V4.2.0]( https://www.nuget.org/packages/AutoMapper/4.2.0) on 28th January 2016 that broke the wiring within our inversion of control container setup, but don’t worry the changes are for the good and it seems like they’re going to kill off the evil statics members soon!

## The new wiring
The new wiring is actually simpler as we need to know less about the internals of AutoMapper to construct the AutoMapper objects. To start with we need to create a `MapperConfiguration` class that contains all our profiles and how our AutoMapper engine will be configured but instead of new’ing it up with lots of internal magic (`new ConfigurationStore(new TypeMapFactory(), MapperRegistry.Mappers`) we just new-up a `MapperConfiguration` passing in to the constructor an expression of how we want it configured:

```csharp
var config = new MapperConfiguration(x =>
{
	x.AddProfile(new MyProfile1());
	x.AddProfile(new MyProfile2());
	x.AddProfile(new MyProfile2());
});
```
Once we’ve got our `MapperConfiguration` object all configured correctly all we need to do is called the `CreateMapper()` function on the `MapperConfiguration` instance.

```csharp
var mapper = config.CreateMapper();

var obj1 = new ClassA();
var obj2 = mapper.Map<ClassB>(obj1);
```
As you can see above we then just get back an IMapper (not an IMappingEngine) and can call the normal Mapping methods. More simple than you thought right?

## Autofac me
Now we know how to couple up all of our object to create our `IMapper` let’s put this in to an Autofac module.

```csharp
public class AutoMapperModule : Module
{
    protected override void Load(ContainerBuilder builder)
    {
        builder.Register(context =>
        {
            var profiles = context.Resolve<IEnumerable<Profile>>();

            var config = new MapperConfiguration(x =>
            {
            	// Load in all our AutoMapper profiles that have been registered
                foreach (var profile in profiles)
                {
                    x.AddProfile(profile);
                }
            });

            return config;
        }).SingleInstance() // We only need one instance
            .AutoActivate() // Create it on ContainerBuilder.Build()
            .AsSelf(); // Bind it to its own type

        // HACK: IComponentContext needs to be resolved again as 'tempContext' is only temporary. See http://stackoverflow.com/a/5386634/718053 
        builder.Register(tempContext =>
        {
            var ctx = tempContext.Resolve<IComponentContext>();
            var config = ctx.Resolve<MapperConfiguration>();

        	// Create our mapper using our configuration above
            return config.CreateMapper();
        }).As<IMapper>(); // Bind it to the IMapper interface

        base.Load(builder);
    }
}
```

We can also replace the above:

```csharp
config.CreateMapper();
```

With

```csharp
config.CreateMapper(t => ctx.Resolve(t));
```

This will make Autofac be in control of all object creation within your AutoMapper profiles which is useful for external dependencies, object disposal and mocking.
