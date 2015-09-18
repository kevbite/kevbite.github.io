---
layout: post
title: Getting along with AutoMapper and Autofac
categories:
tags: [.NET, C#, AutoMapper, Autofac]
description: Allowing your IoC to do all the AutoMapper configuration and wiring
comments: true
---

## AutoMapper love-hate relationship

I've always been up and down when using AutoMapper and everyone I've spoken to seem to have similar issues, so this is all about my love and hate for AutoMapper and how I resolved some of my hate with a bit of Autofac Magic!

### The love

AutoMapper makes life such a breeze when you've got lots of Messages/DTOs/Models that you keep having to map back and forth, I normally end up working on fairly distributed systems or integrating with other systems so as you can imagine there's lots of mapping that's going off in the code-base.

Even when a value doesn't map directly, like a `bool` mapping to a string of `"Yes"` or `"No"` it is made so easy with a custom value resolver.

Also I've got to say if you're not asserting your mapping configurations, you are already losing half the benefit of using AutoMapper. Every set of configurations I have them wrapped in tests whereby I load the configurations and then Assert that that everything is OK, for example:

```csharp
[TestFixture]
public class MappingConfiugrationTests
{
    [TestFixtureSetUp]
    public void GivenAMappingConfiguration()
    {
        Mapper.CreateMap<Applicant, ApplicantDto>();
    }

    [Test]
    public void ThenTheConfigurationIsValid()
    {
        Mapper.AssertConfigurationIsValid();
    }
}
```

AutoMapper checks to make sure that every destination type member has a matching member on the source type, if it doesn't it will throw an AutoMapperConfigurationException with a very descriptive message:

```
AutoMapper.AutoMapperConfigurationException : 
Unmapped members were found. Review the types and members below.
Add a custom mapping expression, ignore, add a custom resolver, or modify the source/destination type
======================================
Applicant -> ApplicantDto (Destination member list)
AutoM.Applicant -> AutoM.ApplicantDto (Destination member list)

Unmapped properties:
MiddleName
```

This is extremely useful when your projects depends on nuget packages that contain contracts, if the owner of the package decides to add an extra property to their contract in the next version and you pull them changes down, your tests will pick up the problems before they start causing any issues!

### The Hate

Normally the reasons I moan about AutoMapper isn't actually down to how AutoMapper has been developed, it's how its been configured or used in the first place.

#### Naming conventions

Not having standard naming conventions throughout your code-base is really hard work, say we have a member on the source side of `CardNumber` but then on your destination side it's called `Card`, Its simple configure to start off with:

```csharp
Mapper.CreateMap<CreditCard, CreditCardDto>()
    .ForMember(dest => dest.Card, opt => opt.MapFrom(src => src.CardNumber));
```

But now times that by 20 members all named differently, the configuration starts getting out of hand and you feel like the benefits of using AutoMapper are going straight out the window! I've seen this happen a lot with poorly specified requirements or no requirements at all. There really needs to be an ubiquitous language set out with the client and the development team. This helps communication back and forth from the client but it also changes how us as developers write code, especially when you start splitting up the teams.

#### Static global Mapper

I'm not really too sure why people go down the route of just using the static mapper directly, It's good for examples but isn't really ideal for production code. It also seems to get developers trying to create really bad abstract around it which lose half the functionality which AutoMapper gives you! It's also pretty hard to tests a static class in the middle of your code too without some hacky magic.

AutoMapper gives you some nice interfaces to play around with, there is a good article that was posted on [Los Techies](https://lostechies.com/jimmybogard/2009/05/12/automapper-and-ioc/ "Los Techies") in 2009 that explains all you need to know.

Once your using the AutoMapper interfaces you can start testing your code and you're not even losing any functionality by wrapping it yourself...

```csharp
public class ApplicantCreator
{
    private readonly IMappingEngine _mappingEngine;
    private readonly IHttp _http;

    public ApplicantCreator(IMappingEngine mappingEngine, IHttp http)
    {
        _mappingEngine = mappingEngine;
        _http = http;
    }

    public void Create(Applicant applicant)
    {
        var dto = _mappingEngine.Map<ApplicantDto>(applicant,
                                    options => options.Items["MiddleName"] = "Billbo");

        _http.Post(dto);
    }
}
```

#### Long mapping configuration

I'm really only going to say one this about long mapping configurations and that's everyone should start using [mapping profiles](https://github.com/AutoMapper/AutoMapper/wiki/Configuration#profile-instances), these are used to organize AutoMapper configuration so you don't just end up with a big long list of `Mapper.CreateMap<>` in your program.main() It just consolidates it and makes it easier to manage later down the line.

#### Dependency hell

Have you ever wanted to push in your own service or repository to a formatter, resolver or type converter before? Imagine we have an object that has a member of an enum and is required to be mapped to say a localized string which is store in a database, This sounds simple right? Well really it all depends how AutoMapper was originally setup, but if you have an IoC to hand you can simply call:

```csharp
Mapper.Configuration.ConstructServicesUsing(ioc.Resolve);
```

Many times i've not had the IoC to hand when AutoMapper is being setup or its being setup with some crazy hand rolled reflection code so its mission impossible to set the property.

## Autofac

Even though I've just been ranting about how annoying it can get, recently I've been working on a nice greenfield project where I had the chance to configure AutoMapper as i saw fit. Seeing as the IoC is core to configuring all my dependencies and wirings, i feel no reason why i shouldn't let it setup all my AutoMapper configuration too. So I decided to roll a nice Module to encapsulate configuring AutoMapper:

```csharp
public class AutoMapperModule : Module
{
    protected override void Load(ContainerBuilder builder)
    {
        builder.Register(context =>
        {
            // Create a new AutoMapper Configuration Store.
            var configurationStore = new ConfigurationStore(new TypeMapFactory(), MapperRegistry.Mappers);

            // Tells AutoMapper to use Autofac container to resolve its dependencies
            configurationStore.ConstructServicesUsing(context.Resolve);

            // Go find all the profiles within the current container and load them all up in to AutoMapper
            var profiles = context.Resolve<IEnumerable<Profile>>();
            foreach (var profile in profiles)
            {
                configurationStore.AddProfile(profile);
            }

            return configurationStore;
        }).SingleInstance() // We only want a singleton of the configuration
            .AutoActivate() // When the container is built we'll create this singleton
            .As<IConfigurationProvider>()
            .As<IConfiguration>();

        builder.RegisterType<MappingEngine>().As<IMappingEngine>();

        base.Load(builder);
    }
}
```

So far this has solved half my issues!