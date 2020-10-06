---
layout: post
title: Testing workflow activities
categories:
tags: [.NET, C#, WF]
description: Example of how to unit test WF activities
comments: true
---

## It's Simple!
When we have all the data upfront that synchronous activity requires, we can just test it using the built-in `WorkflowInvoker`:

```csharp
[Test]
public void MathActivityReturnsCorrectResult()
{
    // Arrange.
    var workflow = new WorkflowInvoker(new MathsActivity() {Number1 = 4, Number2 = 3, SelectedOperator = Operator.Add});

    // Act.
    var outputs = workflow.Invoke();

    // Assert.
    Assert.AreEqual(7, outputs["Result"]);
}
```

## Well it was...

The problem comes when we require some data that is not present at the time of the activity executing, thus we have to wait for the data.
If we change our MathsActivity so that it needs to wait for its selected operator (probably some user intervention) before it can continue using workflow bookmarks:

```csharp
public sealed class MathsActivity : NativeActivity<decimal>
{
    protected override bool CanInduceIdle
    {
        get { return true; }
    }

    [RequiredArgument]
    public InArgument<decimal> Number1 { get; set; }

    [RequiredArgument]
    public InArgument<decimal> Number2 { get; set; }

    public InArgument<Operator?> SelectedOperator { get; set; }

    protected override void Execute(NativeActivityContext context)
    {
        if (SelectedOperator.Get(context).HasValue)
        {
            var result = DoMaths(context);
            this.Result.Set(context, result);
        }
        else
        {
            context.CreateBookmark("BookmarkName", OnMathematicsOperatorEntered);
        }
    }

    private void OnMathematicsOperatorEntered(NativeActivityContext context, Bookmark bookmark, object value)
    {
        var op = (Operator)value;

        this.SelectedOperator.Set(context, op);

        var result = DoMaths(context);
        this.Result.Set(context, result);
    }

    private decimal DoMaths(NativeActivityContext context)
    {
        decimal number1 = this.Number1.Get(context);
        decimal number2 = this.Number2.Get(context);

        switch (this.SelectedOperator.Get(context))
        {
            case Operator.Add:
                return number1 + number2;
            case Operator.Subtract:
                return number1 - number2;
            default:
                throw new NotImplementedException();
        }
    }
}
```

When we start to write tests using the WorkflowInvoker class you'll notice that once it hits the Invoke call the test just hangs forever (well until NUnit or MSTest times out).

```csharp
[Test]
public void MathActivityReturnsCorrectResult()
{
    // Arrange.
    var workflow = new WorkflowInvoker(new MathsActivity() {Number1 = 4, Number2 = 3});

    // Act.
    var result = workflow.Invoke(); // Hangs on this statement.

    // Assert.
    Assert.AreEqual(7, result["Result"]);
}
```

## Everything is testable though...
To allow us to test this activity we now need to use the `WorkflowApplication` object, this obviously makes things very complicated as the `WorkflowApplication` runs the whole workflow asynchronously instead of synchronously.
We would have to have our test waiting on a signal which is raised from one of the many events that the `WorkflowApplication` raises, then we would have to poke around in the `WorkflowApplication` object to find the data which we are asserting on.
**Frankly it's just a lot of hard work.**

But thankfully there is a nice NuGet package that wraps all this functionality up into a nice testing class.

So if we start by downloading the nuget package from [Microsoft.Activities.UnitTesting](http://www.nuget.org/packages/Microsoft.Activities.UnitTesting "Microsoft.Activities.UnitTesting").

```powershell
PM> Install-Package Microsoft.Activities.UnitTesting
```

We can now write a test that checks that we created the bookmark (pause) when there is no SelectedOperator:

```csharp
[Test]
public void MathActivitySetsBookmarkWhenSelectedOperatorNotSet()
{
	// Arrange.
	var workflow = WorkflowApplicationTest.Create(new MathsActivity() {Number1 = 4, Number2 = 3});

	// Act.
	workflow.TestActivity();
	
	// Assert.
	Assert.IsTrue(workflow.WaitForIdleEvent());
	Assert.IsTrue(workflow.Bookmarks.Contains("BookmarkName"));
}
```

Even better we can even check the resumption of the bookmark:

```csharp
[Test]
public void MathActivitySetsBookmarkWhenSelectedOperatorNotSet()
{
  // Arrange.
  var workflow = WorkflowApplicationTest.Create(new MathsActivity() {Number1 = 4, Number2 = 3});
  
  // Act.
  workflow.TestActivity();
  
  // Asserts.
  
  // Check that the workflow went in to idle when hasn't got all the data required.
  Assert.IsTrue(workflow.WaitForIdleEvent());
  
  // Check that we set the correct bookmark.
  Assert.True(workflow.Bookmarks.Contains("BookmarkName"));
  
  // Resume bookmark and check the status.
  Assert.AreEqual(BookmarkResumptionResult.Success,  workflow.TestWorkflowApplication.ResumeBookmark("BookmarkName", Operator.Add));
  
  // Wait until complete and check it completed.
  Assert.IsTrue(workflow.WaitForCompletedEvent());
  
  // Check the result of the activity.
  Assert.AreEqual(7, workflow.Results.Output["Result"]);
}
```

As you can see this wraps up the workflow application nicely.
