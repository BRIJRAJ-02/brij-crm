# 0027 · Calendar quick actions: book, block and hold from the week

**Status**: In Progress
**Date**: 2026-10-20
**Feature**: Bookings › Calendar (spec 0025), polish phase 1, owner feedback F8

## Summary

On Bookings › Calendar a member drags across empty time in a day (or clicks it, taps it, or presses Enter on the day) and a small card asks what the time is for:

- **Book someone in**: a New meeting dialog books a guest into that span as a real booking.
- **Block this time**: the span closes on every booking page that books the member, once or every week.
- **Hold for a private page**: the span closes for everyone except private booking pages, which may book inside it even outside working hours.

The behaviour follows the timefix app's "draw on the calendar"; the look is ours. The owner chose all three on 20 October 2026 ("All three like timefix").

## Requirements

- **AC-700**: Dragging across empty time in a day column draws a ghost span snapped to 15 minutes, dashed while dragging and solid once released, with its start and end times at its corners. A drag never leaves its day.
- **AC-701**: A click, a tap, or a span under 15 minutes becomes the default length (the member's first booking page's first duration, else 30 minutes), clamped to the day. On touch a tap opens the card at once (no drag, which would fight scrolling). From the keyboard, Enter or Space on a day opens it at the member's working start for that day.
- **AC-702**: The card sits beside the span and flips when there is no room. It names the span ("10:00 – 10:30 AM", "Tuesday 20 October · 30 min") and offers Book someone in, Block this time and Hold for a private page. Book someone in is left out on a past day. Escape or a press outside closes it (the next press draws again); Back returns to the choices. Its form names the span's From and To in 15 minute steps, so the span can be set exactly, from the keyboard too, and it says when confirmed bookings sit inside the span (they stay booked). When a card closes and what it was anchored to is gone, focus goes to its day.
- **AC-703**: Block offers "Just this Tuesday" (the default) or "Every Tuesday", and an optional label only the member sees ("Why? (only you see this)"). Block it saves (a second Enter while saving does nothing), then the card closes and a toast says "Time blocked." with Undo, as calendars do. A refusal keeps the card open with the reason; one that arrives after the card was closed shows as a toast.
- **AC-704**: Hold offers a choice of the member's private booking pages, defaulting to "Any private page", and the same label. Hold it saves, then the card closes and a toast says "Held. Only a private booking page can book it." with Undo. A hold is always one span on one date.
- **AC-705**: A block or hold shows on the week as a quiet hatched object under bookings and events: "Blocked" or "Held", with its label when there is room. Pressing it opens a card with the span, the label and Remove (Remove every Tuesday for a weekly block, Release for a hold). Removing closes the card at once and confirms in a toast ("That time is open again."), or says it failed and puts the block back.
- **AC-706**: A one off block, and an every week block on its weekday from its first date on, closes that time on every booking page that books the member: a visitor never sees a slot touching it, buffers included, and booking it is refused.
- **AC-707**: A hold is closed time for every page except a private one. A private page sees a hold that is shared or carved for that page as open, even outside the member's hours; buffers, bookings and calendar busy time still apply inside it. A private page also waives its minimum notice.
- **AC-708**: A booking page has a Private switch (the editor's last setting). A private page is still reached by its link; it is marked Private in the Links list.
- **AC-709**: Book someone in opens a New meeting dialog for the span: With (name, searching people in the workspace as you type), Email, Their time zone (default the member's), Booking page (default the first), Length (15, 30, 45, 60, 90, 120 minutes, plus the drawn length, which is the default), Also invite (more emails), and Message. Book it creates a confirmed booking.
- **AC-710**: A booking the member makes this way ignores which slots are on offer (they may book into their own block, a hold or outside their hours) but never overlaps another confirmed booking of theirs ("Something else is already in that time."). Its length is 5 minutes to 8 hours, and it cannot start in the past.
- **AC-711**: With a connected calendar, the event is written to the member's default calendar with every attendee, and the calendar invites them (the message is in the event). The booking files to the person (created or matched by email) as a page booking does. Timefix's own invitation email, with the manage link and an .ics, arrives with the booking emails in booking milestone 2 (polish phase 10), for page and member bookings alike; the member gets no "new booking" email for their own booking.
- **AC-712**: Blocks, holds and host made bookings are the member's own: nobody else can see, create or remove another member's. Every write is checked by the access door, and goes to the audit log once it exists (#36).

## Decision

### Data

One new table, `booking_time_blocks`, with forced row level security per workspace like every tenant table:

| Column | Type | Notes |
|---|---|---|
| `workspace_id`, `id` | uuid | composite key, as every booking table |
| `member_id` | uuid | whose time; composite FK to `members` |
| `kind` | text | `block` or `hold`, checked |
| `repeat` | text | `once` or `weekly`, checked |
| `during` | tstzrange | a `once` span (absolute instants); null for `weekly` |
| `weekday` | smallint | 0 Sunday to 6 Saturday, `weekly` only |
| `start_minute`, `end_minute` | smallint | local minutes, `weekly` only, end after start, at most 1440 |
| `time_zone` | text | the member's zone when it was made, `weekly` only |
| `from_date` | date | the first date a `weekly` block applies |
| `page_id` | uuid | a hold carved for one private page; null means any private page. No foreign key (a set null would clear the workspace too); the service checks it names a live page the member books, and a page deleted later just never opens it |
| `label` | text | at most 200 characters, only the member sees it |
| created and updated by and at | | the usual audit columns |

Checks make a row exactly one shape: `once` has `during` and no weekly columns; `weekly` has the weekly columns and no `during`; a `hold` is always `once`. A GiST index on `(workspace_id, member_id, during) where repeat = 'once'` serves range overlap, and `(workspace_id, member_id) where repeat = 'weekly'` the weekly ones. Removing a block deletes its row (it is not a record, nothing links to it). The audit columns say who made it; the audit log (#36) records block writes once it exists.

Why weekly blocks are their own rows rather than a rewrite of the weekly hours (what timefix does): timefix's rewrite keeps only the larger side of the day and is lossy by its own comments. A weekly block subtracts from that weekday's windows instead, so the hours the member set stay untouched and removing the block gives them back exactly.

`booking_pages` gains `is_private boolean not null default false`.

### Slots

The slot loader (`core/src/booking/slots.ts`) reads the member's blocks overlapping the range and turns them into engine input:

- `once` blocks, and holds the page can't use, join `busy`.
- `weekly` blocks become busy spans per date in their own zone (local minutes to instants through the engine's `toInstant`, from `from_date` on).
- For a private page, holds that are shared or carved for it become `extraWindows`, merged into that day's windows before busy, bookings, buffers and notice are taken out. The engine gains `extraWindows: readonly Span[]`; everything else stays pure and as tested.
- A private page's minimum notice is 0.

The booking recheck under the host lock uses the same loader, so a block made while a visitor is on the page refuses their booking.

### Host made bookings

A new service `bookAsHost(scope, input)` in `core/src/booking/host.ts`: the reader must be the page's member (their own page, or a page they are on), the span 5 to 480 minutes, not in the past. It takes the host advisory lock and relies on the bookings exclusion constraint, skips the slot check, sets buffers to 0, writes the booking with `created_by` the member and `source = 'host'`, files the person like a page booking, writes the calendar event through the existing path, and queues the guest invitation emails (a `booking.host_invited` template) through the outbox. No host notification.

### API and data layer

`bookings.blocks.list` (`from`, `to`), `bookings.blocks.create`, `bookings.blocks.remove`, and `bookings.bookAsHost`, all `{ bookingPages: true }` in the access table, the member's own only. The data layer adds `data.bookings.blocks` (optimistic create and remove with rollback) and `data.bookings.bookAsHost`. The calendar read returns blocks alongside bookings and events.

### UI

- `WeekCalendar` (library) gains the draw surface per day column (pointer, touch, keyboard), the ghost, a `drawCard` slot anchored to the span, and a third block kind `blocked` drawn with a hatch, solid edge for a block and dashed for a hold. It stays data free: it reports `onDraw({ dayKey, startMinute, endMinute })` and the screen supplies the card.
- `apps/web` Bookings › Calendar supplies the card (choices, Block form, Hold form, success state) and the New meeting dialog, built from Modal, Form, Field, Select, RadioGroup and the people search the record pickers use.
- The booking page editor gains the Private switch; Links rows show a Private tag.

## Build plan

Tracer bullet, one strand at a time, each tested and driven in the browser before the next:

1. Blocks end to end: migration, core service and its tests (including the cross workspace guard and a denied actor), slots honouring once and weekly blocks, API, data layer, the calendar showing blocks, Remove.
2. The draw surface in WeekCalendar (stories for pointer, keyboard and touch), the card with Block, wired to step 1.
3. Private pages and holds: the column and switch, hold rows, the engine's extra windows, the Hold form, Release.
4. Book someone in: `bookAsHost`, the invitation email, the New meeting dialog.

## Consequences

- One more table under row level security, covered by the two guard tests.
- The engine gains one input (`extraWindows`); its existing tests stand.
- Bookings get a `source` value `host`; lists and the calendar show these like any booking.

## Follow-up

- Picking a person from the workspace as you type in With (the record search answers no email today, so it needs a read that does); the server already files the booking to the person with that email.
- Timefix's own invitation email for a member's booking, with the booking emails (booking milestone 2).
- Drawing past the visible edge scrolls the grid (today: set the span with From and To).
- Also invite as removable email chips (the field set's Email editor with several values), one guest control for this dialog and the public booking form.
- The calendar event written by a job keyed by the booking, retried with backoff, so a process that dies after the commit still writes it (today: three tries in the request, and the event id from the booking keeps a retry from inviting twice).
- A live change event for a booking (other tabs see it without a reload), and a per member rate limit on Book someone in, through the limits module.

- A whole day block from the card (timefix keeps it on the day panel; days off already cover it under Availability).
- A calendar choice in the New meeting dialog when a member has two or more calendars (calendar sync milestone 4).
- Required person fields in the New meeting dialog, once the workspace has required attributes.

## Rationale

The behaviour, copy and edge rules come from the timefix app's draw on the calendar, which the owner asked us to follow (layout, interaction and UX from timefix, the look ours). Where timefix is lossy (weekly blocks rewriting the hours) or enforces a rule only on the client (no booking into the past), this spec does it properly on the server. Wording is ours where timefix's was inconsistent ("priority link" against "private meeting type": here, a private booking page).
