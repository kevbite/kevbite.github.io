---
layout: post
title: Connecting to service containers from a multi-staged docker build in Bitbucket pipeline
categories:
tags: [Bitbucket, Pipelines, Docker, Continuous Integration, CI]
description: Secret Bitbucket environment variable allows you to connect to service containers from a multi-staged docker build in Bitbucket pipelines
comments: true
---

## Multi-staged Docker Builds

Multi-stage Docker builds allow you to write Docker files with multiple FROM statements. This means you can create images which derive from several bases, which can help cut the size of your final build.

Multi-stage Docker builds is a great way to encapsulate your entire build process in a single file which can be run on any machine. Dependencies such as Node.js or .NET can be installed as part of the process included from another public image.

## Bitbucket Service Containers

Part of most build peoples build process you'll run through a series of automated tests, these tests normally require 3rd party databases or services running such as MongoDB, MySQL, or even RabbitMQ.

Bitbucket has a feature called service containers, this allow you to declaratively specify your 3rd party services to run as containers next to your build environment.

For example we could create a service definition called `mongo` which runs the [mongo](https://hub.docker.com/_/mongo) docker image which will start up a mongod process in the background.

```yaml
definitions: 
  services: 
    mongo: 
      image: mongo:5.0.1
```

Then we can create a step using the same image but this time connect to the MongoDB instance running in the service container and output a list of all the databases. (Note: I'm using the tag of 4.4.7 for the pipeline step and a tag of 5.0.1 for the service definition so that we can see the difference in the logs)

```yaml
image: mongo:4.4.7
pipelines: 
  default: 
    - step: 
        script: 
          - mongo mongodb://127.0.0.1 --eval "db.adminCommand('listDatabases');"
        services: 
          - mongo
```

When the pipeline is run then we'll get the following logs:

```text
Images used:
    mongo : docker.io/library/mongo@sha256:d78c7ace6822297a7e1c7076eb9a7560a81a6ef856ab8d9cde5d18438ca9e8bf
    build : docker.io/library/mongo@sha256:90db999680d7f6c3fbed7a85e4de59771823a322f389d49fbbaafc5963824871
+ mongo mongodb://127.0.0.1 --eval "print('Hello from mongodb shell');"
MongoDB shell version v5.0.1
connecting to: mongodb://127.0.0.1:27017/?compressors=disabled&gssapiServiceName=mongodb
Implicit session: session { "id" : UUID("e8766f28-1a14-450e-92bf-63f7e3d83862") }
MongoDB server version: 5.0.1
WARNING: shell and server versions do not match
{
	"databases" : [
		{
			"name" : "admin",
			"sizeOnDisk" : NumberLong(8192),
			"empty" : false
		},
		{
			"name" : "config",
			"sizeOnDisk" : NumberLong(12288),
			"empty" : false
		},
		{
			"name" : "local",
			"sizeOnDisk" : NumberLong(8192),
			"empty" : false
		}
	],
	"totalSize" : NumberLong(28672),
	"totalSizeMb" : NumberLong(0),
	"ok" : 1
}
```

As you can see our mongo step (v5.0.1) connected to our MongoDB database (v5.0.1) running inside a Bitbucket service container.

This is great way to startup 3rd party services but doesn't work straight out the box when building inside a docker.

## Connecting to service containers from docker build

As mentioned multi-stage Docker builds are a great way to encapsulate the whole build process, this may include running tests that require 3rd party services which we'd normally set the hostname of the 3rd party service to `host.docker.internal` which is the IP address of the gateway between the Docker host and the bridge network, but within Bitbucket this doesn't work.

For simplicity we'll take our step above and wrap it in to a Dockerfile to act as our testing stage but pipe the results of the list databases command in to a file and create a final image that contains that single file.
```dockerfile
FROM mongo as build
RUN echo building...

FROM build as test
RUN mongo mongodb://host.docker.internal --eval "db.adminCommand('listDatabases');" > databases

FROM scratch as final
COPY --from=test databases .
```

If we build this locally with MongoDB running in another container exposing the database via port 27017 it will be successful.
```bash
docker build .

[+] Building 0.1s (8/8) FINISHED
 => [internal] load build definition from Dockerfile
 => => transferring dockerfile: 258B
 => [internal] load .dockerignore
 => => transferring context: 2B
 => [internal] load metadata for docker.io/library/mongo:latest
 => [build 1/2] FROM docker.io/library/mongo
 => [build 2/2] RUN echo building...
 => [test 1/1] RUN mongo mongodb://host.docker.internal --eval "db.adminCommand('listDatabases');" > databases
 => [final 1/1] COPY --from=test databases .
 => exporting to image
 => => exporting layers
 => => writing image sha256:8d893d90495099411fef786847663787cf42d10f1172e2437e37e5017cd1027e
 ```

 However, if we update our bitbucket build definition to include a `docker build` step it will fail with a connection error.

 ```yaml
image: atlassian/default-image:2
pipelines: 
  default: 
    - step: 
        script: 
          - docker build .
        services: 
          - mongo
          - docker
          
definitions: 
  services: 
    mongo: 
      image: mongo
 ```

 ```text
 ---> Running in 3d9d4d0414ab
The command '/bin/sh -c mongo mongodb://host.docker.internal --eval "db.adminCommand('listDatabases');" > databases' returned a non-zero code: 1
 ```

### Bitbucket Hidden Secrets

To solve the connection issue there's a secret undocumented environment variable of `BITBUCKET_DOCKER_HOST_INTERNAL`. This environment variable can be used as an alternative to `host.docker.internal` which we'd normally use locally. 

We can update our dockerfile to inject in a `MONGODB_HOSTNAME` build argument defaulting it to `host.docker.internal` but allowing us to pass in another value from our Bitbucket step.

```dockerfile
ARG MONGODB_HOSTNAME=host.docker.internal
FROM mongo as build
RUN echo building...

FROM build as test
ARG MONGODB_HOSTNAME
RUN mongo mongodb://$MONGODB_HOSTNAME --eval "db.adminCommand('listDatabases');" > databases

FROM scratch as final
COPY --from=test databases .
```

Then we can update our build step to pass in the special Bitbucket variable.

```yaml
  - docker build --build-arg MONGODB_HOSTNAME=$BITBUCKET_DOCKER_HOST_INTERNAL .
```

Now when our pipeline runs inside of Bitbucket the docker build will succeed ad they'll be no connection issues.

```bash
Step 6/8 : RUN mongo mongodb://$MONGODB_HOSTNAME --eval "db.adminCommand('listDatabases');" > databases
 ---> Running in 56aee7abcf74
Removing intermediate container 56aee7abcf74
 ---> 8e555603f8fc
Step 7/8 : FROM scratch as final
 ---> 
Step 8/8 : COPY --from=test databases .
 ---> ffd4f606885a
Successfully built ffd4f606885a
```

