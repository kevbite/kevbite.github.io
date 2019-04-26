---
layout: post
title: Multi-line PowerShell in Terraform
categories:
tags: [Powershell, Terraform]
description: How to use multi-line PowerShell in terraform scripts.
comments: true
---

## Running a inline PowerShell statement

You most likely know that you can run arbitrary scripts using [local-exec provisioner](https://www.terraform.io/docs/provisioners/local-exec.html) within Terraform. These scripts are run on the local machine running Terraform, not on the resource that has just been created.

Say we have a script that just runs some PowerShell that prints out a name variable that was passed in we'd script it out like the following:

```terraform
variable "name" { }

resource "null_resource" "script1" {
  provisioner "local-exec" {
    command = "Write-Host \"Hello ${var.name}\""

    interpreter = ["PowerShell", "-Command"]
  }
}
```

Then when we apply these changes we'll get the following output.

```bash
$ terraform apply
var.name
  Enter a value: Bob


An execution plan has been generated and is shown below.
Resource actions are indicated with the following symbols:
  + create

Terraform will perform the following actions:

  + null_resource.script1
      id: <computed>


Plan: 1 to add, 0 to change, 0 to destroy.

Do you want to perform these actions?
  Terraform will perform the actions described above.
  Only 'yes' will be accepted to approve.

  Enter a value: yes

null_resource.script1: Creating...
null_resource.script1: Provisioning with 'local-exec'...
null_resource.script1 (local-exec): Executing: ["PowerShell" "-Command" "Write-Host \"Hello Bob\""]
null_resource.script1 (local-exec): Hello Bob
null_resource.script1: Creation complete after 0s (ID: 2394746270154995733)

Apply complete! Resources: 1 added, 0 changed, 0 destroyed.
```

As we'd expect we output `Hello Bob` to the console.

But how do we go about running multiple statements?

## Running multiple inline PowerShell statements

One mistake which is common is to set the `command` property multiple times:

```terraform
provisioner "local-exec" {
  command = "Write-Host \"Hello ${var.name}\""
  command = "Write-Host \"Bye \""

  interpreter = ["PowerShell", "-Command"]
}
```

However when executed this will just output the last command that was given.

```bash
null_resource.script1 (local-exec): Executing: ["PowerShell" "-Command" "Write-Host \"Goodbye\""]
null_resource.script1 (local-exec): Goodbye
```

To write a multi-line powershell statement in Terraform we can use the [heredoc](https://en.wikipedia.org/wiki/Here_document) syntax, this is where we start the string off with a `<<` followed by a delimiting identifier.

Knowing this we can change around the above script in to the following:

```terraform
provisioner "local-exec" {
  command = <<EOT
      Write-Host "Hello ${var.name}"
      Write-Host "Bye"
  EOT

  interpreter = ["PowerShell", "-Command"]
}
```

This will then output the expected results:

```bash
null_resource.script1 (local-exec): Executing: ["PowerShell" "-Command" "      Write-Host \"Hello Bob\"\n      Write-Host \"Bye\"\n    "]
null_resource.script1 (local-exec): Hello Bob
null_resource.script1 (local-exec): Bye
```

As you can see the script is much cleaner now as we're not having to escape the quotes within the powershell script.

## Wrapping in to a file?

It might also be ideal to abstract away your provisioning scripts, this makes it easier to run locally to test and also allows you to wrap Pester tests around them.

On the `interpreter` property on the `provisioner` we can pass in `-File` instead of `-Command` and then just reference a `.ps` file that we wish to execute.

```terraform
provisioner "local-exec" {
  command = "external.ps1"

  interpreter = ["PowerShell", "-File"]
}
```