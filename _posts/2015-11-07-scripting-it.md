---
layout: post
title: Script It
categories:
tags: [Scripting, Deployment, PowerShell, Code Quality, Learning]
description: Should we be scripting everything? Yes?
comments: true
---

## Script what?

I've always been an advocate for scripting as much as humanly possible, there are many reasons behind this and this is one of the reasons for writing this post today.

To start with I see scripts as code and being a developer I obviously like code, the other half of that being as a developer I lack the excitement of creating documents full of pictures of install dialogs and text that just tell the user to fill in certain fields and click next 6 times. But why would I get excited over that when I could give the user 2 lines of code that will automate the whole process?

```powershell

(new-object net.webclient).DownloadFile('http://www.appveyor.com/downloads/AppveyorDeploymentAgent.msi', 'AppveyorDeploymentAgent.msi')

msiexec /i AppveyorDeploymentAgent.msi /quiet /qn /norestart /log install.log ENVIRONMENT_ACCESS_KEY=abc DEPLOYMENT_GROUP=def

```

The above script shows how simple it is to download the AppVeyor deployment agent and install it without any user intervention. If you're manually installing the AppVeyor deployment agent it's a 5 screen wizard with 1 tick box and 2 text input boxes to fill in!

## Why?

So every time I go over scripting with people the first thing that people say is that it's more effort and it won't benefit them, but is it really more effort? If you're planning to set up the same thing more than once, say on a testing/production environment or multiple developer machines then writing a small script has most likely saved you half the time as running through a load of setup dialogs.

Stepping back from the amount of effort it would take you to write some scripts there are loads of other great benefits of scripting too.

### Reproducible

Scripts allow an easy way to get back to a certain state, you'll be able to run a script on another machine and it will produce the same outcome and if there is an issue it will most likely be an environmental issue.

### Versioning

As I said above scripts are just code at the end of the day so why not version your scripts? Versioning your scripts will allow you to keep track of what's been run before giving you a more concise way of getting back to the current state. This kind of complements my first point on being reproducible.

### Source Control

Keep track of what you've written, store all your scripts inside your preferred source control that way you'll have a full history of why the script was changed over time.

### Code Review

It's just code, get your team to review it and make sure you're not doing anything crazy. I encourage the use of pull requests, include as many people as possible in your team it's good practice to keep everyone in your team involved with what's going off.

Code reviews are always good for sharing knowledge between a team, there may be a better way or a more efficient way of achieving your desired outcome. Just don't take feedback too defensively and always keep an open mind of new ways to a solution, it's better to learn something new than keep doing the same old ways.

### Automate It

Having a bunch of scripts is halfway to automating what you're trying to achieve, there are tools out there that will couple your scripts together and run them in the correct environments.

### Dependencies

If you require a given dependency then make your script download it, normally you can find mirror download sites that allow you to download a strict version. This way you won't end up with your machines running an assortment of versions.

I find it's actually much easier and quicker to download files using the shell, for PowerShell you can use `Invoke-WebRequest`:

```powershell

Invoke-WebRequest "http://somedomain.com/file.msi" -Outfile "c:\temp\file.msi"

```

### Self Documenting

Your scripts are self-documenting, if you want to know how a machine is set up or what indexes have been applied to a database then all you have to do is read the script that has been run on the boxes. This way you won't get overloaded by excessive documentation that hardly anyone ever reads and most likely will go out of date.
