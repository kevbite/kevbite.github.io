---
layout: post
title: How I Test Authentication and Authorisation in My ASP.NET Core APIs
categories:
tags: [Testing, ASP.NET Core, .NET, Security, API]
description: A walkthrough of how I structure integration tests so every endpoint proves it guards against bad actors, without copy-pasting the same auth tests everywhere.
comments: true
---

I've always been a bit obsessed with testing. I've given more than a few talks over the years on testing APIs out in the wild, and if there's one thing I keep coming back to, it's this: a well-defined REST API is only as good as the tests that stop a bad actor slipping through it.

Authentication and authorisation are where that really bites. It's easy to write the happy-path test, the one where everything is valid and you get your `200` back. It's the *un*happy paths that keep me up at night, the caller with no token, the wrong role, the wrong scope, or the one poking at another tenant's data. Those are the tests that actually prove your endpoint is guarded.

The trouble is, those tests are nearly identical for every endpoint. Written by hand, they get done properly for the first endpoint, copied to the second, and quietly forgotten by the fifth. So in this post I want to walk through how I set up my APIs *and* my tests so that the auth checks are written once and every endpoint gets them for free.

Everything here is a small, runnable sample: a real minimal API and a set of integration tests, no infrastructure required.

## The problem it solves

Every endpoint on a multi-tenant API has to answer the same handful of questions:

| Situation                                            | Expected |
|------------------------------------------------------|----------|
| No token                                             | 401      |
| Token, wrong role                                    | 403      |
| Token, right role, wrong scope                       | 403      |
| Everything right, but the record is another tenant's | 404      |

That's four near-identical tests, times however many endpoints you have. Nobody wants to write that five times, so the honest truth is nobody does. What I want instead is to write those four tests *once*, and have each new endpoint inherit them.

## The API we're guarding

Before the tests, here's the thing under test. It's a tiny library API where each book lives under a branch (our tenant). Two things guard every endpoint: the caller's **role** and the token's **scope**.

```csharp
builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        options.Authority = builder.Configuration["Auth:Authority"];
        options.Audience = builder.Configuration["Auth:Audience"];
    });

builder.Services.AddAuthorizationBuilder()
    .AddPolicy(Policies.ReadBook, policy => policy
        .RequireAuthenticatedUser()
        .RequireRole(Roles.Librarian)
        .RequireClaim(LibraryClaimTypes.Scope, Scopes.ReadBook))
    .AddPolicy(Policies.WriteBook, policy => policy
        .RequireAuthenticatedUser()
        .RequireRole(Roles.Librarian)
        .RequireClaim(LibraryClaimTypes.Scope, Scopes.WriteBook));
```

The endpoints themselves are plain minimal APIs. Notice that every one starts by resolving the library *scoped to the caller's own branch*:

```csharp
var books = app.MapGroup("/libraries/{libraryId:guid}/books");

books.MapGet("/{bookId:guid}", IResult (Guid libraryId, Guid bookId, ClaimsPrincipal user, LibraryStore store) =>
    {
        var library = store.Find(libraryId, user.BranchId());
        if (library is null)
        {
            return Results.NotFound();
        }

        var book = library.FindBook(bookId);
        return book is null ? Results.NotFound() : Results.Ok(book);
    })
    .RequireAuthorization(Policies.ReadBook);
```

That `store.Find(libraryId, user.BranchId())` is doing something sneaky and important. If the library belongs to another branch, it returns `null`, and the caller gets a **404**, not a **403**. That's deliberate: a caller shouldn't even be able to tell that another tenant's library *exists*. The branch comes from a claim we read off the caller:

```csharp
public static int BranchId(this ClaimsPrincipal user) => user.GetInt(LibraryClaimTypes.BranchId);
```

Nothing exotic here, and that's the point. It's the real API, real policies, real tenancy rules. The tests are going to run all of it.

## Piece 1: a fake authentication scheme

The one thing I don't want in an integration test is a real identity provider. Minting real tokens just to prove an endpoint returns a `403` is misery. So I swap the authentication scheme for a fake one that turns request headers into claims:

```csharp
public class TestAuthHandler(
    IOptionsMonitor<AuthenticationSchemeOptions> options,
    ILoggerFactory logger,
    UrlEncoder encoder)
    : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
{
    public const string SchemeName = "Test";

    public const string IsAuthenticatedHeader = "X-Test-IsAuthenticated";
    public const string RoleHeader = "X-Test-Role";
    public const string ScopeHeader = "X-Test-Scope";
    public const string BranchIdHeader = "X-Test-BranchId";
    public const string UserIdHeader = "X-Test-UserId";

    protected override Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        // No header at all stands in for "no usable token", which ASP.NET Core turns into a 401.
        if (!Request.Headers.ContainsKey(IsAuthenticatedHeader))
        {
            return Task.FromResult(AuthenticateResult.Fail("Not authenticated"));
        }

        var identity = new ClaimsIdentity(BuildClaims(Request.Headers), SchemeName, ClaimTypes.Name, ClaimTypes.Role);
        var ticket = new AuthenticationTicket(new ClaimsPrincipal(identity), SchemeName);

        return Task.FromResult(AuthenticateResult.Success(ticket));
    }

    // ... BuildClaims turns X-Test-Role / X-Test-Scope / X-Test-BranchId / X-Test-UserId into claims
}
```

The lovely part is what *isn't* faked. The scheme just produces claims; the real authorisation policies then evaluate them, the real endpoints run, the real store answers. So a `403` in these tests is the genuine article, and I only ever have to say "authenticated, but with the wrong role" in plain English.

Wiring it in happens in exactly one place, the web application factory:

```csharp
public sealed class LibraryApiWebApplicationFactory : WebApplicationFactory<Program>
{
    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Test");

        builder.ConfigureTestServices(services =>
            // Registered last, so this becomes the default scheme in place of JWT bearer.
            services.AddAuthentication(TestAuthHandler.SchemeName)
                .AddScheme<AuthenticationSchemeOptions, TestAuthHandler>(TestAuthHandler.SchemeName, _ => { }));
    }
}
```

## Piece 2: credentials as a record

Now, if I'm going to write a test that breaks *one* thing about the caller, I need a tidy way to describe a valid caller and then bend a single property. This is where I lean on the same trick I love for [test builders](/2024/11/01/building-better-tests-in-csharp-with-builders.html), but with records so every tweak returns a copy.

```csharp
public abstract record AuthenticationSettingsBase<T>
    where T : AuthenticationSettingsBase<T>
{
    public bool IsAuthenticated { get; init; } = true;
    public string? Scope { get; init; }

    public T WithNoAuthentication() => (T)this with { IsAuthenticated = false };

    public T WithScope(string scope) => (T)this with { Scope = scope };

    public T WithInvalidScope() => WithScope("not-a-real-scope");
}
```

It starts valid and offers one method per way of being invalid. Because it's a record, `WithInvalidScope()` returns a copy with *only* the scope broken and everything else left at its sensible default. That matters more than it looks. A test that accidentally breaks two things can pass for entirely the wrong reason, and you'd never know.

The `With...` methods live on whichever base class owns the concept, so they're written once. The hierarchy stacks up like this:

```
AuthenticationSettingsBase<T>            IsAuthenticated, Scope
  RoleBasedAuthenticationSettingsBase<T> + Roles
    BranchUserAuthenticationSettings     + BranchId, UserId
```

```csharp
public record BranchUserAuthenticationSettings : RoleBasedAuthenticationSettingsBase<BranchUserAuthenticationSettings>
{
    public int? BranchId { get; init; }
    public int? UserId { get; init; }

    public BranchUserAuthenticationSettings WithBranchId(int branchId) => this with { BranchId = branchId };

    public BranchUserAuthenticationSettings WithUserId(int userId) => this with { UserId = userId };
}
```

The generic `T` is there for a reason. It means `WithInvalidRole()` on the middle class still hands you back the concrete `BranchUserAuthenticationSettings`, so the fluent calls chain in any order you like.

## Piece 3: the `Execute` seam

Here's the bit that ties it together. I put the four auth tests in an abstract base class, and I leave a single hole for the derived class to fill: *how do I actually call my endpoint?*

```csharp
protected abstract Task<(HttpStatusCode status, JsonDocument? body)> Execute(
    BranchLibrary library,
    Book book,
    Action<JsonObject>? configureRequestPayload = null,
    Func<BranchUserAuthenticationSettings, BranchUserAuthenticationSettings>? configureAuthSettings = null);
```

The base class knows *what* to assert; the derived class knows *how* to call. Both hooks are optional and default to "make a completely valid request", so an inherited test only ever mentions the one thing it's about:

```csharp
[Fact]
public async Task Returns403WhenTheCallerHasTheWrongScope()
{
    var library = await Harness.Data.CreateLibrary();

    var (status, _) = await Execute(library, BuildBook(),
        configureAuthSettings: settings => settings.WithInvalidScope());

    status.Should().Be(HttpStatusCode.Forbidden);
}
```

Read that test out loud, "execute a valid request but with an invalid scope, and expect a 403", and it says exactly what it means. Nothing else. Here's the whole set living in the base class:

```csharp
public abstract class BookAuthenticationTestsBase(Harness harness) : IClassFixture<Harness>
{
    protected Harness Harness { get; } = harness;

    protected abstract Task<(HttpStatusCode status, JsonDocument? body)> Execute(
        BranchLibrary library,
        Book book,
        Action<JsonObject>? configureRequestPayload = null,
        Func<BranchUserAuthenticationSettings, BranchUserAuthenticationSettings>? configureAuthSettings = null);

    protected virtual Book BuildBook() => BookBuilder.Default;

    [Fact]
    public async Task Returns401WhenTheCallerIsNotAuthenticated()
    {
        var library = await Harness.Data.CreateLibrary();
        var (status, _) = await Execute(library, BuildBook(),
            configureAuthSettings: settings => settings.WithNoAuthentication());
        status.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task Returns403WhenTheCallerHasTheWrongRole()
    {
        var library = await Harness.Data.CreateLibrary();
        var (status, _) = await Execute(library, BuildBook(),
            configureAuthSettings: settings => settings.WithInvalidRole());
        status.Should().Be(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task Returns403WhenTheCallerHasTheWrongScope()
    {
        var library = await Harness.Data.CreateLibrary();
        var (status, _) = await Execute(library, BuildBook(),
            configureAuthSettings: settings => settings.WithInvalidScope());
        status.Should().Be(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task Returns404WhenTheLibraryBelongsToAnotherBranch()
    {
        var library = await Harness.Data.CreateLibrary();

        // 404 rather than 403: a caller should not be able to tell that another branch's library exists.
        var (status, _) = await Execute(library, BuildBook(),
            configureAuthSettings: settings => settings.WithBranchId(library.BranchId + 1));

        status.Should().Be(HttpStatusCode.NotFound);
    }
}
```

Returning `(status, body)` rather than the raw `HttpResponseMessage` is a small thing that pays off constantly. The response stays readable after the `HttpClient` has been disposed, and the assertions stay short.

A concrete endpoint's test class then only has to answer that one question. Here's GET:

```csharp
public class GettingABookTests(Harness harness) : BookAuthenticationTestsBase(harness)
{
    protected override Task<(HttpStatusCode status, JsonDocument? body)> Execute(
        BranchLibrary library,
        Book book,
        Action<JsonObject>? configureRequestPayload = null,
        Func<BranchUserAuthenticationSettings, BranchUserAuthenticationSettings>? configureAuthSettings = null)
        => Harness.Api.GetBook(library.Id, book.Id, library.BranchId, configureAuthSettings);
}
```

That's it. Those four auth tests now run against GET, and I never wrote them here.

## Sharing even more between endpoints

Some rules aren't shared by *every* endpoint, only by some. The two endpoints that write a book (POST and PUT) both reject a bad payload and both store the book. A read does neither. So I slot a second layer in between:

```csharp
public abstract class BookMutationTestsBase(Harness harness) : BookAuthenticationTestsBase(harness)
{
    [Fact]
    public async Task Returns400WhenTheTitleIsMissing()
    {
        var library = await Harness.Data.CreateLibrary();

        var (status, _) = await Execute(library, BuildBook(),
            configureRequestPayload: payload => payload["title"] = "");

        status.Should().Be(HttpStatusCode.BadRequest);
    }

    // ... plus a test that the book is actually stored against the library
}
```

Now, why can POST and PUT share this? Because in this API `PUT` is an upsert, it creates the book when that id isn't in use yet and returns a **201**, exactly as POST does. So both endpoints satisfy the same "creating a book" assertions:

```csharp
// PUT is an upsert: it creates the book when the id is not in use yet. That is what lets the
// POST and PUT test classes inherit the same "creating a book" assertions from a shared base.
if (library.FindBook(bookId) is null)
{
    var created = library.AddBook(request, user.UserId(), bookId);
    return Results.Created($"/libraries/{libraryId}/books/{created.Id}", new { id = created.Id });
}

library.UpdateBook(bookId, request, user.UserId());
return Results.NoContent();
```

`UpdatingABookTests` then adds only the case that's unique to it, overwriting an existing book and getting a **204**. And `GettingABookTests` skips the mutation layer entirely, because a read has no body to invalidate and needs a different scope. It still inherits all four auth tests unchanged, which is the whole point of putting them one level up.

The inheritance tree ends up looking like this:

```
              BookAuthenticationTestsBase      (401 / 403 role / 403 scope / 404 other tenant)
                          |
          +---------------+---------------+
          |                               |
   BookMutationTestsBase            GettingABookTests   (+ 200 with the book, + 404 when missing)
     (400 bad payload, 201 stored)
          |
   +------+------+
   |             |
AddingABook   UpdatingABook   (+ 204 when overwriting)
```

## Adding a new endpoint

The pay-off is the recipe for a new endpoint:

1. Add a method to the typed API client. Start from credentials that are *valid* for the endpoint, and take a `configureAuthSettings` hook.
2. Add a test class deriving from `BookAuthenticationTestsBase` (or `BookMutationTestsBase` if it writes).
3. Override `Execute` to call your new method.

The four auth tests arrive with step 2. You write only what's genuinely new about your endpoint, and it's basically impossible to add an endpoint without its auth coverage tagging along.

## Going further: from roles to a permission model

Role-plus-scope gets you a long way, but eventually "Librarians can write, everyone else can read" stops being expressive enough. The usual next step is a **permission model**: instead of endpoints asking "is this caller a Librarian?", they ask "does this caller have the `books:write` permission?", and a lookup decides which roles carry which permissions.

The nice thing about doing this is that a single dictionary becomes the source of truth for what's allowed:

```csharp
public static class Permissions
{
    public const string ReadBook = "books:read";
    public const string WriteBook = "books:write";
    public const string DeleteBook = "books:delete";
}

public static class PermissionMatrix
{
    public static readonly IReadOnlyDictionary<string, IReadOnlySet<string>> RolePermissions =
        new Dictionary<string, IReadOnlySet<string>>
        {
            [Roles.Librarian] = new HashSet<string> { Permissions.ReadBook, Permissions.WriteBook, Permissions.DeleteBook },
            [Roles.Member] = new HashSet<string> { Permissions.ReadBook },
        };

    public static bool Grants(string role, string permission)
        => RolePermissions.TryGetValue(role, out var permissions) && permissions.Contains(permission);

    public static bool Grants(IEnumerable<string> roles, string permission)
        => roles.Any(role => Grants(role, permission));
}
```

A small authorisation requirement and handler turn a permission into a policy:

```csharp
public sealed class PermissionRequirement(string permission) : IAuthorizationRequirement
{
    public string Permission { get; } = permission;

    public static string PolicyName(string permission) => $"perm:{permission}";
}

public sealed class PermissionHandler : AuthorizationHandler<PermissionRequirement>
{
    protected override Task HandleRequirementAsync(
        AuthorizationHandlerContext context, PermissionRequirement requirement)
    {
        var roles = context.User.FindAll(ClaimTypes.Role).Select(claim => claim.Value);

        if (PermissionMatrix.Grants(roles, requirement.Permission))
        {
            context.Succeed(requirement);
        }

        return Task.CompletedTask;
    }
}
```

Rather than registering a policy by hand for every permission, a policy provider builds them on the fly for any `perm:{permission}` name, so a new permission just needs a row in the matrix:

```csharp
public sealed class PermissionPolicyProvider(IOptions<AuthorizationOptions> options)
    : IAuthorizationPolicyProvider
{
    private readonly DefaultAuthorizationPolicyProvider _fallback = new(options);

    public Task<AuthorizationPolicy> GetDefaultPolicyAsync() => _fallback.GetDefaultPolicyAsync();
    public Task<AuthorizationPolicy?> GetFallbackPolicyAsync() => _fallback.GetFallbackPolicyAsync();

    public Task<AuthorizationPolicy?> GetPolicyAsync(string policyName)
    {
        const string prefix = "perm:";
        if (policyName.StartsWith(prefix, StringComparison.Ordinal))
        {
            var permission = policyName[prefix.Length..];
            var policy = new AuthorizationPolicyBuilder()
                .RequireAuthenticatedUser()
                .AddRequirements(new PermissionRequirement(permission))
                .Build();

            return Task.FromResult<AuthorizationPolicy?>(policy);
        }

        return _fallback.GetPolicyAsync(policyName);
    }
}
```

An endpoint then just names the permission it needs:

```csharp
books.MapDelete("/{bookId:guid}", /* ... */)
    .RequireAuthorization(PermissionRequirement.PolicyName(Permissions.DeleteBook));
```

Now, there's a temptation here I want to steer you well clear of. Because the rules live in a dictionary, you *could* import `PermissionMatrix` straight into your tests and loop over it. **Don't.** If a test reads its expectations from the very same code the production API authorises with, you're just marking your own homework, a bug in the matrix sails right through because the test agrees with it by definition. That's exactly how things fall through the gaps and end up breaking in production.

So I keep the tests' expectations completely separate: a small, hand-written table of what I *believe* should and shouldn't be allowed, checked against the real running endpoints. If production ever drifts, the two disagree and a test goes red:

```csharp
public class BookPermissionMatrixTests(Harness harness) : IClassFixture<Harness>
{
    // Hand-written on purpose. This is what we BELIEVE the rules are, kept deliberately separate
    // from the production PermissionMatrix so a bug over there can never quietly hide in here.
    private static readonly (string Role, string Permission, bool Expected)[] Cases =
    [
        (Roles.Librarian, Permissions.ReadBook, true),
        (Roles.Librarian, Permissions.DeleteBook, true),
        (Roles.Member, Permissions.ReadBook, true),
        (Roles.Member, Permissions.DeleteBook, false),
    ];

    public static TheoryData<string, string, bool> Matrix()
    {
        var data = new TheoryData<string, string, bool>();
        foreach (var (role, permission, expected) in Cases)
        {
            data.Add(role, permission, expected);
        }

        return data;
    }

    [Theory]
    [MemberData(nameof(Matrix))]
    public async Task EnforcesThePermissionMatrix(string role, string permission, bool allowed)
    {
        // ... call the endpoint that requires `permission` as `role`,
        // then assert 403 when not allowed, and anything-but-403 when allowed.
    }
}
```

You can take this as far as you like, per-tenant overrides, permissions stored in a database, a UI that renders the grid. The rule of thumb stays the same though: production has one source of truth for what's allowed, and the tests keep their *own*, independent view of it and prove the two line up against the real API.

## Bonus points: let an AI agent keep you honest

Here's where I'll admit the weak link in all of this. The pattern only protects you if every endpoint actually gets a test class. Nothing stops a rushed pull request from adding a `MapDelete` and "forgetting" the tests, and that's exactly the sort of gap a bad actor loves.

This is a lovely job to hand to an AI agent. I've started writing the rule straight into an [`AGENTS.md`](https://agents.md/) file so tools like Copilot pick it up automatically:

```markdown
## Endpoint auth-test coverage rule

Every endpoint MUST have authentication and authorisation tests: no token -> 401,
wrong role -> 403, wrong scope -> 403, another tenant's record -> 404.

When reviewing or generating endpoint code, cross-check the mapped endpoints
(MapGet / MapPost / MapPut / MapDelete) against the test classes and flag any
endpoint that has no auth test coverage.
```

The second half of it is asking the agent to *review* new endpoints against a proper security checklist, not just eyeball them. And the permission matrix from the last section is perfect for this, because it's machine-readable context you can hand the agent: "here are the rules, now tell me if this endpoint breaks them."

I got a proper nudge on this idea earlier this year. I was volunteering at [NDC Security Oslo 2026](https://ndcsecurity.com/), and caught a talk called ["Secure and Compliant APIs - By Design"](https://youtu.be/32UADtMRy4I) by [Daniel Sandberg](https://www.linkedin.com/in/daniel-sandberg-0b869213/) and [Tobias Ahnoff](https://www.linkedin.com/in/tobias-ahnoff-51993156/). Their framing stuck with me:

> "If you ask 10 developers for a code review, they will identify different issues, and many will miss security concerns like broken access control and lack of input validation."

Which leads to the question every team should be able to answer:

> "How can a DevOps team in their daily work assert that new features do not introduce vulnerabilities, that security bugs get caught before deploy to production?"

Their answer was to "build APIs that are both secure and compliant by design; using OWASP ASVS and support from an application security tuned coding agent." The thing I took away is that agents catch broken access control *far* better when you spell out the access model for them, and that's precisely what the base test class and the permission matrix give you: the rules, written down, in a form both humans and machines can check. The agent is a brilliant safety net, but, as they were careful to say, the humans stay in the loop.

## Wrapping up

The trick that makes all of this work isn't clever, it's just putting the shared rules one level up and leaving a single seam for what's different. The auth tests get written once, every endpoint inherits them, and adding a new endpoint without its guard rails becomes something you'd have to go out of your way to do. Layer a permission matrix on top and the API gets a single source of truth for what's allowed, while the tests keep their own independent view of it and prove the two line up against the real endpoints.

How do you keep your endpoints honest? I'd love to hear the patterns you've landed on.
