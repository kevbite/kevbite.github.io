---
layout: post
title: Restrict user registration per application on Auth0
categories:
tags: [Auth0, Authentication, Authorization]
description: How to disable users registering on given Auth0 applications.
comments: true
---

## Auth0

Auth0 is one of many out the box solutions for authentication and authorization as a service. It has a range of standardized features and follows best authentication and authorization practices.

## Applications in Auth0

An application in Auth0 represents an application that you allow users to authenticate with, this could be a machine to machine application or a user authenticating via an application. It is also possible for an application to be 3rd party wishing to authenticate on behalf of a user to access their data.

## Restricting User Registration

It's common for businesses to sometimes not allow certain applications to register a user. For example NetFlix requires you to create a user online via their website, however, the mobile app only allows you to login via a given previously created application.

Auth0 currently only provides turning off all user registration for a given database connection not application. However, if you do turn off all user registration you can still register new users via the [Auth0 Management API](https://auth0.com/docs/api/management/v2#!/Users/post_users).

![Disable Sign Ups](/assets/posts/2021-07-16-restrict-user-registration-per-application-on-auth0/database-username-password-authentication-disable-sign-ups.png "Disable Sign Ups")

## Auth0 Extensibility

Auth0 has a vast [feature list](https://auth0.com/blog/auth0-features-to-fall-in-love-with/), however, within most businesses there is a need to extend these.
Auth0 gives the following ways to extend their current features:
- [Hooks](https://auth0.com/docs/hooks)
- [Rules](https://auth0.com/docs/hooks)
- [Actions](https://auth0.com/docs/actions)

These all provide different methods for extending the platform, however, in our next section we'll look at using Auth0 Actions.

## Prerequisite Applications

To demonstrating creating a register only application we'll create two applications within Auth0, one called `Login Only App` and another called `Registration App`. We'll create these applications as SPA (Single Page Web Applications), but these should reflect your own application types.

![Create Registration App](/assets/posts/2021-07-16-restrict-user-registration-per-application-on-auth0/create-registration-app.png "Create Registration App")

![Create Login Only App](/assets/posts/2021-07-16-restrict-user-registration-per-application-on-auth0/create-login-only-app.png "Create Login Only App")

## Creating our Auth0 Action

Once we have our prerequisite applications that we'll use, we'll need to head over to the `Flows` page under the `Actions` on the left hand side navigation.

![Action Flows Nav](/assets/posts/2021-07-16-restrict-user-registration-per-application-on-auth0/nav-actions-flows.png "Action Flows Nav")

At the flow screen, we'll want to view the `Pre User Registration` flow.

![Choose Flow](/assets/posts/2021-07-16-restrict-user-registration-per-application-on-auth0/choose-flow.png "Choose Flow")

Here we can add one or more actions which will be invoked on pre user registration. Here we'll create a `Restricting Registration` action.

![Create Action](/assets/posts/2021-07-16-restrict-user-registration-per-application-on-auth0/create-pre-user-registration-action.png "Create Action")

Once created this will pop up a small JavaScript editor with a sample script, this script is our action which will be invoked pre user registration. If required we can call web services or even pull in extra npm packages to build up our action. Actions are also automatically versioned so you can go back to a previous version, it's also possible to save a draft which you're working on too.

![Create Action](/assets/posts/2021-07-16-restrict-user-registration-per-application-on-auth0/restrict-registration-action.png "Create Action")

```javascript
exports.onExecutePreUserRegistration = async (event, api) => {

  const allowedApps = ["Registration App"];

  if(!event.client || !allowedApps.includes(event.client.name))
  {
    const appName = event.client && event.client.name;
    api.access.deny(`App '${appName}' cannot be used for user registration.`,
            `User Registration is not allowed at this time.`);
  }
};
```

The above code is what we will be using for our action, this action allows a list of application names (`allowedApps`) to be able to sign up users. If the application which is trying to register users is not in the list then a message will be relayed back to the user with the `api.access.deny()` call.

You can find more details on the arguments passed in to this action on the auth0 documentation ([Event Object](https://auth0.com/docs/actions/triggers/pre-user-registration/event-object) / [Api Object](https://auth0.com/docs/actions/triggers/pre-user-registration/api-object)).

Once we've deployed our new hook we can test it out via our restricted login app.

![Newly Create Action](/assets/posts/2021-07-16-restrict-user-registration-per-application-on-auth0/pre-user-registration-flow.png "Newly Create Action")

## Testing Restricting User Registration

To test out our pre registration action, we can navigate to the follow url which will direct us to the hosted login pages.

- https://{your-tenant-domain}.eu.auth0.com/authorize?response_type=code&client_id={your-application-client-id}&redirect_uri={your-application-redirect}&scope=openid%20email

Once at the login page, if we click to register and try to sign up we'll be display with the error message passed down from the action (`"User Registration is not allowed at this time."`).

![Register New Univeral Login](/assets/posts/2021-07-16-restrict-user-registration-per-application-on-auth0/register-new-univeral-login.png "Register New Univeral Login")

The denied registration will also be included in the logs.

![Auth0 Logs](/assets/posts/2021-07-16-restrict-user-registration-per-application-on-auth0/auth0-logs.png "Auth0 Logs")

## Run Down.

As we can see we can extend Auth0 capabilities to allow only certain applications to register users.