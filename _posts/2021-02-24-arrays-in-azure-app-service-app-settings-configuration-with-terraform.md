---
layout: post
title: Arrays in Azure App Service App Settings Configuration with Terraform
categories:
tags: [Terraform, Configuration, .NET, ASP.NET Core]
description: How to pass arrays to ASP.NET Core Configuration with Terraform in Azure App Services
comments: true
---

## Setting up

The new ASP.NET Core Configuration is already setup and ready to go to load environment variables (checkout the [default configuration](https://docs.microsoft.com/en-us/aspnet/core/fundamentals/configuration/?view=aspnetcore-5.0#default-configuration)). So if we create a simple ASP.NET Core Web API project, we can set some environment variables and our controller actions will response with the correct output.

If we go ahead and create a ASP.NET API from the templates by using `dotnet new`

```bash
dotnet new webapi
```

This will give us some basics to build on to. Now let's just create an `AppOptions` class to bind out configuration to and register it within our `ConfigureServices` method within `Startup.cs`.

```csharp
public class AppOptions
{
    public string Name { get; set; }
    public string[] Names { get; set; }
}

public class Startup
{
    public Startup(IConfiguration configuration) => Configuration = configuration;

    public IConfiguration Configuration { get; }

    public void ConfigureServices(IServiceCollection services)
    {
        services.AddControllers();
        services.Configure<AppOptions>(Configuration);
    }
}
```

Next up is creating our controller, we'll create a `NamesController` to just output the values of the current `AppOptions`.

```csharp
[ApiController, Route("[controller]")]
public class NamesController : ControllerBase
{
    [HttpGet]
    public object Get([FromServices] IOptionsSnapshot<AppOptions> options)
    {
        return options.Value;
    }
}
```

Now spin up the project with `dotnet run` and then we can curl the `/names` endpoint (or another tool of choice).

```bash
❯ curl http://localhost:5000/names
{"name":null,"names":null}
```

Now if we stop the .NET app and then set some variables for the child processes, we'll be able to see these in the API response.

Below is setting the variables using bash, however, if you're in windows you can use `$env:Name=xxx` in PowerShell.

```bash
export NAME=TestName
export NAMES__0=TestName1
export NAMES__1=TestName2
export NAMES__2=TestName3
dotnet run
```

Now let's curl the endpoint and see our data get returned.

```bash
curl http://localhost:5000/names
{"name":"TestName","names":["TestName1","TestName2","TestName3"]}
```

The configuration library inside ASP.NET Core is doing a few magical things here, It's converting our `__0`, `__1`, `__3` in to items within our `Names` array at the given indexes. It's actually possible to just not pass an index at all and pass any string at the end of `__` and it will map it in to the array. Check out the below for an example.

```bash
export NAMES__NotAnIndex=TestNameHere
```

For more information what is going off behind the scenes you can read more on the [Microsoft Docs site](https://docs.microsoft.com/en-us/aspnet/core/fundamentals/configuration/?view=aspnetcore-5.0#environment-variables).

## Terraform Configuration

Now let's look how we'd configure our Terraform scripts to allow variables passed in by `.tfvar` files and how we can map these to our `app_settings` configuration block.

We'll start by taking the sample terraform configuration from the [provider docs](https://registry.terraform.io/providers/hashicorp/azurerm/latest/docs/resources/app_service). This will create us a resource group, app service plan and an app service.

```terraform
resource "azurerm_resource_group" "example" {
  name     = "example-resources"
  location = "West Europe"
}

resource "azurerm_app_service_plan" "example" {
  name                = "example-appserviceplan"
  location            = azurerm_resource_group.example.location
  resource_group_name = azurerm_resource_group.example.name

  sku {
    tier = "Standard"
    size = "S1"
  }
}

resource "azurerm_app_service" "example" {
  name                = "example-app-service"
  location            = azurerm_resource_group.example.location
  resource_group_name = azurerm_resource_group.example.name
  app_service_plan_id = azurerm_app_service_plan.example.id

  site_config {
    dotnet_framework_version = "v4.0"
    scm_type                 = "LocalGit"
  }

  app_settings = {
    "SOME_KEY" = "some-value"
  }
}
```

Now we want to add a terraform list variable of `names` we can do this by adding the following to our terraform script

```terraform
variable "names" {
  type        = list(string)
  description = "List of names."
}
```

Now we can convert our previous terraform script to use the `names` variable to create a map of strings that will be used for the app_settings instead.

```terraform
resource "azurerm_app_service" "example" {
  name                = "example-app-service"

  app_settings = {for idx, val in var.names: "NAMES__${idx}" => val}
}
```

The above is using a [for expression](https://www.terraform.io/docs/language/expressions/for.html) to create a map from a list with the index of the item appended in the key of `NAMES__`.

Let's create create a `terraform.tfvars` with our list of names.

```terraform
names = [
  "Kevin",
  "Sakis",
  "Irene",
]
```

Now we can do a `terraform plan` to see what it would create for us.

![terraform plan](\assets\posts\2021-02-24-arrays-in-azure-app-service-app-settings-configuration-with-terraform\terraform-plan-1.png "terraform plan")

As you can see our `names` variable has been flattened in to our app_settings in the correct format for ASP.NET Core Configuration.

This is perfect so far but we are most likely going to have other settings in our applications that we need to merge together with our list of names. Here we can pull our [for expression](https://www.terraform.io/docs/language/expressions/for.html) up in to a locals block and use a [merge function](https://www.terraform.io/docs/language/functions/merge.html). This will take 2 maps and merge them together.

```terraform
locals {
  appsettings  = merge({
    "APPLICATION__SETTING1" = "Value1"
    "APPLICATION__SETTING2" = "Value2"
  }, {for idx, val in var.names: "NAMES__${idx}" => val})
}
```

Now we'll just have to update our `azurerm_app_service` resource to reference the locals.
```terraform
resource "azurerm_app_service" "example" {
  name                = "example-app-service"

  app_settings = local.appsettings
}
```

Now when we do another `terraform plan` we'll see both lots of appsetttings merged together.

![terraform plan](\assets\posts\2021-02-24-arrays-in-azure-app-service-app-settings-configuration-with-terraform\terraform-plan-2.png "terraform plan")

