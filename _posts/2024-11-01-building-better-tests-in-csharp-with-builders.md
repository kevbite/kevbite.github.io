---
layout: post
title: Building Better Tests in C# with Builders
categories:
tags: [Testing, C#, .NET]
description: Simplify C# test setup and improve readability with custom builders for complex models
comments: true
---

Testing is basically the bread and butter of building reliable software these days. But as you keep adding more tests, things can start looking like a mess—tests with tons of repeated data setup, making them harder to understand and maintain. This usually happens unintentionally, just from new features piling on over time.

Let’s take a sample scenario where we’re setting up models for an insurance quote. The model might look like this:

```csharp
public record QuoteResourceRepresentation(
    Guid? Id,
    QuoteApplicantResourceRepresentation Applicant,
    DateOnly From,
    int Duration
);

public record QuoteApplicantResourceRepresentation(
    string FirstName,
    string LastName,
    DateOnly DateOfBirth,
    string Nationality,
    IReadOnlyCollection<QuoteApplicantAddressResourceRepresentation> Addresses
);

public record QuoteApplicantAddressResourceRepresentation(
        string Line1,
        string Line2,
        string Line3,
        string PostalCode
);
```

So, a typical test to set up this data could look something like this:

```csharp
[Test]
public void Test1()
{
    var quote = new QuoteResourceRepresentation(
        Id: null,
        Applicant: new(
            FirstName: "John",
            LastName: "Doe",
            DateOfBirth: new DateOnly(1980, 1, 1),
            Nationality: "GB",
            Addresses:
            [
                new(
                    Line1: "8 Hanford Way",
                    Line2: "Loughborough",
                    Line3: "Leicestershire",
                    PostalCode: "LE11 1SD")
            ]),
        From: DateOnly.FromDateTime(DateTime.UtcNow.AddDays(30)),
        Duration: 365);
    
    // Do work
    
    // Assert somethings
}
```

But this pattern gets repeated across tests, which means we end up with code duplication and a lack of clarity on why these values are used in each test. It’s easy to lose track of what the setup is doing, and this setup code can become tough to maintain. That’s where builders can save the day.

## Builders

Builders help encapsulate this repetitive data setup by making reusable components that produce a specific version of our model (e.g., the `QuoteResourceRepresentation`). Here’s a basic builder for our `QuoteResourceRepresentation`.

```csharp
public class QuoteResourceRepresentationBuilder
{
    public QuoteResourceRepresentation Build()
    {
        return new QuoteResourceRepresentation(
            Id: null,
            Applicant: new(
                FirstName: "John",
                LastName: "Doe",
                DateOfBirth: new DateOnly(1980, 1, 1),
                Nationality: "GB",
                Addresses:
                [
                    new(
                        Line1: "8 Hanford Way",
                        Line2: "Loughborough",
                        Line3: "Leicestershire",
                        PostalCode: "LE11 1SD")
                ]),
            From: DateOnly.FromDateTime(DateTime.UtcNow.AddDays(30)),
            Duration: 365);
    }
}
```

Now our tests can use the builder, making them cleaner:

```csharp
[Test]
public void Test1()
{
    var quote = new QuoteResourceRepresentationBuilder()
        .Build();

    // Do work

    // Assert somethings
}

[Test]
public void Test2()
{
    // Quote with a duration of 10 days
    var quote = new QuoteResourceRepresentationBuilder()
        .Build() with { Duration = 10 };

    // Do work

    // Assert somethings
}
```

Our tests are looking more organized, but this would be even better if we could customize specific parts before calling `Build()`. Let’s extend our builder with some `With` methods to make our tests easier to read and control.

## Enhanced Builders with `With` Methods

Adding `With` methods allows you to tweak properties before building, creating a more fluent and readable setup.

```csharp
public class QuoteResourceRepresentationBuilder
{
    private DateOnly? _from;
    private int? _duration;

    public QuoteResourceRepresentation Build()
    {
        return new QuoteResourceRepresentation(
            Id: null,
            Applicant: new(
                FirstName: "John",
                LastName: "Doe",
                DateOfBirth: new DateOnly(1980, 1, 1),
                Nationality: "GB",
                Addresses:
                [
                    new(
                        Line1: "8 Hanford Way",
                        Line2: "Loughborough",
                        Line3: "Leicestershire",
                        PostalCode: "LE11 1SD")
                ]),
            From: _from ?? DateOnly.FromDateTime(DateTime.UtcNow.AddDays(30)),
            Duration: _duration ?? 365);
    }
    
    public QuoteResourceRepresentationBuilder WithFrom(DateOnly from)
    {
        _from = from;
        return this;
    }
    
    public QuoteResourceRepresentationBuilder WithDuration(int duration)
    {
        _duration = duration;
        return this;
    }
}
```

Now our tests are even more flexible:


```csharp
[Test]
public void Test1()
{
    var quote = new QuoteResourceRepresentationBuilder()
        .Build();

    // Snip...
}

[Test]
public void Test2()
{
    // Quote with a duration of 10 days
    var quote = new QuoteResourceRepresentationBuilder()
        .WithDuration(10)
        .Build();
    
    // Snip...
}

[Test]
public void Test3()
{
    // Quote starting in 15 days
    var quote = new QuoteResourceRepresentationBuilder()
        .WithFrom(DateOnly.FromDateTime(DateTime.UtcNow.AddDays(15)))
        .Build();
    
    // Snip...
}
```

## Builders with Greater Meaning

We can make the builder more meaningful by renaming methods to make our intentions clearer. For example, `WithDuration` becomes `WithDaysDuration`. We can even add helper methods for special cases to make tests more readable.

```csharp
public class QuoteResourceRepresentationBuilder
{
    private DateOnly? _from;
    private int? _duration;

    public QuoteResourceRepresentation Build()
    {
        return new QuoteResourceRepresentation(
            Id: null,
            Applicant: new(
                FirstName: "John",
                LastName: "Doe",
                DateOfBirth: new DateOnly(1980, 1, 1),
                Nationality: "GB",
                Addresses:
                [
                    new(
                        Line1: "8 Hanford Way",
                        Line2: "Loughborough",
                        Line3: "Leicestershire",
                        PostalCode: "LE11 1SD")
                ]),
            From: _from ?? DateOnly.FromDateTime(DateTime.UtcNow.AddDays(30)),
            Duration: _duration ?? 365);
    }
    
    public QuoteResourceRepresentationBuilder WithFrom(DateOnly from)
    {
        _from = from;
        return this;
    }
    
    public QuoteResourceRepresentationBuilder WithStartingInDays(int daysAgo)
        => WithFrom(DateOnly.FromDateTime(DateTime.UtcNow.AddDays(daysAgo)));
    
    public QuoteResourceRepresentationBuilder WithDaysDuration(int duration)
    {
        _duration = duration;
        return this;
    }   
}
```

And now we can build out some test cases with meaning baked right into our setup:


```csharp
var quote = new QuoteResourceRepresentationBuilder()
    .WithDaysDuration(10)
    .WithStartingDaysAgo(10)
    .Build();
```

Now we've got the basics we can start also adding methods on to our builder to represent other happy and failure cases a give them explicit names, for example if we want to create some invalid quotes, these could be quotes with a duration of `0` or a quote that is starting in the past.

```csharp
public QuoteResourceRepresentationBuilder WithInvalidDuration()
    => WithDaysDuration(0);

public QuoteResourceRepresentationBuilder WithInvalidDurationAboveMaximum()
    => WithDaysDuration(366);

public QuoteResourceRepresentationBuilder WithInvalidFrom()
    => WithFrom(DateOnly.FromDateTime(DateTime.UtcNow.AddDays(-1)));
```

This now allows us to create tests which are easier to skim read, also if anytime in the future we change what the maximum duration is for a quote we can easily change all the places which setup what a maximum duration looks like.

```csharp
[Test]
public void TestForInvalidDuration()
{
    var quote1 = new QuoteResourceRepresentationBuilder()
        .WithInvalidDuration()
        .Build();

    var quote2 = new QuoteResourceRepresentationBuilder()
        .WithInvalidDurationAboveMaximum()
        .Build();


    // Snip...
}
```

## Builders with Nested Objects

Real-world objects are usually more complex, so we can add nested builders to handle them. Here’s how that could look with our applicant model:

```csharp
public class QuoteResourceRepresentationBuilder
{
    private DateOnly? _from;
    private int? _duration;

    private Func<QuoteApplicantResourceRepresentationBuilder, QuoteApplicantResourceRepresentationBuilder>
        _applicantBuilderFunc = (builder => builder);

    public QuoteResourceRepresentation Build()
    {
        var applicant = _applicantBuilderFunc
            .Invoke(new QuoteApplicantResourceRepresentationBuilder())
            .Build();

        return new QuoteResourceRepresentation(
            Id: null,
            Applicant: applicant,
            From: _from ?? DateOnly.FromDateTime(DateTime.UtcNow.AddDays(30)),
            Duration: _duration ?? 365);
    }

    public QuoteResourceRepresentationBuilder WithApplicant(
        Func<QuoteApplicantResourceRepresentationBuilder, QuoteApplicantResourceRepresentationBuilder> func)
    {
        _applicantBuilderFunc = func;
        return this;
    }

    public QuoteResourceRepresentationBuilder WithFrom(DateOnly from)
    {
        _from = from;
        return this;
    }

    public QuoteResourceRepresentationBuilder WithStartingDaysAgo(int daysAgo)
        => WithFrom(DateOnly.FromDateTime(DateTime.UtcNow.AddDays(-daysAgo)));

    public QuoteResourceRepresentationBuilder WithDaysDuration(int duration)
    {
        _duration = duration;
        return this;
    }

    public QuoteResourceRepresentationBuilder WithInvalidDuration()
        => WithDaysDuration(0);

    public QuoteResourceRepresentationBuilder WithInvalidFrom()
        => WithFrom(DateOnly.FromDateTime(DateTime.UtcNow.AddDays(-1)));
}

public class QuoteApplicantResourceRepresentationBuilder
{
    private readonly
        List<Func<QuoteApplicantAddressResourceRepresentationBuilder,
            QuoteApplicantAddressResourceRepresentationBuilder>> _addressBuilderFuncs = [];

    private DateOnly? _dateOfBirth;

    public QuoteApplicantResourceRepresentationBuilder WithAddress(
        Func<QuoteApplicantAddressResourceRepresentationBuilder,
            QuoteApplicantAddressResourceRepresentationBuilder>? func = null)
    {
        func ??= builder => builder;
        _addressBuilderFuncs.Add(func);
        return this;
    }
    
    public QuoteApplicantResourceRepresentationBuilder WithDateOfBirth(DateOnly dateOfBirth)
    {
        _dateOfBirth = dateOfBirth;
        return this;
    }
    
    public QuoteApplicantResourceRepresentationBuilder WithUnderageDateOfBirth()
        => WithDateOfBirth(DateOnly.FromDateTime(DateTime.UtcNow.AddDays(-365 * 17)));

    public QuoteApplicantResourceRepresentationBuilder WithInvalidDateOfBirth()
        => WithDateOfBirth(DateOnly.FromDateTime(DateTime.UtcNow.AddDays(1)));
    
    public QuoteApplicantResourceRepresentation Build()
    {
        var addresses = _addressBuilderFuncs.Count == 0
            ? [new QuoteApplicantAddressResourceRepresentationBuilder().Build()]
            : _addressBuilderFuncs
                .Select(func => func(new QuoteApplicantAddressResourceRepresentationBuilder()).Build()).ToList();

        return new(
            FirstName: "John",
            LastName: "Doe",
            DateOfBirth: _dateOfBirth ?? new DateOnly(1980, 1, 1),
            Nationality: "GB",
            Addresses: addresses);
    }
}

public class QuoteApplicantAddressResourceRepresentationBuilder
{
    private string? _postalCode;

    public QuoteApplicantAddressResourceRepresentation Build()
    {
        return new(
            Line1: "8 Hanford Way",
            Line2: "Loughborough",
            Line3: "Leicestershire",
            PostalCode: _postalCode ?? "LE11 1SD");
    }

    public QuoteApplicantAddressResourceRepresentationBuilder WithPostalCode(string postalCode)
    {
        _postalCode = postalCode;
        return this;
    }

    public QuoteApplicantAddressResourceRepresentationBuilder WithInvalidPostalCode()
        => WithPostalCode("INVALID");
}
```

Now we can set up tests like this:


```csharp
// Quote with applicant who is underage
var quote1 = new QuoteResourceRepresentationBuilder()
    .WithApplicant(applicant => applicant.WithUnderageDateOfBirth())
    .Build();

// Quote with applicant who has an invalid date of birth
var quote2 = new QuoteResourceRepresentationBuilder()
    .WithApplicant(applicant => applicant.WithInvalidDateOfBirth())
    .Build();

// Quote with applicant who has 2 valid addresses
var quote3 = new QuoteResourceRepresentationBuilder()
    .WithApplicant(applicant => applicant
        .WithAddress()
        .WithAddress())
    .Build();

// Quote with applicant who has a postal code of "L1 1SD"
var quote4 = new QuoteResourceRepresentationBuilder()
    .WithApplicant(applicant => applicant
        .WithAddress(address => address
            .WithPostalCode("L1 1SD")))
    .Build();

// Quote with applicant who has an invalid postal code
var quote5 = new QuoteResourceRepresentationBuilder()
    .WithApplicant(applicant => applicant
        .WithAddress(address => address
            .WithInvalidPostalCode()))
    .Build();
```

## Wrapping Up

Using builders in tests makes setups more manageable and keeps our tests readable and meaningful. Once you've set up a good builder pattern, tweaking tests becomes a breeze. What other builder tricks have you tried out?
