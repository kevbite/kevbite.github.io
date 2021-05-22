---
layout: post
title: Formatting DateOnly types as ISO 8601 in ASP.NET Core responses
categories:
tags: [DateOnly, C#, .NET]
description: How to format DateOnly types as ISO 8601 in ASP.NET Core responses
comments: true
---

## DateOnly

[DateOnly](https://github.com/dotnet/runtime/issues/49036) is a newly introduce struct data type within [.NET 6](https://dotnet.microsoft.com/download/dotnet/6.0). Unlike [DateTime](https://docs.microsoft.com/en-us/dotnet/api/system.datetime) and [DateTimeOffset](https://docs.microsoft.com/en-us/dotnet/api/system.datetimeoffset), DateOnly does not contain any time information.

In previous versions of .NET, .NET Core and .NET Framework there was no common way to represent just a date, this made it awkward when wanting to pass dates around your codebase or when you needed to pass a date on to other libraries or integrations.

The [Noda Time](https://nodatime.org/) library does include a struct data type called [LocalDate](https://nodatime.org/2.2.x/api/NodaTime.LocalDate.html) to represent a single date, however, every library that is required to work with a date would have to reference Noda Time.

The most common approach was to create your own custom type, this worked fine in a closed project but it had the caveat that no other library would be able to support your custom data type. It's was also very common to use a standard DateTime object and call the `Date` property on it which would give you the date and truncate the time - `00:00:00`. However, using a DateTime made it ambiguous in your code as the type still had a time part.

```csharp
DateTime myDateTime = DateTime.UtcNow; 
DateTime date = myDateTime.Date;
// date still had a time part - 05/22/2021 00:00:00
Console.WriteLine(date);
```

## ISO 8601

Within ASP.NET Core, the [System.Text.Json](https://docs.microsoft.com/en-us/dotnet/api/system.text.json?view=net-5.0) namespace defaults to parsing and writing `DateTime` and `DateTimeOffset` values in the [ISO 8601](https://en.wikipedia.org/wiki/ISO_8601) format. Using an international standard to exchange date and time data makes it easier to integrate systems together.

Using a standard like ISO 8601 also reduces risk of error, this is because different cultures have different ways of representing dates and times, for example `02/03/19` could mean _2nd March 2019_ or _3rd February 2019_ depending where you are in the world.

## DateOnly in ASP.NET Core

The DateOnly type isn't supported yet by `System.Text.Json` which ASP.NET Core uses, there is however an issue on [GitHub](https://github.com/dotnet/runtime/issues/51302) which states that they are aiming for the .NET 6 release (It's currently in preview v4). This issue says it's going to be implemented identical to the DateTime and DateTimeOffset types.

However, at the moment if you are using DateOnly it will output all the properties of the object like any other complex object type you try to serialize.

For example if we take the following controller and action.

```csharp
[ApiController]
[Route("[controller]")]
public class WeatherForecastController : ControllerBase
{
    private static readonly Random Random = new();

    [HttpGet]
    public WeatherForecast Get()
    {
        return new WeatherForecast(
            new DateOnly(2021, 05, 22),
            Random.Next(-20, 55)
        );
    }
    
    public record WeatherForecast(DateOnly Date, int TemperatureC);
}
```

And then we call the http endpoint, we'll receive the following JSON.

```json
{
    "date": {
        "year": 2021,
        "month": 5,
        "day": 22,
        "dayOfWeek": 6,
        "dayOfYear": 142,
        "dayNumber": 737931
    },
    "temperatureC": 35
}
```

As you can see we are getting all the properties from the type in the response, what we would like is an ISO 8601 string!

### DateOnly JSON Converter

Within the `System.Text.Json` we can create a `JsonConverter` to handle JSON conversion of specific types, we can do this with the `DateOnly` type so that we parse and write ISO 8601 when serializing and deserializing the data.

```csharp
public sealed class DateOnlyJsonConverter : JsonConverter<DateOnly>
{
    public override DateOnly Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        return DateOnly.FromDateTime(reader.GetDateTime());
    }

    public override void Write(Utf8JsonWriter writer, DateOnly value, JsonSerializerOptions options)
    {
        var isoDate = value.ToString("O");
        writer.WriteStringValue(isoDate);
    }
}
```

To plumb this in to ASP.NET Core we'll need to add some custom JSON options within the `Startup` class.

```csharp
public class Startup
{
   public void ConfigureServices(IServiceCollection services)
   {
      services.AddControllers()
            .AddJsonOptions(options =>
            {
               options.JsonSerializerOptions.Converters.Add(new DateOnlyJsonConverter());
            });

      // ...
   }
}
```

Once this is done we can hit our endpoint again and we'll get back an ISO Date!

```json
{
    "date": "2021-05-22",
    "temperatureC": 48
}
```

### Json.NET - Newtonsoft

Since ASP.NET Core 3.0 the [default JSON](https://devblogs.microsoft.com/dotnet/try-the-new-system-text-json-apis/) serialization and deserialization has been `System.Text.Json`. however, a lot projects still use the widely used [Newtonsoft Json.NET](https://www.newtonsoft.com/json) library, this is due to many reason but the two most common are; it make the upgrade path easier from older ASP.NET versions, and Json.NET is more feature rich compared to `System.Text.Json`.

You can tell if your project is using Json.NET if you've got the [Microsoft.AspNetCore.Mvc.NewtonsoftJson](https://www.nuget.org/packages?q=Microsoft.AspNetCore.Mvc.NewtonsoftJson) NuGet package installed and have the following configuration within your `Startup` class.

```csharp
public void ConfigureServices(IServiceCollection services)
{
   services.AddControllers()
         .AddNewtonsoftJson();
   
   // ...
}
```

Given our example controller and action in our last section, the default Json.NET will output the following JSON response.

```json
{
    "date": {
        "year": 2021,
        "month": 5,
        "day": 22,
        "dayOfWeek": 6,
        "dayOfYear": 142,
        "dayNumber": 737931
    },
    "temperatureC": 47
}
```

There's already an issue raised on [GitHub](https://github.com/JamesNK/Newtonsoft.Json/issues/2521) to support the new `DateOnly` data type, however, there has been no comments on the issue as to when or if support will be implemented natively within the library. The library currently targets [.NETStandard 2.0](https://docs.microsoft.com/en-us/dotnet/standard/net-standard), and this could cause difficulties as they'd have to drop support to .NETStandard 2.0 and re-target to .NET 6 only, or multi-target .NETStandard 2.0 and .NET 6 but conditionally include the `DateOnly` conversions within the codebase.

However, as of today we will need to support this ourself within our projects. We can support this similar to the previous section, we will need to create a `JsonConvertor<T>` but this time from `Newtonsoft.Json` namespace.

```csharp
public sealed class DateOnlyJsonConverter : JsonConverter<DateOnly>
{
    public override void WriteJson(JsonWriter writer, DateOnly value, JsonSerializer serializer)
    {
        writer.WriteValue(value.ToString("O"));
    }

    public override DateOnly ReadJson(JsonReader reader, Type objectType, DateOnly existingValue, bool hasExistingValue,
        JsonSerializer serializer)
    {
        return DateOnly.FromDateTime(reader.ReadAsDateTime().Value);
    }
}
```

Then we will need to plumb in the configuration to ASP.NET Core.

```csharp
public void ConfigureServices(IServiceCollection services)
{
   services.AddControllers()
      .AddNewtonsoftJson(options =>
      {
            options.SerializerSettings.Converters.Add(
               new DateOnlyJsonConverter());
      });
   
   // ...
}
```

Once that's all done we can call the endpoint again and we'll get a nicely formatted ISO date back in the response.

```json
{
    "date": "2021-05-22",
    "temperatureC": 41
}
```

## The Future (of DateOnly)

There has been a need for a common date only type in .NET for quite sometime now, a quick search on [Stackoverflow](https://stackoverflow.com/questions/5314309/a-type-for-date-only-in-c-sharp-why-is-there-no-date-type/) brings me to a [question](https://stackoverflow.com/questions/5314309/a-type-for-date-only-in-c-sharp-why-is-there-no-date-type/) raised in March 2011 with over 100 votes.

However, even though .NET 6 is now going to support a date only type, it's not going to be GA until November 2021 and then all the libraries out there will then need to target .NET 6 to be able to support the type. So I feel it's going to be sometime before it's supported by the whole .NET ecosystem.

However, is it worth using it in your project now? defiantly! You can even checkout the implementation of [GitHub - DateOnly.cs](https://github.com/dotnet/runtime/blob/main/src/libraries/System.Private.CoreLib/src/System/DateOnly.cs)

