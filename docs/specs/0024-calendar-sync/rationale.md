# 0024. Calendar sync: rationale

## Context

Meetings are the most telling activity a CRM shows: who met whom, when, and what's next. Members already keep them in Google or Outlook; retyping them never happens. Booking pages (#59) and round robin (#58) also need to know when members are free and to put events on their calendars. The CRM is multi tenant, built for a million records per workspace, on Railway, Neon and Vercel with Graphile Worker for jobs. Calendar data is personal, so privacy per member matters, and provider tokens are long lived secrets.

The owner asked on 19 October 2026 for this spec to be written with the recommended answer to each open question, so building could start the same day; the calls are listed in index.md for review.

## Options considered

### Option 1: own sync, provider adapters, meetings as their own tables (chosen)

Sync each member's calendar with the provider's incremental API into `meetings` and link them to records.

**Pros**: no new vendor or bill; full control of privacy (descriptions never stored); timelines read local tables, fast at scale; free and busy and event writes use the same tokens.
**Cons**: two provider integrations to write and keep working; Google's sensitive scope verification.

### Option 2: a unified calendar vendor (Nylas, Cronofy)

**Pros**: one API for Google, Outlook and more; webhooks and token handling done for you.
**Cons**: a per connected account bill from day one; members' calendar data passes through a third party; another vendor to secure and monitor.

### Option 3: meetings as records of a standard "Meetings" object

**Pros**: meetings would get every record feature (fields, views, filters) for free.
**Cons**: sync writes would go through the record engine's history and validation at high volume; per meeting privacy doesn't fit record access rules; attendees as relationship values would be heavy. Can be added later as a view over the meetings tables.

## Rationale

Option 1 keeps the stack small and the data private, and is what the forms and booking specs already assume (`createEvent`, `freeBusy`). Incremental sync tokens with push notifications and a poll fallback is the providers' recommended pattern and stays within their quotas. Storing meetings outside the record engine keeps a busy calendar from flooding record history while still linking every meeting to its people and companies.

Calls made without a question, each with its runner up:

- Primary calendar only (runner up: every calendar the account has), since secondary calendars are often personal or shared noise.
- Default sharing `shared` (runner up: `private`), matching how CRMs like Attio and HubSpot behave and what makes the timeline useful; internal meetings never show on records.
- Unknown attendees not created automatically (runner up: always create), to keep the CRM clean.
- Window 90 days back and 180 ahead (runner up: a year back), enough for context, light on the first sync.
- Tokens encrypted with an app key in env (runner up: a KMS), since the stack has no KMS today.

## Amendment, 20 October 2026: calendars and Outlook in one release

### Context

The research pass of 20 October found that Google free and busy and every event call hard code the primary calendar (`apps/api/src/calendar/google.ts`), connections cap at 3 with `is_default` choosing where events go, and `sync_state` is already keyed by calendar id. Two bugs came from the same place: events went to the oldest connection instead of the default, and one failing account closed a whole booking page. Round robin (spec 0029, AC-734, AC-743) and the team calendar (spec 0030, AC-770) were written against "every conflict checked calendar" and "the destination calendar". The owner decided calendars follow the Calendly style design and that Outlook comes in the same release.

### Options considered

**Option A: a calendars table per connection, switches per calendar, one destination (chosen).** Calendly and Cal.com both work this way (check for conflicts per calendar, one "add to calendar"), so members recognise it. Costs a table, a refresh job and per calendar channels.

**Option B: a list of calendar ids on the connection (jsonb).** Smaller, but the destination, colours, errors and channels per calendar would all live in one blob, with no unique index for the one destination.

**Option C: keep primary only and add Outlook first.** Least work, but leaves the two bugs' cause in place and blocks 0029 and 0030 from the calendars they need.

### Rationale

Option A gives each calendar the state it needs (switches, colour, sync token, channel, last error) in a row the database can constrain. Per calendar outcomes fix the bug where one failure closed a page while keeping the safety rule that a page never offers a time it can't book (the destination's grant). Putting Outlook in the same release means the calendar model is proven against two providers before anything is built on it, which is why the adapter interface changes and the Graph adapter land together.

Calls made without a question, each with its runner up:

- Defaults keep today's behaviour (main calendar on, others off) (runner up: every calendar on, which would suddenly block slots for members with busy shared calendars).
- 6 accounts and 50 calendars per account (runner up: 10 accounts).
- Colours as an override of the provider's, mapped to the design system's calendar hues (runner up: provider hex shown raw, which breaks contrast rules).
- Expand and contract for `sync_state` and `channel` (runner up: move in one migration).
- Personal Outlook accounts book without a Teams link and say so (runner up: refuse video pages for them).

### Evidence

Calendly (Mobbin, web): event type settings with "Free/busy rules" referring to "connected calendars", and Settings › Calendar with Calendar, Availability and Advanced tabs. Microsoft Graph documents `calendarView` delta per calendar, `getSchedule` for free and busy, and change notification subscriptions with a validation token, `clientState`, a maximum life of under three days for events, and lifecycle notifications.

## References

- Google Calendar API, synchronizing resources efficiently (sync tokens): https://developers.google.com/calendar/api/guides/sync
- Google Calendar push notifications: https://developers.google.com/calendar/api/guides/push
- Microsoft Graph, get incremental changes to events (delta query): https://learn.microsoft.com/graph/delta-query-events
- Microsoft Graph, calendar getSchedule, and change notifications (subscriptions, lifecycle notifications): named, not fetched for this amendment.
