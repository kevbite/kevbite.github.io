---
layout: post
title: Using multi-stage builds to create class library NuGet packages.
categories:
tags: [Docker, Build, NuGet, Class Library]
description: How to create class library NuGet packages that will run build and deploy anywhere.
comments: true
---

Recently there has a been a big push to start using Docker for applications and services deployed to production, one of the big benefits of using docker is that everything for that service to run is encapsulated inside the docker image. That way, as long you've got docker installed you'll be able to run that image anywhere (kinda).

Docker released a feature called [Multi-stage builds](https://docs.docker.com/develop/develop-images/multistage-build/) in version 17.05. The feature was to combat the issue whereby docker images were alway massive due to how the layer are built up. More can be read on [Stackoverflow (Why are docker container images so large?)](https://stackoverflow.com/questions/24394243/why-are-docker-container-images-so-large). There was work around but were a bit of a hurdle and brought unnecessary complexity, however, multi-stage builds allowed you to create each stage of the build and then pass it to the next which would in theory squash the layers together.

Within Visual Studio when you enable Docker Support for as asp.net core project it will create you a multi-stage Dockerfile which looks something like the following.

```dockerfile
FROM mcr.microsoft.com/dotnet/core/aspnet:3.1-buster-slim AS base
WORKDIR /app
EXPOSE 80
EXPOSE 443

FROM mcr.microsoft.com/dotnet/core/sdk:3.1-buster AS build
WORKDIR /src
COPY ["Test123.csproj", ""]
RUN dotnet restore "./Test123.csproj"
COPY . .
WORKDIR "/src/."
RUN dotnet build "Test123.csproj" -c Release -o /app/build

FROM build AS publish
RUN dotnet publish "Test123.csproj" -c Release -o /app/publish

FROM base AS final
WORKDIR /app
COPY --from=publish /app/publish .
ENTRYPOINT ["dotnet", "Test123.dll"]
```

This creates us multiple stages `build`, `publish`, `final` and we can actually get docker to just build up to that stage by passing a `--target` argument to the `docker build` command.

```powershell
>docker build --target build .

Sending build context to Docker daemon  4.395MB
Step 1/11 : FROM mcr.microsoft.com/dotnet/core/aspnet:3.1-buster-slim AS base
3.1-buster-slim: Pulling from dotnet/core/aspnet
54fec2fa59d0: Pull complete                                                                                             573788d8ba26: Pull complete                                                                                             d8e35c95ac02: Pull complete                                                                                             e158ea73cf60: Pull complete                                                                                             5c38381dab2d: Pull complete                                                                                             Digest: sha256:21d9448c98bf4968b72f64c484117f6bf04e27ff3ebc6af6ff7ba3ed1e894f82
Status: Downloaded newer image for mcr.microsoft.com/dotnet/core/aspnet:3.1-buster-slim
 ---> 79e79777c3bf
Step 2/11 : WORKDIR /app
 ---> Running in e13c5eedb0a9
Removing intermediate container e13c5eedb0a9
 ---> 12cec65d05e3
Step 3/11 : EXPOSE 80
 ---> Running in 4f4ea60395f3
Removing intermediate container 4f4ea60395f3
 ---> 12122b68b034
Step 4/11 : EXPOSE 443
 ---> Running in e477ee39f754
Removing intermediate container e477ee39f754
 ---> 2b89be6ebccc
Step 5/11 : FROM mcr.microsoft.com/dotnet/core/sdk:3.1-buster AS build
3.1-buster: Pulling from dotnet/core/sdk
90fe46dd8199: Pull complete                                                                                             35a4f1977689: Pull complete                                                                                             bbc37f14aded: Pull complete                                                                                             74e27dc593d4: Pull complete                                                                                             caa6ad693f93: Pull complete                                                                                             aae86a99db0a: Pull complete                                                                                             95f813d5736b: Pull complete                                                                                             Digest: sha256:d706e0545b75615ecd864c6af237cc1fc2ca9001ed25cdd84b83fdb3923e9e54
Status: Downloaded newer image for mcr.microsoft.com/dotnet/core/sdk:3.1-buster
 ---> 4aa6a74611ff
Step 6/11 : WORKDIR /src
 ---> Running in 0f9d51c28cbd
Removing intermediate container 0f9d51c28cbd
 ---> 46f26f960997
Step 7/11 : COPY ["Test123.csproj", ""]
 ---> f2ea29b349e9
Step 8/11 : RUN dotnet restore "./Test123.csproj"
 ---> Running in 41acde448cf9
  Restore completed in 1.53 sec for /src/Test123.csproj.
Removing intermediate container 41acde448cf9
 ---> cdb9a2389a13
Step 9/11 : COPY . .
 ---> 1a9aeb2d8add
Step 10/11 : WORKDIR "/src/."
 ---> Running in ee84d36c060c
Removing intermediate container ee84d36c060c
 ---> 1eee360528ab
Step 11/11 : RUN dotnet build "Test123.csproj" -c Release -o /app/build
 ---> Running in 6043b04bec32
Microsoft (R) Build Engine version 16.5.0+d4cbfca49 for .NET Core
Copyright (C) Microsoft Corporation. All rights reserved.

  Restore completed in 39.94 ms for /src/Test123.csproj.
  Test123 -> /app/build/Test123.dll
  Test123 -> /app/build/Test123.Views.dll

Build succeeded.
    0 Warning(s)
    0 Error(s)

Time Elapsed 00:00:04.22
Removing intermediate container 6043b04bec32
 ---> f8500c29a7e6
Successfully built f8500c29a7e6
```

As you can see running a target of `build` has just built our build image. So what if we take this concept and build our class libraries in the same way, then maybe we might end up with a container that pushes the built NuGet package to a feed?

## Dockerizing Class Libraries

Building a class library is pretty much the same as building an asp.net core project, so we can actually steal some of the Dockerfile from the above sample.

So if we start off with creating a new class library from the console using the `dotnet new` command.

```powershell
dotnet new classlib

The template "Class library" was created successfully.

Processing post-creation actions...
Running 'dotnet restore' on C:\dev\Test123\Test123.csproj...
  Restore completed in 307.19 ms for C:\dev\Test123\Test123.csproj.

Restore succeeded.
```

Now we can add a Dockerfile to the project directory that will copy the project file (`.csproj`), do a restore and then a build in release configuration.

```Dockerfile
FROM mcr.microsoft.com/dotnet/core/sdk:3.1-buster AS build
WORKDIR /src
COPY *.csproj .
RUN dotnet restore
COPY . .
RUN dotnet build -c Release --no-restore
```

It's also ideal to include a `.dockerignore` file to stop un-required items being copied in to the docker image with the `Copy . .` step. A simple one that I normally use it to omit all `bin`,`obj`,`.vscode`,`.vs` and `.git` directories. However, you might need to configure yours differently depending on your own setup.

```text
**/bin
**/obj
**/.vscode
**/.vs
.git
```

Now if we run the following docker file with the build command, it will build our class library within a docker image.

```powershell
docker build .
```

However, I normally try to split up the restore and build tasks, this enables docker to cache the restore docker images meaning that your build times will be faster if you're using a previous layer from the docker cache.

Here we can create another stage of restore which just copies in the csproj to do the restore and then another stage of build where we'll take the previous stage.

```Dockerfile
FROM mcr.microsoft.com/dotnet/core/sdk:3.1-buster AS restore
WORKDIR /src
COPY *.csproj .
RUN dotnet restore

FROM restore AS build
COPY . .
RUN dotnet build -c Release --no-restore
```

Now if we run the build multiple times we'll see that the layers are coming from the local cache.

```powershell
docker build .

Sending build context to Docker daemon   5.12kB
Step 1/7 : FROM mcr.microsoft.com/dotnet/core/sdk:3.1-buster AS restore
 ---> 4aa6a74611ff
Step 2/7 : WORKDIR /src
 ---> Using cache
 ---> 46f26f960997
Step 3/7 : COPY *.csproj .
 ---> Using cache
 ---> 61423f4bb4b1
Step 4/7 : RUN dotnet restore
 ---> Using cache
 ---> 0c623c3eee28
Step 5/7 : FROM restore AS build
 ---> 0c623c3eee28
Step 6/7 : COPY . .
 ---> Using cache
 ---> 6bd0b255451a
Step 7/7 : RUN dotnet build -c Release --no-restore
 ---> Using cache
 ---> 514e812ed618
Successfully built 514e812ed618
```

It is also possible to pull from external cache sources, which is explained in the [Docker docs](https://docs.docker.com/engine/reference/commandline/build/#specifying-external-cache-sources)

Next we can add in our pack stage to our Dockerfile, this will bundle up our class library in to a NuGet package.

```Dockerfile
FROM build as pack
RUN dotnet pack --configuration Release --no-build
```

Then the last stage will be to have an entry point in which we can run docker image which will push the artifacts to a NuGet repository.

```Dockerfile
FROM pack as push
ENTRYPOINT ["dotnet", "nuget", "push", "./bin/Release/*.nupkg", "--source", "https://api.nuget.org/v3/index.json"]
```

Now if we build the image, this time giving it a tag of `example/test123`.
```powershell
docker build -t example/push-test123 .
```

We can we can do a `docker run` to push our NuGet package up to NuGet.org.

```powershell
docker run example/push-test123

warn : No API Key was provided and no API Key could be found for 'https://www.nuget.org/api/v2/package'. To save an API Key for a source use the 'setApiKey' command.
```

However, as you can see we've not set a api key. One thing we don't want to do is embed our api key in to the docker image, however we can pass extra arguments to be appended to the entry point via the `run` command.

```powershell
docker run example/push-test123 --api-key an-example-api-key

Pushing Test123.1.0.0.nupkg to 'https://www.nuget.org/api/v2/package'.
```

This will then the NuGet package to the feed.

## What about our tests?

So you're wondering what happens with your tests, we've got the whole build and deploy sorted out via docker, but we've ran no tests yet.

This is fairly simple, we can extend our docker file so that it builds us an image that will run our tests on our build stage.

```Dockerfile
FROM build as build-tests
COPY ./Test123.Tests/ ./Test123.Tests/
RUN dotnet build ./Test123.Tests/*.csproj --configuration Release --no-restore

FROM build-tests as test
ENTRYPOINT ["dotnet", "test", "./Test123.Tests/Test123.Tests.csproj", "--configuration", "Release", "--no-restore", "--no-build"]
CMD ["--logger" , "trx", "--results-directory", "./TestResults"]
```

We can build this docker image by specifying the target on the `build` docker command.

```powershell
docker build -t example/test-test123 . --target test
```

Then once it's built we can run the image and mount a directory to `/TestResults` so the test results get copied to the local file system.

```powershell
docker run -v TestResults:/TestResults example/test-test123
```

## Full example.

A full example of a Dockerfile that I've recently built up and using is below, it can also be found on my [GitHub](https://github.com/kevbite/WLED.NET/blob/master/Dockerfile).

```Dockerfile
ARG VERSION=0.0.0
FROM mcr.microsoft.com/dotnet/core/sdk:3.1 AS restore
ARG VERSION
WORKDIR /

COPY ./nuget.config .
COPY ./*.sln .
COPY ./Directory.Build.props .
COPY ./src/Kevsoft.WLED/*.csproj ./src/Kevsoft.WLED/
COPY ./test/Kevsoft.WLED.Tests/*.csproj ./test/Kevsoft.WLED.Tests/
RUN dotnet restore

FROM restore as build
ARG VERSION
COPY ./icon.png .
COPY ./src/Kevsoft.WLED/ ./src/Kevsoft.WLED/
RUN dotnet build ./src/**/*.csproj --configuration Release -p:Version=${VERSION} --no-restore

FROM build as build-tests
ARG VERSION
COPY ./test/Kevsoft.WLED.Tests/ ./test/Kevsoft.WLED.Tests/
RUN dotnet build ./test/**/*.csproj --configuration Release -p:Version=${VERSION} --no-restore

FROM build-tests as test
ENTRYPOINT ["dotnet", "test", "./test/Kevsoft.WLED.Tests/Kevsoft.WLED.Tests.csproj", "--configuration", "Release", "--no-restore", "--no-build"]
CMD ["--logger" , "trx", "--results-directory", "./TestResults"]

FROM build as pack
ARG VERSION
RUN dotnet pack --configuration Release -p:Version=${VERSION} --no-build

FROM pack as push
ENTRYPOINT ["dotnet", "nuget", "push", "./src/Kevsoft.WLED/bin/Release/*.nupkg", "--source", "NuGet.org"]
```
