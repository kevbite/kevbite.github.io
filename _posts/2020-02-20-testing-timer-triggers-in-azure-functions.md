---
layout: post
title: Testing timer triggers in Azure Functions
categories:
tags: [Azure Functions, .NET, C#]
description: How to trigger off a Azure Functions timer trigger function for testing
comments: true
---

One of the great things about Azure Functions is being able to setup a function that can be scheduled to execute periodically without having to setup something to manage the scheduling. There are products like [HangFire](https://www.hangfire.io/) and [Quarz.NET](https://www.quartz-scheduler.net/) that help with this, but these still require you to manage the backing persistent and all the plumbing before you get start. These products are great and also give you an insight of what has been running but Azure Functions highly accelerates getting your app to production.

## The Azure Timer Trigger

The Azure timer trigger is pretty simple, say that we want to call a HTTP endpoint with some data every morning at 8:00am, we would create some code like below.

```csharp
public static class SendDataFunction
{
    private static HttpClient _client = new HttpClient();

    [FunctionName("SendDataFunction")]
    public static async Task Run([TimerTrigger("0 0 8 * * *")]TimerInfo myTimer, ILogger log)
    {
        await _client.PostAsync("http://requestbin.net/r/1l5v3y41", new StringContent("Hello"));
    }
}
```

The `0 0 8 * * *` string argument of `TimerTrigger` is a [cron expression](https://en.wikipedia.org/wiki/Cron) that tells the runtime to call this function at 8:00am every morning.

## Testing the Timer Trigger

As you can imagine waiting until 8:00am every morning would mean you could only test this function once a day, this isn't ideal so there is a better way.

What we can do is make a http request to the admin endpoint and pass in the function in the uri and just a null input body.

Below is an example http request using [VS Code](https://code.visualstudio.com/) and the [REST Client](https://marketplace.visualstudio.com/items?itemName=humao.rest-client) extension.

```text
POST http://localhost:7071/admin/functions/SendDataFunction
Content-Type: application/json

{
    "input": null
}
```

We can also pull out the function name and the host and port in to variables.
{% raw %}
```text
@function = SendDataFunction
@host = localhost:7071

POST http://{{host}}/admin/functions/{{function}}
Content-Type: application/json

{
    "input": null
}
```
{% endraw %}

Now if we execute the request we will get the following output in our Azure Functions console.

```shell
[20/02/2020 22:10:39] Host lock lease acquired by instance ID '0000000000000000000000008544E626'.
[20/02/2020 22:10:39] Executing HTTP request: {
[20/02/2020 22:10:39]   "requestId": "9432ad7c-d6b1-48de-8524-cb7586bcd32a",
[20/02/2020 22:10:39]   "method": "POST",
[20/02/2020 22:10:39]   "uri": "/admin/functions/SendDataFunction"
[20/02/2020 22:10:39] }
[20/02/2020 22:10:40] Executed HTTP request: {
[20/02/2020 22:10:40]   "requestId": "9432ad7c-d6b1-48de-8524-cb7586bcd32a",
[20/02/2020 22:10:40]   "method": "POST",
[20/02/2020 22:10:40]   "uri": "/admin/functions/SendDataFunction",
[20/02/2020 22:10:40]   "identities": [
[20/02/2020 22:10:40]     {
[20/02/2020 22:10:40]       "type": "WebJobsAuthLevel",
[20/02/2020 22:10:40]       "level": "Admin"
[20/02/2020 22:10:40]     },
[20/02/2020 22:10:40]     {
[20/02/2020 22:10:40]       "type": "WebJobsAuthLevel",
[20/02/2020 22:10:40]       "level": "Admin"
[20/02/2020 22:10:40]     }
[20/02/2020 22:10:40]   ],
[20/02/2020 22:10:40]   "status": 202,
[20/02/2020 22:10:40]   "duration": 1238
[20/02/2020 22:10:40] }
[20/02/2020 22:10:41] Executing 'SendDataFunction' (Reason='This function was programmatically called via the host APIs.', Id=01d35159-9266-4a2b-8cf2-592f208ba3d8)
[20/02/2020 22:10:41] Executed 'SendDataFunction' (Succeeded, Id=01d35159-9266-4a2b-8cf2-592f208ba3d8)
```

As you can see it has accepted the http POST request we sent and then went on to call our function with a reason. Perfect for testing!


## Testing in Azure?

You're now wondering, you've tested your timer trigger function locally and you've pushed it up to azure to a test/qa instance, and you want to manually run the timer trigger?

Now if we just change the `@host` variable to our deployed function app (in my instance `functionapp120200220100513.azurewebsites.net`).
{% raw %}
```
@function = SendDataFunction
@host = functionapp120200220100513.azurewebsites.net

POST https://{{host}}/admin/functions/{{function}}
Content-Type: application/json

{
    "input": null
}
```
{% endraw %}

And execute the http request we'll get an `401` Unauthorized response back from the API, this is because once the Azure Functions app is deployed we don't want anyone who has access to an internet connection to go trigger off any of our functions.

```
HTTP/1.1 401 Unauthorized
WWW-Authenticate: Bearer
Date: Thu, 20 Feb 2020 22:42:44 GMT
Connection: close
Content-Length: 0
```

These functions are now secured using host keys, and we can find these keys in the azure portal by navigating to the function app expanding our functions and clicking on manage.
![manage-azure-function]

If we copy the value for the `_master` key we can add this to a `x-functions-key` header on our request.
{% raw %}
```text
@function = SendDataFunction
@host = functionapp120200220100513.azurewebsites.net
@functionsKey = STX64cqIdG9Ic5rRDTs4fVgVvu2WTFUaEat9Vj3phpIE8dHNiSe9Ow==
POST https://{{host}}/admin/functions/{{function}}
Content-Type: application/json
x-functions-key: {{functionsKey}}

{
    "input": null
}
```
{% endraw %}

Now if we execute the http request again we will get a `202` Accepted.


```text
HTTP/1.1 202 Accepted
Date: Thu, 20 Feb 2020 22:59:29 GMT
Connection: close
Content-Length: 0
```

[manage-azure-function]: /assets/posts/2020-02-20-testing-timer-triggers-in-azure-functions\manage-azure-function.png "Manage Azure Function​"
