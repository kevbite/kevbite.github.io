---
layout: post
title: Running GitHub Action steps and jobs only on push to master
categories:
tags: [GitHub, Actions, CI]
description: How to only running GitHub Action steps and jobs on push to master branch
comments: true
---

[GitHub Actions](https://github.com/features/actions) is now an easy way to automate your software's continuous integration and continuous delivery pipelines when you've already have your code in [GitHub](https://github.com/). Currently at the time of writing this post, within the free tier of GitHub you get 2,000 monthly minutes of actions time which is generous amount for any personal or small business projects.

There's lots of uses for GitHub Actions but one of the most common scenarios is to build and publish your software.

Let's look at an example of a dotnet class library that we package up and push up to NuGet.Org.

```yml
name: Continuous Integration Workflow
on: [push, pull_request]

jobs:
  build:
    name: Build, Test, Pack, Push
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@master

      - run: dotnet restore
      - run: dotnet build --no-restore --configuration Release
      - run: dotnet test --no-build --configuration Release
      - run: dotnet pack --output nupkgs --no-build --configuration Release 
      - run: dotnet nuget push nupkgs\*.nupkg
```

This workflow is setup to run on every `push` and `pull_request` made to the repository, however, we don't really want the `nuget push` step to push packages up on a pull request or anything else other than the `master` branch.

We could separate out the workflow to be a pull request workflow and a push workflow, however, we'd be duplicating lots of parts of our workflow and it would be a lot harder to maintain.

## Conditional steps

On a step we can set extra properties, one of the most common properties what we can use is `name`, this is way to describe the step when the script is ambiguous.

Another property is `if`, this is a property that takes in an expression which if evaluated to true will run the step.

The below step is an example of a step that will alway return `true` for the `if` expression.
```yml
- run: echo I will always run
  if: ${{ true }}
```

However alternately we can use `false` which will mean this step never gets run.
```yml
- run: echo I will always run
  if: ${{ false }}
```

The expressions can become fairly complex with expressions built up based on the environment and the current running context. More information on what you can include in expressions can be found on the [GitHub - Context and expression syntax for Actions](https://help.github.com/en/actions/reference/context-and-expression-syntax-for-github-actions).

### Exclude steps on pull request

Now we know about conditional steps, we can start to exclude our `nuget push` being run on a pull request. One of the variables we can use in out expression is `github.event_name`, this variable is the name of the event that triggered the workflow run. In our example this can either be `push` or `pull_request`. So what we can do is check that the event is always a `push` on our step.

Below is an example of a step that only runs on a push
```yml
- run: echo I will only run on push
  if: ${{ github.event_name == 'push' }}

```

### Only run steps on master

Another useful variable is `github.ref` this is the branch or tag ref that triggered the workflow run. These are in the format `refs/heads/{branch}`.
We can do similar to the above and check that we're on the master branch.
```yml
- run: echo I will only run on the master branch
  if: ${{ github.ref == 'refs/heads/master' }}
```

### Combining expressions

We've now got both expressions for building our step so it does not run on a pull request and only on the master branch. However, we need to join these expressions together. For this we can use some [logical operators](https://help.github.com/en/actions/reference/context-and-expression-syntax-for-github-actions#operators), the operator that we want to use is the `&&` (and operator) but there is also `||` (or operator), these operators are similar to some common languages like C# and JavaScript.

So we can simply combined these expressions together like the below.

```yml
- run: echo I will only run on the master branch and not on pull request
  if: ${{ github.event_name == 'push' && github.ref == 'refs/heads/master' }}
```

We can also rearrange the properties so they read a bit better

```yml
- if: ${{ github.event_name == 'push' && github.ref == 'refs/heads/master' }}
  run: echo I will only run on the master branch and not on pull request
```

### Creating meaningful variables

It's always nice to be able to read what the code does, and having lots of long expressions doesn't help anyone out. Within the workflows we can create [environment variables](https://help.github.com/en/actions/configuring-and-managing-workflows/using-environment-variables) with descriptive names and use these in our if expressions. This also allows us to reuse the expressions multiple times over the workflow without duplicating the code. Let's take the following workflow for example.

```yml
jobs:
  build:
    name: Build, Test, Pack, Push
    runs-on: windows-latest
    env:
      PUSH_PACKAGES: ${{ github.event_name == 'push' && github.ref == 'refs/heads/master' }}
    steps:
      - name: Step 1
        if: ${{ env.PUSH_PACKAGES }}
        run: echo Step 2 running based on PUSH_PACKAGES value of $PUSH_PACKAGES
      - name: Step 2
        if: ${{ env.PUSH_PACKAGES }}
        run: echo Step 2 running based on PUSH_PACKAGES value of $PUSH_PACKAGES
```

Steps 1 and 2 only run based on the environment variable `PUSH_PACKAGES`, this is referenced in an expression with the `env.{var-name}` syntax. The `PUSH_PACKAGES` environment variable however is only set once at the start of our job.

### Our final dotnet class library build/push workflow

Given all the information above, we can now plumb in the extra fields we know to only allow our nuget push to execute on master and not on a pull request.
```yml
name: Continuous Integration Workflow
on: [push, pull_request]

jobs:
  build:
    name: Build, Test, Pack, Push
    runs-on: windows-latest
    env:
      PUSH_PACKAGES: ${{ github.event_name == 'push' && github.ref == 'refs/heads/master' }}
    steps:
      - uses: actions/checkout@master

      - run: dotnet restore
      - run: dotnet build --no-restore --configuration Release
      - run: dotnet test --no-build --configuration Release
      - run: dotnet pack --output nupkgs --no-build --configuration Release 
      - if: ${{ env.PUSH_PACKAGES }}
        run: dotnet nuget push nupkgs\*.nupkg
```

## Conditional jobs

So what about conditional jobs? These are practically the same as a step setup, we can add an extra property of `if` with an expression and if the expression evaluates to true then the job will run.

```yml
jobs:
  build:
    name: Build, Test, Pack, Push
    runs-on: windows-latest
    if: ${{ true }}
    steps:
      - run: echo Hello World
```