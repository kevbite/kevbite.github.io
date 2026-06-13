---
layout: post
title: Banning API Calls in .NET Without Writing Your Own Analyzer
categories:
tags: [C#, .NET, Roslyn, Analyzers, CodeQuality, BannedApiAnalyzers, EF Core]
description: This post shows how to use BannedApiAnalyzers to block specific method calls such as EF Core's Include(), helping you enforce architectural boundaries and keep your codebase clean without writing custom analyzers.
comments: true
---

Every so often, I stumble across something that makes me think: *"Why haven't I been doing this for years?"* This post is about one of those moments.

While working on a project recently, we wanted to stop developers from using certain Entity Framework methods, things like `ToList()` in the middle of a LINQ chain, or `Include()` in places it didn't belong. Sure, we could do code reviews, but what if the build just told you "no" instead?

## Why Block Method Calls?

Sometimes certain APIs just shouldn't be used. They're unsafe, inefficient, or they hide a performance landmine waiting to happen.

In our case, we wanted to block certain EF Core methods that were being overused or misused, stuff like `ToList()` and `Include()` in our application layer. Not because they're inherently bad, but because they were being used in places where projections were a better choice or the async method should of been used instead.

Rather than relying solely on peer reviews or documentation (which nobody reads), we wanted a way to enforce this at compile time. That's where analyzers come in.

## The DIY Approach: Writing Your Own Analyzer

One way to block methods is to write a custom Roslyn analyzer. That's powerful, but it's also a bit of a yak shave if all you want to do is block a few specific method calls.

You can absolutely write an analyzer to detect problematic patterns or APIs. But unless you're doing something fancy like inspecting call graphs or control flow, it's often overkill. For our case, blocking a known list of symbols, we didn't need all that.

## The Easy Button: Using BannedApiAnalyzers

Thankfully, Microsoft already ships a package that does exactly what we want.

[`Microsoft.CodeAnalysis.BannedApiAnalyzers`](https://www.nuget.org/packages/Microsoft.CodeAnalysis.BannedApiAnalyzers) is a lightweight analyzer that lets you specify a list of banned APIs via a `BannedSymbols.txt` file. It plugs straight into your build and throws diagnostics when someone tries to use something on your naughty list.

No magic. No code generation. No custom analyzers. Just a simple file and a NuGet package.

## How to Use BannedApiAnalyzers

Here's how you set it up:

1. **Add the NuGet package:**

   ```bash
   dotnet add package Microsoft.CodeAnalysis.BannedApiAnalyzers
   ```

2. **Create a `BannedSymbols.txt` file in your project (or share it across projects):**

   Example file contents:

   ```text
   # Don't allow ToList, ToArray and Include in application layer
   T:Microsoft.EntityFrameworkCore.EntityFrameworkQueryableExtensions

   M:System.Linq.Queryable.ToList``1(System.Linq.IQueryable{``0})
   M:System.Linq.Queryable.ToArray``1(System.Linq.IQueryable{``0})
   
   M:Microsoft.EntityFrameworkCore.EntityFrameworkQueryableExtensions.Include``2(System.Linq.IQueryable{``0},System.Linq.Expressions.Expression{System.Func{``0,``1}})
   ```

   A few notes:

   * `T:` is for banning a type.
   * `M:` is for banning a specific method or overload.

3. **Set the file's build action to `AdditionalFiles`:**

   If you're editing the `.csproj` directly:

   ```xml
   <ItemGroup>
     <AdditionalFiles Include="BannedSymbols.txt" />
   </ItemGroup>
   ```

   Or just do it in Visual Studio's properties panel.

4. **Build the project:**

   Try using the banned method. You'll get an error like:

   ```text
   error RS0030: The symbol 'EntityFrameworkQueryableExtensions.Include' is banned in this project: Don't allow Include in the application layer.
   ```

   Nice and clear.

## The Errors You'll Get

When you violate the banned API rules, you'll get a diagnostic from the `RS0030` rule. You can customize the message too, by adding a comment at the end of the line in `BannedSymbols.txt`:

```text
M:Microsoft.EntityFrameworkCore.EntityFrameworkQueryableExtensions.Include``2(System.Linq.IQueryable{``0},System.Linq.Expressions.Expression{System.Func{``0,``1}}); Use projection instead of Include in app layer
```

This turns into:

```text
error RS0030: The symbol 'EntityFrameworkQueryableExtensions.Include' is banned in this project: Use projection instead of Include in app layer.
```

Crystal clear for anyone on the team.

## A Few Tips

* You can ban **overloads** by specifying their signatures, but be warned, it gets verbose.
* The file can be reused across projects. Just reference it with a relative path or include it in a shared props file.
* You can use it in SDK-style projects targeting .NET Standard, .NET Core, or .NET Framework.

## Final Thoughts

It's rare that something this simple gives such a big win. In less than 10 minutes, we've added real enforcement around EF misuse that would've taken hours of review time over the course of a project.

It's not just for EF either, we can use it to ban `DateTime.Now`, `Task.Result`, `GC.Collect()`, or any other footgun you want to keep out of your codebase.

Highly recommend.
