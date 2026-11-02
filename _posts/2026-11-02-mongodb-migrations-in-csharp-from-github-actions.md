---
layout: post
title: MongoDB Migrations in C# from GitHub Actions
categories:
tags: [MongoDB, .NET, AWS, GitHub Actions, Migrations]
description: How we run MongoDB migrations as a one-off Fargate task from GitHub Actions, before any new code is deployed, and keep a record of every operation they ran
comments: true
---

A couple of months ago I wrote about [the MongoDB decimal change that quietly broke our migration](https://kevsoft.net/2026/09/14/the-mongodb-decimal-change-that-quietly-broke-our-migration.html). The short version: a driver upgrade left us with money stored as strings in some documents and as `Decimal128` in others, and the migration we wrote to tidy it up fell over on the very first string.

What I didn't dwell on at the time was *where* that migration ran, and how little it told us. It ran as a background job inside our API. When it failed, it failed politely. It logged an error, got retried, failed again on the same document, and made no progress whatsoever. Meanwhile, the deploy that shipped it had sailed through with a lovely green tick, and nothing anywhere said how many orders it had actually changed. (None. It had changed none.)

That's been nagging at me ever since, because it isn't really a decimal problem. It's a "where do migrations live" problem, and running them inside the app gives you four of them:

- The new code is already taking requests before its data changes are in place.
- When a migration fails, nothing anyone is watching goes red.
- Every instance of the app has a go at running it.
- Nothing records what it actually did.

What I actually want is easy to say: **run the migrations once per deploy, before any of the new code runs, fail the build if they fail, and keep a record of exactly what they did.** Something like this:

```text
build → test → push image → migrate → deploy
```

If `migrate` goes red, nothing after it happens, and the old code carries on quite happily against the old data.

Let's build that with GitHub Actions, an app running on AWS Fargate, and a database on MongoDB Atlas.

## Meet Kevsoft.MigrateMongo

Full disclosure: the migration tool in this post is one I wrote. I wanted migrations that are:

- written in C# with the normal MongoDB driver;
- run in a transaction when the cluster supports it;
- guarded by a lock, so two runs can't trip over each other;
- checksummed, so nobody quietly edits one that's already been applied;
- able to tell you exactly what they did.

It's called [Kevsoft.MigrateMongo](https://github.com/kevbite/Kevsoft.MigrateMongo.Tool), and the [usage guide](https://github.com/kevbite/Kevsoft.MigrateMongo.Tool/blob/main/USAGE.md) covers everything I'm about to skim over.

Migrations live in a small console project that you own. Here's the second migration from the decimal post, the one that fills in each order line's `LineTotal`:

```csharp
[Migration("20261022090000", "backfill-line-totals")]
public sealed class BackfillLineTotals : IMigration
{
    public async Task UpAsync(MigrationContext context, CancellationToken cancellationToken)
    {
        var orders = context.Track(context.Database.GetCollection<BsonDocument>("orders"), "backfilled");

        await orders.UpdateManyAsync(
            Builders<BsonDocument>.Filter.Exists("Lines.LineTotal", false),
            LineTotalFromPriceAndQuantity, // the $map pipeline from the decimal post
            cancellationToken: cancellationToken);

        var empty = await orders.Collection.CountDocumentsAsync(
            context.Session, Builders<BsonDocument>.Filter.Size("Lines", 0), cancellationToken: cancellationToken);
        context.Results.Set("emptyOrders", empty);
        if (empty > 0)
        {
            context.Results.Note($"{empty} orders have no lines.", NoteLevel.Warning);
        }
    }

    // DownAsync unsets LineTotal again
}
```

`context.Track` wraps the collection. The update runs exactly as it normally would, inside the migration's transaction with the session passed for you, but it also gets written down:

- what kind of operation it was;
- its filter and update;
- how many documents it matched and modified;
- how long it took.

The `"backfilled"` label adds those counts to the migration's results. `context.Results` holds anything else worth keeping, like a count or a warning.

A `migrate-mongo.yaml` points the project at a database:

```yaml
project: src/MyApp.Migrations
mongodb:
  url: ${MONGODB_URL}
  databaseName: shop
```

And running it looks like this:

```text
$ dotnet migrate-mongo up
Built src/MyApp.Migrations/MyApp.Migrations.csproj (3.3s)
Runner: Kevsoft.MigrateMongo 1.0.0 · MongoDB.Driver 3.13.0 · .NET 10.0.14 · protocol 1
Acquired lock (run 05d63952bd8541e29d4890bdca002726).
▶ 20261022090000 backfill-line-totals
  warning: 3 orders have no lines.
✔ 20261022090000 backfill-line-totals   (0.21s, transaction)
    backfilled   matched 12480 · modified 12477 · upserted 0
    emptyOrders  3
    1 operation(s) recorded – migrate-mongo show 20261022090000
Applied 1 migration(s) in batch 1.
```

Look at those counts. They aren't a log line somebody remembered to write. They're what MongoDB reported back, and they've already caught something: 12,480 orders matched, but only 12,477 were modified. The missing three are the empty orders. Mapping over an empty array changes nothing, so MongoDB doesn't count them as modified. It's a harmless difference this time, but it's exactly the kind of detail you'd never see if all you had was "migration complete". Hang on to that output, because we'll see it again in a GitHub Actions log, and once more after that.

Behind the scenes the tool keeps three collections:

- `_migrations`, with one document per migration, including its results and operations;
- `_migrations.history`, an append-only log;
- `_migrations.lock`, which only exists while a run is in progress. It's what stops two deploys applying the same migration twice.

Two more things matter for the rest of this post. First, **bundles**. `migrate-mongo bundle -r linux-x64` publishes your migrations project as a single self-contained executable, so the machine that runs it doesn't need .NET at all. Ours comes out at about 80 MB. Second, **exit codes**, because the pipeline leans on them:

| Exit code | Meaning |
|---|---|
| `0` | Success |
| `1` | A migration failed |
| `3` | Timed out waiting for another run's lock |
| `4` | Validation failed: an applied migration was edited or removed |
| `5` | The tool is older than the migrations it's running |

## The catch: CI can't see the database

Here's where my lovely diagram hits reality. Our cluster lives on MongoDB Atlas, and it's locked down twice over:

- **The network.** It's only reachable over private networking from inside our AWS VPC (VPC peering or PrivateLink both work). Its host names resolve to private addresses, and nothing on the public internet can even open a connection.
- **Identity.** There are no database passwords at all. Each app signs in with its own AWS IAM role, and each role is a database user that can only reach that app's own data.

Getting onto the network isn't enough. You have to *be* one of the apps.

A GitHub-hosted runner fails on both counts. It can look the host names up all day long, but it can't reach them, and it has no role the database recognises. And honestly, that's the right way round: nobody should be poking holes in either so the build server can get in. So the question isn't how to get the database out to CI. It's how to get the migrations into the network as an app of their own.

## Ways round it

The first idea everyone has is to skip CI altogether and run the migrations when the app starts. The tool can even do that for you with `RunOnStartup()` from `Kevsoft.MigrateMongo.Hosting`, and for plenty of apps that's fine. But look closely and it's the decimal problem again: a failed migration gives you a failed rollout somewhere, not a red step in the build.

So, back to CI. Here's what we weighed up:

| Option | Verdict |
|---|---|
| Allow-list the runners in Atlas | GitHub publishes over 7,000 IP ranges for Actions, shared with everyone else. Static IPs need larger runners on GitHub Enterprise Cloud. |
| Bastion host and an SSH tunnel | Works, and the tool can open the tunnel itself, but it's a box to patch and a private key sitting in your secrets. |
| Self-hosted runner in the VPC | Great if lots of jobs need the network; a fleet to look after if it's just this. |
| **A one-off task in the VPC** | Same network path as the apps, an IAM role of its own, nothing opened inbound, nothing secret in CI. |

I'll admit we really did go looking for a jump box first.

So we went with the one-off task. The app already runs on ECS Fargate, which proves both the network path to Atlas and the IAM authentication work. The migrations ride on exactly the same thing, as one more app with a role of its own. CI's only job is to say "run this, and tell me how it went".

## Packaging the migrations

The migrations project stands on its own, outside the app's solution, so building the app never depends on it. To get it into a container, bundle it and build an image on top of the tool's own `-bundle` image, which is `runtime-deps` plus the `migrate-mongo` tool:

```dockerfile
FROM ghcr.io/kevbite/migrate-mongo:1.0.0-bundle
COPY bundle/ /src/
USER $APP_UID
CMD ["up", "--runner", "./MyApp.Migrations"]
```

The bundle could run on its own, but having the tool drive it with `--runner` means every run starts with that `Runner:` line, so the log records exactly which versions did the work. Two things to remember:

- **Keep the image tag on the same version as your packages.** A tool that's older than the runner it's driving stops with exit code `5`.
- **The image's entrypoint is now `migrate-mongo`.** So for an ad-hoc command like `show`, you need to repeat the `--runner` bit. More on `show` shortly.

Just like the apps, the migrations sign in without a password. Reference `Kevsoft.MigrateMongo.Aws` from the migrations project and ask for AWS IAM auth in the connection string:

```text
mongodb+srv://shop-pri.ab1cd.mongodb.net/?authSource=%24external&authMechanism=MONGODB-AWS
```

The driver picks up the ECS task role's credentials and signs in with those. One gotcha: pin `MongoDB.Driver.Authentication.AWS` to the same version as `MongoDB.Driver`, otherwise the two can end up on different versions.

## The task, its role and its logs

Now for the infrastructure. I'm using the CDK in C#, so everything stays in one language. Here's the migrations stack, trimmed down:

```csharp
public class MigrationsStack : Stack
{
    public MigrationsStack(Construct scope, string id, MigrationsStackProps props) : base(scope, id, props)
    {
        var vpc = Vpc.FromLookup(this, "Vpc", new VpcLookupOptions { VpcId = props.VpcId });
        var cluster = new Cluster(this, "Cluster", new ClusterProps { Vpc = vpc });

        var taskRole = new Role(this, "TaskRole", new RoleProps
        {
            RoleName = $"myapp-migrations-{props.EnvironmentName}",
            AssumedBy = new ServicePrincipal("ecs-tasks.amazonaws.com"),
        });

        var taskDefinition = new FargateTaskDefinition(this, "Task", new FargateTaskDefinitionProps
        {
            Family = $"myapp-migrations-{props.EnvironmentName}",
            Cpu = 256,
            MemoryLimitMiB = 512,
            TaskRole = taskRole,
        });

        var logGroup = new LogGroup(this, "Logs", new LogGroupProps { Retention = RetentionDays.ONE_MONTH });
        var repository = Repository.FromRepositoryName(this, "Repository", "myapp-migrations");

        taskDefinition.AddContainer("Migrations", new ContainerDefinitionOptions
        {
            ContainerName = "Migrations",
            Image = ContainerImage.FromEcrRepository(repository, (string)Node.TryGetContext("imageTag")),
            Logging = LogDrivers.AwsLogs(new AwsLogDriverProps { LogGroup = logGroup, StreamPrefix = "migrations" }),
            Environment = new Dictionary<string, string> { ["MONGODB_URL"] = props.MongoDbUrl },
        });

        var securityGroup = new SecurityGroup(this, "SecurityGroup", new SecurityGroupProps { Vpc = vpc });

        new CfnOutput(this, "ClusterName", new CfnOutputProps { Value = cluster.ClusterName });
        new CfnOutput(this, "TaskDefinitionArn", new CfnOutputProps { Value = taskDefinition.TaskDefinitionArn });
        // ...and the subnets, security group, log group and container name
    }
}
```

A few choices in there are deliberate:

- **It has its own cluster**, because in a brand-new environment the migrations run before the app's cluster exists.
- **The image is pinned to the commit.** `imageTag` comes in from the workflow as the commit SHA, so the task runs exactly the migrations that were just tested.
- **It's plain Fargate, not Spot.** Spot can be taken away, and losing a task halfway through a migration that isn't in a transaction leaves it stuck as `applying`.
- **The role has a fixed name**, because Atlas names its database user after it.

Here's the Atlas side, as one Atlas CLI command. Like every other app's user, it can only touch its own database:

```bash
atlas dbusers create \
  --username arn:aws:iam::123456789012:role/myapp-migrations-production \
  --awsIAMType ROLE \
  --role readWrite@shop
```

You don't need to say anything about the `$external` auth database: the CLI sets it for IAM users itself, and it won't let you give them a password either. If your migrations ever change validators with `collMod`, add `dbAdmin` as well.

## Letting GitHub Actions in, and no further

GitHub Actions gets into AWS with OpenID Connect, so there are no access keys in your secrets. The workflow asks for a token like this:

```yaml
permissions:
  id-token: write
  contents: read
```

That second line matters more than it looks. As soon as you set any permission, all the others drop to none. Without `contents: read`, your checkout step suddenly can't see your own repository.

On the AWS side, the deploy role trusts tokens from your repository's production environment:

```json
"Condition": {
  "StringEquals": {
    "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
    "token.actions.githubusercontent.com:sub": "repo:my-org/my-app:environment:production"
  }
}
```

Watch that `sub` format. Repositories created before 15 July 2026 use the `repo:OWNER/REPO:environment:NAME` form above. [Newer repositories](https://docs.github.com/en/actions/reference/security/oidc) default to an immutable format that adds the owner's and repository's ids, and GitHub only documents what that looks like for branches. So rather than guess, drop this step into the deploy job once and copy what it prints:

```yaml
- name: Show the OIDC subject
  run: |
    curl -s -H "Authorization: bearer $ACTIONS_ID_TOKEN_REQUEST_TOKEN" \
      "$ACTIONS_ID_TOKEN_REQUEST_URL&audience=sts.amazonaws.com" \
      | jq -r '.value | split(".")[1] | gsub("-"; "+") | gsub("_"; "/") | @base64d | fromjson | .sub'
```

Those `gsub`s matter. Tokens use URL-safe base64, which the snippet in GitHub's archived [OIDC debugger](https://github.com/github/actions-oidc-debugger) can choke on, because it pipes the token straight into `base64 -d`.

Running the migrations needs very little:

- `ecs:RunTask` on the migrations task definition;
- `ecs:DescribeTasks`;
- `iam:PassRole` on just the task's two roles;
- `logs:GetLogEvents` on its log group;
- `cloudformation:DescribeStacks`, to read the stack's outputs.

`cdk deploy` also wants to assume the CDK bootstrap roles. If it can't, it says `current credentials could not be used to assume …` and carries on with the workflow's own credentials, which then need the deploy permissions themselves. Either way, CI can *start* the migrations but never holds a database credential at all.

## Running it and watching it

The first version of the script that runs the task was the obvious one:

```bash
task=$(aws ecs run-task --cluster "$cluster" --task-definition "$task_definition" \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[$subnets],securityGroups=[$security_group]}" \
  --query 'tasks[0].taskArn' --output text)

aws ecs wait tasks-stopped --cluster "$cluster" --tasks "$task"
aws logs tail "$log_group" --log-stream-name-prefix "migrations/Migrations/${task##*/}"
```

It works, right up until it doesn't, for three reasons:

- `aws ecs wait tasks-stopped` gives up after 10 minutes (100 checks, 6 seconds apart) with exit code 255. Any longer migration fails the build while it's still running perfectly happily.
- You see nothing at all until the very end.
- CloudWatch can receive the last few lines just *after* the task stops, so the tail can miss the most interesting bit: the error.

So the second version does three things differently:

- It checks `failures[0].reason`, because a task that never started doesn't give you an ARN.
- It prints new log lines as they arrive.
- When the task stops, it keeps reading for a while longer.

Here it is in full:

```bash
#!/usr/bin/env bash
# Runs the migrations task from a migrations stack to completion, printing its output as it goes,
# and fails if the migrations did.
#
#   scripts/run-migrations.sh <stack name>
set -euo pipefail

stack=$1

output() {
  aws cloudformation describe-stacks --stack-name "$stack" \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue | [0]" --output text
}

cluster=$(output ClusterName)
task_definition=$(output TaskDefinitionArn)
container=$(output ContainerName)
subnets=$(output SubnetIds)
security_group=$(output SecurityGroupId)
log_group=$(output LogGroupName)

task=$(aws ecs run-task \
  --cluster "$cluster" \
  --task-definition "$task_definition" \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[$subnets],securityGroups=[$security_group],assignPublicIp=DISABLED}" \
  --started-by "github-${GITHUB_RUN_ID:-manual}" \
  --query 'tasks[0].taskArn || failures[0].reason' --output text)

if [[ "$task" != arn:aws:ecs:* ]]; then
  echo "The migrations task didn't start: $task"
  exit 1
fi
echo "Started $task"

log_stream="migrations/$container/${task##*/}"
log_token=""
log_errors=$(mktemp)
log_error_reported=""
trap 'rm -f "$log_errors"' EXIT

# Prints the task's log lines that haven't been printed yet, and fails if there weren't any.
# Reads at most 10 pages at a time, so a busy stream can't hold up the status checks.
print_new_logs() {
  local args page next printed=1 pages=0
  while [ "$pages" -lt 10 ]; do
    args=(--log-group-name "$log_group" --log-stream-name "$log_stream" --output json)
    if [ -n "$log_token" ]; then args+=(--next-token "$log_token"); else args+=(--start-from-head); fi

    if ! page=$(aws logs get-log-events "${args[@]}" 2>"$log_errors"); then
      # The stream only exists once the container has started.
      if ! grep -q ResourceNotFoundException "$log_errors" && [ -z "$log_error_reported" ]; then
        echo "Couldn't read the task's logs: $(cat "$log_errors")"
        log_error_reported=1
      fi
      return 1
    fi

    jq -r '.events[] | "\(.timestamp / 1000 | floor | todate) \(.message)"' <<<"$page"
    if [ "$(jq '.events | length' <<<"$page")" -gt 0 ]; then printed=0; fi

    # The end of the stream, for now, is the page that hands back the token it was asked for.
    next=$(jq -r '.nextForwardToken' <<<"$page")
    if [ "$next" = "$log_token" ]; then return $printed; fi
    log_token=$next
    pages=$((pages + 1))
  done
  return $printed
}

last_status=""
while true; do
  status=$(aws ecs describe-tasks --cluster "$cluster" --tasks "$task" --query 'tasks[0].lastStatus' --output text)
  if [ "$status" != "$last_status" ]; then
    echo "Migrations task is $status"
    last_status=$status
  fi
  [ "$status" = "STOPPED" ] && break
  print_new_logs || true
  sleep 5
done

# CloudWatch can receive the last lines after the task has stopped, so keep reading until it's been quiet for a while.
quiet_polls=0
while [ "$quiet_polls" -lt 3 ]; do
  sleep 5
  if print_new_logs; then quiet_polls=0; else quiet_polls=$((quiet_polls + 1)); fi
done

exit_code=$(aws ecs describe-tasks --cluster "$cluster" --tasks "$task" \
  --query "tasks[0].containers[?name=='$container'] | [0].exitCode" --output text)

if [ "$exit_code" != "0" ]; then
  reason=$(aws ecs describe-tasks --cluster "$cluster" --tasks "$task" \
    --query "[tasks[0].stoppedReason, tasks[0].containers[?name=='$container'] | [0].reason]" --output text)
  case "$exit_code" in
    3) meaning="another run held the migrations lock" ;;
    4) meaning="validation failed: an applied migration was edited or removed" ;;
    5) meaning="the migrate-mongo image is older than the Kevsoft.MigrateMongo packages" ;;
    None) meaning="the container didn't run" ;;
    *) meaning="a migration failed" ;;
  esac
  echo "Migrations failed with exit code $exit_code ($meaning). $reason"
  exit 1
fi
```

It starts by reading the migrations stack's outputs, so the workflow only has to pass the stack's name. Here's how the rest works:

- **Streaming the logs.** `get-log-events` hands back a forward token with every page. You've reached the end of the stream (so far) when it hands back the same token you asked with.
- **While the task runs**, the script reads new lines every 5 seconds, at most ten pages at a time, so a chatty migration can't hold up the status checks.
- **Once the task stops**, it keeps reading until three polls in a row bring nothing new.
- **At the end**, it turns the container's exit code into a message using the table from earlier.

All it needs is the AWS CLI and `jq`, and GitHub's Ubuntu runners come with both.

There's one thing it deliberately *doesn't* do, and that's give up and stop the task. Stopping a task halfway through a migration that isn't in a transaction is exactly how you get one stuck as `applying`. If something really does hang, the job's `timeout-minutes` ends the job, the task carries on, and the lock is released when it finishes.

And here's the payoff: the same output we saw on my machine, counts and all, now in the Actions log and running against production:

```text
Run ./scripts/run-migrations.sh MyApp-Migrations-production
Started arn:aws:ecs:eu-west-2:123456789012:task/myapp-migrations-production/7d1c9e04a2b54f6c9e8a31f0b5d27c4e
Migrations task is PROVISIONING
Migrations task is PENDING
Migrations task is RUNNING
2026-11-02T09:14:36Z Runner: Kevsoft.MigrateMongo 1.0.0 · MongoDB.Driver 3.13.0 · .NET 10.0.14 · protocol 1
2026-11-02T09:14:41Z Acquired lock (run 8e2f5a17c04d4b9a9f6e2d3c1b0a7f58).
2026-11-02T09:14:42Z ▶ 20261022090000 backfill-line-totals
2026-11-02T09:14:43Z   warning: 3 orders have no lines.
2026-11-02T09:14:44Z ✔ 20261022090000 backfill-line-totals   (2.43s, transaction)
2026-11-02T09:14:44Z     backfilled   matched 41207 · modified 41204 · upserted 0
2026-11-02T09:14:44Z     emptyOrders  3
2026-11-02T09:14:44Z     1 operation(s) recorded – migrate-mongo show 20261022090000
2026-11-02T09:14:44Z Applied 1 migration(s) in batch 2.
Migrations task is DEPROVISIONING
Migrations task is STOPPED
```

As for timings, getting from `run-task` to that first line takes around 40 seconds, while Fargate finds some capacity and pulls the image. Another 5 or so go on looking up the cluster and signing in with the task's role, and then the migrations themselves. All in, the migrate step adds a minute or two to a deploy. The very first deploy takes a little longer, because CloudFormation has to create the stack (about 40 seconds for ours).

## The best bit: every operation, written down

Logs are great while you're watching. But CI logs get tidied away (GitHub keeps them for 90 days by default), CloudWatch's get tidied away too, and the questions I actually get asked about a migration tend to come months later. *What exactly did that change in production? How many orders did it touch? What did that index look like before we dropped it?*

This is my favourite part of the tool. Everything a migration records is stored with it, on its document in `_migrations` and on its history entry, so the database itself remembers. `show` puts the lot on one screen:

```text
$ migrate-mongo show 20261022
Runner: Kevsoft.MigrateMongo 1.0.0 · MongoDB.Driver 3.13.0 · .NET 10.0.14 · protocol 1
20261022090000 backfill-line-totals
  State     applied (batch 2, up, transaction)
  Applied   2026-11-02 09:14:44 by app@ip-10-0-3-17 (2.38s)
  Checksum  sha256:0c42cc28e360b5df3578c229212681dbf10437d22188167b6214023c32797a79
  Source    csharp MyApp.Migrations.Migrations.BackfillLineTotals
  Versions  tool migrate-mongo/1.0.0 (linux-x64; aot), library 1.0.0, driver 3.13.0
  Run       8e2f5a17c04d4b9a9f6e2d3c1b0a7f58

Results
  backfilled   { matched: 41207, modified: 41204, upserted: 0 }
  emptyOrders  3

Notes
  09:14:43  warning  3 orders have no lines.

Operations
  1. updateMany orders [backfilled]  matched 41207 · modified 41204 · upserted 0  (2.21s)
       filter: { Lines.LineTotal: { $exists: false } }
       update: [{ $set: { Lines: { $map: { input: "$Lines", as: "line", in: { $mergeObjects: ["$$line", { LineTotal: { $multiply: ["$$line.UnitPrice", "$$line.Quantity"] } }] } } } } }]

History
 At                   ID              Name                  Event    Batch  Run       Host          Error  Results
 2026-11-02 09:14:44  20261022090000  backfill-line-totals  applied  2      8e2f5a17  ip-10-0-3-17         backfilled: matched 41207 · modified 41204 · upserted 0, em…
```

There's a lot packed into that, so let me pick out what makes it so useful:

- **The counts are MongoDB's, not yours.** They come straight from the server's result, so a migration that quietly modified nothing can't hide behind a cheerful log line. `modified 0` would be sitting right there, just like the three empty orders are here.
- **You get the statement that actually ran.** The exact filter and update, which is the first thing you reach for when the numbers look odd. If your filters contain data you'd rather not keep, `results.captureStatements: false` turns statements off and keeps only the kinds, counts and timings.
- **Dropping an index records it first.** A tracked `DropIndexAsync` saves the index's full definition before dropping it, so a migration (or a rollback) that removes an index leaves you the recipe to put it back.
- **Failures keep what they recorded.** A migration that fails keeps everything it recorded up to that point. If its transaction was aborted, the results are marked `resultsCommitted: false` and the log says `(transaction aborted – changes not persisted)`, so you can tell what it *tried* from what actually *stuck*.
- **It's all just documents.** Results are stored as native BSON, so you can query them like anything else. Every migration that has ever touched the orders collection is one query away:

  ```js
  db["_migrations"].find({ "operations.collection": "orders" }, { name: 1, results: 1 })
  ```

And because `show` is just another command, you can run it right where the database is, with the very same task. No bastion needed to look, either:

```bash
aws ecs run-task --cluster "$cluster" --task-definition "$task_definition" --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[$subnets],securityGroups=[$security_group]}" \
  --overrides '{"containerOverrides":[{"name":"Migrations","command":["show","20261022","--runner","./MyApp.Migrations"]}]}'
```

## Wiring up the workflow

Here's the workflow, trimmed down to the interesting parts:

{% raw %}
```yaml
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-dotnet@v6
      - run: dotnet tool restore
      - run: dotnet migrate-mongo bundle -r linux-x64 -o bundle
      - run: docker build -t myapp-migrations:${{ github.sha }} -f Dockerfile.migrations .
      # ...and on main, push it to ECR

  test:
    runs-on: ubuntu-latest
    services:
      mongo:
        image: mongodb/mongodb-atlas-local:8.0
        ports: ["27017:27017"]
        options: --health-interval 5s
    env:
      MONGODB_URL: mongodb://localhost:27017/?directConnection=true
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-dotnet@v6
      - run: dotnet tool restore
      - run: dotnet migrate-mongo up
      - run: dotnet migrate-mongo down --batch --no-build
      - run: dotnet migrate-mongo up --no-build
      - run: dotnet migrate-mongo validate --no-build

  deploy-production:
    if: github.ref == 'refs/heads/main'
    needs: [build, test]
    runs-on: ubuntu-latest
    environment: production
    concurrency:
      group: deploy-production
      cancel-in-progress: false
    timeout-minutes: 40
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-dotnet@v6
      - uses: aws-actions/configure-aws-credentials@v6
        with:
          role-to-assume: arn:aws:iam::123456789012:role/myapp-deploy-production
          aws-region: eu-west-2
      - run: npx aws-cdk@2 deploy MyApp-Migrations-production -c imageTag=${{ github.sha }} --require-approval never
      - run: ./scripts/run-migrations.sh MyApp-Migrations-production
      - run: npx aws-cdk@2 deploy MyApp-production -c imageTag=${{ github.sha }} --require-approval never
```
{% endraw %}

The `test` job runs the migrations against a throwaway `mongodb-atlas-local` service container. It's a single-node replica set, so transactions work just like they do in Atlas. Applying everything, rolling it back and applying it again catches a migration that doesn't undo cleanly long before anyone merges it.

The image has a built-in health check, and the runner won't start your steps until the service reports healthy. You'll see a "Waiting for all services to be ready" group at the top of the job. The check only runs every 30 seconds, though. Anything in `options` is passed to `docker create`, so `--health-interval 5s` speeds it up without replacing it.

A few things in the deploy job are worth calling out:

- **There are two stacks, deployed in that order.** Anything in the app's stack that takes new code, like a task definition or a Lambda function, would ship before the migrations if they shared a stack. (Even a C# CDK app gets deployed with the Node CLI, hence the `npx`.)
- **`cancel-in-progress: false`.** Cancelling a deploy halfway through a migration is exactly what we don't want. The tool's lock would cope with two runs anyway, but belt and braces.
- **Required reviewers on the `production` environment** give you a manual "are you sure?" before anything touches production. Be warned, though: on the Free, Pro and Team plans they [only work on public repositories](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments).

Pull requests only get `build` and `test`, so nothing in a PR ever touches a real database.

## Writing migrations that run before the code

Running migrations first changes how you write them, so here are a few rules we stick to:

- **Track what you touch.** Wrap collections with `context.Track` and record anything worth knowing later in `context.Results`. Future you will be grateful.
- **Expand, then contract.** The old code is still serving traffic while the migration runs, and if the deploy rolls back, it's the old code again afterwards. Every migration has to work with the code that's running *now*. Removing things waits for a later release.
- **Keep them quick and idempotent.** A transactional migration can be retried, and the job has a time limit. A long, throttled backfill doesn't belong in a deploy gate.
- **Never edit one that's been applied.** The checksum will catch you, so write a new one instead.
- **Allow out-of-order migrations** (`allowOutOfOrder: true`) if pull requests merge in any order. A migration's id is the time it was created, not the time it was merged.

## Wrapping up

So, back to that decimal migration. With this setup, it would have failed in the `migrate` step, the build would have gone red, and the new code would never have shipped against data it couldn't handle. And if it had ever "succeeded" while changing nothing, the counts would have said so, in the job log and in the database, for as long as we cared to look.

What we ended up with is pleasingly boring: no bastion, no database credentials in CI, and a permanent record of every operation each migration ran.

How do you run your migrations, and how do you find out afterwards what they did? On start-up, in CI, or by hand on a Friday afternoon? Let me know in the comments.
