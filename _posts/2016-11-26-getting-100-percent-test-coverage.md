---
layout: post
title: Getting 100% test coverage
categories:
tags: [Agile, Software, C#, Testing, Code Coverage]
description: How to get that 100% test coverage
comments: true
---

# 100% test coverage
Everyone knows that hitting that 100% test coverage is going to get you a high five from your product owner. Test coverage is a metric that is often mapped to quality so let's get on and write some code that gets that desired 100% test coverage!

## System under test

Say we have two classes `Calculator` and `AdvancedCalculator`:

```csharp
public class Calculator
{
    public int Add(int num1, int num2) => num1 + num2;

    public int Multiply(int num1, int num2) => num1 * num2;

    public int Subtract(int num1, int num2) => num1 - num2;
}

public class AdvancedCalculator
{
    public int Square(int num) => num * num;
}
```

## Writing the tests

We can then start writing our tests...

```csharp
[Test]
public void GetMe100Percent()
{
    var types = new[] {typeof (Calculator), typeof (AdvancedCalculator)};

    foreach (var type in types)
    {
        var instance = Activator.CreateInstance(type);

        foreach (var methodInfo in type.GetMethods())
        {
            var parameters = methodInfo.GetParameters()
                .Select(x => Activator.CreateInstance(x.ParameterType))
                .ToArray();

            methodInfo.Invoke(instance, parameters);
        }
    }
}
```

## High Five ✋!

A quick run in dotCover, and we'll see that we've hit our 100% target!
![100% in dotCover](/assets/posts/2016-11-26-getting-100-percent-test-coverage/dotCover.png)

# Being more serious

We can see from the above the test gives us no confidence that our code is going to function as expected. So really the metric we want is confidence percentage?

## Confidence

I find that having an excessive amounts of unit tests couples your tests to your implementation which in turn makes it hard to refactor or implement new features. It is much better trying to increase your confidence in software working by writing higher level tests such as functional or integration tests. I've personally seen a lot more issues on problems with integration due to web services not working as expected or unseen circumstances with third party applications.