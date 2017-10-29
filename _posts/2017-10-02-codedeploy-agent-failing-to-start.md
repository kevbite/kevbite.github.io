---
layout: post
title: CodeDeploy Agent Failing To Start
categories:
tags: [AWS, Windows, Services, CodeDeploy]
description: How to fix aws CodeDeploy agent when it fails to start
comments: true
---

We recently found ourself baffled with CodeDeploy, It was failing to deploy an application to our EC2 instances hosted within AWS. It seemed that CodeDeploy was failing due to the CodeDeploy agent not being running on the machine after a instance had launched.

## Is the Agent running?

With our debugging head on we remotely connected on to the boxes and run the following powershell commands to check if the service was up and running:

```powershell
PS> Get-Service -Name codedeployagent

Status   Name               DisplayName
------   ----               -----------
Stopped  codedeployagent    CodeDeploy Host Agent Service
```

We saw straight away that the service for some reason was stopped, We then tried to start the service manually and check it's status a few times to see if it kept running.

```powershell
PS> Start-Service -Name codedeployagent
PS> Get-Service -Name codedeployagent

Status   Name               DisplayName
------   ----               -----------
Running  codedeployagent    CodeDeploy Host Agent Service
```

Manually starting it seems to do the trick, but why was it failing at startup?

## Windows System Logs

We then dig a little deeper as manually starting the service each time we wanted to launch an instance is not scalable. Checking the windows system logs showed us that the service failed to start with the following description:

>A timeout was reached (60000 milliseconds) while waiting for the CodeDeploy Host Agent Service service to connect.

![windows-event-viewer]

It was now obvious to us that the service was taking over 1 minute to start thus making windows services terminate the service from starting. We just needed to know what was taking so long for the service to start.

## CodeDeploy Host Agent

A good place to start for finding out what happening within the CodeDeploy agent is looking at the agents logs. The logs can be found within `C:\ProgramData\Amazon\CodeDeploy\log` directory.

Sadly we discovered that the CodeDeploy agent had not written any logs within the 1 minute while it was starting up.

## Extending the service startup time

We could not get to the root cause of why the service was not starting within the default service start time so we ended up increasing the start time to 2 minutes instead. We did this by just dropping in to powershell and running the following command:

```powershell
New-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control" -Name "ServicesPipeTimeout" -Value 120000 -PropertyType DWORD -Force

ServicesPipeTimeout : 120000
PSPath              : Microsoft.PowerShell.Core\Registry::HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Control
PSParentPath        : Microsoft.PowerShell.Core\Registry::HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet
PSChildName         : Control
PSDrive             : HKLM
PSProvider          : Microsoft.PowerShell.Core\Registry
```

This can also be done in the `regedit.exe` GUI.

## What now?

We never really got to the bottom of why the service was not starting in a timely fashion. We imagine it was due to the instance size just taking a little longer due to it's smaller compute power, the work around however works seamlessly.


[windows-event-viewer]: \assets\posts\2017-10-02-codedeploy-agent-failing-to-start\windows-event-viewer.png "Windows Event Viewer"