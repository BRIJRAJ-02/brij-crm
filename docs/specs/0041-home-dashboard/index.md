# 0041. Home: the workspace's landing page

**Date**: 2026-10-21
**Status**: Proposed
**Numbering**: the next free number on 21 October 2026 (0037 to 0040 are held by other lanes).

## Summary

Home is where a workspace opens and the sidebar's first row (spec 0034). It ports timefix's dashboard module (`components/dashboard/`): a setup checklist first, then a grid of cards that each answer "what needs me now". The layout, the sections and the interactions follow timefix; the look is ours, from `@crm/ui`. Only sections this CRM has data for are built. It adds no endpoint and no table: every section is a read the data layer already has, through the access door.

Reasoning and options: see [rationale.md](rationale.md).

## Sections

| Section | Shown when | Data (all through `packages/data`) | Rule |
|---|---|---|---|
| Finish setting up | a step the member may do is still open | `calendar.view`, `bookingPages.view`, `forms.view`, `members.list`, `invitations.list`, `access.mine` | see Setup below |
| Today | the member has a booking or a calendar event today | `bookings.calendar(today's midnight, tomorrow's)` | bookings the member hosts that aren't cancelled, and the member's own calendar events that aren't cancelled, by start; split into Earlier (started) and Next |
| Tasks due | the member has open tasks assigned to them | `tasks.mine('assigned', 'open')`, the list My tasks holds | the first 5, earliest due first, no date last, the rest counted; ticking one is the same optimistic `tasks.setDone` |
| Needs attention | an open deal the member owns has gone quiet | `records.view(deals, filter, sort)`, a records window | see Needs attention below |

A section with nothing in it is left out, not drawn empty (timefix, owner, 17 September 2026: "a panel that appears every day saying nothing is wrong is a panel people stop seeing"). When every section is left out, Home says so once, in one EmptyState.

### Needs attention

An open deal you own that nobody has changed in 14 days:

- the object whose `standardKey` is `deals`;
- its `owner` attribute `is_me`;
- its `stage` (a status) `is_any_of` the stages whose outcome is open (not won, not lost, not archived);
- its `updated_at` before 14 days ago;
- stalest first (`updated_at` ascending), the first 6 shown, the rest counted ("4 more").

It is a saved view's filter, run by the records engine, so access applies (a hidden deal is absent) and the window is paged. If the workspace has no Deals object, or its Deals lack an Owner or a Stage, the section is left out.

### Setup

Each step is shown only to a member who may do it. Done when:

| Step | May do | Done |
|---|---|---|
| Connect your calendar | calendars are enabled | the member has a connection |
| Create a booking page | `booking.manage` | a booking page the member owns |
| Create a form | `forms.manage` | the workspace has a form |
| Invite your team | `members.invite` | another member, or an invitation waiting |

The first open step carries the primary button; every row opens the page where the step is done. A step the member may not take is never read. The card goes once every step shown is done. "Not now" (hiding it while steps are open) needs a per member preference the server doesn't keep yet, so it is left out.

## Acceptance criteria

- AC-1041-1: `/w/$slug/home` draws Finish setting up, Today, Tasks due and Needs attention from the data layer, with no fetch in a screen.
- AC-1041-2: each section is absent when it has nothing; with all absent, one EmptyState.
- AC-1041-3: loading draws each card with a Skeleton; a failed read draws that card's error with Try again; the rest of the page still works.
- AC-1041-4: ticking a task on Home ticks it in My tasks too (one list), optimistic with rollback.
- AC-1041-5: Needs attention lists only deals the member may read, by the rule above.
- AC-1041-6: full width; one column at 390px with no sideways scroll; light and dark; every control by keyboard.

## Left out (no data source yet)

- timefix's ask box (the assistant, #54), Team today (who is free: needs the team calendar, spec 0030), the metrics band (pipeline, win rate: needs reporting, #52), the open hours line under Today (needs the slot engine per member), and "Not now" on the checklist (needs a member preference).
