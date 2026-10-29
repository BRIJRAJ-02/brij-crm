# 0024. Calendar sync: meetings on records, and free and busy for booking

**Date**: 2026-10-19 (amended 2026-10-20: milestone 5, every calendar in each account, and milestone 4, Outlook, ship together in one release)
**Status**: Proposed

## Summary

A member connects their Google or Outlook calendar. Their meetings, past and upcoming, sync into the CRM and appear on the timeline of every person and company in them, live as they change. Each member chooses whether their meetings are shared with the workspace or kept private. The same connection gives the CRM free and busy times and lets it create, move and cancel events, which booking pages (#59, spec 0025) and later round robin (#58) build on. A connection that expires or is revoked says so in the app and is never silently stale.

The owner asked for this spec to be written with the recommended answer to every open question (19 October 2026), so each call below is a default the owner may change; the ones worth a look are under **Calls for the owner**.

**Amendment, 20 October 2026.** The owner decided that calendars follow the Calendly style and that Outlook comes in the same release. Milestone 5 lists every calendar in each connected account: each can check for conflicts, show on the member's week, and sync meetings, with its own colour; each member picks one calendar where new bookings go, and a booking page can name another. One failing calendar no longer closes a page. Milestone 4 adds Outlook through Microsoft Graph. Both ship together (Release 1). The new criteria are AC-991 to AC-1014; this amendment owns AC-991 to AC-1030.

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
- **AC-599**: One connection per member per provider account; a member may connect at most 3 accounts (amended: 6, AC-1000). Disconnecting stops sync at once, deletes the stored tokens, and removes that connection's meetings that no other connection also holds.
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
- **AC-615**: `freeBusy(scope, { memberIds, from, to })` returns each member's busy intervals from their connected calendars (all of their connections; amended by AC-994 and AC-995: every conflict checked calendar, failures skipped), at most a 62 day range, answered in under 1 second at p95 for 5 members, cached 60 seconds per member and range.
- **AC-616**: `createEvent(scope, { memberId, title, start, end, attendees, timeZone, video: true | false, description })` creates the event in the member's primary calendar of their default connection (amended by AC-996 to AC-998: in the destination calendar), with a Google Meet or Microsoft Teams link when `video` is true, and answers the meeting it made.
- **AC-617**: `moveEvent` and `cancelEvent` change or cancel an event the CRM created (it keeps the provider's event id), sending updates to attendees through the provider.
- **AC-618**: A member with no connection has no free and busy (callers treat them as unavailable), and `createEvent` refuses with `CALENDAR_NOT_CONNECTED`.

*Health*
- **AC-619**: A refresh that fails with the provider's "invalid grant" (revoked or expired) marks the connection `expired`, stops its sync, and shows a banner to its member ("Your Google calendar disconnected. Reconnect") on every page until reconnected or removed.
- **AC-620**: Other failures retry with backoff; after 6 hours of failures the connection is `failed`, with the same banner and the last error in Settings.
- **AC-621**: The settings page shows each connection's last successful sync time.
- **AC-622**: Push notification channels are renewed before they expire (Google channels last up to 7 days; renewed daily).

*Calendars (milestone 5, amendment of 20 October 2026)*
- **AC-991**: After connecting, once a day, and on Refresh in Settings › Calendar, each account's calendars are listed from the provider: name, provider colour, access role (owner, writer, reader, free and busy only), whether it is the account's main calendar, and its time zone. Calendars removed at the provider are removed here; new ones are added with the defaults of AC-992. At most 50 calendars per account are kept (main first, then by name).
- **AC-992**: Defaults: an account's main calendar checks for conflicts, shows on my calendar and syncs meetings; every other calendar does none of these until the member turns it on. The backfill gives every existing connection its main calendar with these defaults, so nothing a member sees or a page offers changes on the day it ships.
- **AC-993**: Settings › Calendar (Account › Calendars, spec 0026) shows each account as a card (provider mark, email, status, last synced, Sharing, Refresh, Disconnect) with its calendars under it: a colour dot, the name, a "Main" tag, and three switches, Check for conflicts, Show on my calendar and Sync meetings. The colour dot opens a palette of the design system's calendar hues; Reset goes back to the provider's colour. Each switch saves at once and rolls back with a toast on a refusal.
- **AC-994**: `freeBusy` reads every calendar with Check for conflicts on, across all of the member's accounts, with one provider call per account per read (Google `freebusy.query` with each calendar as an item; Outlook as AC-1010). The 60 second cache is per member and range and is cleared when a switch or the destination changes.
- **AC-995**: Each calendar's answer stands alone. A calendar or account that errors or doesn't answer within 3 seconds is skipped: slots come from the rest, the member sees "We couldn't check Work at 10:04, so it was left out" in Settings › Calendar and on Bookings, and the failure is logged. A page offers no times (fails closed) only when every conflict calendar of a required host failed, or when the grant of the account holding the destination calendar is expired or revoked. The public page's wording stays as it is.
- **AC-996**: Each member has one destination calendar, "Add events to", chosen in Settings › Calendar among calendars they can write (owner or writer). The backfill sets it to the main calendar of their default connection. A change applies to new bookings only.
- **AC-997**: The booking page editor has "Add events to": "My default (<calendar>)" or another writable calendar of the page owner. When the named calendar is gone, no longer writable, or its account disconnected, bookings go to the owner's default and the editor shows why. For team pages the override applies only when it names a calendar of the assigned host (spec 0029, AC-743).
- **AC-998**: `createEvent`, `moveEvent` and `cancelEvent` take the calendar; a move or cancel acts on the calendar the event was created in (kept on its meeting source), even if the destination has changed since.
- **AC-999**: An event marked private at the provider (Google visibility private or confidential; Outlook sensitivity private), in any calendar that syncs or checks conflicts, shows to anyone but its owner only as "Busy" with its times, on the team calendar (spec 0030, AC-770) and wherever else others could see it; never its title, attendees, location or calendar name.
- **AC-1000**: A member may connect at most 6 accounts (supersedes AC-599's 3). The seventh is refused with "Connect at most 6 calendar accounts."
- **AC-1001**: The Bookings week view's calendar filter lists my calendars grouped by account, each with its colour and a checkbox that is the same setting as Show on my calendar. Events draw in their calendar's colour (the override, else the provider's mapped to the nearest calendar hue). Busy blocks for events with no one else invited (the owner's 20 October call) keep their look, tinted by their calendar.
- **AC-1002**: Meetings sync to records only from calendars with Sync meetings on. Turning it off removes meetings held only by that calendar, as a disconnect does (AC-599); turning it on runs a full sync of that calendar's window.
- **AC-1003**: Push and the poll fallback work per calendar: each calendar that syncs or checks conflicts has its own watch channel (Google) or subscription (Outlook), renewed as AC-622 says, and its own sync token.
- **AC-1004**: A calendar the member can only read can check for conflicts and show on their calendar, but can't be a destination; the Select doesn't offer it.
- **AC-1005**: When the destination calendar is removed at the provider, the destination falls back to the main calendar of the default connection, and the member sees a banner saying so until they dismiss it or pick another.

*Outlook (milestone 4, same release)*
- **AC-1006**: A member connects Outlook (Microsoft 365 work or school, or a personal outlook.com account) from Settings › Calendar through Microsoft's consent screen (the `common` authority; scopes `offline_access`, `User.Read`, `Calendars.ReadWrite`). It has the same statuses, sharing level, health handling and calendars as Google.
- **AC-1007**: Outlook calendars sync through Microsoft Graph's `calendarView` delta per calendar over the same window; an expired delta token (`syncStateNotFound` or 410) runs a full sync.
- **AC-1008**: Push uses Graph change notification subscriptions on each calendar's events, with a random `clientState` stored hashed and checked on every notification; the validation request is answered with its token; subscriptions are renewed daily (they last at most about three days); a `reauthorizationRequired` or `subscriptionRemoved` lifecycle notice renews or recreates the subscription; the 15 minute poll covers any gap.
- **AC-1009**: Outlook events map like Google's: iCalendar UID for dedupe, attendees and responses, `showAs` free or working elsewhere as not busy, everything else busy, `isCancelled` as cancelled, all day and declined rules as AC-605.
- **AC-1010**: Free and busy on Outlook reads the account's main calendar through `getSchedule` and any other conflict calendar through `calendarView`, in one batch request per account.
- **AC-1011**: `createEvent` on Outlook adds a Teams link when video is asked for and the account allows online meetings; when it doesn't (most personal accounts), the event is made without a link and the host's booking notice says "No Teams link: this Outlook account can't create one."
- **AC-1012**: The API validates `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET` and `MICROSOFT_TENANT` (default `common`) at startup only when `CALENDAR_OUTLOOK=on` (and `CALENDAR_SYNC=on`), and refuses to boot when one is missing then. With it off, Connect Outlook isn't shown.
- **AC-1013**: Both adapters pass one shared adapter test suite run against recorded provider responses (no live calls in CI), and `verify.md` checks a real Google and a real Outlook account by hand before the release.
- **AC-1014**: Milestones 4 and 5 ship in the same release: neither is announced done until both pass their criteria.

## Decision

The owner accepted every recommendation in this spec, including its open questions, on 20 October 2026: Help shows keyboard shortcuts until a help centre exists; a page with its own hours becomes a schedule named after the page; only `booking.admin` edits a colleague's schedules; an Outlook personal account books without a Teams link and the host is told; steps go live in release 1 and one at a time in release 2; the form layout data change is accepted; sidebar changes reach the member's other tabs through the workspace `nav` event.

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

Google: Calendar API v3 with `singleEvents=true`, `showDeleted=true`, `timeMin`/`timeMax` from the window on full sync and the `syncToken` afterwards; free and busy from `freebusy.query`; Meet links by `conferenceData.createRequest` with `conferenceDataVersion=1`. Milestones 1 to 3 sync the primary calendar only; milestone 5 (below) syncs each calendar the member turns on. A fake adapter in core tests stands in for both providers; no test calls a real provider.

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

### Calendars and Outlook (milestones 5 and 4, amendment of 20 October 2026)

**`calendar_calendars`** (new tenant table: `workspace_id` first, forced RLS with the standard policy, audit columns)
- `id`, `connection_id` (foreign key to `calendar_connections`, cascade on delete), `member_id` (copied from the connection, for the destination index and member reads), `provider_calendar_id` (text: Google's calendar id, Graph's calendar id), `name`, `provider_colour` (hex from the provider, shown only through the nearest calendar hue), `colour_override` (a calendar hue token name, nullable), `access_role` (`owner` | `writer` | `reader` | `free_busy`), `is_primary`, `check_conflicts`, `show_in_week`, `sync` (booleans, defaults by AC-992), `time_zone`, `is_destination` (boolean), `sync_state` (jsonb: this calendar's sync token or delta link), `channel` (jsonb: watch channel or Graph subscription id, expiry, hashed token or client state), `last_error` (code and message), `failing_since`.
- Unique (`workspace_id`, `connection_id`, `provider_calendar_id`). Partial unique (`workspace_id`, `member_id`) where `is_destination`. Check: `not is_destination or access_role in ('owner', 'writer')`.
- `calendar_connections.sync_state` and `.channel` move here (the expand migration copies the primary's; the contract migration a release later drops them); `calendar_connections.is_default` stops being read for writes once the destination exists and is dropped with them.
- `booking_pages.destination_calendar_id` (uuid, nullable, foreign key with `on delete set null`).
- `meeting_sources.calendar_id` keeps the provider calendar id; the backfill rewrites today's literal `'primary'` to the main calendar's real id.
- `MAX_CALENDAR_CONNECTIONS` becomes 6 in contracts.

**Provider interface changes** (`packages/core/src/calendar/provider.ts`):

```ts
listCalendars(tokens: Tokens): Promise<ProviderCalendar[]>;   // id, name, colour, accessRole, isPrimary, timeZone
freeBusy(tokens: Tokens, calendarIds: readonly string[], from: string, to: string):
  Promise<ReadonlyMap<string, { readonly busy: readonly Interval[] } | { readonly error: CalendarErrorCode }>>;
createEvent(tokens: Tokens, calendarId: string, input: NewEvent): Promise<ProviderEvent>;
updateEvent(tokens: Tokens, calendarId: string, eventId: string, input: Partial<NewEvent>): Promise<ProviderEvent>;
cancelEvent(tokens: Tokens, calendarId: string, eventId: string): Promise<void>;
watch(tokens: Tokens, calendarId: string, address: string, token: string): Promise<Channel>;
```

`listChanges` already takes a calendar id. Google replaces every `calendars/primary` path with the calendar's id. Microsoft lives in `apps/api/src/calendar/microsoft.ts`, the only module that calls Graph, with the same shape.

**Free and busy with outcomes** (`packages/core/src/calendar/events.ts`): `freeBusy(scope, { memberIds, from, to })` now answers, per member, `{ busy, skipped: [{ calendarId, name, code }], closed: boolean }`. `closed` is true only by AC-995's two rules. The slot engine treats a closed host as unavailable and otherwise uses `busy`; `skipped` is written to `calendar_calendars.last_error` and shown to the member.

**Destination** (`destinationFor(tx, { memberId, pageId? })`): the page's `destination_calendar_id` when it names a writable calendar of that member on a live connection, else the member's `is_destination` calendar, else `CALENDAR_NOT_CONNECTED`. The chosen calendar id is stored on the meeting source that `createEvent` writes, which is what move and cancel read (AC-998).

**Jobs**: `calendar.calendars.refresh` (light lane, per connection) runs after connect, daily, and on Refresh, upserting `calendar_calendars` and removing the gone ones (AC-991, AC-1005). `calendar.sync` loops over the connection's calendars with `sync` or `check_conflicts` on. The notify endpoints (`/api/calendar/google/notify`, `/api/calendar/microsoft/notify`) map the channel or subscription to its calendar.

**API**: `calendar.calendars.list` (the member's accounts with their calendars), `calendar.calendars.update` (`id`, `checkConflicts?`, `showInWeek?`, `sync?`, `colourOverride?`), `calendar.destination.set` (`calendarId`), `calendar.connections.refresh` (`id`); `booking.pages.update` takes `destinationCalendarId: uuid | null`. All own member only; errors `NOT_FOUND`, `CALENDAR_NOT_WRITABLE`, `CALENDAR_LIMIT`.

**Microsoft env** (validated only when `CALENDAR_OUTLOOK=on`): `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_TENANT` (default `common`). An Entra app registration for "accounts in any organizational directory and personal Microsoft accounts", with the redirect URI `<API origin>/api/calendar/microsoft/callback` and the delegated permissions of AC-1006. Push notifications post to `<CALENDAR_WEBHOOK_ORIGIN>/api/calendar/microsoft/notify`.

**Screens** (Calendly style, from the library only):
- Settings › Calendar: "Add events to" (a Select of writable calendars grouped by account) at the top with one line of help; then each account as a Card, its calendars as rows (colour dot button, name, Main tag, three Switches with labels on the first row and as accessible names on every row); a skipped calendar's row shows its warning inline.
- The colour palette: a Popover of the calendar hue tokens as swatches (radio group), with Reset.
- The page editor: "Add events to" Select under Location.
- The Bookings week view: the existing filter menu grows a section per account with each calendar's checkbox and swatch.

**Value sourcing**:

| Action | Value | Source |
|---|---|---|
| Calendar list | name, colour, role, main, zone | provider `listCalendars`, stored on refresh |
| Shown colour | hue | `colour_override`, else `provider_colour` mapped to the nearest calendar hue |
| Busy for slots | intervals | `freeBusy` over calendars with `check_conflicts`, per AC-994 and AC-995 |
| Destination | calendar | page override, else member `is_destination`, per `destinationFor` |
| Backfilled destination | calendar | main calendar of the connection with `is_default` |
| Teams link possible | yes or no | Graph's answer to the online meeting request on create |

**Critical test scenarios** (amendment):
- Backfill: a member with two connections and pages keeps the same slots and the same event calendar after the migration; verifies **AC-992**, **AC-996**.
- Partial failure: of three conflict calendars one times out; slots come from the other two and the warning shows; then all three fail and the page offers none; then only the destination's grant is revoked and the page offers none; verifies **AC-995**.
- Override: a page names a secondary calendar, which is then deleted at the provider; the next booking lands in the default and the editor explains; verifies **AC-997**, **AC-1005**.
- Move after change: an event made in calendar A moves in A after the destination became B; verifies **AC-998**.
- Private: a private event in a secondary calendar shows as Busy to a colleague and in full to its owner; verifies **AC-999**.
- Outlook: the shared adapter suite passes for both providers; a subscription validation and a lifecycle notice are handled; a personal account booking with video gets no link and the notice says so; verifies **AC-1007** to **AC-1011**, **AC-1013**.
- Env: with `CALENDAR_OUTLOOK=on` and a missing secret the API refuses to boot; verifies **AC-1012**.

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

**Milestone 5: calendars** (amendment; ships in the same release as milestone 4)
10. Migration (expand): `calendar_calendars`, `booking_pages.destination_calendar_id`, the backfill (main calendar per connection with AC-992's defaults, destination from the default connection, `sync_state` and `channel` copied, `'primary'` source ids rewritten), guard tests, satisfies **AC-991**, **AC-992**, **AC-996**.
11. Core and the Google adapter: `listCalendars`, calendar ids on every call, `freeBusy` with per calendar outcomes and the closed rule, `destinationFor`, the cache cleared on changes, `calendar.calendars.refresh`, per calendar sync and channels, the cap at 6, satisfies **AC-994**, **AC-995**, **AC-997**, **AC-998**, **AC-1000**, **AC-1002**, **AC-1003**, **AC-1004**, **AC-1005**.
12. API and screens: the calendar procedures; Settings › Calendar accounts with calendars, switches, colours and Add events to; the page editor's Add events to; the week view filter by account; private events as Busy for others; `design-system-guardian`, `ux-interaction-reviewer`, satisfies **AC-993**, **AC-996**, **AC-997**, **AC-999**, **AC-1001**.

**Milestone 4: Outlook** (same release)
13. The Microsoft adapter (Graph `calendarView` delta, `getSchedule` and `calendarView` for free and busy in one batch, events with Teams links when allowed, subscriptions with validation, client state and lifecycle notices), its OAuth start and callback, env behind `CALENDAR_OUTLOOK`, satisfies **AC-598**, **AC-1006** to **AC-1012**.
14. The shared adapter test suite over recorded responses for both providers; `verify.md` by hand with real accounts; `security-access-reviewer` (tokens, webhooks, client state), `state-performance-reviewer` (provider calls per read), satisfies **AC-1013**, **AC-1014**.
15. One release later: the contract migration dropping `calendar_connections.sync_state`, `.channel` and `.is_default`.

## Calls for the owner

- Only each account's main calendar checks for conflicts, shows and syncs until the member turns others on (amended 20 October 2026 from "primary only"; owner decision).
- A failing calendar is skipped with a warning; a page closes only when all of a host's conflict calendars fail or the destination's grant is gone (owner decision, 20 October 2026).
- Private events show as Busy to everyone but their owner (owner decision, 20 October 2026).
- Outlook needs an Entra app registration by the owner (redirect URI, client secret, `CALENDAR_OUTLOOK=on`) before it works in production.
- Default sharing is `shared`; internal only meetings never show on records.
- Unknown attendees are not created automatically unless an admin turns it on.
- Descriptions and attachments are never stored.
- Sync window: 90 days back, 180 days ahead.
- Calendar sync needs Google Cloud setup by the owner before it works in production: the Calendar API enabled, the redirect URI added, and the four env values set (`CALENDAR_SYNC=on`).

## Consequences

- A new class of secret (members' calendar tokens) lives in the database, encrypted; losing `CALENDAR_TOKEN_KEY` means every member reconnects.
- Google push needs a public https webhook origin, so local development runs on the poll fallback.
- Google's OAuth verification is required before members outside the owner's test users can connect (sensitive scopes); until then the consent screen shows "unverified app".
- Milestone 5 multiplies provider work by the calendars members turn on: one channel or subscription and one sync token per calendar, and a larger free and busy request per account. The 50 calendar cap and one call per account per read keep it bounded.
- Outlook adds a second set of secrets, a second webhook, and Microsoft's publisher verification before work accounts outside the owner's tenant can consent without an admin.
- Two providers in one release make the release larger and its verify longer; the owner chose that over shipping calendars first.

## Follow-up

- [x] Sync more than the primary calendar (milestone 5, amendment of 20 October 2026).
- [ ] Microsoft publisher verification, and the admin consent link for tenants that block user consent.
- [ ] Calendars shared with the member that aren't in their own list (Outlook shared calendars, Google calendars only subscribed), if members ask.
- [ ] Notices and email for a disconnected calendar once #28 lands.
- [ ] Meeting notes and recordings on meetings (later features).
- [ ] Google OAuth app verification for the Calendar scopes before general release.

## Rationale

See [rationale.md](rationale.md).

## Calls made fixing late traps, 27 to 30 October 2026 (shipped, main 82fbc760f)

A late trap is a change that saves fine, then breaks something later somewhere else, without anyone being told. Each line says what the product does now, and the trap it closes (numbers from the late trap audit). The owner asked for each to follow industry practice and delegated the product calls.

- A calendar leaving the account's list (unsubscribed, unshared, or past the first 50) never cancels its bookings; only the host deleting the event itself does (#82). Turning a calendar's show in my week off never cancels them either (#3).
- A disconnect clears `bookings.meeting_id` for the meetings it deleted, so a guest's later move or cancel doesn't fail at the provider (#85).
