---
layout: post
title: Creating a job scoped computed environment variable in GitHub Actions.
categories:
tags: [GitHub, Actions]
description: How to create a computed environment variable scoped across multiple steps within a job.
comments: true
---

A lot of the time we want to set a few environment variables scoped at the job level within a workflow. Variables scoped to the job level would mean that all steps within that job would have access to these environment variables.

Let's take a look at a simple example how this would look in a GitHub Action Workflow:

```yaml
name: Example Workflow
on: [push]

jobs:
  example-job:
    name: An example job
    runs-on: ubuntu-latest
    env:
      MY_ENV_1: My environment variable 1
      MY_ENV_2: My environment variable 2
      
    steps:
      - name: Echo MY_ENV_1
        run: echo $MY_ENV_1
        
      - name: Echo MY_ENV_2
        run: echo $MY_ENV_2
      
      - name: Echo MY_ENV_1 and MY_ENV_2
        run: echo $MY_ENV_1, $MY_ENV_2
```

Here we are setting 2 environment variables scoped to the job and then using them in the steps contained. When the following workflow is run, we'll see the following output:

![an-example-job-run-github-actions]

As we can see each of our steps have access to the environment variables `MY_ENV_1` and `MY_ENV_2`



But what about if we wanted to compute the environment variable, say we've got a version we want to share across the job that all steps will use?

## Computed environment variables

Within GitHub actions we can use an [expression syntax](https://help.github.com/en/actions/reference/context-and-expression-syntax-for-github-actions#example-setting-an-environment-variable) to create more complex expressions.

These expressions can be used in environment variables. Below is a workflow example of a job that has 2 steps, both declare an environment variable `MY_VERSION` which is set to `"1.0."` appended with the [github run number](https://help.github.com/en/actions/reference/context-and-expression-syntax-for-github-actions#github-context).

```yml
name: Example Workflow
on: [push]

jobs:
  example-job:
    name: An example job
    runs-on: ubuntu-latest     
    steps:
      - name: Echo MY_VERSION step 1
        run: echo $MY_VERSION
        env:
          MY_VERSION: 1.0.${{ github.run_number }}

      - name: Echo MY_VERSION step 2
        run: echo $MY_VERSION
        env:
          MY_VERSION: 1.0.${{ github.run_number }}
```
When this workflow is run it will output the following.

![computed-step-envs]

As we can see our version variable is being echoed, however, having the environment variable declared multiple times is just error prone and confusing.

It would be really nice if we could create a [DRY](https://en.wikipedia.org/wiki/Don%27t_repeat_yourself) solution and just move that environment variable up to the job scope.

```yml
  
name: Example Workflow
on: [push]

jobs:
  example-job:
    name: An example job
    runs-on: ubuntu-latest     
    env:
      MY_VERSION: 1.0.${{ github.run_number }}
    steps:
      - name: Echo MY_VERSION step 1
        run: echo $MY_VERSION

      - name: Echo MY_VERSION step 2
        run: echo $MY_VERSION
```

As you can see, we can pull this variable up in the yml to the job, and it'll run the same:

![computed-job-envs]


[an-example-job-run-github-actions]: \assets\posts\2020-04-25-creating-a-job-scoped-computed-environment-variable-in-github-actions\an-example-job-run-github-actions.png "An example GitHub Action workflow run"

[computed-step-envs]: \assets\posts\2020-04-25-creating-a-job-scoped-computed-environment-variable-in-github-actions\an-steps-with-envs-github-actions.png "Example workflow with computed environment variables in GitHub Actions"

[computed-job-envs]: \assets\posts\2020-04-25-creating-a-job-scoped-computed-environment-variable-in-github-actions\an-job-with-envs-github-actions.png "Example workflow with computed job environment variables in GitHub Actions"
