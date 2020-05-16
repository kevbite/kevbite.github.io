---
layout: post
title: Optimising MongoDB queries by removing lookups
categories:
tags: [MongoDB, Queries]
description: How to optimising MongoDB queries by removing lookups
comments: true
---

Within development we live in a agile world, our requirements are changing on a constant basis and this means we need a flexible database to allow us to adapt to changes fast. MongoDB is perfect for this as we don't have all the grunt work in setting up schemas.

However sometimes we end up having data spread across collections due to our requirements changing which isn't always an optimal document design.

Let's take a blog website for example, we might have `posts` collection where the documents looks like the following:

```javascript
{
  "_id" : ObjectId("5ec028efdedb939aa1735fe4"),
  "title" : "My Post Title",
  "description" : "A Post Description",
  "body" : "This would be the body of the post",
  "tags" : [
    "MongoDB",
    "Database"
  ],
  "author" : {
    "_id" : ObjectId("5ec028efdedb939aa1735fe3"),
    "name" : "Liam Smith"
  }
}
```

We modeled it like this because everything we need for displaying the page for a post is contained within a single document.

We also have a `authors` collection that has extra details about each author, however, this is displayed on a different page on it's own.

```javascript
{
  "_id" : ObjectId("5ec028efdedb939aa1735fe4"),
  "title" : "My Post Title",
  "description" : "A Post Description",
  "body" : "This would be the body of the post",
  "tags" : [
    "MongoDB",
    "Database"
  ],
  "author" : {
    "_id" : ObjectId("5ec028efdedb939aa1735fe3"),
    "name" : "Liam Smith",
    "bio" : "Liam is a enterprise solution architect who secretly just writes PowerShell.",
    "posts" : [
      {
        "_id" : ObjectId("5ec028efdedb939aa1735fe4"),
        "title" : "My Post Title"
      },
      {
        "_id" : ObjectId("5ec02f30dedb939aa1735fe5"),
        "title" : "Another post"
      }
    ],
    "social" : {
      "facebook" : "https://fb.com/liam",
      "twitter" : "https://twitter.com/liam",
      "website" : "https://liam-the-architect.com",
      "tiktok" : "https://www.tiktok.com/@liam"
    }
  }
}
```

## The feature

Originally before our feature, the post document was modelled so that we would have everything we needed on the `post` document, however, a feature was added to the blog website to show the authors twitter link on the blog post page. This was initially achieve with using a [$lookup](https://docs.mongodb.com/manual/reference/operator/aggregation/lookup/) in MongoDB.

```javascript
db.posts.aggregate([
  { "$match" : { "_id" : ObjectId("5ec028efdedb939aa1735fe4") } },
  { "$lookup" : {
      "from" : "authors",
      "localField" : "author._id",
      foreignField: "_id",
      as: "author"
    }
  },
  { "$addFields" : {
      "author": { $arrayElemAt: [ "$author", 0 ] },
    }
  }
])

```

This will go fetch the post but then go lookup the author each time, resulting in the following output.

```javascript
{
  "_id" : ObjectId("5ec028efdedb939aa1735fe4"),
  "title" : "My Post Title",
  "description" : "A Post Description",
  "body" : "This would be the body of the post",
  "tags" : [
    "MongoDB",
    "Database"
  ],
  "author" : {
    "_id" : ObjectId("5ec028efdedb939aa1735fe3"),
    "name" : "Liam Smith",
    "bio" : "Liam is a enterprise solution architect who secretly just writes PowerShell.",
    "posts" : [
      {
        "_id" : ObjectId("5ec028efdedb939aa1735fe4"),
        "title" : "My Post Title"
      },
      {
        "_id" : ObjectId("5ec02f30dedb939aa1735fe5"),
        "title" : "Another post"
      }
    ],
    "social" : {
      "facebook" : "https://fb.com/liam",
      "twitter" : "https://twitter.com/liam",
      "website" : "https://liam-the-architect.com",
      "tiktok" : "https://www.tiktok.com/@liam"
    }
  }
}
```

This will work, however, it's less efficient as we'll be fetching 2 documents each time we do a query for our blog post.

## Moving the field

The twitter field is very unlikely to change very often, so we might prefer to store this on the blog post document like we did with the authors `name` field.

We can achieve this by running a aggregation pipeline with a [$merge](https://docs.mongodb.com/manual/reference/operator/aggregation/merge/) stage to append the twitter field to the post document.

```javascript
db.authors.aggregate([
  { "$unwind": "$posts" },
  { "$project" : { "_id" : "$posts._id", "author": {  "twitter" : "$social.twitter" } } },
  { "$merge" : { into : "posts" } }
]);
```

Running the above reworks the author documents so that each document has the `_id` of the post and the `author.twitter` field.
If we just run the `$unwind` and `$project` we'd see the following output:

```javascript
{ "_id" : ObjectId("5ec028efdedb939aa1735fe4"), "author" : { "twitter" : "https://twitter.com/liam" } }
{ "_id" : ObjectId("5ec02f30dedb939aa1735fe5"), "author" : { "twitter" : "https://twitter.com/liam" } }
```

This is then fed in to merge stage which will merge it back on to all our post documents based on their `_id` field.

Now if we look at our post document we'll see the following:

```javascript
db.posts.findOne()
{
  "_id" : ObjectId("5ec028efdedb939aa1735fe4"),
  "title" : "My Post Title",
  "description" : "A Post Description",
  "body" : "This would be the body of the post",
  "tags" : [
    "MongoDB",
    "Database"
  ],
  "author" : {
    "twitter" : "https://twitter.com/liam"
  }
}
```

## Wrapping up

As you can see we can now just go fetch the data required to display the post with one single hit, thus making our queries more efficient. The `$merge` stage is a very efficient way of migrating data around your collections.