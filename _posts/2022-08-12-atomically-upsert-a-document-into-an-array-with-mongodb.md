---
layout: post
title: Atomically Upsert a Document into an Array with MongoDB
categories:
tags: [MongoDB, JavaScript]
description: How to atomically upsert (update or insert) a document into an array with MongoDB update aggregation pipelines
comments: true
---

If you've worked with MongoDB before you'll most likely have stored sub-documents within arrays, this is one of many reasons MongoDB shines over other traditional database.

## Noddy approach

However, if you have a document where you want to insert a sub-document in to an array when it doesn't exist, or update the whole document in the array when it does exist you've mostly likely pull the item from the array and the pushed the new item in to the array within 2 update operations:

```javascript

// Insert a test item document
db.items.insertOne({
    "_id" : ObjectId("623ded6e1ce9aa98b37ce86a"),
    "items": [
        { "_id": 1, "content": "aaa"},
        { "_id": 2, "content": "bbb"},
        { "_id": 3, "content": "ccc"},
    ]
})

// Pull the array item which we want to update
db.items.updateOne(
    { "_id" : ObjectId("623ded6e1ce9aa98b37ce86a")},
    {
        "$pull": {
            "items": { "_id": 2 }
        }
    }
)

// Push the updated item back in to the array (we're updating content to "zzz")
db.items.updateOne(
    { "_id" : ObjectId("623ded6e1ce9aa98b37ce86a")},
    {
        "$push": {
            "items": {
                "_id": 2, "content": "zzz"
            }
        }
    }
)

// Check final document
db.items.find()
[
  {
    _id: ObjectId("623ded6e1ce9aa98b37ce86a"),
    items: [
      { _id: 1, content: 'aaa' },
      { _id: 3, content: 'ccc' },
      { _id: 2, content: 'zzz' }
    ]
  }
]

```

This is quite chatty and if someone fetches the document halfway through updating then they'll get a inconsistent view of the document too with the item with the id of 2 missing. We can however fix the problem with the inconsistencies by starting a transaction and completing the 2 operations together.

## Transactions

The code below shows the 2 operations wrapped in a transaction.

```javascript

// Start a session
var session = db.getMongo().startSession( { readPreference: { mode: "primary" } } );

// Start a transaction
session.startTransaction( { readConcern: { level: "local" }, writeConcern: { w: "majority" } } );

try {
    var items = session.getDatabase("test").items;

    // Pull the array item which we want to update
    items.updateOne(
        { "_id" : ObjectId("623ded6e1ce9aa98b37ce86a")},
        {
            "$pull": {
                "items": { "_id": 2 }
            }
        }
    )

    // Push the updated item back in to the array (we're updating content to "zzz")
    items.updateOne(
        { "_id" : ObjectId("623ded6e1ce9aa98b37ce86a")},
        {
            "$push": {
                "items": {
                    "_id": 2, "content": "zzz"
                }
            }
        }
    )

    // Commit the transaction using write concern set at transaction start
    session.commitTransaction();

} catch (error) {
   // Abort transaction on error
   session.abortTransaction();
   throw error;
}

session.endSession();
```

This is a great way to do multiple operations on a document, however, it does require a MongoDB 4.0 running in a replica set or MongoDB 4.2 if your data is partitioned across multiple shards.


## Update aggregation pipelines

Another way is to utilize the update operation with an aggregation pipeline (This also requires MongoDB v4.2), this allows one single update operation without the need to any transactions.

The below update with an aggregation pipeline is very similar to the above operation, we're using the `$addFields` aggregation stage to keep replacing over the top of the `myItems` field.

```javascript
db.items.updateOne(
    { "_id" : ObjectId("6176d58d636041dbac68233c")},
    [
        {
            $addFields: {
                "myItems": {
                    $filter: {
                        input: "$myItems",
                        as: "item",
                        cond: { $ne: [
                                "$$item.id",
                                2
                            ]
                        }
                    }
                }
            }
        },
        {
            $addFields: {
                "myItems": { $concatArrays: [ "$myItems",
                        [
                            {
                                "id": 2,
                                "extraProps": true,
                                "content": "Hello World"
                            }
                        ]
                    ]
                }
            }
        }
    ]
)

```

The first `$addFields` stage removes the document from the array based on a given condition using the `$filter` operator and then the second `$addFields` stage then appends the new document using the `$concatArrays` operator.


## The best way?

Like most things within software development there's no best way to solve the problem, the update aggregation pipeline can become complex but is less chatting and doesn't require a transaction. However, the transaction approach can make your code easier to understand, but then has the overhead of a transaction and requires a replica set for local development too.

