---
layout: post
title: Debugging .NET Configuration
categories:
tags: [.NET, Configuration, Debugging]
description: How to debug your .NET Configuration to find out where the configuration values came from
comments: true
---

When you've got multiple configuration sources such as [AWS Systems Manager Parameter Store](https://github.com/aws/aws-dotnet-extensions-configuration) or 
[AWS Key Management Service](https://github.com/Kralizek/AWSSecretsManagerConfigurationExtensions), particularly when certain ones override other default ones which are set for development purposes, it's useful to be able to debug your .NET configuration where each value is loaded from.

## GetDebugView on IConfigurationRoot

The `IConfigurationRoot` interface which the default `ConfigurationRoot` implements has an extension method of [GetDebugView](https://github.com/dotnet/runtime/blob/5528e84e4826cdbe6e625f12bd1fdaa8954d795b/src/libraries/Microsoft.Extensions.Configuration.Abstractions/src/ConfigurationRootExtensions.cs#L36) that creates a string debug output of all the configuration values and their sources.

Within your program.cs class after the call to the `Build()` method on the `WebApplicationBuilder` you can get the configuration and cast it to a `IConfigurationRoot` and then call the `GetDebugView` method.

```csharp
var app = builder.Build();

if (app.Configuration is IConfigurationRoot configurationRoot)
{
    Console.WriteLine(configurationRoot.GetDebugView());
}
```

This will then output the following on startup:

```text
AllowedHosts=* (JsonConfigurationProvider for 'appsettings.json' (Optional))
ALLUSERSPROFILE=C:\ProgramData (EnvironmentVariablesConfigurationProvider Prefix: '')
applicationName=GetDebugViewExample (Microsoft.Extensions.Configuration.ChainedConfigurationProvider)
ASPNETCORE_ENVIRONMENT=Development (EnvironmentVariablesConfigurationProvider Prefix: '')
ASPNETCORE_URLS=https://localhost:7053;http://localhost:5020 (EnvironmentVariablesConfigurationProvider Prefix: '')
CommonProgramFiles(x86)=C:\Program Files (x86)\Common Files (EnvironmentVariablesConfigurationProvider
contentRoot=C:\dev\GetDebugViewExample (MemoryConfigurationProvider)
ENVIRONMENT=Development (EnvironmentVariablesConfigurationProvider Prefix: 'ASPNETCORE_')
Logging:
  LogLevel:
    Default=Information (JsonConfigurationProvider for 'appsettings.Development.json' (Optional))
    Microsoft.AspNetCore=Warning (JsonConfigurationProvider for 'appsettings.Development.json' (Optional))
```

As you can see each key has a corresponding value using the format of {key}={value}, and the structured configuration values are spaced indented trees. Also you'll notice in brackets, you'll see the configuration provider that supplied that data and some settings that were used for that provider.

For example the value of `AllowedHosts` key has come from the `JsonConfigurationProvider` source with the path setting of `appsettings.json`.

## GetDebugView Process Value Callback with .NET 7

The `GetDebugView` function is invaluable when trying to debug configuration values, however, if you have secure secrets within your configuration then you'll want to obfuscate the configuration values so they don't get outputted. Within .NET 7 a feature was added to allow you to [hide values](https://github.com/dotnet/runtime/issues/60065). This allows you to add a simple callback which the return value is the new value that is used in the output.

For example the below code will output `"super secret"` for all configuration values.

```csharp
var app = builder.Build();

if (app.Configuration is IConfigurationRoot configurationRoot)
{
    Console.WriteLine(configurationRoot.GetDebugView(_ => "Super Secret"));
}
```

```text
AllowedHosts=Super Secret (JsonConfigurationProvider for 'appsettings.json' (Optional))
ALLUSERSPROFILE=Super Secret (EnvironmentVariablesConfigurationProvider Prefix: '')
applicationName=Super Secret (Microsoft.Extensions.Configuration.ChainedConfigurationProvider)
ASPNETCORE_ENVIRONMENT=Super Secret (EnvironmentVariablesConfigurationProvider Prefix: '')
ASPNETCORE_URLS=Super Secret (EnvironmentVariablesConfigurationProvider Prefix: '')
CommonProgramFiles(x86)=Super Secret (EnvironmentVariablesConfigurationProvider
contentRoot=Super Secret (MemoryConfigurationProvider)
ENVIRONMENT=Super Secret (EnvironmentVariablesConfigurationProvider Prefix: 'ASPNETCORE_')
Logging:
  LogLevel:
    Default=Super Secret (JsonConfigurationProvider for 'appsettings.Development.json' (Optional))
    Microsoft.AspNetCore=Super Secret (JsonConfigurationProvider for 'appsettings.Development.json' (Optional))
```

Even though none of our `"Super Secret"` values are seen, we can still see where that configuration was loaded which is super helpful for debugging.

The value passed in to the callback (`ConfigurationDebugViewContext`) allows you to narrow down which values you don't want to be outputted. This contains following arguments which you can use

- Path (Path of current item)
- Key (Current key)
- Value (Current value)
- ConfigurationProvider (Provider that was used to get the current value of the current item)

Knowing that we can be a bit more creative with hiding our secrets, for this instance we'll imagine we use AWS KMS (Key Management Service) and we want to hide all values which were loaded from KMS. We can check the provider that was supplier to the callback and only write out none secure values.

```csharp
Console.WriteLine(configurationRoot.GetDebugView(context => context switch
{
    { ConfigurationProvider: SecretsManagerConfigurationProvider } => "Super Secret",
    _ => context.Value
}));
```
