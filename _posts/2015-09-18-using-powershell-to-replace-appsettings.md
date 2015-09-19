---
layout: post
title: Using PowerShell to replace appsettings
categories:
tags: [PowerShell, CI, CD, AppVeyor, Deployment]
description: Using PowerShell to replace appsettings with corresponding environment variables
comments: true
---

## Background

This week I've been settings up some of our new automated deployment, we are using [AppVeyor](http://www.appveyor.com/ "AppVeyor") as our continuous intergration and delivery solution which is highly recommended in the .NET open source projects at the moment.

Having used [Octopus Deploy](https://octopusdeploy.com/ "Octopus Deploy") before, I've been used to the ease of being able to replace configuration AppSettings values with environment specific values by just setting up environment variables within the Octopus web portal (see [Configuration files](http://docs.octopusdeploy.com/display/OD/Configuration+files "Configuration files")). I wanted to achieve the same with AppVeyor deployment agents but a quick google proved this wasn't possible out of the box!

## A bit of PowerShell

I always like to keep things nice and modular, so before I even started thinking about how this was going to fit in to the deployment life cycle I knew that I was going to create a small PowerShell script to replace our AppSettings.

Having not used PowerShell much before and only knowing the basics, I actually found it pretty easy to throw together a script.

The `replace_appsettings.ps1` script below loads up a given config file, navigates within the xml to the `appSettings` section, loops around each key and trys to find matching environment variables, if successful then replaces the value, after all we've searched every setting then the config is then overwritten.

```powershell
# replace_appsettings.ps1
param([Parameter(Mandatory=$True)][string]$config)

$configPath = "$env:APPLICATION_PATH\$config"

Write-Output "Loading config file from $configPath"
$xml = [xml](Get-Content $configPath)

ForEach($add in $xml.configuration.appSettings.add)
{
	Write-Output "Processing AppSetting key $($add.key)"
	
	$matchingEnvVar = [Environment]::GetEnvironmentVariable($add.key)

	if($matchingEnvVar)
	{
		Write-Output "Found matching environment variable for key: $($add.key)"
		Write-Output "Replacing value $($add.value)  with $matchingEnvVar"

		$add.value = $matchingEnvVar
	}
}

$xml.Save($configPath)
```

## Plugging in to AppVeyor Deployment Agent

AppVeyor is very customisable, most of their build and deployment solutions allow you to plugin their pipeline with a custom command or PowerShell script.

Within the AppVeyor deployment agent there are 2 scripts that allow custom configuration, both are required to be placed within the root folder of the deployable artifact. The first script is `before-deploy.ps1` which is executed after the artifact is downloaded but before unzipping the artifact or executing any appveyor deployment stages (such as IIS Website or Windows Service). The second script is `deploy.ps1` which is executed after all the deployment stages have excuted or if you've only selected to deploy a windows application, it can be used for writing your own deploy scripts.

To achieve replacing the values within the config files I needed the artifacts to already be unzipped so I could edit the app.config file thus we needed to add/edit our `deploy.ps1` file.

Seeing as we pulled out our script that does all the work, our `deploy.ps1` is now made really simple:

```powershell
# deploy.ps1

.\replace_appsettings.ps1 -config "MyAwesomeApp.exe.config"
```

## AppVeyor deployment environment variables

To allow the agent to alter our app settings we need to setup some environment variables. The environment variables for deployment can be found on the settings tab inside an a deployment agent environment:

![appveyor environment variables for deployment](/assets/posts/2015-09-18-using-powershell-to-replace-appsettings/appveyor-environment-variables-for-deployment.png)

Now we've added in our environment variables, as long as they match the same keys as our app settings they'll get replaced.

## We're ready to go

Fire off a deploy and see how it all goes!