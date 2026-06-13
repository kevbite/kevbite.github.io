---
layout: post
title: Decoupling MongoDB’s ObjectId in C# with EF Core
categories:
tags: [MongoDB, C#, .NET, EF Core]
description: This post explores how to decouple MongoDB's ObjectId from your C# models using EF Core, allowing you to work with simple string IDs while keeping MongoDB happy under the hood.
comments: true
---

When building APIs, you don’t want the internal details of your database or libraries leaking out all over the place. A classic example? MongoDB’s `ObjectId`.  

If you use MongoDB in C#, you might have seen `ObjectId` in your models. But do you really want to couple your entire app to MongoDB’s specific ID type? Probably not. Instead, wouldn’t it be nicer to just work with simple `string` IDs and let EF Core handle the conversion for you?  

That’s exactly what we’ll explore here.  

For example, below are two policies: one that relies on an `ObjectId` for its `Id` property and another that uses a `string`.  

```csharp
public record Policy
{
    public ObjectId Id { get; set; } // Requires a reference to MongoDB.Bson Package
    public string PolicyNumber { get; set; }
    public decimal Premium { get; set; }
}

public record Policy
{
    public string Id { get; set; }
    public string PolicyNumber { get; set; }
    public decimal Premium { get; set; }
}
```

The second version keeps things simple, no dependency on MongoDB, just a plain string ID.  

To achieve this within the MongoDB EF provider, we have to set up conversions between the `string` and `ObjectId` types. This can be done within the `DbContext` by calling `HasConversion` with a generic of `ObjectId`.  

This tells EF Core: "Hey, when dealing with the `Id` field, just convert it to/from `ObjectId` automatically." No manual conversions needed!  

```csharp
public class InsuranceDbContext(
    DbContextOptions<InsuranceDbContext> options)
    : DbContext(options)
{
    public DbSet<Policy> Policies { get; init; }

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);

        modelBuilder.Entity<Policy>(builder =>
        {
            builder.ToCollection("policies");
            builder.Property(x => x.Id)
                .HasConversion<ObjectId>();
        });
    }
}
```

Under the covers, this swaps the property to use a `StringToObjectIdConverter`, which can be found in the `MongoDB.EntityFrameworkCore.Storage.ValueConversion` namespace. The EF Core MongoDB provider currently ships with the following conversions to help bridge your model types and the provider's (MongoDB) types:  

- `Decimal128ToDecimalConverter`  
- `DecimalToDecimal128Converter`  
- `ObjectIdToStringConverter`  
- `StringToObjectIdConverter`  

However, if you need something more complex, you can also pass in a delegate to the `HasConversion` method. Below is a hand-crafted version of the `StringToObjectIdConverter`:  

```csharp
builder.Property(x => x.Id)
    .HasConversion<ObjectId>(s => new ObjectId(s), id => id.ToString());
```

Now, when we try to insert a policy into our database using EF Core, it will be stored as expected in MongoDB using `ObjectId` for the `_id` field.  

```csharp
var policy = new Policy
{
    Id = ObjectId.GenerateNewId().ToString(),
    PolicyNumber = "123456789",
    Premium = 109.99m
};
context.Policies.Add(policy);

await context.SaveChangesAsync();
```

Data stored in MongoDB:  

```javascript
demo> db.policies.find()
[
  {
    _id: ObjectId('67eedaab29543eaafc76cf18'),
    PolicyNumber: '123456789',
    Premium: Decimal128('109.99')
  }
]
```

However, manually setting `Id` every time you create a policy with `ObjectId.GenerateNewId().ToString()` is not ideal. This should be handled automatically by EF Core.  

But if we try to leave `Id` out, like this:  

```csharp
var policy = new Policy
{
    PolicyNumber = "123456789",
    Premium = 109.99m
};
context.Policies.Add(policy);

await context.SaveChangesAsync();
```

We’ll get the following exception thrown by EF Core:  

```text
System.InvalidOperationException: Unable to track an entity of type 'Policy' because its primary key property 'Id' is null.
```

We can fix this by adding some extra configuration to our EF Core context. We need to tell it to use a `ValueGenerator` for the `Id` property when adding an item to the context. This is done by calling `HasValueGenerator` and passing in `StringObjectIdValueGenerator`, which is provided by the MongoDB EF Core provider.  

```csharp
public class InsuranceDbContext(
    DbContextOptions<InsuranceDbContext> options)
    : DbContext(options)
{
    public DbSet<Policy> Policies { get; init; }
    
    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);

        modelBuilder.Entity<Policy>(builder =>
        {
            builder.ToCollection("policies");
            builder.Property(x => x.Id)
                .HasConversion<ObjectId>()
                .HasValueGenerator<StringObjectIdValueGenerator>();
        });
    }
}
```

Now that our `DbContext` is configured correctly, we can run the following code:  

```csharp
var policy = new Policy
{
    PolicyNumber = "123456789",
    Premium = 109.99m
};
context.Policies.Add(policy);

await context.SaveChangesAsync();
```

And when we check MongoDB, we’ll see that new `ObjectId`s are being generated:  

```javascript
demo1> db.policies.find()
[
  {
    _id: ObjectId('67eedc2066007f38933e6dd1'),
    PolicyNumber: '123456789',
    Premium: Decimal128('109.99')
  }
]
```

As you can see, we’ve successfully abstracted away MongoDB’s internal ID type while still storing it properly in MongoDB.  
