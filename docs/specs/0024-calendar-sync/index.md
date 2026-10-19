# 0024. Calendar sync: meetings on records, and free and busy for booking

**Date**: 2026-10-19
**Status**: Proposed

## Summary

A member connects their Google or Outlook calendar. Their meetings, past and upcoming, sync into the CRM and appear on the timeline of every person and company in them, live as they change. Each member chooses whether their meetings are shared with the workspace or kept private. The same connection gives the CRM free and busy times and lets it create, move and cancel events, which booking pages (#59, spec 0025) and later round robin (#58) build on. A connection that expires or is revoked says so in the app and is never silently stale.

The owner asked for this spec to be written with the recommended answer to every open question (19 October 2026), so each call below is a default the owner may change; the ones worth a look are under **Calls for the owner**.

Reasoning and options: see [rationale.md](rationale.md).

## Dependencies

| Feature | What this spec needs | When it is missing |
|---|---|---|
| #8 background jobs (spec 0008) | the light lane for sync runs and token refresh, scheduled jobs for the poll fallback and channel renewal, the daily cleanup | hard prerequisite |
| #9 access (spec 0009) | the access door; a meeting is visible where its linked records are, and private meetings only to their owner | hard prerequisite |
| #15 relations (spec 0014) | People to Companies, to link a meeting to the company of an attendee's domain | hard prerequisite |
| #17 record page (spec 0017) | `ACTIVITY_SOURCES`, to which this spec adds the `meeting` entry | hard prerequisite |
| #7 realtime (spec 0007) | the outbox and relay; this spec adds the `meetings` kind | hard prerequisite |
| #28 notifications | telling a member their calendar disconnected by notice and email | until it lands: the in app banner and the settings status only |
| #31 duplicate detection | merging two people an attendee email matched | an ambiguous match links none and is listed as needing review |
| #58 round robin | free and busy per member for availability | this spec provides `freeBusy`; #58 calls it later |

## Requirements

**User stories**:
- As a member, I want to connect my calendar once and see every meeting with a contact on their record, so I know what was discussed and when we meet next.
- As a member, I want to keep some or all of my meetings private, so personal events never show to the team.
- As a member, I want people I meet who aren't in the CRM yet to be one click from being added.
- As a builder of booking pages, I want to read members' free and busy times and create, move and cancel events with a video link, so a booking becomes a real calendar event.
- As a member, I want to know at once when my calendar stops syncing.

**Acceptance criteria** (this spec owns AC-597 to AC-622):

*Connecting*
- **AC-597**: A member connects a Google calendar from Settings › Calendar through Google's consent screen (scopes: read and write events, read free and busy). The connection shows the account's email and its status: syncing, connected, expired, revoked or failed.
- **AC-598**: A member connects an Outlook (Microsoft 365 or outlook.com) calendar the same way through Microsoft's consent screen (milestone 4).
- **AC-599**: One connection per member per provider account; a member may connect at most 3 accounts. Disconnecting stops sync at once, deletes the stored tokens, and removes that connection's meetings that no other connection also holds.
- **AC-600**: Access and refresh tokens are encrypted at rest (AES 256 GCM, key `CALENDAR_TOKEN_KEY`), never logged, never sent to a browser, and never readable through the API.

*Syncing*
- **AC-601**: After connecting, the past 90 days and the next 180 days sync within 2 minutes for a calendar of up to 5,000 events in that window.
- **AC-602**: A change made in the calendar (new, moved, cancelled, attendee added) reaches the CRM within 60 seconds while push notifications are active, and within 15 minutes through the poll fallback when they are not.
- **AC-603**: The same event in several members' calendars is one meeting in the CRM (matched by its iCalendar UID and, for a recurring instance, its original start).
- **AC-604**: Recurring events sync as their instances within the window; an instance moved or cancelled on its own changes only that instance.
- **AC-605**: Events the member declined, events with no other attendee, and all day events without attendees are not synced. Events whose attendees are all members of the workspace (internal) sync, but show on no record's timeline.

*On records*
- **AC-606**: Each attendee email (normalised: trimmed, lower case) is matched to People by their email addresses attribute. Exactly one match links the meeting to that person; several matches link none and mark the attendee as ambiguous.
- **AC-607**: An attendee whose email domain is not a free email domain links the meeting to the company with that domain (the company's domains attribute), when exactly one company has it.
- **AC-608**: A meeting appears on the timeline of every linked person and company as "Meeting: <title>" with its time, attendees and their responses, and the video link; upcoming meetings show first under "Upcoming".
- **AC-609**: An attendee not in the CRM shows with an "Add as person" action; a workspace setting (off by default) creates people automatically for unknown external attendees, as the `calendar` actor, and links their company by domain.
- **AC-610**: A meeting's changes reach every open timeline live within a second (a `meetings` outbox kind).

*Privacy*
- **AC-611**: Each connection has a sharing level: `shared` (title, time, attendees and video link visible to anyone who can see a linked record) or `private` (the meeting links to records but shows to others only as "Private meeting" with its time). Default: `shared`.
- **AC-612**: An event marked private in the calendar itself is always treated as `private`, whatever the connection's level.
- **AC-613**: Event descriptions and attachments are never stored.
- **AC-614**: Removing a member deletes their connections and the meetings only they held (spec 0009's `removeMember` hook).

*Free and busy, and writing events (for #58 and #59)*
- **AC-615**: `freeBusy(scope, { memberIds, from, to })` returns each member's busy intervals from their connected calendars (all of their connections), at most a 62 day range, answered in under 1 second at p95 for 5 members, cached 60 seconds per member and range.
- **AC-616**: `createEvent(scope, { memberId, title, start, end, attendees, timeZone, video: true | false, description })` creates the event in the member's primary calendar of their default connection, with a Google Meet or Microsoft Teams link when `video` is true, and answers the meeting it made.
- **AC-617**: `moveEvent` and `cancelEvent` change or cancel an event the CRM created (it keeps the provider's event id), sending updates to attendees through the provider.
- **AC-618**: A member with no connection has no free and busy (callers treat them as unavailable), and `createEvent` refuses with `CALENDAR_NOT_CONNECTED`.

*Health*
- **AC-619**: A refresh that fails with the provider's "invalid grant" (revoked or expired) marks the connection `expired`, stops its sync, and shows a banner to its member ("Your Google calendar disconnected. Reconnect") on every page until reconnected or removed.
- **AC-620**: Other failures retry with backoff; after 6 hours of failures the connection is `failed`, with the same banner and the last error in Settings.
- **AC-621**: The settings page shows each connection's last successful sync time.
- **AC-622**: Push notification channels are renewed before they expire (Google channels last up to 7 days; renewed daily).

## Decision

Build calendar sync in the API and worker as a provider adapter (Google first, Outlook in milestone 4) behind one internal interface, store meetings as their own tables linked to records, sync incrementally with the provider's sync tokens, wake on provider push notifications with a 15 minute poll as the fallback, and expose free and busy and event writes as core services for booking and round robin. See [rationale.md](rationale.md).

## Feature design

### Data model

All tables are tenant tables: `workspace_id` first in every key, forced row level security with the standard policy, created and updated columns, as in spec 0004.

**`calendar_connections`**
- `id`, `member_id`, `provider` (`google` | `microsoft`), `account_email`, `status` (`syncing` | `connected` | `expired` | `revoked` | `failed`), `sharing` (`shared` | `private`, default `shared`), `is_default` (one per member; booking writes here).
- `tokens` (bytea: the encrypted JSON of access token, refresh token, expiry; never selected by any read the API serves).
- `sync_state` (jsonb: per calendar id, the provider's sync token or delta link), `channel` (jsonb: channel id, resource id, expiry, the hashed channel token), `last_synced_at`, `last_error` (code and message, no tokens), `failing_since`.
- Unique: (`workspace_id`, `member_id`, `provider`, `account_email`).

**`meetings`**
- `id`, `ical_uid`, `original_start` (null unless a recurring instance), `title`, `starts_at`, `ends_at`, `all_day`, `location` (text, at most 500 characters), `video_url`, `status` (`confirmed` | `tentative` | `cancelled`), `organizer_email`, `is_private` (computed when syncing from AC-611 and AC-612: true when any holding connection is private or the event is private), `is_internal`, `created_by_crm` (true for events `createEvent` made), `booking_id` (spec 0025, nullable).
- Unique: (`workspace_id`, `ical_uid`, `coalesce(original_start, 'epoch')`).
- Index: (`workspace_id`, `starts_at`).

**`meeting_sources`**: which connection holds which meeting under which provider event id: (`meeting_id`, `connection_id`, `provider_event_id`, `calendar_id`, `etag`). A meeting is deleted when its last source goes.

**`meeting_attendees`**: (`meeting_id`, `email`, `name`, `response` (`accepted` | `declined` | `tentative` | `needs_action`), `is_organizer`, `member_id` (a workspace member with that email), `person_record_id` (nullable), `match` (`linked` | `ambiguous` | `unknown` | `member`)).

**`meeting_records`**: (`meeting_id`, `record_id`, `via` (`attendee` | `domain`)). Index (`workspace_id`, `record_id`, `meeting_id`). This is what timelines read.

**`calendar_settings`** (one row per workspace): `create_unknown_people` (boolean, default false).

`actor_type` gains `calendar`.

### Provider adapter

One interface in `packages/core/src/calendar/provider.ts`, implemented in `apps/api/src/calendar/google.ts` and (milestone 4) `microsoft.ts`, the only modules that call the providers. Core gets the adapter passed in, never reads env.

```ts
interface CalendarProvider {
  authorizeUrl(state: string, redirectUri: string): string;
  exchangeCode(code: string, redirectUri: string): Promise<Tokens & { accountEmail: string }>;
  refresh(tokens: Tokens): Promise<Tokens>;              // throws ProviderAuthError on invalid_grant
  listChanges(tokens: Tokens, calendarId: string, syncToken: string | undefined, window: Window):
    Promise<{ events: ProviderEvent[]; nextSyncToken: string }>;   // a 410 Gone means: full resync
  freeBusy(tokens: Tokens, from: string, to: string): Promise<Interval[]>;
  createEvent(tokens: Tokens, input: NewEvent): Promise<ProviderEvent>;
  updateEvent(tokens: Tokens, eventId: string, input: Partial<NewEvent>): Promise<ProviderEvent>;
  cancelEvent(tokens: Tokens, eventId: string): Promise<void>;
  watch(tokens: Tokens, calendarId: string, address: string, token: string): Promise<Channel>;
  stopWatch(tokens: Tokens, channel: Channel): Promise<void>;
}
```

Google: Calendar API v3 with `singleEvents=true`, `showDeleted=true`, `timeMin`/`timeMax` from the window on full sync and the `syncToken` afterwards; free and busy from `freebusy.query`; Meet links by `conferenceData.createRequest` with `conferenceDataVersion=1`. Only the primary calendar syncs (more calendars are a Follow-up). A fake adapter in core tests stands in for both providers; no test calls a real provider.

### Connecting (OAuth)

- `GET /api/calendar/google/start` (signed in) redirects to Google with `state` = a signed, 10 minute, single use value carrying workspace, member and a nonce; `access_type=offline`, `prompt=consent`.
- `GET /api/calendar/google/callback` checks the state, exchanges the code, encrypts the tokens, upserts the connection (`syncing`), queues `calendar.sync` (full), and redirects to Settings › Calendar.
- Env (validated at startup only when `CALENDAR_SYNC=on`): `GOOGLE_CALENDAR_CLIENT_ID`, `GOOGLE_CALENDAR_CLIENT_SECRET` (a Google Cloud OAuth client with the Calendar API enabled; it may be the same client as sign in, but its redirect URI `<API origin>/api/calendar/google/callback` must be added), `CALENDAR_TOKEN_KEY` (32 bytes, base64), `CALENDAR_WEBHOOK_ORIGIN` (the public https origin Google posts to). Milestone 4 adds `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`. With `CALENDAR_SYNC` off, Settings › Calendar says calendar sync isn't set up for this workspace.

### Sync

- Job `calendar.sync` (light lane, keyed by connection, one at a time per connection): refresh the token when it expires within 5 minutes; call `listChanges` with the stored sync token (or a full sync over the window); a 410 Gone clears the sync token and runs a full sync. Store the next sync token only after the batch commits.
- For each event: skip by AC-605; upsert the meeting by (`ical_uid`, `original_start`); upsert this connection's `meeting_sources` row; replace its attendees; match attendees (AC-606, AC-607, AC-609) and rewrite `meeting_records`; a cancelled or deleted event removes this source, and the meeting goes with its last source. Write one `meetings` outbox row per batch naming the meetings and every linked record before and after.
- Matching runs through the engine's record reads as the `calendar` actor's system scope; the free domain list is the `free-email-domains` package (spec 0023).
- Push: after the first full sync, `watch` the primary calendar with an address `<CALENDAR_WEBHOOK_ORIGIN>/api/calendar/google/notify` and a random channel token (stored hashed). The notify endpoint answers 200 at once, checks the channel id and token, and queues `calendar.sync` for that connection (deduplicated by job key). The daily cleanup renews channels that expire within 48 hours.
- Poll fallback: a scheduled job every 15 minutes queues `calendar.sync` for connections whose last sync is older than 15 minutes.
- Window: the full sync covers 90 days back and 180 days ahead; the daily cleanup moves the window, and meetings older than the window stay as they are (history is kept).

### Reads, timelines and live

- `meetings.forRecord({ recordId, cursor })` pages a record's meetings, upcoming first then past, 20 a page, through the access door: the record must be readable, and a private meeting's title, attendees and link are replaced by "Private meeting" for anyone but the members whose connections hold it.
- The record timeline adds a `meeting` source to `ACTIVITY_SOURCES` (spec 0017): one entry per meeting at its start time, with an "Upcoming" group above today's entries.
- The `meetings` outbox kind carries meeting ids and record ids; facts for the relay are each meeting's private flag and holders, so a private meeting's event goes out coarse to everyone else (spec 0009's `eventFacts`).

### Free and busy, and events (core services)

`freeBusy`, `createEvent`, `moveEvent`, `cancelEvent` live in `packages/core/src/calendar/events.ts`, called as the system actor by booking (spec 0025) and later round robin, never directly from the browser. `createEvent` writes the meeting row at once (`created_by_crm`, its source, attendees, links) so the timeline shows it before the next sync, and the sync later sees the same event by UID and updates it in place.

### Screens

- **Settings › Calendar** (every member): Connect Google calendar (and Outlook from milestone 4), each connection's account, status with last synced time, sharing level (Shared / Private, a SegmentedControl), Make default, Disconnect (confirm). Admins also see the workspace setting "Create people for unknown attendees".
- **The disconnected banner**: a Callout `placement="banner"` at the top of the app shell for the member whose connection is expired or failed, with Reconnect.
- **Timeline entry**: the ActivityFeed's `meeting` entry: title, time range in the viewer's time zone, attendee chips (members, linked people, unknown emails with "Add as person"), the response of each, and the video link.
- All from the component library; any new variant goes through `design-system-guardian` when testing resumes.

## Build plan

**Milestone 1: Google meetings on timelines** (one thread through every layer)
1. Migration: the six tables, `actor_type` `calendar`, guard tests (forced RLS, cross workspace read empty).
2. Core: the provider interface, the fake provider, token encryption, the sync (full and incremental, dedupe, recurring instances, skips, matching, `meeting_records`), the outbox row. Unit tests on the fake provider.
3. API: the Google adapter, the OAuth start and callback, env validation behind `CALENDAR_SYNC`, `calendar.connections.list`, `.update` (sharing, default), `.remove`, `meetings.forRecord`.
4. Worker: `calendar.sync`, the 15 minute poll.
5. Data layer and screens: Settings › Calendar, the timeline's meeting entry, live through the `meetings` kind.
Satisfies AC-597, AC-599 to AC-601, AC-603 to AC-608, AC-610, AC-611 to AC-614, AC-621.

**Milestone 2: live, private and unknown attendees**
6. Push channels, the notify endpoint, renewal in the daily cleanup.
7. Add as person, the workspace setting and automatic creation; ambiguous matches listed in the meeting's attendees.
8. Health: expired, failed, the banner, backoff.
Satisfies AC-602, AC-609, AC-619, AC-620, AC-622.

**Milestone 3: free and busy, and events**
9. `freeBusy` with its cache, `createEvent` with Meet links, `moveEvent`, `cancelEvent`, `CALENDAR_NOT_CONNECTED`.
Satisfies AC-615 to AC-618.

**Milestone 4: Outlook**
10. The Microsoft adapter (Graph, delta queries, subscriptions for push, Teams links), its OAuth start and callback.
Satisfies AC-598.

## Calls for the owner

- Only each member's primary calendar syncs; more calendars later.
- Default sharing is `shared`; internal only meetings never show on records.
- Unknown attendees are not created automatically unless an admin turns it on.
- Descriptions and attachments are never stored.
- Sync window: 90 days back, 180 days ahead.
- Calendar sync needs Google Cloud setup by the owner before it works in production: the Calendar API enabled, the redirect URI added, and the four env values set (`CALENDAR_SYNC=on`).

## Consequences

- A new class of secret (members' calendar tokens) lives in the database, encrypted; losing `CALENDAR_TOKEN_KEY` means every member reconnects.
- Google push needs a public https webhook origin, so local development runs on the poll fallback.
- Google's OAuth verification is required before members outside the owner's test users can connect (sensitive scopes); until then the consent screen shows "unverified app".

## Follow-up

- [ ] Sync more than the primary calendar.
- [ ] Notices and email for a disconnected calendar once #28 lands.
- [ ] Meeting notes and recordings on meetings (later features).
- [ ] Google OAuth app verification for the Calendar scopes before general release.

## Rationale

See [rationale.md](rationale.md).
