---
layout: post
title: Extra Validation Errors In ASP.NET Core
categories:
tags: [ASP.NET Core, .NET, C#]
description: How to extra validation errors using Problem Detail within ASP.NET Core
comments: true
---

## API Validation in ASP.NET Core

When building APIs within ASP.NET Core, when we append the `[ApiController]` attribute to our controllers the framework does the heavy lifting of sorting out model validation issues and returns a 400 bad request and a industry standard [Problem Details](https://datatracker.ietf.org/doc/html/rfc7807) as the body.

Take the following `PeopleController` as an example, the `Name` property for the `PersonResource` is required so when we send a post request to the endpoint we will get a 400 bad request response back without any of our code in our controller being executed.

```csharp
[ApiController, Route("[controller]")]
public class PeopleController : ControllerBase
{
    [HttpPost]
    public IActionResult Post(PersonResource person) => Ok();
}

public class PersonResource
{
    public PersonResource(string name)
    {
        Name = name;
    }
    [Required]
    public string Name { get; }
}
```

```bash
curl --insecure -X 'POST' \
  'https://localhost:7183/People' \
  -H 'accept: */*' \
  -H 'Content-Type: application/json' \
  -d '{
}'
{
    "type": "https://tools.ietf.org/html/rfc7231#section-6.5.1",
    "title": "One or more validation errors occurred.",
    "status": 400,
    "traceId": "00-06148ca152dc0ec880b2ba3fbcadd3ff-5bb9892ff9ed6ed1-00",
    "errors": {
        "Name": [
            "The Name field is required."
        ]
    }
}
```

Sometimes we can't do the validation within the model using the normal data annotation attributes, we might need other data that is store within our database.

## Complex Validation in Controller Action

Let's extend our `PersonResource` so that it has a role property.

```csharp
public class PersonResource
{
    public PersonResource(Guid? id, string name, PersonRole role)
        => (Id, Name, Role) = (id, name, role);

    [Required]
    public Guid? Id { get; }
    [Required]
    public string Name { get; }
    [Required]
    public PersonRole? Role { get; }
}
public enum PersonRole
{
    Owner,
    Admin,
    User
}
```

Now let's say that we have a requirement that only **one** person in our system can have a role of `Owner`, now we would most likely implement that inside the controller action or a application service.

We can keep track of our current people in memory just for this example, and we will implement that logic within our post action method.

```csharp
[ApiController]
[Route("[controller]")]
public class PeopleController : ControllerBase
{
    private static readonly List<PersonResource> _people = new();

    [HttpGet]
    public IActionResult Get()
    {
        return Ok(_people);
    }
    
    [HttpPost]
    public IActionResult Post(PersonResource person)
    {
        if(person.Role == PersonRole.Owner && _people.Any(p => p.Role == PersonRole.Owner))
        {
            return BadRequest("Only one owner is allowed");
        }
        _people.Add(person);

        return Ok();
    }
    
    [HttpDelete("{id}")]
    public IActionResult Delete(Guid id)
    {
        _people.RemoveAll(x => x.Id == id);

        return Ok();
    }
}
```

Now we've got our logic all sorted, if we run a `curl` command to send two post messages with a role of `Owner`, we will then get a string body of `"Only one owner is allowed"` for the last message sent.

```bash
curl -X 'POST' \
  'https://localhost:7183/People' \
  -H 'accept: */*' \
  -H 'Content-Type: application/json' \
  -d '{
  "id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
  "name": "Name 1",
  "role": "Owner"
}'
curl -i -X 'POST' \
  'https://localhost:7183/People' \
  -H 'accept: */*' \
  -H 'Content-Type: application/json' \
  -d '{
  "id": "44d17cac-56c0-49ba-9d54-a80e1c8bcd7a",
  "name": "Name 2",
  "role": "Owner"
}'
HTTP/2 400
content-type: text/plain; charset=utf-8
server: Kestrel

Only one owner is allowed
```

We do get a 400 bad request status code back, however, ideally we want the payload returned to be a `Problem Detail`, that way it's consistent with the rest of our API.

There's a helper method on the `ControllerBase` that we can use to achieve this.

```csharp
[HttpPost]
public IActionResult Post(PersonResource person)
{
    if(person.Role == PersonRole.Owner && _people.Any(p => p.Role == PersonRole.Owner))
    {
        return Problem(
            title: "Incorrect role",
            detail: "Only one owner is allowed",
            statusCode: 400);
    }
    _people.Add(person);

    return Ok();
}
```

Now when we run our `curl` command we'll get the following output.
```bash
HTTP/2 400
content-type: application/problem+json; charset=utf-8
date: Sun, 02 Jan 2022 19:55:21 GMT
server: Kestrel

{
    "type": "https://tools.ietf.org/html/rfc7231#section-6.5.1",
    "title": "Incorrect role",
    "status": 400,
    "detail": "Only one owner is allowed",
    "traceId": "00-38594bebd07ad9b11e2c4ab851353396-d8af49e8b18863c6-00"
}
```

This is better but it would be more useful if it highlighted which property on the model was invalid.

### ModelState Validation Problem

We can achieve this by adding a error to the `ModelState` object on the `ControllerBase` and then returning `ValidationProblem()`.

```csharp
[HttpPost]
public IActionResult Post(PersonResource person)
{
    if(person.Role == PersonRole.Owner && _people.Any(p => p.Role == PersonRole.Owner))
    {
        ModelState.AddModelError(nameof(PersonResource.Role), "Only one owner is allowed");
        return ValidationProblem();
    }
    _people.Add(person);

    return Ok();
}
```

Let's run the `curl` command one last time to see the response

```bash
HTTP/2 400
content-type: application/problem+json; charset=utf-8
date: Sun, 02 Jan 2022 19:58:12 GMT
server: Kestrel

{
    "type": "https://tools.ietf.org/html/rfc7231#section-6.5.1",
    "title": "One or more validation errors occurred.",
    "status": 400,
    "traceId": "00-f8108c62afb77a2948020d2390c94956-b7533e5e2c34e08e-00",
    "errors": {
        "Role": [
            "Only one owner is allowed"
        ]
    }
}
```

As you can see this will give the consumer of the API a lot more feedback, thus making integrations easier.

It's also possible to pass in more information to the `ValidationProblem()` help method such as `detail` and `title`.

