# 0025. Booking pages: book time with a member or a team

**Date**: 2026-10-19

**Experience**: the visitor page, the guest page and the host builder follow [0025-experience.md](0025-experience.md); where it differs from this file (for example a month calendar rather than a week of days), it wins.
**Status**: Proposed

## Summary

A member publishes a booking page. A visitor opens it, sees open slots in their own time zone, answers a few questions and books. The booking puts the event on the host's calendar with a video link, matches or creates the person and their company, shows the meeting on their timelines, can create or move a deal, and sends the visitor a confirmation with links to cancel or reschedule, plus reminders. A team page books a time when every required member is free. Two visitors picking the same slot never both get it. Forms (spec 0023) can send a qualified visitor straight to a booking page with their answers prefilled.

The owner asked for this spec to be written with the recommended answer to every open question (19 October 2026), and to skip round robin (#58) for now: team pages that rotate between members wait for it, behind one seam. The calls worth a look are under **Calls for the owner**.

Reasoning and options: see [rationale.md](rationale.md).

## Dependencies

| Feature | What this spec needs | When it is missing |
|---|---|---|
| #44 calendar sync (spec 0024) | `freeBusy`, `createEvent`, `moveEvent`, `cancelEvent`, and the `meetings` tables a booking links to | hard prerequisite (spec 0024 milestone 3) |
| #48 forms (spec 0023) | the public bundle and hosted page shell, the question renderer, bot checks (honeypot, minimum fill time, rate limits; reCAPTCHA only when its keys are set), record matching by email and domain, the free email domain list | hard prerequisite (spec 0023 milestone 1) |
| #8 background jobs (spec 0008) | reminders and emails as scheduled jobs | hard prerequisite |
| #9 access (spec 0009) | `booking.manage` (own pages) and `booking.admin` (team pages, everyone's) permissions | hard prerequisite |
| #58 round robin | `assignOwner` to pick the host of a rotating team page | the `round_robin` page kind waits for it; `pickHost` is the seam |
| Email sending (Resend) | confirmation, reminder, cancel and reschedule emails | until `RESEND_API_KEY` is set, the provider's own calendar invite is the confirmation and reminders are skipped (logged) |

## Requirements

**User stories**:
- As a member, I want a link people can use to book time with me, inside my working hours and around my real calendar.
- As a team, we want one page that books a time all of us are free.
- As a visitor, I want to see times in my own time zone, book in a few clicks, and cancel or move it myself.
- As a member, I want every booking on the right person, company and deal without typing.
- As a member, I want a qualified form visitor to land on my booking page with their details already filled in.

**Acceptance criteria** (this spec owns AC-623 to AC-648):

*Pages*
- **AC-623**: A member with `booking.manage` creates a personal booking page: title, short description, a web address slug (unique in the workspace), meeting lengths offered (one or more of 15, 30, 45, 60, 90 minutes), location (the calendar's video link, a phone call the visitor gives a number for, an address, or custom text), and status (`live` or `paused`).
- **AC-624**: Availability: weekly hours per day (several ranges a day) in a chosen time zone, date overrides (a day off, or different hours), buffers before and after (0 to 60 minutes), minimum notice (0 to 14 days), how far ahead people can book (1 to 365 days), a daily limit of bookings (optional), and the slot step (15, 30 or 60 minutes, default the meeting length).
- **AC-625**: Questions: name and email always; up to 10 more, built with the forms answer types and the same question cards ([0023-experience.md](../0023-forms/0023-experience.md)), each optionally filed on a person attribute through Where it goes, with the same validation as forms.
- **AC-626**: On booking, optionally create a deal (choose its stage), or move the person's company's open deal to a stage when one exists (an existing open deal is never duplicated).
- **AC-627**: An admin with `booking.admin` creates a team page of kind `collective`: required members (2 to 8); a slot is offered only when every required member is free, and the event goes on the first member's calendar with the others as attendees.
- **AC-628**: The `round_robin` team kind appears in the builder as "Coming soon" until #58 lands.

*Slots*
- **AC-629**: Slots shown = availability, minus busy times from every connected calendar of the host (spec 0024 `freeBusy`), minus existing bookings and their buffers, minus the minimum notice, within the booking window, and none on a day that has reached its daily limit.
- **AC-630**: The page loads in under 1.5 seconds at p75 and shows 7 days at a time in the visitor's time zone (detected, changeable), with the next free day preselected.
- **AC-631**: A host with no connected calendar is offered from availability and bookings only, and the builder warns about it.

*Booking*
- **AC-632**: Booking checks the slot again on the server under a per host lock, so two visitors choosing the same slot get one booking and one "That time was just taken" with fresh slots (a database exclusion constraint per host is the last guard).
- **AC-633**: A booking creates the calendar event (`createEvent`, with a video link for the video location), the visitor and the host as attendees, the visitor's answers in the event's description, and links the meeting to the booking.
- **AC-634**: The visitor is matched to a person by email, or a person is created (name, email, mapped answers that are empty on an existing person, never overwriting), as the `booking` actor; their company is matched or created by email domain (not for free email domains) and linked.
- **AC-635**: The meeting shows on the person's and company's timelines at once (spec 0024), and the person's timeline also shows "Booked <page title>".
- **AC-636**: The visitor sees a confirmation page and gets a confirmation email with the time in their zone, the location or video link, an .ics file, and links to cancel and reschedule.
- **AC-637**: Reminder emails go 24 hours and 1 hour before the meeting (skipped when booked later than that).

*Changing a booking*
- **AC-638**: The cancel and reschedule links carry a single use, unguessable token (stored hashed) valid until the meeting starts; cancelling asks for an optional reason, cancels the event (`cancelEvent`) and tells the host.
- **AC-639**: Rescheduling shows the page's slots, moves the same event (`moveEvent`), keeps the booking's id, and sends a new confirmation; a booking can be rescheduled at most 5 times.
- **AC-640**: The host can cancel or reschedule from the meeting on the timeline or from the bookings list, and the visitor is told.
- **AC-641**: A booking whose event the host deletes in their calendar becomes `cancelled` at the next sync and the visitor is told.

*Forms hand off*
- **AC-642**: `bookingLink({ bookingPageId, prefill, submissionId })` returns the page address with a signed, 24 hour token holding the prefilled answers (attribute ids to values) and the submission id; the page fills those answers in (editable), and the booking stores `submission_id`.

*Public safety*
- **AC-643**: The public endpoints rate limit per client address (60 slot reads and 5 bookings a minute) and per page; booking needs the forms bot checks (reCAPTCHA v3 score, honeypot, minimum fill time).
- **AC-644**: Public answers never include member emails, other bookings, busy event titles, or internal ids other than the page's public key.

*Managing*
- **AC-645**: Settings › Booking pages lists the member's pages (admins see all) with their link, status and bookings this month; Copy link, Pause, Duplicate, Delete.
- **AC-646**: A bookings list per page shows upcoming and past bookings with the visitor, time, status and the linked person.
- **AC-647**: Everything the builder offers is keyboard usable and meets WCAG AA in both themes; the public page meets WCAG AA at 375 px and up.
- **AC-648**: Deleting a page keeps its past bookings and their meetings; its link answers "This page is no longer available".

## Decision

Build booking pages in the existing API, worker and the forms public bundle: page settings and bookings in Postgres, slots computed on the server from availability, calendar free and busy and existing bookings, bookings confirmed under a per host advisory lock with an exclusion constraint as the final guard, the event written through spec 0024, records matched through the forms matching code, emails sent by jobs through Resend. See [rationale.md](rationale.md).

## Feature design

### Data model

Tenant tables with forced row level security, the standard policy and created and updated columns.

**`booking_pages`**: `id`, `public_key` (random, URL safe, 16 characters), `slug` (unique per workspace), `kind` (`personal` | `collective` | `round_robin`), `owner_member_id`, `title`, `description`, `durations` (int[] minutes), `location` (jsonb: `{ type: 'video' | 'phone' | 'address' | 'custom', value? }`), `availability` (jsonb: `{ timeZone, weekly: { mon: [[start, end]], … }, overrides: [{ date, ranges }] }`, times as `HH:MM`), `buffer_before`, `buffer_after`, `min_notice_minutes`, `window_days`, `daily_limit` (nullable), `slot_step` (nullable: the duration), `questions` (jsonb: the forms question shape, attribute mappings by attribute id), `deal` (jsonb, nullable: `{ mode: 'create' | 'move_open', stageOptionId }`), `status` (`live` | `paused`), `deleted_at`.

**`booking_page_members`**: (`page_id`, `member_id`, `position`): the required members of a collective page; the owner alone for a personal page.

**`bookings`**: `id`, `page_id`, `host_member_id`, `starts_at`, `ends_at`, `during` (tstzrange of start minus buffer before to end plus buffer after), `visitor_name`, `visitor_email`, `visitor_time_zone`, `answers` (jsonb), `status` (`confirmed` | `cancelled`), `cancel_reason`, `reschedules` (int), `manage_token_hash`, `meeting_id` (spec 0024), `person_record_id`, `company_record_id`, `deal_record_id`, `submission_id` (spec 0023, nullable).
- Exclusion constraint: `exclude using gist (workspace_id with =, host_member_id with =, during with &&) where (status = 'confirmed')` (needs `btree_gist`).

`actor_type` gains `booking`. Permissions `booking.manage` and `booking.admin` join spec 0009's permission list (owner and admin roles get both; member gets `booking.manage`).

### Slots (core)

`slots(scope, { pageId, from, to, duration, visitorTimeZone })` in `packages/core/src/booking/slots.ts`, pure apart from its reads:
1. Expand the page's weekly hours and overrides into intervals over [from, to] in the page's time zone (DST aware, through `Temporal` or `@date-fns/tz`, whichever the repo already pins; add the catalog pin otherwise).
2. Subtract: busy intervals from `freeBusy` for every required member (collective) or the host, each widened by the buffers; confirmed bookings' `during`; [now, now + min notice]; anything past now + window.
3. Walk each free interval in `slot_step` steps, keeping starts where `duration` fits; drop days at the daily limit.
4. Answer `{ start, end }` in UTC; the page renders in the visitor's zone.
Cached 60 seconds per (page, day); a booking clears that day.

`pickHost(page, slot)`: personal → the owner; collective → the first required member (the event's organiser); round robin → `assignOwner` from #58 (not built: refused with `NOT_AVAILABLE`).

### Booking (core, one transaction plus calendar calls)

1. Check the bot verdict (shared forms checks) and the input.
2. Take `pg_advisory_xact_lock` on the host (for collective, on every required member, in id order), recompute that day's slots, refuse with `SLOT_TAKEN` and fresh slots when the slot is gone.
3. Insert the booking (the exclusion constraint guards a lock bypass).
4. Match or create the person and company with the forms matching module as the `booking` actor (AC-634), the deal step (AC-626), write a `booked` timeline entry.
5. Commit, then call `createEvent` (outside the transaction). On failure: retry 3 times; then the booking stays confirmed without an event, the host gets a banner on the booking and an email, and the visitor's confirmation still goes out with the time. The event's id links back through `meeting_id`.
6. Queue `booking.confirmation` and the two `booking.reminder` jobs (scheduled at their times, keyed by booking so a reschedule replaces them).

Reschedule and cancel run the same lock, update the booking, `moveEvent` or `cancelEvent`, and re-queue or cancel the reminder jobs. A sync that sees a CRM made event cancelled in the provider cancels its booking (AC-641).

### Public surface

In the forms public bundle (spec 0023's second Vite entry), so booking adds no new host:
- `GET /b/<publicKey>` (and `/<workspaceSlug>/<pageSlug>` as a redirect): the hosted booking page: page header, duration choice, a week of days and their slots, then the questions, then the confirmation.
- `GET /b/<publicKey>/manage?t=<token>`: cancel or reschedule.
- Public REST on the API (CORS for our origin only): `GET /api/public/booking/:publicKey` (page facts, no member emails), `GET /api/public/booking/:publicKey/slots?from&to&duration&tz`, `POST /api/public/booking/:publicKey/book`, `POST /api/public/booking/manage/:token/cancel`, `POST /api/public/booking/manage/:token/reschedule`.
- Rate limits and bot checks as AC-643, through the forms modules.

### Emails

Jobs `booking.confirmation`, `booking.reminder`, `booking.cancelled`, `booking.rescheduled`, `booking.host_notice` render React Email templates (the `react-email` skill is installed) and send through Resend (`RESEND_API_KEY`, `BOOKING_FROM_EMAIL`), with an .ics attachment on confirmation and reschedule. Without the key, each job logs that it skipped and completes.

### Screens (members)

- **Settings › Booking pages**: the list (AC-645), New booking page.
- **The page builder**: sections for Details, Availability (weekly hours per day with add range, overrides, time zone), Limits (buffers, notice, window, daily limit, step), Questions (reusing the forms builder's question list), On booking (deal), Members (collective), and a live preview of the public page. Save as you go (debounced), with a Live / Paused switch.
- **Bookings**: per page, upcoming and past, with Cancel and Reschedule (opens the public reschedule flow for the host).
- All from the component library; new variants reviewed by `design-system-guardian` when testing resumes.

## Build plan

**Milestone 1: a personal page books a meeting** (after spec 0024 milestone 3 and spec 0023 milestone 1)
1. Migration: the three tables, `btree_gist`, the exclusion constraint, `actor_type` `booking`, the permissions; guard tests.
2. Core: availability expansion, slots, `pickHost`, booking under the lock, matching and creating records, the timeline entry; unit tests including DST days and the race (two bookings for one slot).
3. API: member procedures (`bookingPages.list`, `.get`, `.create`, `.update`, `.delete`, `bookings.list`) and the public endpoints for page, slots and book.
4. Public page in the forms bundle; Settings › Booking pages and the builder (details, availability, limits).
Satisfies AC-623, AC-624, AC-629 to AC-635, AC-643 to AC-645, AC-647.

**Milestone 2: emails, questions, deals and changing a booking**
5. Questions with attribute mapping, the deal step.
6. Emails and reminders through jobs; manage links, cancel, reschedule; the host's cancel and reschedule; AC-641 from sync.
7. The bookings list.
Satisfies AC-625, AC-626, AC-636 to AC-641, AC-646, AC-648.

**Milestone 3: teams and the forms hand off**
8. Collective pages; the round robin kind shown as coming soon.
9. `bookingLink` and prefill; `submission_id` on bookings for forms stats.
Satisfies AC-627, AC-628, AC-642.

## Calls for the owner

- Round robin team pages wait for #58 (skipped today); collective team pages are built.
- Durations offered: 15, 30, 45, 60, 90 minutes; slot step defaults to the duration.
- Emails go through Resend once `RESEND_API_KEY` and `BOOKING_FROM_EMAIL` are set; until then the calendar invite is the confirmation and reminders are skipped.
- A booking whose calendar event fails to create stays booked, and the host is told.
- The deal step never creates a second open deal for a company that has one.

## Consequences

- The public surface grows by five endpoints; they share the forms rate limits and bot checks, so a single in memory limiter still assumes one API instance (spec 0023's Follow-up applies).
- `btree_gist` is enabled in the database (available on Neon).
- Booking quality depends on calendar sync health: an expired calendar means busy times are unknown, so the builder warns, and the page offers only availability minus bookings.

## Follow-up

- [ ] Round robin team pages once #58 has a spec and `assignOwner`.
- [ ] Paid bookings, group events with several visitors, and routing forms beyond the forms hand off (later).
- [ ] Measure the slots endpoint on the load harness with a busy page.

## Rationale

See [rationale.md](rationale.md).
