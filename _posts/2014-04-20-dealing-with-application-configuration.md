---
layout: post
title: Dealing with application configuration
categories:
tags: [ISP, Abstraction, Settings, .NET, Configuration, C#]
description: A simple way to abstract away all the pesty application settings
comments: true
---

## Messy Configuration code
Everyone’s been in the situation where they're reading through a bunch of code and most of it's just reading config values and parsing them off into their correct type, this normally makes the code harder to understand the business logic.

For example, take our `DepositCalculator` it is loading the deposit percentage, minimum deposit, and max deposit from config, while this class isn’t that hard to follow you can understand in a bigger and more complex class, loading config values directly within the method could get completely out of hand.

```csharp
// DepositCalculator.cs
public class DepositCalculator
{
	public decimal CalculateDeposit(decimal basketTotal)
	{
		var deposit = basketTotal / 100 * decimal.Parse(ConfigurationManager.AppSettings["DepositPercentage"]);

		deposit = Math.Max(deposit, decimal.Parse(ConfigurationManager.AppSettings["MinDeposit"]));

		deposit = Math.Min(deposit, decimal.Parse(ConfigurationManager.AppSettings["MaxDeposit"]));

		return deposit;
	}
}
```
	
## Abstraction
	
Ideally, we would want to abstract these settings away into a separate class so that the `DepositCalculator` isn’t concerning itself with how it’s getting these settings, so let’s introduce an `IDepositSettings` interface and an `AppSettings` class that implements it.

```csharp
// IDepositSettings.cs
public interface IDepositSettings
{
    float DepositPercentage { get; }

    decimal MinDeposit { get; }
    
    decimal MaxDeposit { get; }
}
```

```csharp
// AppSettings.cs
public class AppSettings : IDepositSettings
{
    public decimal DepositPercentage
    {
        get
        {
            return decimal.Parse(ConfigurationManager.AppSettings["DepositPercentage"]);
        }
    }

    public decimal MinDeposit
    {
        get
        {
            return decimal.Parse(ConfigurationManager.AppSettings["MinDeposit"]);
        }
    }

    public decimal MaxDeposit
    {
        get
        {
            return decimal.Parse(ConfigurationManager.AppSettings["MaxDeposit"]);
        }
    }
}
```

```csharp
// DepositCalculator.cs
public class DepositCalculator
{
    public DepositCalculator(IDepositSettings depositSettings)
    {
        _depositSettings = depositSettings;
    }

    public decimal CalculateDeposit(decimal basketTotal)
    {
        var deposit = basketTotal / 100 * _depositSettings.DepositPercentage;

        deposit = Math.Max(deposit, _depositSettings.MinDeposit);

        deposit = Math.Min(deposit, _depositSettings.MaxDeposit);

        return deposit;
    }

    private readonly IDepositSettings _depositSettings;
}
```
	
Now we've got our configuration separated from our logic, you can easily see how this is much more unit testable as we can mock out our deposit settings without concerning our self with our actual settings.

## Default values?
Default values I hear you say? Well now our configuration is separated we can easily just change our `AppSettings` implementation to set our default values.

```csharp
// AppSettings.cs
public class AppSettings : IDepositSettings
{
    public decimal DepositPercentage
    {
        get
        {
            return decimal.Parse(ConfigurationManager.AppSettings["DepositPercentage"]);
        }
    }

    public decimal MinDeposit
    {
        get
        {
            decimal minDeposit;
            if (!decimal.TryParse(ConfigurationManager.AppSettings["MinDeposit"], out minDeposit))
            {
                minDeposit = 0;
            }

            return minDeposit;
        }
    }

    public decimal MaxDeposit
    {
        get
        {
            decimal maxDeposit;
            if (!decimal.TryParse(ConfigurationManager.AppSettings["MaxDeposit"], out maxDeposit))
            {
                maxDeposit = decimal.MaxValue;
            }

            return maxDeposit;
        }
    }
}		
```

As you can see if we added the parsing logic into our `DepositCalculator` method for calculating the deposit amount, it would be far more complex and on edge of maintainable!

## Crashing apps!
You've just done a merge or checked out someone else’s code and it’s taken you 20 minutes to get it to building state. You spin up the application, flip through a few pages then "Server Error" - the yellow screen of death! You do a bit of debugging and realize it is missing of one them AppSettings within the app.config file, how annoying! 

Wouldn’t it be nice if our app just pre-loaded and parsed our AppSettings when the application started? Then we would know upfront if someone missed out on one of the AppSettings.

So seeing as our Settings are using a common interface we can create a `PreloadedSettings` class for example.


```csharp
// PreloadedSettings.cs
public class PreloadedSettings : IDepositSettings
{
	public PreloadedSettings(IDepositSettings depositSettings)
	{
		_depositPercentage = depositSettings.DepositPercentage;
		_minDeposit = depositSettings.MinDeposit;
		_maxDeposit = depositSettings.MaxDeposit;
	}

	public decimal DepositPercentage
	{
		get { return _depositPercentage; }
	}

	public decimal MinDeposit
	{
		get { return _minDeposit; }
	}

	public decimal MaxDeposit
	{
		get { return _maxDeposit; }
	}

	private readonly decimal _depositPercentage;
	private readonly decimal _minDeposit;
	private readonly decimal _maxDeposit;
}
```

We can now plug this into our IoC container to create a singleton instance that gets created as soon as the container is built.

It’s actually quite amazing how common this is. I've been in situations where an application has been pushed live and it’s been half running for at least a week until someone raised a bug, it was then discovered after a lot of developer effort that a missing config value from a previous release was the problem.


## Database
There comes a point where the application is running on multiple nodes and keeping all them config files up to date and allowing them to be changed easily without any human error becomes an issue. Such as our Deposit settings, we'd love to hand these off to the business owners so they can keep updating the deposit amounts on a weekly basis, they'd like that too as our competitor is always fluctuating their deposit rates.

So the only logical solution here is to move them into a database and give our owners a nice pretty front end. That’s pretty easy to do now we've got our abstraction of `IDepositSettings`.

```csharp
// DatabaseSettings.cs
public class DatabaseSettings : IDepositSettings
{
	public DatabaseSettings()
	{
		_settingsRepository = new MongoSettingsRepository();
	}
	
	public decimal DepositPercentage
	{
		get
		{
			return _settingsRepository.GetDepositPercentage();
		}
	}

	public decimal MinDeposit
	{
		get
		{
			return _settingsRepository.GetMinDeposit();
		}
	}

	public decimal MaxDeposit
	{
		get
		{
			return _settingsRepository.GetMaxDeposit();
		}
	}

	private readonly ISettingsRepository _settingsRepository;
}
```

## Caching
Our `DatabaseSettings` isn’t going to scale very well in production. We could use our `PreloadedSettings` which we made earlier, it will cache the settings in the process so that the settings are not fetched for the rest of the application life. This isn’t ideal though as when our business owners want to change the deposit amount from 5% to 10% we would have to tell them we need to restart all the applications running so that they can then fetch the data again from the database.

We need the ability to limit the load on our servers but also have the feeling that it’s updating in real-time. Even caching strategies of 1 minute are worthwhile. Say you have 30,000 people within a 3-minute time frame hitting a page for the same setting (or any other resource), if we'd of cached that content on the server for 1 minute we'd of benefited by 10,000% as We'd have only hit the database 3 times. Also from our business owner’s point of view waiting a minute for the update to propagate is nothing, they’ll probably not even notice.

This also allows for us to continue running if our settings database server goes down for maintenance, if it can’t fetch up to date settings we can make it continue running with the old settings until the server is back up.

As you can see caching is always a win-win! So let’s get on with the code.

```csharp
// ICacheProvider.cs
public interface ICacheProvider
{
	T GetOrSet<T>(string key, Func<T> fetchFunction, int? ttlSeconds);
}
```

```csharp
// CacheDepositSettingsDecorator.cs
public class CacheDepositSettingsDecorator : IDepositSettings
{
	public CacheDepositSettingsDecorator(IDepositSettings depositSettings, ICacheProvider cacheProvider)
	{
		_depositSettings = depositSettings;
		_cacheProvider = cacheProvider;
	}

	public decimal DepositPercentage
	{
		get
		{
			return _cacheProvider.GetOrSet("depositPercentage", () => _depositSettings.DepositPercentage, 60);
		}
	}

	public decimal MinDeposit
	{
		get
		{
			return _cacheProvider.GetOrSet("minDeposit", () => _depositSettings.MinDeposit, 60);
		}
	}

	public decimal MaxDeposit
	{
		get
		{
			return _cacheProvider.GetOrSet("maxDeposit", () => _depositSettings.MaxDeposit, 60);                
		}
	}

	private readonly IDepositSettings _depositSettings;

	private readonly ICacheProvider _cacheProvider;
}
```

## Multiple interfaces

We can take this a stage further by using multiple interfaces for our AppSettings, this then adheres to the interface-segregation principle (ISP) as when we inject these settings into the consuming class it only knows about the settings that it requires and doesn’t need to know anything about what these settings relate to.

```csharp
public class AppSettings : IDepositSettings, IPaymentSettings, IUxSettings
{
	// Snips...
}

public class DatabaseSettings : IDepositSettings, IUxSettings
{
	// Snips...
}

public class CacheSettingsDecorator : IDepositSettings, IUxSettings
{
	// Snips...
}
```

## Wrapping it up
Keeping our settings abstracted away from the main business logic of the code makes it much easier to maintain going forward. I've seen many solutions where the app.config files have over 100+ AppSettings and have resulted in an unmaintainable state with the usage of them is scattered over the codebase. It would take a significant amount of time to move these out into some other location such as a shared data store.
