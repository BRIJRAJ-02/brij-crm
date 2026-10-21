# 0041. Home: the workspace's landing page

**Date**: 2026-10-21
**Status**: Proposed
**Numbering**: the next free number on 21 October 2026 (0037 to 0040 are held by other lanes).

## Summary

Home is where a workspace opens and the sidebar's first row (spec 0034). It ports timefix's dashboard module (`components/dashboard/`): a setup checklist first, then a grid of cards that each answer "what needs me now". The layout, the sections and the interactions follow timefix; the look is ours, from `@crm/ui`. Only sections this CRM has data for are built. It adds no table. Team today and the metrics row are its two reads of its own (`home.teamToday`, `home.metrics`, 22 October 2026: lean versions from the data that exists, ahead of spec 0030's team calendar and #52's reports); every other section is a read the data layer already has. All go through the access door.

Reasoning and options: see [rationale.md](rationale.md).

## Sections

| Section | Shown when | Data (all through `packages/data`) | Rule |
|---|---|---|---|
| Finish setting up | a step the member may do is still open | `calendar.view`, `bookingPages.view`, `forms.view`, `members.list`, `invitations.list`, `access.mine` | see Setup below |
| Today | the member has a booking or a calendar event today | `bookings.calendar(today's midnight, tomorrow's)` | bookings the member hosts that aren't cancelled, and the member's own calendar events that aren't cancelled, by start; split into Earlier (started) and Next |
| Team today | the workspace has two or more active members, or the read is loading or failed | `home.teamToday(today's midnight, tomorrow's)` | see Team today below |
| This week | the reader may see at least one figure | `home.metrics(this Monday's midnight)` | see The metrics row below |
| Tasks due | the member has open tasks assigned to them | `tasks.mine('assigned', 'open')`, the list My tasks holds | the first 5, earliest due first, no date last, the rest counted; ticking one is the same optimistic `tasks.setDone` |

A section with nothing in it is left out, not drawn empty (timefix, owner, 17 September 2026: "a panel that appears every day saying nothing is wrong is a panel people stop seeing"). When every section is left out, Home says so once, in one EmptyState.

### Team today

One row per active member (at most 100), the reader first, then by name: their picture, where they stand now and what is next. It reads each member's confirmed bookings (`bookings_by_host`), the meetings their connected calendars hold (`meetings_by_start`) and their busy times with nobody else invited (`calendar_busy_times_by_end`): four queries whatever the team's size, no read per member.

- In a meeting until the end of the run of back to back meetings it is in, then "Next: <title>, <time>"; else "Free now" with the next one; else "Free, nothing else today". All day events never make anyone busy. The clock moves the presence without another read; the day is read again when the person comes back to the page (nothing polls).
- A title shows only where the reader may see it: all of their own; a booking they may see on Bookings (their page's, one they host, or everyone's with `booking.admin`); a meeting one of the reader's own calendars holds too, or one that isn't private and whose every calendar of that member holding it shows Full details to teammates (sharing `shared`). Anything else reads "Busy", by its time alone: never its title, place, link or attendees, and the server never sends them.
- Who sees a title is the calendar's own setting, Teammates see: Full details or Busy only (the owner's call, 22 October 2026, through the coordinator). This is wider than spec 0024's AC-611, where a shared meeting reaches a reader only through a record they can read: here a shared calendar's meetings show their titles to every teammate with `booking.manage`, record or not. A member who wants that narrower keeps their calendar at Busy only.
- It needs `booking.manage` (Bookings' gate, so a role without scheduling sees no one's day), only a member reads it (a key reads an empty team), and only today: the day must start within 36 hours of now. One member is not a team: the card is left out, decided from the member list before the read so it never loads and goes. The first 8 rows show, the rest counted.

### The metrics row

This week so far against all of last week, on the reader's clock (their Monday's midnight): meetings booked (confirmed bookings starting in each week: everyone's with `booking.admin`, else the ones the reader hosts), new people, new deals, the value of deals won (moved to a won stage in the week and still there, in the Value attribute's currency; other currencies are never added in, and the card says so), and form submissions. Each count is one indexed range read over two weeks, never a scan: records by `records_created`, won deals among the deals touched since last week began (`records_updated`) by their current Stage, submissions by `form_submissions_by_form`, bookings by `bookings_by_host`. The workspace's figures are kept a minute per workspace and week in each API process; `weekStart` must fall on a quarter hour (every time zone's midnight does), so a caller can't make a key per millisecond. A row whose every figure is zero this week and last is left out like any section with nothing in it. A figure the reader may not see is absent, never zero: People and Deals need the object at read with no record rule, the won value its Stage and Value fields too, submissions `forms.manage`.

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

- AC-1041-1: `/w/$slug/home` draws Finish setting up, Today and Tasks due from the data layer, with no fetch in a screen.
- AC-1041-2: each section is absent when it has nothing; with all absent, one EmptyState.
- AC-1041-3: loading draws each card with a Skeleton; a failed read draws that card's error with Try again; the rest of the page still works.
- AC-1041-4: ticking a task on Home ticks it in My tasks too (one list), optimistic with rollback.
- AC-1041-5: dropped with Needs attention (see below).
- AC-1041-7: Team today shows every member's presence and next meeting; a teammate's Busy only calendar, a private event and a booking the reader may not see on Bookings read "Busy" with no title (tested in `packages/core/src/home/home.test.ts`).
- AC-1041-8: the metrics row compares this week with last for the figures the reader may see, from indexed reads cached a minute per workspace.
- AC-1041-6: full width; one column at 390px with no sideways scroll; light and dark; every control by keyboard.

## Dropped

- Needs attention (open deals you own, unchanged for 14 days): timefix removed it, and the owner dropped it on 22 October 2026. Home keeps Today, Tasks due, Team today, the metrics and Finish setting up.

## Left out (no data source yet)

- timefix's ask box (the assistant, #54), Team today's open hours and its link to a team calendar (spec 0030), the metrics' pipeline, win rate and window toggle (reporting, #52), the open hours line under Today (needs the slot engine per member), and "Not now" on the checklist (needs a member preference).
