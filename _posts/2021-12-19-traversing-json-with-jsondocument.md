---
layout: post
title: Traversing JSON with JsonDocument
categories:
tags: [C#, System.Text.Json, JsonDocument]
description: How to traversing JSON with the JsonDocument object in System.Text.Json
comments: true
---

## System.Text.Json

The `System.Text.Json` namespace is fairly new and was introduced when .NET Core 3.0 shipped on 23rd Sept 2019. It includes classes to deal with processing JSON with high-performance, and low-allocating in mind.

A common alternative to this namespace was [Newtonsoft's Json.NET](https://www.newtonsoft.com/json), and it's still widely used within the .NET ecosystem today.

## JsonDocument

The `JsonDocument` class within the namespace is responsible for examining the structural content of a JSON value, similar to `JToken` within Json.NET.

`JsonDocument` is great if you want to inspect the JSON but not serialize it in to a C# POCO (Plain Old CLR Object). I personally find this really useful when testing APIs where I don't want a deserializer doing some extra magic when verifying the return values of an API.

## Traversing JSON

Let's take the following JSON example below and write some C# using JsonDocument to traverse it.

```json
{
    "name": "Joe",
    "age": 22,
    "canDrive": true,
    "contactDetails": {
        "email": "joe@hotmail.com",
        "mobile": "07738277382",
        "fax": null
    },
    "addresses":[
        {
            "line1": "15 Beer Bottle Street"
        },
        {
            "line1": "Shell Cottage"
        }
    ]
}
```

To start with we'll need to parse the JSON string, to do this we can use the static factory method on the `JsonDocument` class. If you're parsing from a stream then you might want to use the `ParseAsync` method.

```csharp
using var jsonDocument = JsonDocument.Parse(json);
```

The `JsonDocument` itself doesn't really do much for an end consumer, however, it does implement `IDisposable` so make sure you wrap it in a `using` statement, that way it will get cleaned up after use.

The `RootElement` property on the `JsonDocument` is the only property on `JsonDocument`, This returns back a `JsonElement`

A JSON document is broken down in to a bunch of elements and properties, an element can be thought of as a value of a property, such as a primitive value (string, number, object, array, boolean, null), object, or array.

In our above example `"Joe"` and `22` are `JsonElement`'s but also `{"email": "joe@hotmail.com","mobile": "07738277382", "fax": null }` is also classified as a `JsonElement`.

![JSON Elements and Properties](/assets/posts/2021-12-19-traversing-json-with-jsondocument/json-element-json-property.png "JSON Elements and Properties")

We can fetch these `JsonElement`s by calling the `GetProperty(string)` method on any `JsonElement`, which includes the `RootElement`.

```csharp
var rootElement = jsonDocument.RootElement;

var nameJsonElement = rootElement.GetProperty("name");
var ageJsonElement = rootElement.GetProperty("age");
var contactDetailsJsonElement = rootElement.GetProperty("contactDetails");
var addressesJsonElement = rootElement.GetProperty("addresses");cd
```

Once we've got these properties we can then get values from element.

```csharp
var name = nameJsonElement.GetString();
var age = ageJsonElement.GetInt32();

Console.WriteLine($"Name: {name}"); // Joe
Console.WriteLine($"Age: {age}"); // 22
```

Objects are very similar, we can keep traversing down the properties

```csharp
var contactDetailsJsonElement = rootElement.GetProperty("contactDetails");

var emailJsonElement = contactDetailsJsonElement.GetProperty("email");
var email = emailJsonElement.GetString();
Console.WriteLine($"Email: {email}"); // joe@hotmail.com

var mobileJsonElement = contactDetailsJsonElement.GetProperty("mobile");
var mobile = mobileJsonElement.GetString();
Console.WriteLine($"Mobile: {mobile}"); // 07738277382
```

However we can also enumerate all the properties on the object.

```csharp
var contactDetailsJsonElement = rootElement.GetProperty("contactDetails");

foreach (var jsonProperty in contactDetailsJsonElement.EnumerateObject())
{
    Console.WriteLine($"{jsonProperty.Name}: {jsonProperty.Value}");
}
// email: joe@hotmail.com
// mobile: 07738277382
// fax:

```

Arrays are very similar in how we enumerate them.

```csharp
var addressesJsonElement = rootElement.GetProperty("addresses");cd

foreach (var jsonElement in addressesJsonElement.EnumerateArray())
{
    var line1JsonElement = jsonElement.GetProperty("line1");
    var line1 = line1JsonElement.GetString();
    Console.WriteLine($"Line 1: {line1}");
    Console.WriteLine($"----");

}
// Line 1: 15 Beer Bottle Street
// ----
// Line 1: Shell Cottage
// ----

```

As you can see everything follows the same simple structure.