---
layout: post
title: Using Local APIs with Cordova
categories:
tags: [Cordova, JavaScript, Testing]
description: How to use local APIs when testing and debugging Cordova Apps
comments: true
---

One of the main benefits of using Cordova is the ability to build all your application locally in the browser before even testing it on a real device or emulator. You might already know, but to do this we can just add another platform of `browser` to our Cordova application by executing the following in the shell:

```bash
cordova platform add browser
```

Once this platform is added then we can run our application inside the browser by executing:

```bash
cordova run browser
```

This is great way to test your application as there is even support for the camera within the browser platform!

However, you'll most likely bump in to problems where 3rd party cordova plugins either don't support running in the browser or they run completely different on the device compared to the browser.

## Communicating to APIs

When developing most application we'll need to talk to some type of API to send and receive data, when developing it locally we might host a mocked API or have the real API running so that we can debug and test the application while using it. To do this we normally host the API locally on a given port such as `http://localhost:8080`.

However, if we want to test this locally on the device while running the APIs locally then nothing will be listening on port `8080` on `localhost` which will now be your Android or iOS device and straight away you'll get a `Unable to connect to the remote server` error.

## Port forwarding

One of the cool things with Android remote debugger is that it allows [port forwarding](https://developer.chrome.com/devtools/docs/remote-debugging#port-forwarding). To enable port forwarding launch [Chrome](https://www.google.com/chrome/) and open the Developer tools by pressing `Ctrl`+`Shift`+`i`, once open navigate to the `Remote devices` tab a the bottom section of the Developer tool.

![developer-tools-remote-devices]

Now if we tick the port forwarding box, we'll be able to specify port `8080` gets forwarded to localhost on the current machine.

![port-forwarding]

We can also use the port forwarding to be forward to other destinations, say we're got our machine connected to an internal network we could forward the traffic to `server1.mycompany.local:8080`. This would then route the traffic on the device to a machine running on our local network.

## Wrapping up

As you can see using this simple trick allows you to speed up your development or debugging cycles, so give it a try and see what you think!

[developer-tools-remote-devices]: \assets\posts\2019-08-20-using-local-apis-with-cordova\developer-tools-remote-devices.png "Developer tool, Remote devices"

[port-forwarding]: \assets\posts\2019-08-20-using-local-apis-with-cordova\port-forwarding.png "Developer tool, Port Forwarding"