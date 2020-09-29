---
layout: post
title: Combining Two Sorted Generic Enumerables in C#
categories:
tags: [C#, LINQ, BenchmarkDotNet, Performance]
description: How to combining two sorted generic enumerables in C#
comments: true
---

I recently got challenged to write a C# method that would take two `IEnumerable<T>` and return a sorted `IEnumerable<T>` that would contain every item of the two `IEnumerable<T>` inputs. For the challenge it was assumed that both `IEnumerable<T>`s were already sorted.

I thought this was an interesting challenge as it can be tackled many different ways and I personally don't think there's a right or wrong way it all depends on your current context.

## Defining a Signature

Most of my development work I try to drive with tests, so the simplest test I could write for building up the method signature was to take two empty enumerables and assert that I get an empty one back.

```csharp
[Fact]
public void CombiningTwoEmptyEnumerablesOfIntReturnsEmptyEnumerable()
{
    var input1 = Enumerable.Empty<int>();
    var input2 = Enumerable.Empty<int>();

    var result = EnumerableCombine.Combine(input1, input2);

    result.Should().BeEmpty();
}
```

The above test is using [xUnit](https://xunit.net/) and [FluentAssertions](https://fluentassertions.com/), these are 2 of my favorite tools for testing.

After writing the test and watching it fail we can fill in the blanks and end up with a solution like the following.

```csharp
public static class EnumerableCombine
{
    public static IEnumerable<T> Combine<T>(IEnumerable<T> one, IEnumerable<T> two)
    {
        return Enumerable.Empty<T>();
    }
}
```

## The Simplest Approach

The next step is to start feeding some data to our method and assert that it comes back as we expect. So let's get two int arrays and fill them with 3 items each and pass them along to our method.

```csharp
[Fact]
public void CombiningTwoSortedIntegerArraysReturnsCombinedAndSortedEnumerable()
{
    var input1 = new[] { 0, 2, 4 };
    var input2 = new[] { 1, 3, 5 };

    var result = EnumerableCombine.Combine(input1, input2);

    result.Should().Equal(0, 1, 2, 3, 4, 5);
}
```

After we've seen our test fail we'll implement the simplest approach which is to embrace the power of [Linq](https://docs.microsoft.com/en-us/dotnet/csharp/programming-guide/concepts/linq/) and concatenate both enumerables and order them.

```csharp
public static class EnumerableCombine
{
    public static IEnumerable<T> Combine<T>(IEnumerable<T> one, IEnumerable<T> two)
    {
        return one.Concat(two)
                    .OrderBy(x => x);
    }
}
```

One of the best things about Linq is how easy it is to read and reason about.

After we've seen this pass we also might also want to write extra tests around the method to verify that we'll get duplicates in order when combining them together.

```csharp
[Fact]
public void CombiningTwoSortedIntegerArraysWithDuplicatesReturnsCombinedAndSortedEnumerable()
{
    var input1 = new[] { 1, 2, 3 };
    var input2 = new[] { 1, 2, 3 };

    var result = EnumerableCombine.Combine(input1, input2);

    result.Should().Equal(1, 1, 2, 2, 3, 3);
}
```

We can also write tests for when `input1` and `input2` would be empty.

```csharp
[Fact]
public void CombiningInput1WithEmptyEnumerableOfIntReturnsInput1()
{
    var input1 = new[] { 1, 2, 3 };
    var input2 = Enumerable.Empty<int>();

    var result = EnumerableCombine.CombineApproach2(input1, input2);

    result.Should().Equal(input1);
}

[Fact]
public void CombiningInput2WithEmptyEnumerableOfIntReturnsInput2()
{
    var input1 = Enumerable.Empty<int>();
    var input2 = new[] { 1, 2, 3 };

    var result = EnumerableCombine.CombineApproach2(input1, input2);

    result.Should().Equal(input2);
}
```

## Order By with Generics?

With our method being a generic you're most likely wondered how is Linq comparing the values for sorting the arrays? It's actually using the default comparer for the generic type that we pass in. We can fetch this ourselves by calling the following.

```csharp
var comparer = Comparer<int>.Default;
```

This `comparer` has a `int Compare(T x, T y)` method that when called with 2 values returns the following result:

| Value             | Meaning                 |
|-------------------|-------------------------|
| Less than zero    | `x` is less than `y`    |
| Zero              | `x` equals `y`          |
| Greater than zero | `x` is greater than `y` |

Lots of types throughout the .NET Framework have comparers, however, if we use our own type we'll have to create a comparer so our function works correctly.

So let's start by writing another failing test, for this test we're going to create our own type of `SquareBox` which will have a single int size property and we want to be able to combined a few of these together and get a result with our Combine method.

```csharp
public class SquareBox
{
    public SquareBox(int size)
    {
        Size = size;
    }

    public int Size { get; }
}

[Fact]
public void CombiningTwoSortedSquareBoxArraysReturnsCombinedAndSortedSquareBoxes()
{
    var input1 = new[] { new SquareBox(1), new SquareBox(3) };
    var input2 = new[] { new SquareBox(1), new SquareBox(2) };

    var result = EnumerableCombine.Combine(input1, input2);

    result.Select(x => x.Size)
        .Should().Equal(1, 1, 2, 3);
}
```

This test will fail with the following exception.
```text
System.InvalidOperationException
Failed to compare two elements in the array.
```
However there's a inner exception which has the full details what went wrong.
```text
System.ArgumentException
At least one object must implement IComparable.
```

This is because the default object comparer needs our objects to implement the `IComparable` interface.

So let's get this test passing by implementing the `IComparable` on our `SquareBox`. For simplicity we'll just delegate our `CompareTo` method straight on to the `CompareTo` method of the `Size` property.

```csharp
public class SquareBox : IComparable<SquareBox>
{
    public SquareBox(int size)
        => Size = size;

    public int Size { get; }

    public int CompareTo(SquareBox other)
        => Size.CompareTo(other.Size);
}
```

Now we've got that final test passing, we should be fairly confident that our `Combine` method will work with any set of generics.

## Alternative Technique

The Linq approach which we have at the moment is nice, clean and readable. however, with any abstraction we don't really know what it's doing under the covers, looking at how the statements are layed out. We first concatenating the two enumerables then it looks like we are going over the whole enumerable again and ordering it.

We might want to try to optimise our approach for performance as we already know that both enumerables are already sorted before they get passed on to our function.

What we can do is enumerate both of our enumerables one at a time and compare each value and yielding each result back one at a time.

```csharp
public static class EnumerableCombine
{
    public static IEnumerable<T> Combine<T>(IEnumerable<T> one, IEnumerable<T> two)
    {
        var comparer = Comparer<T>.Default;
        using var enumeratorOne = one.GetEnumerator();
        using var enumeratorTwo = two.GetEnumerator();

        var moreOne = enumeratorOne.MoveNext();
        var moreTwo = enumeratorTwo.MoveNext();
        
        while (moreOne && moreTwo)
        {
            var compare = comparer.Compare(enumeratorOne.Current, enumeratorTwo.Current);
            if (compare <= 0)
            {
                yield return enumeratorOne.Current;
                moreOne = enumeratorOne.MoveNext();
            }
            else
            {
                yield return enumeratorTwo.Current;
                moreTwo = enumeratorTwo.MoveNext();
            }

        }

        if (moreOne | moreTwo)
        {
            var finalEnumerator = moreOne ? enumeratorOne : enumeratorTwo;

            yield return finalEnumerator.Current;
            while (finalEnumerator.MoveNext())
            {
                yield return finalEnumerator.Current;
            }
        }
    }
}
```

As you can see the complexity of our code has increased dramatically, however, all our tests are still passing.

## Comparing the Techniques

Now we have two techniques, and we are only assuming that the alternative to the Linq approach is faster. However, we can take advantage of [BenchmarkDotNet](https://benchmarkdotnet.org) to show us if our hand crafted approach is actually faster and more efficient.

To get started we can install the BenchmarkDotNet global tool using the dotnet CLI.

```bash
dotnet tool install -g BenchmarkDotNet.Tool
```

We'll then need to create our class to encapsulate our benchmarks to compare our two approaches.

```csharp
[SimpleJob(RuntimeMoniker.NetCoreApp31)]
public class CombineApproach1VsCombineApproach2
{
    private int[] _input1;
    private int[] _input2;

    [GlobalSetup]
    public void Setup()
    {
        _input1 = Enumerable.Range(0, 100000).ToArray();
        _input2 = Enumerable.Range(50000, 200000).ToArray();
    }

    [Benchmark]
    public int[] LinqApproach1()
        => EnumerableCombine.CombineApproach1(_input1, _input2).ToArray();

    [Benchmark]
    public int[] ManualCodedApproach2()
        => EnumerableCombine.CombineApproach2(_input1, _input2).ToArray();
}

public static class EnumerableCombine
{
    public static IEnumerable<T> CombineApproach1<T>(IEnumerable<T> one, IEnumerable<T> two)
    {
        return one.Concat(two)
            .OrderBy(x => x);
    }
    public static IEnumerable<T> CombineApproach2<T>(IEnumerable<T> one, IEnumerable<T> two)
    {
        var comparer = Comparer<T>.Default;

        using var enumeratorOne = one.GetEnumerator();
        using var enumeratorTwo = two.GetEnumerator();

        var moreOne = enumeratorOne.MoveNext();
        var moreTwo = enumeratorTwo.MoveNext();

        while (moreOne && moreTwo)
        {
            var compare = comparer.Compare(enumeratorOne.Current, enumeratorTwo.Current);
            if (compare <= 0)
            {
                yield return enumeratorOne.Current;
                moreOne = enumeratorOne.MoveNext();
            }
            else
            {
                yield return enumeratorTwo.Current;
                moreTwo = enumeratorTwo.MoveNext();
            }

        }

        if (moreOne | moreTwo)
        {
            var finalEnumerator = moreOne ? enumeratorOne : enumeratorTwo;

            yield return finalEnumerator.Current;
            while (finalEnumerator.MoveNext())
            {
                yield return finalEnumerator.Current;
            }
        }
    }
}
```

Now if we build our project in release mode and run the benchmark tool with the following command.

```bash
dotnet benchmark CombineEnumerables.dll
```

We'll get some results that look like the following

|               Method |      Mean |     Error |    StdDev |
|--------------------- |----------:|----------:|----------:|
|        LinqApproach1 | 74.667 ms | 1.1276 ms | 0.9416 ms |
| ManualCodedApproach2 |  6.349 ms | 0.1258 ms | 0.2597 ms |

As you can see our manually coded approach is **1176% faster**, That's amazing eh!?

## Does it Really Matter?

As we've noted our manually coded approach is 1175% faster, which as a percentage is a lot! However, the speed that it takes to execute our method with large amount of data is still significantly small with a mean of ~74ms. If you're writing a standard business application, you most likely won't even notice the speed difference, in this context I'd would value the readability of the Linq statement over the speed of execution. However, if you're building a library that will be consumed by many different clients that have different performance requirements you may value the performance gains.

On another side note when performance tuning your code, ensure you have adequate amount of test coverage to safeguard you against any broken functionality while tuning your code.