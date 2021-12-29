---
layout: post
title: Manipulate JSON with System.Text.Json.Nodes
categories:
tags: [C#, System.Text.Json, JsonNode, .NET]
description: How to create and manipulate JSON with the JsonNode object in System.Text.Json
comments: true
---

## System.Text.Json

The `System.Text.Json` namespace has been around since Sept 2019, however, only the recent release of .NET 6 (Nov 2021) included a way to create and manipulate JSON with `JsonNode`.

A common alternative to this was to use `JToken`, `JObject`, `JArray` and `JValue` which was part of [Newtonsoft's Json.NET](https://www.newtonsoft.com/json), and can be seen in many .NET projects.


## Building JSON

JSON is built on two structures:
- A collection of name/value pairs.
- An ordered list of values.

Ref: [https://www.json.org/](https://www.json.org/)

Both of these structures contain values so we'll first cover creating values.

### JsonValue

Within the `System.Text.Json.Nodes` namespace, There's a class called `JsonValue` which contains static factory methods named `Create`, these methods can be used to create the a Json Value object from various C# values.

```csharp
var jsonValue1 = JsonValue.Create("a string");
var jsonValue2 = JsonValue.Create(123);
var jsonValue3 = JsonValue.Create(123.123);
var jsonValue4 = JsonValue.Create(199.99m);
var jsonValue5 = JsonValue.Create(true);
```

Above is a few examples, the `JsonValue` is a `JsonNode` (derived type) and there's also some implicit conversations built in to make things easier when passing arguments to methods. Take the following code for example.

```csharp
PrintJsonNode("a string");
PrintJsonNode(123);
PrintJsonNode(123.123);
PrintJsonNode(199.99m);
PrintJsonNode(true);

void PrintJsonNode(JsonNode jsonNode)
{
    Console.WriteLine(jsonNode.ToJsonString());
}
```

The above will compile due to the implicit conversion to the `JsonNode` type.

### JsonObject

We can also use a `JsonObject` to create our collection of name/value pairs.
```json
{ "name1": "value1", "name2": 2 }
```

There is a few ways we can go about creating a `JsonObject` in C#. We can create the whole structure with the constructor and pass in an array of key value pairs of string,JsonNode.
```csharp
var jsonObject = new JsonObject(
    new[]
    {
        KeyValuePair.Create<string, JsonNode?>("name1", "value1"),
        KeyValuePair.Create<string, JsonNode?>("name2", 2),
    }
);
```
Alternately if we've got a `Dictionary<string, JsonNode>` we can pass that directly in to the constructor of a JsonObject, because the constructor accepts a `IEnumerable<KeyValuePair<string, JsonNode?>>`.
```csharp
var dictionary = new Dictionary<string, JsonNode>
{
    ["name1"] = "value1",
    ["name2"] = 2
};

var jsonObject = new JsonObject(dictionary);
```

You might have noticed that we didn't have to do a `JsonValue.Create` to create each of our `JsonNode`s, this is because of the implicit conversion.

The last and the cleanest approach is to use the index initializers on creation.

```csharp
var jsonObject = new JsonObject(dictionary)
{
    ["name1"] = "value1",
    ["name2"] = 2
};
```

Once we have a `JsonObject` we can start adding and removing pairs with the `Add` and `Remove` methods:
```csharp
jsonObject.Add(KeyValuePair.Create<string, JsonNode>("name3", "value3"));
jsonObject.Add("name4", "value4");
```

```csharp
jsonObject.Remove("name1");
```

There's also an extra `Remove` extension method on `IDictionary<TKey, TValue>` that can be useful if you want to remove the pair and keep hold of it's value to move or rename it.
```csharp
var jsonObject = new JsonObject(dictionary)
{
    ["name1"] = "value1",
    ["name2"] = 2
};

if (jsonObject.Remove("name1", out var value))
{
    jsonObject.Add("name3", value);
}

Console.WriteLine(jsonObject.ToJsonString());
// {"name2":2,"name3":"value1"}

```

### JsonArray

The last class we should talk about is the `JsonArray`, this is for representing our ordered list of values.

Similar to our `JsonObject` in the last section, an `JsonArray` can be created in the same ways. There's a constructor that takes in an array of `JsonNode`s. Like before we can use the implicit type conversation in the language to get from our C# types to the `JsonNode`s which the JsonArray requires.

```csharp
var jsonArray = new JsonArray(1, "string", true, null);
```

We can also use collection initializers to create our JsonArray, similar to how we'd create a `List<T>`.
```csharp
var jsonArray = new JsonArray
{
    1,
    "string",
    true,
    null
};
```

Now we can add and remove items to our `JsonArray`

```csharp
var jsonArray = new JsonArray
{
    1,
    "string"
};

jsonArray.Add("new string");
var index = 1;
jsonArray.Insert(index, "another string");

jsonArray.Remove("string");
jsonArray.RemoveAt(index);
```

We can either Add/Remove by the value or by its index within the `JsonArray`.

### JsonArray and JsonObject values

`JsonArray` and `JsonObject` are also values too, that means we can build up more complex objects. Take the following example for building up a person with many addresses.

```csharp
var person = new JsonObject
{
    ["name"] = "John Doe",
    ["age"] = 42,
    ["address"] = new JsonArray
    {
        new JsonObject
        {
            ["street"] = "1st Ave",
            ["city"] = "York",
            ["country"] = "UK"
        },
        new JsonObject
        {
            ["street"] = "2nd Ave",
            ["city"] = "London",
            ["country"] = "UK"
        }
    }
};

Console.WriteLine(person.ToJsonString());
// {"name":"John Doe","age":42,"address":[{"street":"1st Ave","city":"York","country":"UK"},{"street":"2nd Ave","city":"London","country":"UK"}]}
```

### ToString / ToJsonString

There's two methods on the base class `JsonNode` for generating a string output, the first one is a the normal `object.ToString()` the second is a `JsonNode.ToJsonString()`. They normally generate similar string outputs, however, they're subtly different.

#### ToString

`ToString` by definition will generate a _string representation for the current value appropriate to the node type_. Let's take a look at some examples.

```csharp
var value1 = JsonValue.Create("John Doe");
var value2 = JsonValue.Create(42);

Console.WriteLine(value1.ToString());
// John Doe
Console.WriteLine(value2.ToString());
// 42
```

```csharp
var value1 = JsonValue.Create(new []{1,2});
var value2 = JsonValue.Create(new {a = 1, b = 2});

Console.WriteLine(value1.ToString());
// [
//   1,
//   2
// ]

Console.WriteLine(value2.ToString());
// {
//   "a": 1,
//   "b": 2
// }

```

As you can see the primitive values are returned with no quotation wrapping and also the more complex objects are indented for readability.

#### ToJsonString

The `ToJsonString` definition is to _Convert the current instance to string in JSON format._

Now let's compare the previous examples with `ToJsonString`

```csharp
var value1 = JsonValue.Create("John Doe");
var value2 = JsonValue.Create(42);

Console.WriteLine(value1.ToJsonString());
// "John Doe"
Console.WriteLine(value2.ToJsonString());
// 42
```

```csharp
var value1 = JsonValue.Create(new []{1,2});
var value2 = JsonValue.Create(new {a = 1, b = 2});

Console.WriteLine(value1.ToJsonString());
// [1,2]

Console.WriteLine(value2.ToJsonString());
// {"a":1,"b":2}

```

As you can see the JSON string of a string is wrapped in quotes so that it's actually JSON, also the values for the more complex objects omit all the spacing and indentation which is used for readability. So if you want to output the JSON value then we should be using `ToJsonString` method.

The `ToJsonString` also has an optional parameter which you can pass a `JsonSerializerOptions` to control how the json string is generate. For example we could use the `CamelCase` policy for naming.

```csharp
var value3 = JsonValue.Create(new {A = 1, B = 2});

var jsonSerializerOptions = new JsonSerializerOptions
{
    PropertyNamingPolicy = JsonNamingPolicy.CamelCase
};
Console.WriteLine(value3.ToJsonString(jsonSerializerOptions));
// {"a":1,"b":2}
```

## Json.NET / Wrap-Up

As you can see, with the new types within the `Nodes` namespace within .NET 6 it's now possible to do everything you could do with Json.NET. This is one of the last things that `System.Text.Json` was missing which meant that I still had a reference to Json.NET in my projects. It's another great new addition to the .NET eco system!
