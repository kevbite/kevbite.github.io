---
layout: post
title: Simplifying Branching Logic in Cake Builds
categories:
tags: [CI, CakeBuild, C#]
description: Tips for simplifying your cake files.
comments: true
---

With our application code we always strive to write code that is readable and maintainable. However, sometimes our build scripts are left behind, they should be no exception to this rule. We also often write build scripts and they get left untouched for months or even years before someone has to change them, so it's always ideal to make them as maintainable as possible for future changes. It's also one of the reasons I moved from [FAKE](https://fake.build/) to [Cake](https://cakebuild.net/), so that I can easily understand them as I use C# daily.

## Branching Logic

Our build scripts have lots of different types of branching logic in them, for example; we do different logic depending on the environment we're running in, we check configuration before configuring things (such as setting up a NuGet feed), we only run certain parts of the build script based on environment, and they're loads of more way we use branching logic.

### If statements

One of the most natural ways people do branching in Cake scripts is just using standard C# `if` statements. Below is a snippet of a `build.cake` file using `if` statements for all the conditional branching:

```csharp
var target = Argument("target", "Default");
var slackApiKey = EnvironmentVariable("slack_api_key");
var branch = EnvironmentVariable("APPVEYOR_REPO_BRANCH");
var isWindows = true;

Task("Add-NuGet-Feed")
  .Does(() =>
{
  if(!NuGetHasSource("https://somedomain/nuget/v3/index.json")){
      Information("Adding NuGet Source...");
  }
});

Task("NuGet-Restore")
  .IsDependentOn("Add-NuGet-Feed")
  .Does(() =>
{
  Information("Restoring Packages...");
});

Task("Build")
  .IsDependentOn("NuGet-Restore")
  .Does(() =>
{
  if(isWindows)
  {
    Information("Building for Windows...");
  }
  else
  {
    Information("Building for Linux...");
  }
});

Task("Package")
  .IsDependentOn("Build")
  .Does(() =>
{
  Information("Packing...");
});

Task("Deploy")
  .IsDependentOn("Package")
  .Does(() =>
{
  if(branch == "master")
  {
    Information("Deploying...");
  }
});

Task("Notify-Slack")
  .IsDependentOn("Deploy")
  .Does(() =>
{
  if(!string.IsNullOrEmpty(slackApiKey))
  {
    Information("Notifying Slack...");
  }
});

Task("Default")
  .IsDependentOn("Notify-Slack");

RunTarget(target);

```

This works totally fine but you will notice straight away that the output looks a bit strange as all the _Tasks_ are run even if they did no work.

![powershell-build-ps1-1]

### Criteria

One of the feature of cake is to give a _Task_ a criteria, only if the criteria is met then the task run. Using criterions  is an excellent way to eliminate our `if` statements in our `build.cake` file. Given our example above we can change the `build.cake` file to the following:

```csharp
var target = Argument("target", "Default");
var slackApiKey = EnvironmentVariable("slack_api_key");
var branch = EnvironmentVariable("APPVEYOR_REPO_BRANCH");
var isWindows = true;

Task("Add-NuGet-Feed")
  .WithCriteria(!NuGetHasSource("https://somedomain/nuget/v3/index.json"))
  .Does(() =>
{
  Information("Adding NuGet Source...");
});

Task("NuGet-Restore")
  .IsDependentOn("Add-NuGet-Feed")
  .Does(() =>
{
  Information("Restoring Packages...");
});

Task("Build")
  .IsDependentOn("NuGet-Restore")
  .Does(() =>
{
  if(isWindows)
  {
    Information("Building for Windows...");
  }
  else
  {
    Information("Building for Linux...");
  }
});

Task("Package")
  .IsDependentOn("Build")
  .Does(() =>
{
  Information("Packing...");
});

Task("Deploy")
  .WithCriteria(branch == "master")
  .IsDependentOn("Package")
  .Does(() =>
{
  Information("Deploying...");
});

Task("Notify-Slack")
  .WithCriteria(!string.IsNullOrEmpty(slackApiKey))
  .IsDependentOn("Deploy")
  .Does(() =>
{
  Information("Notifying Slack...");
});

Task("Default")
  .IsDependentOn("Notify-Slack");

RunTarget(target);

```
Now if we run the the build script we get useful log messages telling us that our `Deploy` and `Notify-Slack` tasks have been skipped:

![powershell-build-ps1-2]

However, we've still got our `if(isWindows)` condition still in our script because we execute 2 code blocks depending on if `isWindows` is `true` or `false`. For our build task we can split it down in to 2 other tasks, a `Build-Windows` and a `Build-Linux` and then just have our `Build` task dependent on these 2 tasks:

```csharp
Task("Build-Windows")
  .WithCriteria(isWindows)
  .IsDependentOn("NuGet-Restore")
  .Does(() =>
{
  Information("Building for Windows...");
});

Task("Build-Linux")
  .WithCriteria(!isWindows)
  .IsDependentOn("NuGet-Restore")
  .Does(() =>
{
  Information("Building for Linux...");
});

Task("Build")
  .IsDependentOn("Build-Windows")
  .IsDependentOn("Build-Linux");

```

Now if we run the above we get the following output:

![powershell-build-ps1-3]

As you can see the code is easier to read and the output of the script is substantially more descriptive.

### Watch out

A common mistake when using `WithCriteria` is that the criteria will be set when the task is created (in theory as soon as the script is called). The following shows an example of this:

```csharp
var target = Argument("target", "Default");
var shouldNotify = false;

Task("Important-Task")
  .Does(() =>
{
  Information("Doing something important...");
  shouldNotify = true;
});

Task("Notify")
  .WithCriteria(shouldNotify)
  .IsDependentOn("Important-Task")
  .Does(() =>
{
  Information("Notifying...");
});

Task("Default")
  .IsDependentOn("Notify");

RunTarget(target);
```
![powershell-build-ps1-4]

As you can see we're setting the `shouldNotify` to true in the first task, however the `Notify` task is never run, this is because the boolean is evaluated at creation of the Task.

The alternative to this is to pass in a delegate which will be evaluated when the task is about to be run, thus deferring the evaluation of the `shouldNotify`, for example:

```csharp
Task("Notify")
  .WithCriteria(() => shouldNotify)
  .IsDependentOn("Important-Task")
  .Does(() =>
{
  Information("Notifying...");
});
```
![powershell-build-ps1-5]

As you can see above this yield the correct results.


[powershell-build-ps1-1]: \assets\posts\2019-01-18-simplifying-branching-logic-in-cake-builds\powershell-build-ps1-1.png "build.ps1"

[powershell-build-ps1-2]: \assets\posts\2019-01-18-simplifying-branching-logic-in-cake-builds\powershell-build-ps1-2.png "build.ps1"

[powershell-build-ps1-3]: \assets\posts\2019-01-18-simplifying-branching-logic-in-cake-builds\powershell-build-ps1-3.png "build.ps1"

[powershell-build-ps1-4]: \assets\posts\2019-01-18-simplifying-branching-logic-in-cake-builds\powershell-build-ps1-4.png "build.ps1"

[powershell-build-ps1-5]: \assets\posts\2019-01-18-simplifying-branching-logic-in-cake-builds\powershell-build-ps1-5.png "build.ps1"