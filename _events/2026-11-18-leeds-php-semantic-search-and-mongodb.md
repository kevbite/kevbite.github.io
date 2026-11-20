---
layout: event
title: Leeds PHP - Semantic Search & MongoDB
description: A talk on semantic search with MongoDB
img: main.jpg
youtube-video-id: 
talk-title: Semantic Search & MongoDB
talk-description: |
  MongoDB doesn't have to mean learning a whole new world. In this talk, we start from a PHP developer's perspective and map the document database back to the relational concepts you already know: collections are tables, documents are rows, and a nested PHP array is all a document really is. Through a live demo we'll cover the essentials from both plain PHP and Laravel—inserting and querying data, embedding versus referencing, indexes, the aggregation pipeline, and how the official Laravel MongoDB package makes it all feel like ordinary Eloquent. By the end of the first half you'll be comfortable storing and querying documents
  
  In the second half we tackle something genuinely useful and very much of the moment: semantic search—searching by meaning, not keywords. We'll unpack the two ideas that power it, embeddings and vectors, and see why keyword search falls short when someone searches for "a young wizard faces a dark lord" and expects Harry Potter. With a Laravel app backed by a local embedding model (Ollama) and MongoDB Atlas Local, we'll compare keyword, full-text, semantic, and hybrid search side by side using Atlas Vector Search keeping your data and its vectors together in one document, with no separate vector database to sync. Finally, we'll look at how Voyage AI's built-in automated embeddings on Atlas remove the glue code entirely
  
  If you already know PHP and Laravel, adding AI-powered search is a small step, not a new system to learn.

links:
  - https://luma.com/5w5p4gpg
---