---
layout: post
title: Colourful Consoles Using C# and .NET
categories:
tags: [Colour, Console, CLI, C#, .NET]
description: How to create colourful console applications
comments: true
---

While digging around in the [Azure Functions CLI (azure-functions-core-tools)](https://github.com/Azure/azure-functions-core-tools), I noticed that they were using [Colors.Net](https://www.nuget.org/packages/Colors.Net/) to make the CLI more pretty with colours. It's great to find even the [big dogs (Microsoft)](https://en.wikipedia.org/wiki/Microsoft) are using 3rd party libraries built by others to build their software, and that it's not an internal proprietary packages.

## Colors.Net

Colors.Net is an open source library which can be found on [GitHub](https://github.com/ahmelsayed/Colors.Net), It's under the [MIT](https://tldrlegal.com/license/mit-license) so is very permissive.

## Installing Colors.Net

Colors.Net is on [NuGet](https://www.nuget.org/packages/Colors.Net/) so it's simple to add it to your project, either add it from the command line using:
```bash
dotnet add package Colors.Net
```

Or from the Package Manager Console in Visual Studio
```
Install-Package Colors.Net
```

## Usage

One of the great things about Colors.Net compared to its alternatives is that it has a very similar API surface to the static `Console` class within the `System` namespace of .NET. The static class that we use in Colors.Net is `ColoredConsole` and can be located in `Colors.Net`. This has 2 methods on it of `WriteLine` and `Write`.

We can then use the `ColoredConsole` the same as the normal `Console` as seen below:

```csharp
using Colors.Net;

class Program
{
    static void Main(string[] args)
    {
        ColoredConsole.WriteLine(
            "This is a line of text"
        );
    }
}
```

![line-of-text]

Very familiar right?

One big difference with the API is that you can chain the `WriteLine`s and `Write`s without having to call the static method again. Check out the follow example:

```csharp
ColoredConsole.WriteLine("This is a line of text")
    .WriteLine("Here's another line...");
```

![two-lines-of-text]

### Where's my colours?

Within Colors.Net there is a static class called `StringStaticMethods`, here you'll find static methods like `Red(string)` or `Green(string)` that takes a string a returns a `RichString`. This can be used to create our colourful strings.

```csharp
var red = StringStaticMethods.Red("red");
var green =  StringStaticMethods.Green("green");
var blue =  StringStaticMethods.Blue("blue");

ColoredConsole.WriteLine(
    string.Join(", ", new []{red, green, blue})
);
```

![colour-text-in-console]

We can clean up this code by using the [_using static directive_](https://docs.microsoft.com/en-us/dotnet/csharp/language-reference/keywords/using-static) which was introduced in C# 6.
```csharp
using static Colors.Net.StringStaticMethods;

ColoredConsole.WriteLine(
    $"{Red("red")}, {Green("green")}, {Blue("blue")}"
);
```

## Colours of colours

One of the other cool features I like about Colors.Net is that you can embed colours inside colours. This is great for highlighting.

```csharp
var doorId = Cyan("34983");
var message = Red($"Please close the door {doorId} after you enter.");
ColoredConsole.WriteLine(
    message
);
```
![colour-text-in-console-2]

## Popular command line interface

With CLIs becoming more popular this library simplifies creating a better user experience.

## Alternatives
With any package there is always some alternatives so I've listed these below, however, if you know of anymore please feel free to open a PR on [GitHub](https://github.com/kevbite/kevbite.github.io)

- [https://github.com/silkfire/Pastel](https://github.com/silkfire/Pastel)
- [https://github.com/riezebosch/crayon](https://github.com/riezebosch/crayon)


[line-of-text]: \assets\posts\2019-12-03-colourful-consoles-using-csharp-and-dotnet\colors-net-writeline-example-1.png "Line of text in console"

[two-lines-of-text]: \assets\posts\2019-12-03-colourful-consoles-using-csharp-and-dotnet\colors-net-writeline-example-2.png "Two lines of text in console"

[colour-text-in-console]: \assets\posts\2019-12-03-colourful-consoles-using-csharp-and-dotnet\colors-net-writeline-colours-example-1.png "Colour text in console"

[colour-text-in-console-2]: \assets\posts\2019-12-03-colourful-consoles-using-csharp-and-dotnet\colors-net-writeline-colours-example-2.png "Colour text in console"