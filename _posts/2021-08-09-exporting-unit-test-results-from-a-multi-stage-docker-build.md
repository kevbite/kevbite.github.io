---
layout: post
title: Exporting unit test results from a multi-stage docker build
categories:
tags: [Docker, Continuous Integration, CI, .NET]
description: How to exporting unit test results from a multi-stage docker build
comments: true
---

## Multi-staged Docker Builds

Multi-stage Docker builds allow you to write Docker files with multiple FROM statements. This means you can create images which derive from several bases, which can help cut the size of your final build.

Multi-stage Docker builds is a great way to encapsulate your entire build process in a single file which can be run on any machine. Dependencies such as Node.js or .NET can be installed as part of the process included from another public image.

## Testing within a Multi-staged Docker Build

It's not that common for people to run their test suites inside their docker build, however, it's a perfect use-case as once you've got a docker file setup then it will run the same no matter of the build environment.

For .NET, I feel the reason for not running your test suites inside docker is because all the examples omit out the testing part of the script, for example if we take a look at the [docker.com's ASP.NET Core sample](https://docs.docker.com/samples/dotnetcore/) you'll notice it only contains the restore and publish before creating the runtime image of the container that we'd run in production.

```Dockerfile
# syntax=docker/dockerfile:1
FROM mcr.microsoft.com/dotnet/sdk:5.0 AS build-env
WORKDIR /app

# Copy csproj and restore as distinct layers
COPY *.csproj ./
RUN dotnet restore

# Copy everything else and build
COPY ../engine/examples ./
RUN dotnet publish -c Release -o out

# Build runtime image
FROM mcr.microsoft.com/dotnet/aspnet:3.1
WORKDIR /app
COPY --from=build-env /app/out .
ENTRYPOINT ["dotnet", "aspnetapp.dll"]
```

We could easily add in a testing phase to this test run by adding in a `dotnet build` and `dotnet test`.

```Dockerfile
FROM mcr.microsoft.com/dotnet/sdk:5.0 AS build-env
WORKDIR /app

COPY *.csproj ./
RUN dotnet restore

COPY ../engine/examples ./
RUN dotnet build -c Release --no-restore
RUN dotnet test -c Release --no-build
RUN dotnet publish -c Release --no-build -o out

# Build runtime image
FROM mcr.microsoft.com/dotnet/aspnet:5.0
WORKDIR /app
COPY --from=build-env /app/out .
ENTRYPOINT ["dotnet", "aspnetapp.dll"]
```

Above you can see the two commands we've included, when this is built the `docker build` command will return a exit code not zero if the `dotnet test` does not run to competition.

## Test Named Build Stage

Now we've seen that we can easily add our tests to a build stage it's worth looking at how we can only run the tests. Ideally we'd want to be able to run the tests and then also run build for creating the runtime image.

Within a multi-staged docker build, we don't need to run all stages top to bottom. What we can do is name the stages, we can also fork the layer to add more layers on top.

For example, ideally we'd end up with two builds

**Testing:**
- Copy csproj
- Restore
- Copy rest of files
- Build
- Test

**Runtime image:**
- Copy csproj
- Restore
- Copy rest of files
- Build
- Publish
- Copy publish artifact in to runtime image

To achieve the above we can use the `FROM` directive:
```dockerfile
FROM prevStage AS newStage
```
Where the `prevStage` is the stage we're building on top of, and the `newStage` is the name of the new stage.

If we swap around our docker file to be build up on multiple stages we'll now have the following Dockerfile:
```dockerfile
FROM mcr.microsoft.com/dotnet/sdk:5.0 AS restore
WORKDIR /app

COPY *.csproj ./
RUN dotnet restore

FROM restore AS build
COPY ../engine/examples ./
RUN dotnet build -c Release --no-restore

FROM build AS test
RUN dotnet test -c Release --no-build

FROM build AS publish
RUN dotnet publish -c Release --no-build -o out

# Build runtime image
FROM mcr.microsoft.com/dotnet/aspnet:5.0
WORKDIR /app
COPY --from=publish /app/out .
ENTRYPOINT ["dotnet", "aspnetapp.dll"]
```

Now if we run our normal `docker build` process it won't run our `dotnet test` command as that's not a required stage to create the runtime image. However, now we can tell docker to build up to a give target stage with the `--target` option. So within our build script we can call `docker build` twice.

```bash
docker build --target test .
docker build .
```

Here you might be thinking this going to waste a lot of time re-building each stage twice, however, docker will cache previously built layers meaning that it will only build our `restore` and `build` stages once.

## Outputting our test files

Many CI/CD solutions come with built-in aggregation dashboards for test runs, the two examples below are [AppVeyor](https://www.appveyor.com/) and [Azure DevOps](https://azure.microsoft.com/en-gb/services/devops/), however, there's many other products on the market that do similar.


**AppVeyor Test Results Dashboard**:
![AppVeyor Test Results Dashboard](/assets/posts/2021-08-09-exporting-unit-test-results-from-a-multi-stage-docker-build/appveyor-test-results.png "AppVeyor Test Results Dashboard")

**Azure DevOps Test Results Dashboard**:
![Azure DevOps Test Results Dashboard](/assets/posts/2021-08-09-exporting-unit-test-results-from-a-multi-stage-docker-build/azure-devops-test-results.png "Azure DevOps Test Results Dashboard")

These dashboards make it much easier to see which tests have passed or failed at a glance, they sometimes even have built-in trends for tests to tell you which tests are flaky.

`dotnet test` has a built in logger for Visual Studio Test results files (`.trx`), to enable this we need to pass in an extra argument of `--logger trx` in to our `dotnet test` command. This will then create a bunch of `.trx` files inside a `TestResults` folder relative to each test project.

Also within the docker file we need to create another layer that only has these `.trx` files copied in, this is very similar to our stage where we build our runtime, however this time we won't need the .NET runtime so we can use the special `scratch` image.

```dockerfile
FROM mcr.microsoft.com/dotnet/sdk:5.0 AS restore
WORKDIR /app

COPY *.csproj ./
RUN dotnet restore

FROM restore AS build
COPY ../engine/examples ./
RUN dotnet build -c Release --no-restore

FROM build AS test
RUN dotnet test -c Release --no-build --logger trx

FROM scratch as export-test-results
COPY --from=test /app/TestResults/*.trx .

FROM build AS publish
RUN dotnet publish -c Release --no-build -o out

FROM mcr.microsoft.com/dotnet/aspnet:5.0
WORKDIR /app
COPY --from=publish /app/out .
ENTRYPOINT ["dotnet", "aspnetapp.dll"]
```

Now we've got our `export-test-results` stage to contain our tests results in a scratch image, we now need to tell docker to export these to the current file system once that stage is built. This can be achieved with the `--output` option. The custom build output can output the files directly as is, or they can be rolled up in a `.tar` archive.

For our example we'll just output them directly to the local file system in an `out` folder.

```bash
docker build --target export-test-results --output type=local,dest=out .
```

Once we've got our files on our filesystem these can be pushed up to your CI/CD solution.