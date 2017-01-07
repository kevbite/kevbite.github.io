---
layout: post
title: Comments in code
categories:
tags: [Clean Code, C#]
description: Going from comments to descriptive code
comments: true
---

# Comments in code

## Way back

When I first started out coding I remember having a totally different mindset of what was good and bad code. Looking back I think this was mostly related to what I was told. One of the things that I was told to do was _always comment your code_. However since then I've been burnt by many fires and thus learned from mistakes to realise that comments don't always provider better quality of code. I now find comments to be far less useful in code and also obscure the code from what it is really doing.

## Little example

So let's start simple, the below example shows a comment that you may see everyday within your CodeBase, but what value does it give?

```csharp

// Gets the bonnet color of the car.
var color = car.GetColor(Part.Bonnet);

```

Lets just break down the operations in the above C# statement; `var color = ` tells us that we're setting a variable color to most likely a colour because we've named it that. Next is `car.GetColor(...)` so we've got a _car_ and we are getting a colour from it, then the last part `...(Part.Bonnet)` explicitly tells us we're getting the color of the bonnet part of the car. Simple right? so why would we need the comment above it?

## I hear you

So I hear you... _"The comments are not harming anyone, so stop being so picky"._ So let me ask you, How many comments have you seen throughout a CodeBase that are not related to anything in the code above or below the comment?

```csharp
var vat = 0.2d;

// Add the products to the basket
basket.ApplyVat(vat)

```

I know this isn't such a biggy in the above statement but when you've got a fairly big CodeBase with lots of unknowns it's just another hurdle to jump while your trying to understand what's going off.

## Obscure meaning

One of the other issues that I've found with comments is that the meaning of something within a comment isn't always the correct.

```csharp

// Gets the default path
var value = packageManager.GetUrl();

```

The above comment says _path_ where I'd assume the path was something like `/this-is-my-path` but from the code it says _GetUrl_ so I'd assume that would return `http://a.full.url/with-a-path`. confusing eh?

# Let's change!

Below is an everyday commented snippet of code, we'll just walk though stages of how we could change this so that we don't need the comments explaining the code, thus making our code self descriptive.

```csharp

public class Message
{
    // 1 = Normal, 2 = Super, 3 = Admin
    public int UserType { get; set; }

    public string Name { get; set; }
}

public class AddUserHandler
{
    private readonly IUserStore _store;
    private static Random _random = new Random();

    public AddUserHandler(IUserStore store)
    {
        _store = store;
    }

    public void Handle(Message message)
    {
        // Generate our user reference
        string prefix = "";
        if (message.UserType == 2) // Super User
        {
            prefix = "s-";
        }else if (message.UserType == 3) // Admin User
        {
            prefix = "a-";
        }

        var reference = prefix + _random.Next(1000, 9999).ToString();

        _store.Save(new User(reference, message.Name));
    }
}

public class User
{
    public string Reference { get; }
    public string Name { get; }
    public User(string reference, string name)
    {
        // Set our properties
        Reference = reference;
        Name = name;
    }
}

public interface IUserStore
{
    void Save(User user);
}

```

So to start with let's take the `// 1 = Normal, 2 = Super, 3 = Admin` comments which are littered throughout our block of code and take advantage of some of the C# language features and wrap these up in a enumeration.

```csharp

public enum UserType
{
    Normal = 1,
    Super = 2,
    Admin = 3
}

public class Message
{
    public UserType UserType { get; set; }

    public string Name { get; set; }
}

```

Looking better already right?

So now we'll look at the `// Generate our user reference` comment next. For this we should really take advantage of using a object orientated language and encapsulate this bit of logic in a class, let's call that class `UserReferenceGenerator`. That way it will make more sense what this block of code is doing.

```csharp

public sealed class UserReferenceGenerator
{
    private static readonly Random _random = new Random();

    public string Generate(UserType type)
    {
        var prefix = "";
        if (type == UserType.Super)
        {
            prefix = "s-";
        }
        else if (type == UserType.Super)
        {
            prefix = "a-";
        }

        return prefix + _random.Next(1000, 9999).ToString();
    }
}

```

It's obvious what this class is generating now but the logic inside the class is still not straight forward. This is where having a good set of tests around the class will help us.

```csharp

public class UserReferenceGeneratorTests
{
    [Fact]
    public void WhenGeneratingARefFromASuperUser_ThenRefIsPrefixed() { }
    [Fact]
    public void WhenGeneratingARefFromAAdminUser_ThenRefIsPrefixed() { }
    [Fact]
    public void WhenGeneratingARefFromANormalUser_ThenRefIsNotPrefixed() { }
    [Fact]
    public void WhenGeneratingARef_ThenRefIsKindaUnique() { }
}

```

So we'll bring all this together and see our outcome so far.

```csharp


public enum UserType
{
    Normal = 1,
    Super = 2,
    Admin = 3
}

public class Message
{
    public UserType UserType { get; set; }

    public string Name { get; set; }
}

public class UserReferenceGenerator
{
    private static readonly Random _random = new Random();

    public string Generate(UserType type)
    {
        var prefix = "";
        if (type == UserType.Super)
        {
            prefix = "s-";
        }
        else if (type == UserType.Super)
        {
            prefix = "a-";
        }

        return prefix + _random.Next(1000, 9999).ToString();
    }
}

public class UserReferenceGeneratorTests
{
    public void WhenGeneratingARefFromASuperUser_ThenRefIsPrefixed() { }

    public void WhenGeneratingARefFromAAdminUser_ThenRefIsPrefixed() { }

    public void WhenGeneratingARefFromANormalUser_ThenRefIsNotPrefixed() { }

    public void WhenGeneratingARef_ThenRefIsKindaUnique() { }
}

public class AddUserHandler
{
    private readonly IUserStore _store;

    private readonly UserReferenceGenerator _referenceGenerator;

    public AddUserHandler(IUserStore store)
    {
        _store = store;
        _referenceGenerator = new UserReferenceGenerator();
    }
    
    public void Handle(Message message)
    {
        var reference = _referenceGenerator.Generate(message.UserType);
        _store.Save(new User(reference, message.Name));
    }
}

public class User
{
    public string Reference { get; }
    public string Name { get; }
    public User(string reference, string name)
    {
      Reference = reference;
      Name = name;
    }
}

public interface IUserStore
{
    void Save(User user);
}

```

What do you think?

I feel It's better to strive for least amounts of comments as possible, and try to make your code as descriptive as possible!

# I'm not against comments

Don't get me wrong I'm not totally against comments but I feel people should use them more wisely, for example if I'm shipping a public package I'll either write the desired usage of the package within the `readme.md` or XML comment my publicly exposed API.

Another good usage is where you have to work around a problem out of your control, say you have to do something a little odd because a library that your using doesn't give percentages as decimals but as full numbers.

```csharp

var vatClient = new VatClient();

// Hack: We need to divide by 100 as the rate is returned as a full number.
var standardRate = varClient.GetStandardRate() / 100d;

```

So I'll end this with, _think before you comment_.