---
layout: post
title: Azure Functions with Visual Studio 2017 15.3
categories:
tags: [Azure Functions, Visual Studio]
description: How to get started developing and debugging Azure Functions within Visual Studio
comments: true
---

# Visual Studio and Azure Functions

Azure functions are now a first class citizen within Azure development workload in the Visual Studio 2017 15.3 onwards. Below are the steps on getting setup with running Azure functions locally using Visual Studio.

## Installing Visual Studio 2017 15.3

As of writing this article the latest version of VS 2017 15.3 is Preview 2, this can be downloaded directly from the [Visual Studio Preview Download Site](https://www.visualstudio.com/vs/preview/).

Once downloaded and run, within the installer select the _Azure Development_ under the _Workloads_ tab. The _Azure Development_ workload includes the Azure Functions for Visual Studio. 

![visual-studio-installer]

## Updating Visual Studio Extensions

Now we have installed Visual Studio you will notice that when you try to create a new _Azure Functions Project_ It does not exist.

![visual-studio-new-project-1]

If you have got a keen eye you might have notice that there was a notification when you first opened visual studio. Clicking on the Flag pops open the notifications window which tells us _An Update to "Azure Functions and Web Job Tools" is available_.

![visual-studio-notification]

Now if we click on the notification this will bring up the _Extensions and Updates_ dialog which will show us we have some updates for the Azure Functions extension. However if you have missed or just dismissed the notification, you can get to the Extensions and Updates dialog by following _Tools_ -> _Extensions and Updates..._ from the menu bar.

![visual-studio-extensions-and-updates]

Once we click update we will then presented with a VSIX window to confirm the changes, accepting these will then continue with the update.

![vsix-installer-1]

![vsix-installer-2]

## Creating an Azure Function App

Now that we have everything updated you will notice that _Azure Functions_ project is now displayed under the _Visual C# - Cloud_ group.

![visual-studio-new-project-2]

Selecting this project sets up a basic project to get started with.

![visual-studio-solution-explorer]

Pressing F5 will now start up the _Azure Functions CLI_ and put Visual Studio in to debug mode.

![azure-functions-cli]

## Start creating functions locally

We have covered just setting up Visual Studio for developing Azure Functions, now it is up to you to start creating your own bespoke functions!

[visual-studio-installer]: /assets/posts/2017-08-18-azure-functions-with-visual-studio-2017-15-3-release/visual-studio-installer.png "Installing Visual Studio 2017 15.3 Preview 2​​"

[visual-studio-1]: /assets/posts/2017-08-18-azure-functions-with-visual-studio-2017-15-3-release/visual-studio-1.png "Visual Studio 2017 15.3 Preview 2"

[visual-studio-new-project-1]: /assets/posts/2017-08-18-azure-functions-with-visual-studio-2017-15-3-release/visual-studio-new-project-1.png "Visual Studio - New Project Dialog"

[visual-studio-notification]: /assets/posts/2017-08-18-azure-functions-with-visual-studio-2017-15-3-release/visual-studio-notification.png "Visual Studio Notification"

[visual-studio-extensions-and-updates]: /assets/posts/2017-08-18-azure-functions-with-visual-studio-2017-15-3-release/visual-studio-extensions-and-updates.png "Visual Studio Extentions and Updates"

[vsix-installer-1]: /assets/posts/2017-08-18-azure-functions-with-visual-studio-2017-15-3-release/vsix-installer-1.png "Visual Studio VSIX Installer"

[vsix-installer-2]: /assets/posts/2017-08-18-azure-functions-with-visual-studio-2017-15-3-release/vsix-installer-2.png "Visual Studio VSIX Installer"

[visual-studio-new-project-2]: /assets/posts/2017-08-18-azure-functions-with-visual-studio-2017-15-3-release/visual-studio-new-project-2.png "Visual Studio - New Project Dialog"

[visual-studio-solution-explorer]: /assets/posts/2017-08-18-azure-functions-with-visual-studio-2017-15-3-release/visual-studio-solution-explorer.png "Visual Studio Solution Explorer"

[azure-functions-cli]: /assets/posts/2017-08-18-azure-functions-with-visual-studio-2017-15-3-release/azure-functions-cli.png "Azure Functions CLI"