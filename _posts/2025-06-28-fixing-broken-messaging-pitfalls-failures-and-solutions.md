---
layout: post
title: "Fixing Broken Messaging: Pitfalls, Failures, and Solutions"
categories:
tags: [Messaging, C#, .NET]
description: This post shows how poor messaging practices can quietly erode the scalability, reliability, and maintainability of your distributed systems and what to do instead.
comments: true
---

Back in April 2025 at [DDD South West 2025](https://www.dddsouthwest.com/), I had the chance to give a talk on **Fixing Broken Messaging: Pitfalls, Failures, and Solutions**.  
Messaging is something I’ve always been passionate about, it’s one of the foundations of modern distributed systems, but it’s also **incredibly easy to get wrong**.

In this post, I’ll share a deeper dive into what I covered at DDD South West, expanding on **best practices** and **common pitfalls** to help you make your messaging systems **scalable**, **resilient**, and **a joy to work with**, not a constant headache.

## Why Messaging?

Before we dive into the pitfalls, let's remind ourselves why messaging matters:

- **Decoupling**, Services communicate without knowing about each other's internals or uptime.
- **Scalability**, Add more consumers to scale out processing horizontally.
- **Resilience**, If a service goes down, the messages persist until it's back up.
- **Asynchronous Processing**, Users aren't stuck waiting for long-running tasks.

Messaging when done right can make your system **more flexible**, **more robust**, and **more scalable**. Done badly? It becomes a bottleneck, a black hole for bugs, and a reliability nightmare.

## What Is Messaging?

**Messaging** is the act of communicating by sending messages, not calling APIs directly.  
It means **"fire-and-forget"**, send a message into the system, and move on.

The receiving system processes the message **later**, **separately**, and **independently**.

✅ Asynchronous.  
✅ Loosely coupled.  
✅ Scalable.  
✅ Fault-tolerant.

If you're building distributed systems, you're already using messaging somewhere; even if it’s just event notifications, background jobs, or service-to-service communication.

## Core Messaging Concepts

Let's quickly define the moving parts:

| Concept            | What it Means |
|--------------------|---------------|
| **Message**        | A single unit of information (JSON, XML, etc.) |
| **Producer**       | The service that sends the message |
| **Consumer**       | The service that processes the message |
| **Message Broker** | The system that routes and stores messages (RabbitMQ, Azure Service Bus, Kafka, etc.) |
| **Queue**          | A store for messages |
| **Topic/Exchange** | Pub/Sub mechanisms to send a message to multiple consumers |

These building blocks sound simple. But how you **use** them determines whether your system thrives or collapses under pressure.

## What Makes Good Messaging?

Good messaging is not just sending messages and hoping for the best. It’s **designing communication intentionally**.

### 1. Monitoring and Observability

**If you can't see it, you can't fix it.**

Good messaging systems must be observable:
- **Log every key event**: message fetched, processing started, success, failure.
- **Monitor queue depths**: see how messages back up when things slow down.
- **Track performance metrics**: processing times, success/failure rates.
- **Use distributed tracing** (like OpenTelemetry) to trace a message across services.

> Without observability, you’ll spend hours guessing where a message disappeared.

Set up dashboards, alerts, and error trackers right from day one, not after your first outage.

### 2. Decoupled Services

A consumer **should not** depend on the producer being available, or vice versa.

Good decoupling means:
- **No synchronous API calls inside message handlers.**
- **Reference data** is stored locally if it's critical, instead of making live lookups at processing time.
- **Eventual consistency** is embraced, small delays are OK if they improve resilience.

Autonomous services = scalable services.

### 3. Dead-Letter Queues (DLQs)

Failures **will happen**, embrace them.

Dead-Letter Queues allow you to:
- Capture failed messages after retries are exhausted.
- Analyze what went wrong (bad data? external outage? code bug?).
- Replay or manually fix messages.

**Without DLQs**, failed messages either block your queue or silently vanish. Neither is acceptable.

> "No data left behind" should be your mantra.

### 4. Concurrency Control / Rate Limiting

Just because you *can* consume 1000 messages a second doesn’t mean your downstream services can handle it.

Control concurrency with:
- **Prefetch Count**: how many messages a consumer fetches at once.
- **Rate Limits**: how fast consumers process messages.
- **Circuit Breakers**: temporarily pause processing if downstream services struggle.

The goal is **smooth, controlled flow**, not **overload and crash**.

### 5. Balanced Load

You need **even distribution** of work.

Pitfalls to avoid:
- High prefetch counts causing uneven work.
- Single consumers getting flooded while others sit idle.

Use techniques like:
- **Fair queueing**.
- **Sharding** by tenant, customer, or ID ranges.

Smooth load = happy system.

### 6. Idempotency and Message Deduplication

Your system must be **idempotent**, processing the same message twice must have **no bad side effects**.

✅ No double-charging customers.  
✅ No duplicate emails.  
✅ No overwriting good state with replays.

Achieve this using:
- **Unique message IDs**.
- **Outbox/Inbox Patterns**.
- **Deduplication storage**.

Never assume "the broker guarantees delivery once", design for retries!

### 7. Good Message Structure

Good messages are:
- **Small** (only what's needed).
- **Focused** (one clear event per message).
- **Domain-specific** (tied to business events, not CRUD actions).

**Avoid** generic messages like `OrderUpdated`.  
**Prefer** specific events like `OrderPlaced`, `OrderDispatched`, `OrderCancelled`.

This clarity massively improves scaling, monitoring, and future extensibility.

### 8. Claim Check Pattern (Right Message Size)

Large payloads? Don't shove them in the message.

Use the **Claim Check Pattern**:
- Store the large data in a database or blob storage.
- Send a lightweight message with a **reference link**.

This keeps your queues fast, lean, healthy, and avoids painful serialization issues.

### 9. Correlation and Conversation IDs

To debug distributed systems, you need **end-to-end traceability**.

Always include:
- A **Correlation ID** to group related messages and activities.
- A **Conversation ID** if you need to follow a multi-message transaction.

Without these, debugging across services becomes near-impossible.

## Common Messaging Pitfalls

Messaging isn’t foolproof, there are some common ways things go wrong.

### 1. Excessive Retries

💥 Retrying over and over can create **retry storms** that overload systems and cause even more failures.

Instead:
- **Retry only transient errors**.
- **Use exponential backoff with jitter**.
- **Implement circuit breakers** to prevent cascading failures.

Retries are a tool, not a fix.

### 2. Excessive Locking

🐢 Long database locks inside message handlers crush performance and throughput.

Solution:
- **Use short-lived transactions**.
- **Defer slow operations** outside of the lock.
- **Adopt the Outbox Pattern** where needed.

Always think: **Lock less. Work faster. Fail safer.**

### 3. Single Queue for All Message Types

🚧 A single queue for everything = bottlenecks, deadlocks, and chaos.

Instead:
- **Separate queues by concern** (e.g. consumers/sagas).
- **Scale consumers independently**.
- **Monitor each queue separately**.

Isolation brings clarity and control.

### 4. Bespoke Routing Topology

🧭 Overcomplicated routing (hardcoded keys, custom exchanges) leads to fragile systems.

Instead:
- **Use standard pub/sub** patterns.
- **Stick to logical naming conventions** (`OrderPlaced`, not `ShippingService.OrderPlaced`).
- **Let frameworks like MassTransit handle routing** when possible.

Make your routing boring and obvious.

### 5. Sending PII or Sensitive Data

⚖️ Messaging without care can leak sensitive data into:
- Logs
- Tracing systems
- Dead-letter queues

Solution:
- **Use Claim Check Pattern** for sensitive payloads.
- **Encrypt** sensitive fields.
- **Restrict access** to queues and topics.

> Security isn't optional. It's part of good design.

### 6. Doing Too Much in a Handler

🛑 When handlers do too much (save to DB, call APIs, publish events), a partial failure leaves the system in a **bad, inconsistent state**.

Instead:
- **Split responsibilities** across messages and services.
- **Use Outbox Pattern** for consistency.
- **Use Routing Slip Pattern** for processing steps.
- **Keep handlers focused** and idempotent.

### 7. Polymorphism in Messaging

🧬 Inheritance in messages leads to:
- Serialization nightmares.
- Broken consumers when new fields appear.
- Poor discoverability.

Instead:
- **Send concrete, versioned message types**.
- **Favor composition over inheritance**.
- **Be explicit with your contracts**.

### 8. Refactoring Messages

💥 Changing a live message contract without care breaks everything downstream.

Instead:
- **Version your messages** (`V1`, `V2`, etc).
- **Only add fields**, don't remove or rename.
- **Emit both old and new messages** during migrations.
- **Communicate changes clearly** across teams.

Messaging contracts are *public APIs*. Treat them like it!

## Final Takeaways

✅ Messaging is incredibly powerful, but **only if you respect it**.

✅ Avoid common pitfalls: retries, bottlenecks, coupling, data leaks.

✅ Design good systems: decoupled, observable, small messages, resilient flows.

✅ Build with the assumption that **everything can fail**, and make sure your system can recover.


> Messaging isn't just a transport.  
> It's how your distributed system *thinks*.  
> **Invest in doing it properly.**

