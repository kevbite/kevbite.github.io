---
layout: post
title: Build and Releasing with VSTS for multiple AWS Serverless Stacks
categories:
tags: [AWS, VSTS, Serverless, C#, CloudFormation, CI]
description: A how to, for splitting up the build and release pipelines for AWS Serverless Applications in VSTS
comments: true
---

With any project it's always good to be able to split up the build and the release stages of your application. This allows you to just keep propagating the same build artifacts across each environment so you can be confident that the code will work the same once it gets to production.

## Prerequisites

For this example we will require the following to be setup:

- [Visual Studio 2017 (Community edition will work fine)](https://visualstudio.microsoft.com/downloads/)
- [AWS Toolkit for Visual Studio 2017](https://aws.amazon.com/visualstudio/)
- [VSTS Account](https://visualstudio.microsoft.com/team-services/)
- [AWS Tools for Microsoft Visual Studio Team Services](https://marketplace.visualstudio.com/items?itemName=AmazonWebServices.aws-vsts-tools)

## Project

To get started we will use one of the sample templates within the AWS Toolkit. Open up Visual studio and from the _New Project_ menu select _AWS Serverless Application (.NET Core)_, enter a name and location for your application and then click _OK_.

![visual-studio-new-project]

For simplicity we will be using the _Simple S3 Function_ template.

![visual-studio-new-aws-serverless-application]

This template will create us an AWS Lambda function and also a CloudFormation template that will create a S3 bucket and a Function that will trigger every time a object is created within the S3 bucket.

Let's start by modifying this so when an object is created in our S3 bucket we call a http endpoint with the bucket name, object key and the cloud formation stack name in which this function was created from:

```json
{
    "event": "ObjectCreated",
    "bucketName": "my-bucket-name",
    "objectKey": "my-object.png",
    "stackName": "my-cloud-formation-stack-name"
}
```

We'll then need to modify the C# Lambda function to provide the required functionality.

```csharp
public class Function
{
    public static HttpClient HttpClient { get; } = new HttpClient();

    public static string StackName { get; } = Environment.GetEnvironmentVariable("STACK_NAME");
    public static string HttpEndpoint { get; } = Environment.GetEnvironmentVariable("HTTP_ENDPOINT");

    public async Task FunctionHandler(S3Event evnt, ILambdaContext context)
    {
        var s3Event = evnt.Records?[0].S3;
        if(s3Event == null)
        {
            return;
        }

        var json = JsonConvert.SerializeObject(new
        {
            @event = "ObjectCreated",
            bucketName = s3Event.Bucket.Name,
            objectKey = s3Event.Object.Key,
            stackName = StackName
        });
        var responseMessage = await HttpClient.PostAsync(HttpEndpoint, new StringContent(json))
                                            .ConfigureAwait(false);

        responseMessage.EnsureSuccessStatusCode();
        context.Logger.LogLine($"Posted JSON '{json}' to {HttpEndpoint}");
    }
}
```

The last step is to extend the CloudFormation template (`serverless.template`) and where we need to pass in our new environment variables required by our C# function.

```json
{
    "AWSTemplateFormatVersion": "2010-09-09",
    "Transform": "AWS::Serverless-2016-10-31",
    "Description": "Template that creates a S3 bucket and a Lambda function that will be invoked when new objects are upload to the bucket.",
    "Parameters": {
        "BucketName": {
            "Type": "String",
            "Description": "Name of S3 bucket to be created. The Lambda function will be invoked when new objects are upload to the bucket. If left blank a name will be generated.",
            "MinLength": "0"
        },
        "HttpEndpoint": {
            "Type": "String",
            "Description": "The Http endpoint to where to post data to when objects are created in the S3 bucket.",
            "MinLength": "1"
        }
    },
    "Conditions": {
        "BucketNameGenerated": {
            "Fn::Equals": [
                {
                    "Ref": "BucketName"
                },
                ""
            ]
        }
    },
    "Resources": {
        "Bucket": {
            "Type": "AWS::S3::Bucket",
            "Properties": {
                "BucketName": {
                    "Fn::If": [
                        "BucketNameGenerated",
                        {
                            "Ref": "AWS::NoValue"
                        },
                        {
                            "Ref": "BucketName"
                        }
                    ]
                }
            }
        },
        "S3Function": {
            "Type": "AWS::Serverless::Function",
            "Properties": {
                "Handler": "MyCompany.MyServerlessApp::MyCompany.MyServerlessApp.Function::FunctionHandler",
                "Runtime": "dotnetcore2.1",
                "CodeUri": "",
                "Description": "Default function",
                "MemorySize": 256,
                "Timeout": 30,
                "Role": null,
                "Policies": [
                    "AWSLambdaFullAccess"
                ],
                "Events": {
                    "NewImagesBucket": {
                        "Type": "S3",
                        "Properties": {
                            "Bucket": {
                                "Ref": "Bucket"
                            },
                            "Events": [
                                "s3:ObjectCreated:*"
                            ]
                        }
                    }
                },
                "Environment": {
                    "Variables": {
                        "STACK_NAME": {
                            "Ref": "AWS::StackName"
                        },
                        "HTTP_ENDPOINT": {
                            "Ref": "HttpEndpoint"
                        }
                    }
                }
            }
        }
    },
    "Outputs": {
        "Bucket": {
            "Value": {
                "Ref": "Bucket"
            },
            "Description": "Bucket that will invoke the lambda function when new objects are created."
        }
    }
}
```

## Push to source control

Now we have done all our alterations to our Serverless Application, let's create a git repository, commit our changes and push it to a our hosted git solution of choice (we'll be using VSTS).

```powershell
Invoke-WebRequest -Uri https://raw.githubusercontent.com/
github/gitignore/master/VisualStudio.gitignore -OutFile .gitignore

git init

git add .

git commit -m "MyServerlessApp"

git remote add origin https://mycompany.visualstudio.com/myproject/_git/MyCompany.MyServerlessApp

git push -u origin --all
```

Notice we're also downloading the `VisualStudio.gitignore` from GitHub to be used, this will exclude all the files and folders made by visual studio but not required.

## The Build

### Build Source

Let's go to the _Build and Release_ section of VSTS, then we will create a new Build definition then select the source of the build, in our case it will be the git repository that we've just pushed to in the last section.

![create-build-select-your-repository]

When asked to _select a template_ choose the _Empty Process_ option as we will be creating our own build pipeline.

## Build Pipeline

Our build pipeline will consist of 5 parts:

- dotnet restore
- dotnet build
- dotnet lambda package
- Copy serverless.template
- Publish artifacts

![vsts-build-pipeline-phase-1]

### dotnet restore

The `dotnet restore` and `dotnet build` steps will just be the default dotnet core steps with the command of `restore` and `build` selected retrospectively.

![vsts-build-dotnet-restore]

![vsts-build-dotnet-build]

### dotnet lambda package

Our `dotnet lambda package` will be a dotnet core step with a custom command of `lambda`, however, we will have to specify some additional arguments:

```bash
package --output-package $(build.artifactstagingdirectory)/MyCompany.MyServerlessApp.zip
```

![vsts-build-dotnet-lambda-package]

This will tell the lambda cli to create us a lambda serverless package that can be deployed later down the line.

### Copy serverless.template

Well also need to include the CloudFormation template (`serverless.template`) in our deployment artifacts. This task copies `serverless.template` in to the VSTS artifact staging directory.

![vsts-build-copy-serverless-template]

### Publish Artifact

We'll need to add a _Publish Artifacts_ task with the standard defaults that will creates a artifact with the name of `drop` from the `$(build.artifactstagingdirectory)` path.

![vsts-build-publish-artifact]

### Running the build

Save and queue a build, once it has completed successfully you will notice that an artifact of the name of `drop` will be attached to the build. If you navigate in to this artifact you'll see our built C# serverless application.

![vsts-build-success-artifacts]

![vsts-build-artifacts-explorer]

## Release Pipeline

Now we have our build artifacts ready to deploy, we will need to create a Release pipeline to deploy to AWS.

However, before we get started on our pipeline, we need to Install the AWS VSTS Extensions and Configure a AWS Service Endpoint. We will not cover the details of setting this up, but you can follow the [Getting Started](https://docs.aws.amazon.com/vsts/latest/userguide/getting-started.html) section of the AWS VSTS documentation which will guide you through the process.

### New Pipeline

Now within the _All release pipelines_ section of VSTS, We can create a new Release pipeline then from the _Select a template_ screen, select _Empty process_ (once again we will be building our own pipeline).

![vsts-new-pipeline-select-a-template]

This will now give us an empty canvas to work with.

![vsts-new-pipeline-empty-process]

#### Artifacts

To start with we need to tell VSTS where to pull artifacts to use within our release pipeline. Select the _Add an artifact_ block and select the project where we build our artifacts within the last section. We will just leave the settings as the default as this will work perfectly for our scenario.

![vsts-release-add-an-artifact]

#### Environments

##### DevTest Environment

Now let's create our first environment, we'll call this `DevTest` for the time being but feel free to name it corresponding to your stack that you will be creating.

Our environment needs 2 tasks to deploy the serverless application:

- Create Temp csproj
- Deploy to Lambda

![vsts-release-pipeline-devtest-tasks]

###### Create temp project file

We need to first create a temporary `csproj` file with a CLI Tool reference to `Amazon.Lambda.Tools` as the Lambda deploy task runs a `dotnet restore` and uses the `Amazon.Lambda.Tools` CLI internally. You can checkout this [GitHub Issue](https://github.com/aws/aws-vsts-tools/issues/80) for more information.

We can create a file in multiple ways within VSTS but for simplicity we will use the [File Creator](https://marketplace.visualstudio.com/items?itemName=eliostruyf.build-task) VSTS Task.

For the _File path_ we will set it to `$(System.DefaultWorkingDirectory)/_MyApplication-CI/drop/Tools.csproj`.

For the file content we'll set it to the following:

```text
<Project Sdk="Microsoft.NET.Sdk">

  <PropertyGroup>
    <TargetFramework>netcoreapp2.1</TargetFramework>
  </PropertyGroup>

  <ItemGroup>
    <DotNetCliToolReference Include="Amazon.Lambda.Tools" Version="2.2.0" />
  </ItemGroup>

</Project>
```

![vsts-release-pipeline-file-creator]

###### AWS Lambda .NET Core Deployment

Next we will create a AWS Lambda deployment task that will fill-in the rest of the serverless.template and then push it to CloudFormation with our code to create us a new CloudFormation stack.

Select the _AWS Credentials_ you wish to use for this deployment, note that these will have to have the correct permissions within AWS to create all the given resources required by CloudFormation.

Select the region where you want this CloudFormation stack deploying, we'll be using `EU (Ireland) [eu-west-1]`

We will also be deploying a Serverless Application, so select the _Serverless Application_ from the _Deployment Type_.

Give the stack a name, we'll call ours `DevTest-MyApp`, we'll also need a place to store the serverless templates, we've already created a S3 bucket of `faedb8aa-86a3-4575-8e0e-c106cbbaee67`.

The tricky part is the additional lambda tools command line arguments, we need to pass in a `package` of the zip file within our deployment artifacts, `template` for the base template to use when deploying the CloudFormation template and also the template `template-parameters`. For our DevTest we will use the following values

```bash
--package "$(System.DefaultWorkingDirectory)/_MyApplication-CI/drop/MyCompany.MyServerlessApp.zip" --template "$(System.DefaultWorkingDirectory)/_MyApplication-CI/drop/serverless.template" --template-parameters "HttpEndpoint=http://requestbin.fullcontact.com/1f7hhs71;BucketName="
```

![vsts-release-pipeline-deploy-to-lambda]

###### Testing the Release Pipeline

If we now go and create a release from the latest version of the artifacts this will automatically create our new template for our DevTest stack push it to S3.

![vsts-release-pipeline-devtest-release-test]

![vsts-release-pipeline-devtest-release-test-s3-template]

And eventually the CloudFormation will start to build our serverless application stack.

![aws-cloudformation-devtest-stack]

![aws-cloudformation-devtest-stack-overview]

###### Testing the DevTest Stack

We can now test that our serverless application works as expected by dropping a file in to our newly created S3 bucket, which should posts a message to our endpoint that we gave CloudFormation when creating our stack (http://requestbin.fullcontact.com/1f7hhs71).

If we navigate to the resources section of the CloudFormation stack, we will see a link to our new S3 bucket that was created.

![aws-cloudformation-devtest-stack-resources]

We can click the link and we will end up at the S3 bucket within the AWS Console, upload a file and watch the magic begin!

Now if we flip back to [RequestBin](https://requestbin.fullcontact.com) we will notice that we have had a post request hit our endpoint with all the information we would of expected.

![requestbin-devtest-capture]

We can also check CloudWatch to see our log messages which are also automatically streamed from Lambda to CloudWatch.

![aws-cloudwatch-devtest]

##### Production Environment

Our DevTest environment now fully working, we need to setup our Production environment of the Serverless Application, we can simple do this by going back to our release pipeline and copying our current _AWS DevTest_ environment.

![vsts-release-pipeline-clone-devtest-environment]

Once cloned, rename the environment to _AWS Production_.

![vsts-release-pipeline-environments]

We will now have to alter our _Stack Name_ within our _AWS Lambda .NET Core Deployment_ task, this time we will call it `Production-MyApp` and now we are ready to roll our application to production!

> **Note**: We could of also change our CloudFormation template parameters such as `HttpEndpoint` to point to another endpoint for production but for simplicity we'll keep them the same.

###### Create another release

The only thing left to do now is create another release and allow CloudFormation to build our production environment for our serverless application.

![vsts-release-pipeline-production-release]

![aws-cloudformation-stacks]

Now that everything is built you'll notice that we now have identical stacks between DevTest and Production. We can go upload another file in to our newly create production s3 bucket, and this will trigger off our production dotnet core lambda function.

![requestbin-production-capture]

Below you can also see the 2 lambda functions that were created for each stack by CloudFormation.

![aws-functions]

## Combined Power of VSTS and AWS CloudFormation

As you can appreciate this gives us lots of power to allow VSTS to track our work items and also allows us to progress them in to each environment instead of the default way of just having a stack deployed on every build.


[aws-cloudformation-devtest-stack-overview]: \assets\posts\2018-08-13-build-and-releasing-with-vsts-for-multiple-aws-serverless-stacks\aws-cloudformation-devtest-stack-overview.png "aws cloudformation devtest stack overview"

[aws-cloudformation-devtest-stack-resources]: \assets\posts\2018-08-13-build-and-releasing-with-vsts-for-multiple-aws-serverless-stacks\aws-cloudformation-devtest-stack-resources.png "aws cloudformation devtest stack resources"
[aws-cloudformation-devtest-stack]: \assets\posts\2018-08-13-build-and-releasing-with-vsts-for-multiple-aws-serverless-stacks\aws-cloudformation-devtest-stack.png "aws cloudformation devtest stack"
[aws-cloudformation-stacks]: \assets\posts\2018-08-13-build-and-releasing-with-vsts-for-multiple-aws-serverless-stacks\aws-cloudformation-stacks.png "aws cloudformation stacks"
[aws-cloudwatch-devtest]: \assets\posts\2018-08-13-build-and-releasing-with-vsts-for-multiple-aws-serverless-stacks\aws-cloudwatch-devtest.png "aws cloudwatch devtest"
[aws-functions]: \assets\posts\2018-08-13-build-and-releasing-with-vsts-for-multiple-aws-serverless-stacks\aws-functions.png "aws functions"
[build-and-releasing-with-vsts-for-multiple-aws-serverless-stacks.md]: \assets\posts\2018-08-13-build-and-releasing-with-vsts-for-multiple-aws-serverless-stacks\build-and-releasing-with-vsts-for-multiple-aws-serverless-stacks.md "build and releasing with vsts for multiple aws serverless stacks.md"
[create-build-select-your-repository]: \assets\posts\2018-08-13-build-and-releasing-with-vsts-for-multiple-aws-serverless-stacks\create-build-select-your-repository.png "create build select your repository"
[requestbin-devtest-capture]: \assets\posts\2018-08-13-build-and-releasing-with-vsts-for-multiple-aws-serverless-stacks\requestbin-devtest-capture.png "requestbin devtest capture"
[requestbin-production-capture]: \assets\posts\2018-08-13-build-and-releasing-with-vsts-for-multiple-aws-serverless-stacks\requestbin-production-capture.png "requestbin production capture"
[visual-studio-new-aws-serverless-application]: \assets\posts\2018-08-13-build-and-releasing-with-vsts-for-multiple-aws-serverless-stacks\visual-studio-new-aws-serverless-application.png "visual studio new aws serverless application"
[visual-studio-new-project]: \assets\posts\2018-08-13-build-and-releasing-with-vsts-for-multiple-aws-serverless-stacks\visual-studio-new-project.png "visual studio new project"
[vsts-build-artifacts-explorer]: \assets\posts\2018-08-13-build-and-releasing-with-vsts-for-multiple-aws-serverless-stacks\vsts-build-artifacts-explorer.png "vsts build artifacts explorer"
[vsts-build-copy-serverless-template]: \assets\posts\2018-08-13-build-and-releasing-with-vsts-for-multiple-aws-serverless-stacks\vsts-build-copy-serverless-template.png "vsts build copy serverless template"
[vsts-build-dotnet-build]: \assets\posts\2018-08-13-build-and-releasing-with-vsts-for-multiple-aws-serverless-stacks\vsts-build-dotnet-build.png "vsts build dotnet build"
[vsts-build-dotnet-lambda-package]: \assets\posts\2018-08-13-build-and-releasing-with-vsts-for-multiple-aws-serverless-stacks\vsts-build-dotnet-lambda-package.png "vsts build dotnet lambda package"
[vsts-build-dotnet-restore]: \assets\posts\2018-08-13-build-and-releasing-with-vsts-for-multiple-aws-serverless-stacks\vsts-build-dotnet-restore.png "vsts build dotnet restore"
[vsts-build-pipeline-phase-1]: \assets\posts\2018-08-13-build-and-releasing-with-vsts-for-multiple-aws-serverless-stacks\vsts-build-pipeline-phase-1.png "vsts build pipeline phase 1"
[vsts-build-publish-artifact]: \assets\posts\2018-08-13-build-and-releasing-with-vsts-for-multiple-aws-serverless-stacks\vsts-build-publish-artifact.png "vsts build publish artifact"
[vsts-build-success-artifacts]: \assets\posts\2018-08-13-build-and-releasing-with-vsts-for-multiple-aws-serverless-stacks\vsts-build-success-artifacts.png "vsts build success artifacts"
[vsts-new-pipeline-empty-process]: \assets\posts\2018-08-13-build-and-releasing-with-vsts-for-multiple-aws-serverless-stacks\vsts-new-pipeline-empty-process.png "vsts new pipeline empty process"
[vsts-new-pipeline-select-a-template]: \assets\posts\2018-08-13-build-and-releasing-with-vsts-for-multiple-aws-serverless-stacks\vsts-new-pipeline-select-a-template.png "vsts new pipeline select a template"
[vsts-release-add-an-artifact]: \assets\posts\2018-08-13-build-and-releasing-with-vsts-for-multiple-aws-serverless-stacks\vsts-release-add-an-artifact.png "vsts release add an artifact"
[vsts-release-pipeline-clone-devtest-environment]: \assets\posts\2018-08-13-build-and-releasing-with-vsts-for-multiple-aws-serverless-stacks\vsts-release-pipeline-clone-devtest-environment.png "vsts release pipeline clone devtest environment"
[vsts-release-pipeline-deploy-to-lambda]: \assets\posts\2018-08-13-build-and-releasing-with-vsts-for-multiple-aws-serverless-stacks\vsts-release-pipeline-deploy-to-lambda.png "vsts release pipeline deploy to lambda"
[vsts-release-pipeline-devtest-release-test-s3-template]: \assets\posts\2018-08-13-build-and-releasing-with-vsts-for-multiple-aws-serverless-stacks\vsts-release-pipeline-devtest-release-test-s3-template.png "vsts release pipeline devtest release test s3 template"
[vsts-release-pipeline-devtest-release-test]: \assets\posts\2018-08-13-build-and-releasing-with-vsts-for-multiple-aws-serverless-stacks\vsts-release-pipeline-devtest-release-test.png "vsts release pipeline devtest release test"
[vsts-release-pipeline-devtest-tasks]: \assets\posts\2018-08-13-build-and-releasing-with-vsts-for-multiple-aws-serverless-stacks\vsts-release-pipeline-devtest-tasks.png "vsts release pipeline devtest tasks"
[vsts-release-pipeline-environments]: \assets\posts\2018-08-13-build-and-releasing-with-vsts-for-multiple-aws-serverless-stacks\vsts-release-pipeline-environments.png "vsts release pipeline environments"
[vsts-release-pipeline-file-creator]: \assets\posts\2018-08-13-build-and-releasing-with-vsts-for-multiple-aws-serverless-stacks\vsts-release-pipeline-file-creator.png "vsts release pipeline file creator"
[vsts-release-pipeline-production-release]: \assets\posts\2018-08-13-build-and-releasing-with-vsts-for-multiple-aws-serverless-stacks\vsts-release-pipeline-production-release.png "vsts release pipeline production release"