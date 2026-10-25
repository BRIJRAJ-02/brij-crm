# 0053. Social links: the reasoning

## Context

The owner, 25 October 2026: "for bookings, add more options like adding social media. Can we create those, and add a set of those wherein people can add." A visitor deciding whether to book wants to see who the host is, and the host wants their profiles beside their meeting. The same people were getting a link page (spec 0051) whose references (Linktree, liinks.co) all show a row of social icons under the person's name.

Three forces shaped it. The links are a person's, like their handle, bio and photo, and they appear on pages from every workspace the person is in. The public booking pages load nothing from another origin (`img-src 'self' data: blob:`), so no favicon or outside image can be fetched. And the booking page's first load sat at about 224 of 230 kB of JavaScript and 17.8 of 18 kB of CSS, so the row had to be nearly free.

## Options considered

1. **A small table `auth.social_links (user_id, network, href, position)` behind definers (chosen).** The database holds the rules itself: one link per network per person (primary key), at most ten (position 0 to 9), the network set and the address shape (checks), and the rows go when the account does (cascade). Con: two more definers and a table for the security reviewer.
2. **A jsonb column on `auth.user_prefs`.** One write, no new table. Con: the database can't enforce one per network, the limit or the address shape without a JSON check function, and history needs a diff of a blob.
3. **A block on the link page.** No new store. Con: booking pages could not show it, and a person would keep two lists in step. See spec 0051's rationale, "Why social links are not a block".

## Rationale

The links are the person's in the same way their handle and picture are, and schema `auth` already holds those behind narrow definers (`crm_save_picture_hidden`, migration 0094), so this follows a pattern the repo has twice. A table rather than a blob lets Postgres enforce the rules a visitor's page relies on, so a caller that skipped the contract still can't store a second LinkedIn or a `javascript:` website. Marks through `ProviderMark` and a server made label keep the public pages' policy and budgets as they were, which the booking page's 18 kB CSS ceiling made non negotiable.

## References

Sources, no links fetched: the builder's log in the lane note `handoffs/booking-socials.md` (decisions, reviewers, walks); spec 0025 (booking pages); spec 0051 (the link page); migration `0094_user_picture_hidden.sql` (the definer pattern followed); Mobbin screens studied by the builder (Curater, Linktree, Mintlify, Meetup, Base44, Delphi).
