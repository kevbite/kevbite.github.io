---
layout: post
title: Configuring private VSTS NuGet feeds with Cake
categories:
tags: [CI, CakeBuild, VSTS, C#]
description: How to configure your CakeBuild scripts to use private VSTS NuGet feeds.
comments: true
---

## Creating a private feed in VSTS

Setting up a private NuGet feed within VSTS is fairly simple. From the left navigation bar, click on the packages icon to go to the packages section of VSTS.

![vsts-packages]

Once we are on the package screen, click the _"New feed"_ link and follow the on screen prompts until completed.

![vsts-create-new-private-nuget-feed]

Now we have our new private feed setup, we can push to it with the normal NuGet push commands.

## Setting up your Cake Build

VSTS unlike AppVeyor will not automatically configure your NuGet sources, if you add a package that is not within the public NuGet.org repository then you'll get an _"Unable to find package"_ error outputted from the console:

```bash
2018-08-03T09:32:59.4378109Z Build FAILED.
2018-08-03T09:32:59.4420400Z        "D:\a\1\s\MyCompany.App.sln" (Restore target) (1) ->
2018-08-03T09:32:59.4420524Z        (Restore target) -> 
2018-08-03T09:32:59.4420729Z          D:\a\1\s\src\MyCompany.App\MyCompany.App.csproj : error NU1101: Unable to find package MyCompany.Wibble. No packages exist with this id in source(s): Microsoft Visual Studio Offline Packages, nuget.org [D:\a\1\s\MyCompany.App.sln]

```

However if you're using [CakeBuild](https://cakebuild.net/) to build your solution you can easily add an extra build setup to configure your NuGet feed.

Let's start off with creating a new task within our `build.cake` file that will check to see if a NuGet source exists, then add it with a password that we will later get VSTS pass in to our script.

```csharp
Task("Add-Private-NuGet-Feed")
    .Does(() =>
{
    var feedSource = "https://mycompany.pkgs.visualstudio.com/_packaging/Internal-NuGet/nuget/v3/index.json";
    
    if (!NuGetHasSource(feedSource))
    {
        var accessToken = EnvironmentVariable("SYSTEM_ACCESSTOKEN")
                            ?? throw new Exception("VSTS System Access Token is required to setup Private NuGet Feed");

        NuGetAddSource("MyCompany-NuGet", feedSource, new NuGetSourcesSettings
            {
                UserName = "VSTS",
                Password = accessToken,
            });
    }
});
```

We will then have to add a dependency to our NuGet restore task to try add the private feed before doing a restore.

```csharp
Task("Restore-NuGet-Packages")
    .IsDependentOn("Add-Private-NuGet-Feed")
    .Does(() =>
{
    DotNetCoreRestore(sln);
});
```

Now if we commit and push the changes to VSTS, then run our build we'll get the following output:

```bash
2018-08-06T17:36:39.3463798Z ========================================
2018-08-06T17:36:39.3463899Z Add-Private-NuGet-Feed
2018-08-06T17:36:39.3464002Z ========================================
2018-08-06T17:36:39.3464111Z Executing task: Add-Private-NuGet-Feed
2018-08-06T17:36:40.0400811Z ##[error]An error occurred when executing task 'Add-Private-NuGet-Feed'.
2018-08-06T17:36:40.0412153Z ##[error]Error: One or more errors occurred.
2018-08-06T17:36:40.0412819Z ##[error]	VSTS System Access Token is required to setup Private NuGet Feed
2018-08-06T17:36:40.1542848Z ##[error]System.Exception: Unexpected exit code 1 returned from tool Cake.exe
```

This is expected as by default VSTS does not pass in the environment variable of `SYSTEM_ACCESSTOKEN`.

## Setting up VSTS OAuth Token

To enable the OAuth AccessToken to be passed in to our script, we need to change the settings of our phase within our agent, We will navigate to the task that are running within VSTS and select the build phase where our Cake script is running, now we will see an option to _"Allow scripts to access OAuth token"_. Enable this option and save and requeue a build.

![vsts-configure-oauth-token]


[vsts-packages]: \assets\posts\2018-08-06-configuring-private-vsts-nuget-feeds-with-cake\vsts-packages.png "VSTS Packages"

[vsts-create-new-private-nuget-feed]: \assets\posts\2018-08-06-configuring-private-vsts-nuget-feeds-with-cake\vsts-create-new-private-nuget-feed.png "Create New Private NuGet Feed"

[vsts-configure-oauth-token]: \assets\posts\2018-08-06-configuring-private-vsts-nuget-feeds-with-cake\vsts-configure-oauth-token.png "Configure OAuth Token"

