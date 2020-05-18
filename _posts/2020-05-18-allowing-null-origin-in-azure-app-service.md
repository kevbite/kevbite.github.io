---
layout: post
title: Allowing null origin in Azure App Service
categories:
tags: [Azure, App Service, Web App, CORS]
description: How to allowing null origin in Azure App Services
comments: true
---

Recently we came across an issue within Cordova on iOS when we updated our app to use `WKWebView`, this was in guidance to the following recommendation on the [Apple Developer documentation](https://developer.apple.com/documentation/webkit/wkwebview).

> **Important**
>
> Starting in iOS 8.0 and OS X 10.10, use WKWebView to add web content to your app. Do not use UIWebView or WebView.

Every request that we were sending to our API return the following issue with CORS:

> Origin null is not allowed by Access-Control-Allow-Origin

This was because the `Origin` header from the request was now containing `null` value as previously it never existed.

## Updating our Web App CORS

We've got our APIs hosted in Azure Web Apps, so updating our CORS settings is simply just adding them in to a list in the portal. However, because `null` does not match the pattern of `[HTTP|HTTPS]://[www.]domain.[TLD][:portnumber]` we get an error in the portal.

![azure-invalid-origin]

## Work around

### Azure CLI

There's a couple of work around for this, the simplest approach (if you've got the [Azure CLI](https://docs.microsoft.com/en-us/cli/azure/) installed) is to add an allowed origin with the following command:

```bash
az webapp cors add --allowed-origins null --name MyWebApp --resource-group rg-my-resources
```

This will response with the updated allowed origins.

```json
{
  "allowedOrigins": [
    "null"
  ],
  "supportCredentials": false
}
```

This seems to bypass the validation on the [Azure Portal](https://portal.azure.com), which seems to only be client side validation.

### Azure Resources Explorer

Another way to update the CORS settings is via browsing to Azure Resources Explorer ([resources.azure.com](https://resources.azure.com/)). In the search at the top, search for your web app.

Once selected, navigate down on the tree on the left hand side from your web app, to `config`, then to `web.

![azure-resource-explorer]

Once open, change it to be in Read/Write mode, find the json CORS block.

```json
    "cors": {
      "allowedOrigins": [ ],
      "supportCredentials": false
    }
```

Then update it will a `null` value and save.

```json
    "cors": {
      "allowedOrigins": [ "null" ],
      "supportCredentials": false
    }
```

### Azure Portal

Once we've updated our CORS values via the workarounds, we can pop back in to the Azure Portal and we'll have our `null` as one of our entries.

![azure-web-app-cors]

## Avoid returning "null"

As described in the [w3c](https://w3c.github.io/webappsec-cors-for-developers/#avoid-returning-access-control-allow-origin-null), it's advised not to return `null` as possible allowed CORS value, however, at the time of writing this there is no other work around.

[avoid-returning-access-control-allow-origin-null](https://w3c.github.io/webappsec-cors-for-developers/#avoid-returning-access-control-allow-origin-null)


[azure-invalid-origin]: \assets\posts\2020-05-18-allowing-null-origin-in-azure-app-service/azure-invalid-origin.png "Azure invalid origin"

[azure-resource-explorer]: \assets\posts\2020-05-18-allowing-null-origin-in-azure-app-service/azure-resource-explorer.png "Azure Resource Explorer"

[azure-web-app-cors]: \assets\posts\2020-05-18-allowing-null-origin-in-azure-app-service/azure-web-app-cors.png "Azure WebApp CORS"