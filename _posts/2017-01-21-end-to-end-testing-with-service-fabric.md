---
layout: post
title: End to end testing with Service Fabric
categories:
tags: [Continuous Integration, Service Fabric, Testing, NUnit, Azure]
description: How to end to end test your Service Fabric application
comments: true
---

# End to end testing

Most application that I have worked on developing, I have always tried to have my build server test the application end to end so that I have a very high confidence that when I ship the code, the features implemented are going to work as expected.

Prior to Service Fabric, services I developed were built on top of _[Owin](http://owin.org/)_ or _[TopShelf](http://topshelf-project.com/)_. This allowed them to be run easily by just executing a executable file (*.exe). I could then just alter the configuration within the tests or inject in some environment variables to point to a local database and/or a mocked web service and test my application fully.

However if we try to execute a Service Fabric service from the command line it will just throw an exception as it is not running within the Service Fabric runtime:

```text
  System.Fabric.FabricException: An error occurred during this operation.  Please check the trace logs for more details. ---> System.Runtime.InteropServices.COMException: Exception from HRESULT: 0x80071CC0
    at System.Fabric.Interop.NativeRuntime.FabricEndGetNodeContext(IFabricAsyncOperationContext context)
    at System.Fabric.FabricRuntime.NativeFabricRuntimeFactory.GetNodeContextEndWrapper(IFabricAsyncOperationContext context)
    at System.Fabric.Interop.AsyncCallOutAdapter2`1.Finish(IFabricAsyncOperationContext context, Boolean expectedCompletedSynchronously)
    --- End of inner exception stack trace ---
    at System.Runtime.CompilerServices.TaskAwaiter.ThrowForNonSuccess(Task task)
    at System.Runtime.CompilerServices.TaskAwaiter.HandleNonSuccessAndDebuggerNotification(Task task)
    at Microsoft.ServiceFabric.Services.Runtime.RuntimeContext.<GetOrCreateAsync>d__3.MoveNext()
  --- End of stack trace from previous location where exception was thrown ---
    at System.Runtime.CompilerServices.TaskAwaiter.ThrowForNonSuccess(Task task)
    at System.Runtime.CompilerServices.TaskAwaiter.HandleNonSuccessAndDebuggerNotification(Task task)
    at Microsoft.ServiceFabric.Services.Runtime.ServiceRuntime.<RegisterServiceAsync>d__5.MoveNext()
  --- End of stack trace from previous location where exception was thrown ---
    at System.Runtime.CompilerServices.TaskAwaiter.ThrowForNonSuccess(Task task)
    at System.Runtime.CompilerServices.TaskAwaiter.HandleNonSuccessAndDebuggerNotification(Task task)
    at System.Runtime.CompilerServices.TaskAwaiter.GetResult()
    at Kevsoft.WordCount.Service.Program.Main(String[] args) in C:\dev\kevbite\MassTransit.ServiceFabric\src\WordCount.Service\Program.cs:line 22
```

This is not ideal; I was told by the Service Fabric documentation that it would run just like a normal console application. So, I did a bit of digging using my favourite tool [ILSpy](http://ilspy.net/), but it boils down to calling some assemblies that are pretty impossible to mock out. So I resorted to sticking the question out there on [StackOverflow](http://stackoverflow.com/questions/41495153/how-do-i-run-a-service-fabric-exe-locally) to see what everyone else thought about the problem.

It seems that the only way to get my services up and running was to build, package and deploy a Service Fabric Application up to a Service Fabric cluster. I find that doing end-to-end testing throughout a project gives you a very high confidence that when you ship the software it is going to work as expected, and so I decided the cost to benefit ratio of spending the time investigating how I could achieve this was worthwhile.

# Let's get it deployed via NUnit

On the Service Fabric website there is an excessive amount of documentation on how to deploy Service Fabric applications using PowerShell or Visual Studio, which is useful for setting up our production environment but for my tests I wanted to be able to create, deploy and then destroy everything programmatically using C#. A while back when I was looking at Service Fabric examples I stumbled across a class [FabricClient](https://docs.microsoft.com/en-us/dotnet/api/system.fabric.fabricclient) which is a class for manipulating a Service Fabric cluster programmatically; this will allow us to perform operations related to applications.
So, to start with, we need to access the `ApplicationManager` on the `FabricClient` so we can perform application related operations.

```csharp
var client = new FabricClient();
var manager = client.ApplicationManager;

// Our operations
```

Within Service Fabric there are a few stages we have to go though before we can start interacting with our application, these are:
- Package application
- Copy application package to Service Fabric image store
- Provision application
- Create an instance of the application

After we have run our tests we will also need to tear down our application instance. 

## Packaging the application

Building a Service Fabric application (*.sfproj projects) does not build a deployable package. To create a deployable package we will have to execute `msbuild.exe` with a package argument.

The path to the `msbuild.exe` is located within the MS Build Tools, this location can differ between the version of Visual Studio installed so it's best to lookup the location via the registry. Within the registry this can be found with the key of `HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\MSBuild\ToolsVersions\4.0` and a value of `MSBuildToolsPath`.

We can check this by dropping in to the command line and executing `REG.exe`.

```batch
C:\>REG QUERY HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\MSBuild\ToolsVersions\4.0 /v MSBuildToolsPath

HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\MSBuild\ToolsVersions\4.0
    MSBuildToolsPath    REG_SZ    C:\Windows\Microsoft.NET\Framework64\v4.0.30319\
```

We will need to execute `msbuild.exe` with the following command arguments, that will then build a package in to the `\pkg\Debug` directory.

```batch
msbuild.exe c:\dev\SfApplication\SfApplication.sfproj /t:Package /p:Configuration=DEBUG,Platform=x64
```

We can now wrap this in some C# code to do the same thing.

```csharp
  public class MsBuildPacker
  {
      public void Pack(string projPath)
      {
          var msbuildPath = GetMsBuildToolPath();
          var process = Process.Start($@"{msbuildPath}\msbuild.exe",
              $@" ""{projPath}"" /t:Package /p:Configuration={Configuration.Current},Platform=x64");

          process.WaitForExit();

          if (process.ExitCode != 0)
          {
              throw new Exception("msbuild package failed");
          }
      }

      private string GetMsBuildToolPath()
      {
          return (string)Registry.GetValue(@"HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\MSBuild\ToolsVersions\4.0",
              "MSBuildToolsPath", null);
      }
  }

```

## Copy to the image store

This is a pretty simple step: all the applications that Service Fabric can provision have to be stored within the Service Fabric image store. Within the default Service Fabric development cluster this is located in `C:\SfDevCluster\Data\ImageStoreShare`. Using the `FabricClient` we can call the `CopyApplicationPackage` method passing in the `imageStoreConnectionString`, `applicationPackagePath` and `applicationPackagePathInImageStore`.

```csharp
var client = new FabricClient();

client.ApplicationManager.CopyApplicationPackage(@"file:C:\SfDevCluster\Data\ImageStoreShare",
                "C:\dev\SfApplication\SfApplication\pkg\DEBUG",
                "SfApplication");
```

## Provisioning an application

This is another easy step: we have to pass in the `applicationPackagePathInImageStore` value that we used in the `CopyApplicationPackage` method call and pass it in to `ProvisionApplicationAsync` method. This will then register our Service Fabric application type with the cluster.

```csharp
await client.ApplicationManager.ProvisionApplicationAsync("SfApplication")
                .ConfigureAwait(false);

```

## Create an instance

The last step before we start writing our functional tests is to create an instance of our application. One of the benefits of using Service Fabric is we can spin up multiple applications with different names. This allows us to isolate an instance per a given set of tests and within each instance of the application we can vary how the application runs by passing in application parameters. To create an instance we will need an `ApplicationDescription` and we'll pass this in to the `CreateApplicationAsync` on the `FabricClient`.

```csharp
var applicationDescription = new ApplicationDescription(new Uri($"fabric:/{Guid.NewGuid()}"),
                    "SfApplication",
                    "1.0.0",
                    new NameValueCollection()
                    {
                        // Application Parameters
                        { "SuperWebServiceUri", "http://api.super.com/" }
                    });

await client.ApplicationManager.CreateApplicationAsync(applicationDescription)
                                    .ConfigureAwait(false);
```

After executing the `CreateApplicationAsync` method Service Fabric will start deploying our application!

## Wrapping it up in NUnit.

Now we have all the pieces in place we can roll this in to a few classes to run before our tests.

To wrap up all the creating and deploying (and also destroying) of the service fabric I've created a class `FabricApplicationDeployer`.

```csharp

public class FabricApplicationDeployer : IDisposable
{
    private readonly string _packagePath;
    private readonly string _applicationType;
    private readonly string _applicationPathVersion;
    private readonly FabricClient _client;
    private string _imageStorePath;
    private readonly string _imageStoreConnectionString;
    private Uri _applicationName;

    public FabricApplicationDeployer(string packagePath, string applicationType, string applicationPathVersion)
    {
        this._packagePath = packagePath;
        this._applicationType = applicationType;
        this._applicationPathVersion = applicationPathVersion;
        _client = new FabricClient();
        _imageStoreConnectionString = @"file:C:\SfDevCluster\Data\ImageStoreShare";
    }

    public async Task<Uri> DeployAsync()
    {
        _imageStorePath = Guid.NewGuid().ToString();
        _applicationName = new Uri($"fabric:/{Guid.NewGuid()}");

        _client.ApplicationManager.CopyApplicationPackage(@"file:C:\SfDevCluster\Data\ImageStoreShare",
            _packagePath,
            _imageStorePath);

        await _client.ApplicationManager.ProvisionApplicationAsync(_imageStorePath)
            .ConfigureAwait(false);

        await _client.ApplicationManager.CreateApplicationAsync(
            new ApplicationDescription(_applicationName,
                _applicationType,
                _applicationPathVersion,
                new NameValueCollection()
                {

                })
        ).ConfigureAwait(false);

        return _applicationName;
    }

    public async Task RemoveAsync()
    {
        await _client.ApplicationManager.DeleteApplicationAsync(new DeleteApplicationDescription(_applicationName))
            .ConfigureAwait(false);

        await _client.ApplicationManager.UnprovisionApplicationAsync(_applicationType, _applicationPathVersion)
            .ConfigureAwait(false);

        _client.ApplicationManager.RemoveApplicationPackage(_imageStoreConnectionString, _imageStorePath);
    }

    public void Dispose()
    {
        RemoveAsync().GetAwaiter().GetResult();
    }
}

```

We can then use the `FabricApplicationDeployer` and `MsBuildPacker` within an _NUnit_ `SetUpFixture` so that it will run once before all of our tests.

```csharp
[SetUpFixture]
public class Initialize
{
    private FabricApplicationDeployer _deployer;

    public static Uri ApplicationUri { get; private set; }

    [OneTimeSetUp]
    public async Task SetUp()
    {
        var pathFinder = new PathFinder();
        var paths = pathFinder.Find("SfApplication");

        var applicationType = "SfApplicationType";
        var applicationTypeVersion = "1.0.0";

        var msBuildPackager = new MsBuildPacker();
        msBuildPackager.Pack(paths.SfProj);

        _deployer = new FabricApplicationDeployer(paths.SfPackagePath, applicationType, applicationTypeVersion);
        ApplicationUri = await _deployer.DeployAsync()
                                    .ConfigureAwait(false);
    }

    [OneTimeTearDown]
    public async Task Kill()
    {
        await _deployer.RemoveAsync()
            .ConfigureAwait(false);
    }
}

```

As you can see, I've wrapped away how we find the paths to the application within a `PathFinder` that returns a `ProjectPaths`.

```csharp

public class ProjectPaths
{
    public string SfProj { get; set; }

    public string SfPackagePath { get; set; }
}

```

Depending on how we run the tests we might need to change this around but the following implementation works well with `nunit3-console.exe` and _resharper_.

```csharp
public class PathFinder
{
    public ProjectPaths Find(string projectName)
    {
        var codeBase = new Uri(Assembly.GetExecutingAssembly().CodeBase).LocalPath;
        var slnRoot = codeBase.Substring(0, codeBase.IndexOf(@"\FunctionalTests", StringComparison.Ordinal));

        var applicationRoot = $@"{slnRoot}\{projectName}";

        var applicationSfProj = $@"{applicationRoot}\{projectName}.sfproj";
        var packagePath = $@"{applicationRoot}\pkg\{Configuration.Current}";

        return new ProjectPaths()
        {
            SfProj = applicationSfProj,
            SfPackagePath = packagePath
        };
    }
}
```

# Let's write a test!

Now we have all the code in place to allow us to create our application with Service Fabric, we will write a simple health checker test that makes sure that our application and services are running ok.

```csharp

[TestFixture]
public class ApplicationHealthTests
{
    private FabricClient _fabricClient;

    [SetUp]
    public void SetUp()
    {
        _fabricClient = new FabricClient();
    }

    [Test]
    public async Task ShouldHaveAnOkAggregatedHealthState()
    {
        var applicationHealth = await GetApplicationHealth()
                                        .ConfigureAwait(false);

        Assert.That(applicationHealth.AggregatedHealthState, Is.EqualTo(HealthState.Ok));
    }

    [Test]
    public void ShouldHaveHealthyMyStatelessService()
    {
        var uriBuilder = new UriBuilder(Initialize.ApplicationUri);
        uriBuilder.Path += "/MyStatelessService";

        Assert.That(async () => await GetServiceHealthState(uriBuilder.Uri).ConfigureAwait(false), Is.EqualTo(HealthState.Ok).After(30000, 200));
    }
    
    private async Task<ApplicationHealth> GetApplicationHealth()
    {
        var applicationHealth =
            await _fabricClient.HealthManager
                .GetApplicationHealthAsync(Initialize.ApplicationUri)
                .ConfigureAwait(false);

        return applicationHealth;
    }

    private async Task<HealthState?> GetServiceHealthState(Uri serviceUri)
    {
        return (await GetApplicationHealth().ConfigureAwait(false))
                    .ServiceHealthStates
                    .FirstOrDefault(x => x.ServiceName == serviceUri)
                    ?.AggregatedHealthState;
    }
}

```

This is a little simple but from this we can start testing our application end-to-end, be it either an API or an MVC website. I've added a little sample to my github ([EndToEndServiceFabric](https://github.com/kevbite/EndToEndServiceFabric)) this one shows an example of testing a REST API which is hosted within Service Fabric.
