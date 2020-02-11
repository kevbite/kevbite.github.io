---
layout: post
title: Adding errors to model state and returning bad request within asp.net core 3.1
categories:
tags: [ASP.NET Core, .NET, C#]
description: How to add errors to the model state and return the same bad request response as the asp.net core 3.1 framework
comments: true
---

Sometimes we just want to add some extra validation to a bound model within the body of the action within a controller, it's the most simplest approach to adding some custom validation to your models without going overboard.

You'd think this would be fairly simple but we'll soon see that it doesn't send the same response as the framework by just calling

```
return BadRequest(ModelState);
```

## Invalid Models

The ASP.NET Core framework is really helpful, most of the handling of invalid models is done for us by the framework.

Take the following code for example.

```csharp
[Route("api/values")]
[ApiController]
public class ValuesController : Controller
{
    // GET: api/values?from=2020-01-01&to=2020-01-31
    [HttpGet]
    public IActionResult Get([FromQuery] GetValuesQueryParameters parameters)
        => Ok(new
            {
                parameters.From,
                parameters.To
            });
    
    public class GetValuesQueryParameters
    {
        [Required] public DateTime? From { get; set; }

        [Required] public DateTime? To { get; set; }
    }
}
```
Our `GetValuesQueryParameters` model has a couple of `[Required]` attributes on it, this tells the framework these are required properties to progress the request. There are loads of different validation attributes that you can apply, you can check out the comprehensive list on the [documentation site](https://docs.microsoft.com/en-us/aspnet/core/mvc/models/validation?view=aspnetcore-3.1#built-in-attributes).

You might have also noticed we have got an attribute of `[ApiController]` on the controller, this tells the framework to apply the [api behaviors](https://docs.microsoft.com/en-us/aspnet/core/web-api/?view=aspnetcore-3.1#apicontroller-attribute), one of these is to [automatically check](https://docs.microsoft.com/en-us/aspnet/core/web-api/?view=aspnetcore-3.1#automatic-http-400-responses) if there are any errors on the ModelState and if there is, it will return a 400 bad request.

The response that we get back from the api from calling `/api/values` with no query string will be:

```json
{
    "type": "https://tools.ietf.org/html/rfc7231#section-6.5.1",
    "title": "One or more validation errors occurred.",
    "status": 400,
    "traceId": "|3184ae60-44f89c2239f987a2.",
    "errors": {
        "To": [
            "The To field is required."
        ],
        "From": [
            "The From field is required."
        ]
    }
}
```
As you can see it's nice and descriptive and even includes a trace id!

## Extending Validation in Controller Action

Say we want to extend the validation in our controller action, for this example we will make sure that our date ranges are no more than 31 days apart.

We will check the date ranges and then add a model error to the `ModelState` with the given property and then return a `BadRequest` with the `ModelState`.

```csharp
    [HttpGet]
    public IActionResult Get([FromQuery] GetValuesQueryParameters parameters)
    {
        if ((parameters.To!.Value - parameters.From!.Value).TotalDays > 31)
        {
            ModelState.AddModelError(nameof(GetValuesQueryParameters.To), "The date range for the query can be maximum of 31 days.");
            
            return BadRequest(ModelState);
        }
        return Ok(new
            {
                parameters.From,
                parameters.To
            });
    }
```

Now if we make a GET request to the url `/api/values?from=2020-01-01&to=2020-12-01` we'll receive a `400` bad request response back with the following body:

```json
{
    "From": [
        "The date range for the query can be maximum of 31 days."
    ]
}
```

So our extra bit of validation is now running and we're getting the right response code but the body of the response is completely different from what the ASP.NET Core framework was giving us originally.

## Returning The Same Response Body

It would be nice to keep the response the same as what the framework was giving us originally, to do that, we need to injecting in `ApiBehaviorOptions` in to our action, these options are used to describe how the api should behavior. One of the options is a factory to create the response back from the api when the model state is invalid, this is called `InvalidModelStateResponseFactory`. We can call this factory with the `ControllerContext` which will give us back an `IActionResult` in which we can return back to the action.

```csharp
[HttpGet]
public IActionResult Get(
    [FromQuery] GetValuesQueryParameters parameters,
    [FromServices] IOptions<ApiBehaviorOptions> apiBehaviorOptions)
{
    if ((parameters.To!.Value - parameters.From!.Value).TotalDays > 31)
    {
        ModelState.AddModelError(nameof(GetValuesQueryParameters.To), "The date range for the query can be maximum of 31 days.");

        return apiBehaviorOptions.Value.InvalidModelStateResponseFactory(ControllerContext);
    }

    return Ok(new { parameters.From, parameters.To });
}
```

Now if we do another GET request to the same url `/api/values?from=2020-01-01&to=2020-12-01` we will get the same response as originally from the framework:

```json
{
    "type": "https://tools.ietf.org/html/rfc7231#section-6.5.1",
    "title": "One or more validation errors occurred.",
    "status": 400,
    "traceId": "|b587c9f9-4aff6eb0721c184a.",
    "errors": {
        "To": [
            "The date range for the query can be maximum of 31 days."
        ]
    }
}
```

## Customizing The Model Validation Response.

Now we know that there is a factory for creating the response from an invalid model state,  we can replace the factory with our own factory to create custom responses.
Within the `Startup.cs` in the `ConfigureServices` function, after the `AddMvc` call, we can chain an extra method call of `ConfigureApiBehaviorOptions` this is where we can alter the options.

```csharp
public void ConfigureServices(IServiceCollection services)
{
    services.AddMvc()
       .ConfigureApiBehaviorOptions(opt
           =>
           {
               opt.InvalidModelStateResponseFactory =
                   (context => new OkObjectResult("Hello there?"));
           });
}
```

Now if we spin back up the api and get an invalid model state, we'll get the following response from the api.

```text
Hello there?
```

## Respect the API Behavior Options

From this we now should see that we should respect the API behavior options within our controller, that way if we ever wanted to globally change how the invalid model state responses are create, we only have one place to change it.