---
layout: post
title: Deploying multiple applications to an auto scaling group with CodeDeploy
categories:
tags: [AWS, Windows, CodeDeploy, EC2, Auto Scaling Groups]
description: A workaround for deploying multiple applications to the same Amazon EC2 instance in an Auto Scaling group at the same time
comments: true
---

# Our setup

Part of our current setup within AWS has a single auto scaling group associated to 6 CodeDeploy applications, however this is [discorraged in the AWS documentation](http://docs.aws.amazon.com/codedeploy/latest/userguide/troubleshooting-auto-scaling.html)
> Deploying multiple application revisions to the same Amazon EC2 instance in an Auto Scaling group at the same time can fail if one of the deployments has scripts that run for more than a few minutes. Do not deploy multiple application revisions to the same Amazon EC2 instances in an Auto Scaling group

AWS recommends that we should have an auto scale group per application, this would mean running 6+ servers instead of 1. However, this is not ideal for our scenario due to costing. We also did not want to package up all our applications in to one deployable CodeDeploy artifact and deploy all the application at once to a single server as we would not be able to deploy this artifact to all our environments in an identical way.

# The problem

The first thing we saw when running our setup was that when the scale group instantiated another instance at least one CodeDeploy deployment would fail but others would succeed with no problems.

![deployment-statuses]

Checking the details of the error just gave us a generic _Deployment Failed_ message.

> **Deployment Failed**
> The overall deployment failed because too many individual instances failed deployment, too few healthy instances are available for deployment, or some instances in your deployment group are experiencing problems. (Error code: HEALTH_CONSTRAINTS)

![deployment-failed]

We also drill down in to the instance that has failed, which tells us that the life cycle events did not run.

> **One or more lifecycle events did not run and the deployment was unsuccessful. Possible causes include:**
> (1) Multiple deployments are attempting to run at the same time on an instance;
> (2) The AWS CodeDeploy agent has stopped. Restart the agent. Learn more

![events-error]

Once the instance had failed deploying then the auto scale group would terminate the instance then try to create a new one thus being in a continious loop forever.

# Trying to find a solution

Ignoring the fact that AWS does not recommend this setup, we still tried to proceed with this. Googling this issue resulted in not much information so we decided to invest in a bit of trail and error to see if we could just configure it to work.

## Health Check Grace Period

Our first assumption was that the scale group was terminating the instance before it had chance to complete deploying all the applications. With us running windows we had already increased the _Health Check Grace Period_ setting within the scale group due to the slow startups, but we decided increase this more and doubled it to 1200 seconds (20 minutes).

Changing the _Health Check Grace Period_ setting actually had no effect at all on scaling up the instances, so we ended up just setting the value back to it's previous state.
 
## Lifecycle Hook Heartbeat Timeout

When you link a CodeDeploy application to a auto scaling group it will create a life cycle hook within the auto scaling group to trigger off to deploy the application. These life cycle hooks are set to a timeout of 600 seconds (10 minutes). However if you create the hooks manually it gives a default timeout of 3600 seconds (60 minutes). We decided to increase all our 6 hooks to the same timeout to see what difference it would make.

Increasing the default timeout actually made it so that code deploy would have longer to deploy the applications but still at least one application would fail but then it would get retried once the application failed but then constantly failed.

## Deleting Lifecycle Hooks

We then decided that if we could not automatically trigger off the deployments we would turn off that feature by deleting the life cycle hooks on the scale group. We deleted all 6 of the hooks which made it so that none of the CodeDeploy deployments would run after a instance was created. This obviously worked perfectly fine, but our newly created instance would require manually deploying each application. Just to note that when we did manually deployed each application to the new instance, it would also join the target group associated to the deployment group.

# Our solution

Surprisingly our solution was to delete the life cycle hooks to stop the triggering of the deployments. The idea behind this was to slowly release one application at a time, instead of trying to bulk deploy all 6 applications. Within the [AWS documentation](https://aws.amazon.com/blogs/devops/under-the-hood-aws-codedeploy-and-auto-scaling-integration/) it states that each step of the depoyment can not take longer than 5 minutes to complete, so rolling each application out one at a time would hopefully work.

## Deploying the applications

We initially thought that we could trigger off an AWS Lambda and get the Lambda to roll out the application slowly but soon realised this would not be possible due to the [maximum execution duration per request being 300 seconds](http://docs.aws.amazon.com/lambda/latest/dg/limits.html).

Our second option was to get the machine that had just started to call CodeDeploy to start deploying all the applications. There is multiple ways to do this depending on what you feel comfortable with, if you have the [aws cli](http://docs.aws.amazon.com/cli/latest/userguide/cli-chap-welcome.html) pre-installed on your base image you can just add a script in to your User Data for the launch configuration which will deploys each application and then pauses for a bit before deploying the next:

```xml
<powershell>
aws deploy create-deployment --application-name Service-A --deployment-group-name Staging --update-outdated-instances-only

Start-Sleep 600

aws deploy create-deployment --application-name Service-B --deployment-group-name Staging --update-outdated-instances-only

Start-Sleep 600

aws deploy create-deployment --application-name Service-C --deployment-group-name Staging --update-outdated-instances-only

</powershell>
```

Notice that we are specifying _update outdated instances only_ which will only to instances that are not running the latest application revision.

You can also do a similar if you are using the [AWS JavaScript SDK](https://aws.amazon.com/sdk-for-node-js/). We actually went with using the JavaScript SDK and ran the deployment from node as it was a little easier to script out monitoring the deployments before it rolled out the next deployment, thus ment that we did not have to have arbortary sleeps within our scripts.

## Premisions

One thing to note, is that the EC2 instance needs to be running under a IAM role that has access to deploy applications through code deploy. This is however fairly simple to setup due to the built in policies. Just find your role for the EC2 instance and attach the built in policy of `arn:aws:iam::aws:policy/AWSCodeDeployDeployerAccess` which is the following policy:
```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Action": [
                "codedeploy:Batch*",
                "codedeploy:CreateDeployment",
                "codedeploy:Get*",
                "codedeploy:List*",
                "codedeploy:RegisterApplicationRevision"
            ],
            "Effect": "Allow",
            "Resource": "*"
        }
    ]
}
```

[deployment-statuses]: \assets\posts\2017-10-20-deploying-multiple-applications-to-an-auto-scaling-group-with-codedeploy\deployment-statuses.png "Deployment Statuses"

[deployment-failed]: \assets\posts\2017-10-20-deploying-multiple-applications-to-an-auto-scaling-group-with-codedeploy\deployment-failed.png "Deployment Failed"

[events-error]: \assets\posts2017-10-20-deploying-multiple-applications-to-an-auto-scaling-group-with-codedeploy\events-error.png "Events Error"

