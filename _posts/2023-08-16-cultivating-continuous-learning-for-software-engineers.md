---
layout: post
title: Cultivating Continuous Learning for Software Engineers
categories:
tags: [Learning, Engineering Excellence]
description: How your company can encourage continuous learning to strive for engineering excellence
comments: true
---

# A bit of a different one

This post breaks away from my usual technical ramblings. I want to talk about
something I care about a lot: how we keep learning as software engineers, and
how the companies we work for can help (or hinder) that.

When I first got into the industry, nearly everyone I met had a pile of side
projects on the go. People were tinkering at home, contributing to open source,
turning up to meetups. Tech wasn't just the day job, it was the hobby too.

Things have shifted since then. A lot of people now see software engineering as
_just a job_, and that's completely fine, there's nothing wrong with wanting a
steady wage and switching off at 5pm. But it does mean fewer people are
upskilling themselves in their own time, and companies can no longer rely on
cherry-picking the handful who are. If you want your engineers to keep up with
where the industry is going, you have to build the learning into the culture.

# Hiring a good engineer isn't the finish line

We all love hiring someone with a great skill set, but tech doesn't sit still.
The person you hired as a "fully qualified" engineer today isn't going to stay
that way if nothing changes around them. The tools, the frameworks, the
practices, they all move on. So the skills need to keep moving on too, and that
only happens if there's time and space for it.

# Give people some direction

One of the easiest ways to waste learning time is to have no idea what to learn.
If you leave engineers to guess, some will pick things that never get used and
others won't pick anything at all.

It helps to be clear about the techniques, tools, platforms and libraries you
actually want people to get good at, and to flag the up-and-coming stuff worth
keeping an eye on. That way the learning is pointed in a useful direction rather
than being a bit aimless.

A lot of places do this with an internal
[tech radar](https://www.thoughtworks.com/radar) (the ThoughtWorks one is the
usual starting point). It's a simple way of saying "we're adopting this, we're
trialling that, we're keeping an eye on this other thing", and it gives people a
map of where to spend their effort.

# So how do people actually learn?

Everyone learns differently. Some folk love a technical book, some can't stand
them and would rather watch a video or just get their hands dirty. There's no
single right way, so the more options you can offer, the better. Here's a few
that I've seen work well.

## Pair and mob programming

Pairing and mobbing are brilliant for spreading knowledge around a team. When
you're sat working through a problem together you naturally pick up each other's
tricks, shortcuts and ways of thinking.

One little thing I'd say: try to have the person _with less_ knowledge of the
area driving, and the person with more knowledge navigating. It keeps the
conversation on what you're changing and _why_, rather than the expert quietly
racing ahead while everyone else nods along.

## Sharing what you've learnt across teams

Pairing is great within a team, but a lot of good stuff gets stuck there. When
one team cracks a tricky problem, finds a nicer library, or lands on a better
way of doing something, it's worth getting that in front of everyone else.

This usually happens in a tech town hall, in person or remotely. Some companies
run dedicated engineering days where teams get together to share what they've
been up to and run workshops. In-person is lovely if the budget stretches to it,
mostly because of the chats you have in the corridor afterwards, but remote
sessions still do the job.

## Hackathons

Taking a couple of days away from the normal work to hack on something is a
great way to learn and to get people collaborating who don't normally work
together. There are no sprint commitments hanging over you, so you can just
explore.

I've been to [Hack24](https://hack24.co.uk/) a couple of times, a 24-hour
hackathon held in the Council House in Nottingham. Both times taught me
something, but in very different ways.

The **first time** we bit off way more than we could chew. We were building a
peer-to-peer DJ'ing app (BeMyDJ), and by the end of the 24 hours we had a big
pile of half-working features and nothing you could really call presentable. We
learnt a load about SignalR and streaming music in the browser, which was
genuinely useful, but we had no real output to show for it.

<iframe width="100%" height="480px" src="https://www.youtube.com/embed/cyT7JPeslfY" frameborder="0" allowfullscreen>
</iframe>

The **second time** we were much better prepared. The very first thing we did
was break the idea down into small parts and get a Minimal Viable Product
working within a few hours, then we just kept stacking feature after feature on
top of it. We built a "Family Calendar" running on a Raspberry Pi, where you
could scan a QR code from your phone to sync your calendar into a shared one. We
even got a decent night's sleep and came back fresh the next day, and we won a
prize for it too! The big lesson second time round wasn't really technical, it
was all about planning and scoping something small enough to actually ship.

<iframe width="100%" height="480px" src="https://www.youtube.com/embed/ue3heruUQ8Y" frameborder="0" allowfullscreen>
</iframe>

That's the thing with hackathons, even the "failures" teach you something, and
they're a lot of fun.

## Meetups and user groups

Meetups are one of my favourite ways to learn, and a big part of that is the
chats before and after the talks rather than just the talks themselves.

Here's a little story. Long before I ran dotnetsheff, someone else was running
it, and they used to put on Kata sessions done in TDD. That was my very first
exposure to test-driven development, and honestly it changed the direction of my
career. I started applying TDD back at work, and I genuinely think it was a big
part of me landing my next job over at Alpharooms. All from turning up to a
free meetup one evening.

These days I help run two of them in the north of England,
[dotnetsheff](https://dotnetsheff.co.uk) and
[dotnetYork](https://dotnetYork.co.uk). There's a group out there for pretty
much every flavour of tech, they're usually sponsored so there's free drinks and
pizza, and they're a really relaxed, welcoming way to meet other developers.
Companies can help here by covering travel or counting attendance as work time.

## Conferences

Conferences are a bit like meetups turned up a notch. They ask for more
commitment because they run for longer, but you get loads more content and the
networking is second to none. They can be pricey, but there are some brilliant
single-day conferences that won't break the bank.

The [DDD events](https://en.wikipedia.org/wiki/Developer!_Developer!_Developer!)
are a great example, they're community-run, developer-focused and dotted around
the UK:

- [Reading (DeveloperDeveloperDeveloper)](https://developerdeveloperdeveloper.com/)
- [Bristol (DDD South West)](https://dddsouthwest.com/)
- [Nottingham (DDD East Midlands)](https://dddeastmidlands.com/)
- [Cambridge (DDD East Anglia)](https://www.dddeastanglia.com/)
- [Hull (DDD North)](https://www.dddnorth.co.uk/)

They double up nicely as a team day out too, everyone can wander off to
different tracks and then compare notes over a coffee at the break.

## Dedicated learning time (10% time)

Having proper, ring-fenced learning time is ideal, because it takes away the
guilt of "I should really be shipping features". The pressure to deliver always
eats into learning otherwise.

Google famously had its "20% time", where people could spend a fifth of their
week on their own projects, and it gave us things like Gmail and Google News. You
don't need to go that far, but a bit of structure helps. The setup I've seen work
well is to start the day with a quick standup where everyone says what they're
going to try, people pair up to help each other out, and then at the end of the
day everyone gives a 5–10 minute report back on how it went.

And it's fine if it _didn't_ go well! Maybe the shiny library you hoped would
make the system more testable just wasn't a good fit. That's still a useful thing
to learn, and now the whole team knows it too.

## Learning resources

Because everyone learns differently, it pays to offer a spread of resources. Some
people want technical books, some want online video courses. A few things worth
providing:

- Free books, or a shared book library
- Subscriptions to the likes of Pluralsight or Udemy
- University or training courses
- Access to paywalled blogs and publications

# Wrapping up

Software engineering has drifted from being a passion project for most people to
being a job, and that's just the reality now. But that makes building a culture
of continuous learning more important, not less. If you give people direction, a
bit of time, and a mix of ways to learn that suit how they actually like to
learn, you end up with engineers who keep growing, and a company that keeps up
with a industry that never sits still.
