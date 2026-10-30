# 0037 · Every member's own calendars, on a team

**Part of**: [index.md](index.md) (owner decisions 14, 15 and 31). **ACs**: AC-1306 to AC-1315. **Status**: decisions accepted 21 October 2026; **amended 31 October 2026**: built by J3 and J8 (migration 0134) except the Team day's chips (J12); the sweep's window is one hour (AC-1311), and the routing pool preview is gone with the routing setup.
**Extends**: spec 0024 (calendar sync, and its milestones 4 and 5: Outlook, several calendars per account, up to 6 accounts, conflict and show switches, colours, "Add events to"), spec 0029 (round robin reads each member's busy time), spec 0030 (Busy only colleagues), [0037-scheduling-access.md](0037-scheduling-access.md) (See reach).

## Summary

Each member's calendars stay theirs. Only the member connects accounts, picks which calendars check for conflicts, show, and sync, chooses where new bookings go, and sets sharing; no role, delegation or reach changes that, because calendar access is the member's own OAuth grant. What a team gets is what it needs to schedule around people: their **Busy times** (never titles, attendees, places or calendar names), and their **calendar health** as a status (Connected, Some calendars skipped, Reconnect needed, No calendar), shown to people who may see them on the Members page, the Roster, Round robin and the Team day. When a calendar breaks, the member gets one email per broken episode (timefix's rule), and a manager can press "Ask to reconnect".

## How spec 0024 M4 and M5 feed the team

| Need | Comes from | Notes |
|---|---|---|
| A member's busy time for slots | spec 0024 AC-994: every calendar with Check for conflicts on, in all their accounts (up to 6), one provider call per account | the 60 second busy cache per member and range |
| A member who can't be read | spec 0024 AC-995: a failing calendar is skipped; a member is closed only when every conflict calendar failed or the destination's grant is gone | spec 0029 AC-736 drops a closed member from a round robin union instead of closing the page |
| Where a booking's event goes | spec 0024 AC-996 and AC-997: the host's own "Add events to" calendar, or the page's override when it names a calendar of that host | with fixed hosts, the organiser's calendar holds the event and the other hosts are attendees (AC-1313) |
| What colleagues see on the Team day | spec 0030 AC-770 and spec 0024 AC-999: Busy only | unchanged |
| Meetings on records | spec 0024 AC-611: shared or private per connection | private meetings show "Private meeting" to everyone else, admins included |
| A member with no calendar | spec 0029 AC-729 and spec 0025 AC-631: hours and bookings only, with a warning | their status reads No calendar |

## User stories

- As a member, I want colleagues and admins to see only that I'm busy, never what I'm doing or which calendar it's on.
- As a team lead, I want to see whose calendar is broken before it costs us a double booking, and to nudge them.
- As a member, I want to be told once, clearly, when my calendar stops syncing, not every fifteen minutes.

## Acceptance criteria

- **AC-1306**: Only the member connects, disconnects or refreshes their calendar accounts, and changes their calendars' switches, colours, destination and sharing (spec 0024, unchanged). No role, delegation or reach gives this to anyone else, and the calendar procedures stay own member only (spec 0024's `ownConnection` access entry).
- **AC-1307**: `calendar.health({ memberIds })` answers, for each asked member in the caller's See reach, or for any member to a holder of `booking.admin`, one status and the time it began: **Connected**; **Some calendars skipped** (at least one conflict calendar failing, spec 0024 AC-995); **Reconnect needed** (the account holding the destination, or every conflict calendar, is expired, revoked or failed); **No calendar**. It never answers account emails, calendar names, provider error text or event data. A member outside that reach is left out. Editing a rotation alone gives no health reads (AC-1315). Until J1 merges, it answers the caller's own status, and every member's to `booking.admin`.
- **AC-1308**: The status shows as a chip (`CalendarHealthChip`) in the Members page's Calendar column (holders of `members.manage`), under each name on the Roster, beside each member on Bookings › Round robin (all built), and in the Team day's column header (spec 0030 AC-761's status, J12).
- **AC-1309**: Someone with See over a member, or a holder of `booking.admin`, can press "Ask to reconnect" when the status is Reconnect needed or Some calendars skipped: the member gets an email linking to Settings › Account › Calendars, naming who asked; at most once per member per 24 hours (429 `RATE_LIMITED` with the wait); audited (`calendar.reconnect_asked`).
- **AC-1310**: When one of a member's connections becomes expired or failed (spec 0024 AC-619, AC-620), the member gets exactly two emails for that episode at most: one when it starts ("Your Google calendar stopped syncing, so people may book you when you're busy. Reconnect"), and one reminder 7 days later if it is still broken. The episode ends when the connection is connected again, and a new break starts a new episode.
- **AC-1311**: The health sweep runs at least hourly: it asks for every 15 minutes and runs at the deployment's job drain (every hour on `brij-crm`'s Hobby plan, every 15 minutes where a cron drains more often), and its counts cover the last hour, so these rules hold at either cadence (amended 31 October 2026; no setting per deployment). If at least a quarter of all checked connections, and at least 4, broke in the last hour, no member emails go out for that sweep; one warning goes to Sentry with the counts; the next sweep decides again. One sweep sends at most 200 emails; the rest go next sweep.
- **AC-1312**: Colleagues' outside events stay Busy only everywhere (spec 0030 AC-770, spec 0024 AC-999), and meetings from a private connection show "Private meeting" with their time to everyone but the members whose connections hold them, owners and admins included (spec 0024 AC-611).
- **AC-1313**: For round robin and routing, each member's busy time is the union of their conflict calendars across all their accounts, a closed member is left out of a union (spec 0029 AC-736), and the event goes to the host's destination calendar (spec 0024 AC-996, AC-997). On a page with fixed hosts the organiser is the first fixed host by position, else the first rotation's host, and every other host is an attendee, so their own calendars receive the invitation through the provider.
- **AC-1314**: A member with No calendar can still host from their hours and bookings (spec 0029 AC-729's warning badge); Round robin, the Roster and the Team day show their status so the risk is visible.
- **AC-1315**: Editing a rotation or a page gives no reads about its members' calendars: the rotation screen shows each member's health chip only to viewers with See over them or `booking.admin`; other editors see the chip as "Hidden".

## Design

### The health status

`calendarHealth(tx, memberIds)` reads, in one query, each member's connections (`calendar_connections.status`, spec 0024) and their calendars (`calendar_calendars.check_conflicts`, `is_destination`, `last_error`, `failing_since`, spec 0024 M5) and folds them:
1. no live connection: No calendar;
2. the destination's connection, or every conflict calendar's connection, is `expired`, `revoked` or `failed`, or every conflict calendar has a `last_error`: Reconnect needed, since the earliest `failing_since`;
3. any conflict calendar with a `last_error`: Some calendars skipped;
4. otherwise Connected.

Before spec 0024 M5 lands, the same rules run on connections only (no per calendar errors). The procedure filters asked members through the caller's See reach (`canActFor`, 'view'), or lets `booking.admin` see all; members outside are left out (the index's `filtered` access kind).

### Health emails

- Inputs: spec 0024's status changes on `calendar_connections` (to `expired` on an invalid grant, to `failed` after 6 hours of errors). Each change to a broken state starts an episode stored on the connection: `health_notified_at` (set when the first email goes) and `health_reminded_at` (set when the reminder goes), new nullable timestamp columns, both cleared when the connection is connected again.
- There was no shared sweep (each connection's `crm_calendar_sync` task reschedules itself), so this adds a cron task, `crm_cron_calendar_health` (built: `CALENDAR_HEALTH_CRONTAB`, every 15 minutes with 15 minutes of fill, so the hourly drain turn runs it once), under the worker's own login (`crm_worker`), as the daily cleanup reaches across workspaces. A security definer function, `crm_calendar_health_candidates()`, answers only ids and counts across workspaces: the connections with an episode and no email yet, or one email at least 7 days old and no reminder, and the counts of connections checked and newly broken in the last hour. When at least a quarter of the checked connections, and at least 4, newly broke, it sends nothing and logs one warning; otherwise it queues up to 200 `calendar.health_email` jobs, each a system job in its own workspace, keyed by connection, episode and which email (first or reminder) so a retry never sends twice.
- The email uses `packages/emails` (the shared footer) and names the provider and account email to the member only.

### Ask to reconnect

`calendar.askReconnect({ memberId })`: checks the caller's See reach (or `booking.admin`), then the 24 hour limit per member from the audit log's latest `calendar.reconnect_asked` row for that member (`target_type = 'member'`, `target_id` the member id, read through spec 0031's `audit_events_target` index), writes that audit row, and queues `calendar.reconnect_asked_email` to the member ("Priya asked you to reconnect your calendar."). No new table.

### Procedures

| Procedure | Key inputs | Key outputs | Access | Key errors |
|---|---|---|---|---|
| `calendar.health` | `memberIds[]` (1 to 50) | `[{ memberId, status, since? }]` | any member; members outside reach left out | none |
| `calendar.askReconnect` | `memberId` | none | See, or `booking.admin` | 404, 429 `RATE_LIMITED` |

### Screens

- The status chip is the library's Badge or StatusDot with a text label (never colour alone), a tooltip with the since time, and, on Reconnect needed and on Some calendars skipped, an "Ask to reconnect" action in the row menu or column header menu.
- Settings › Account › Calendars (spec 0024) is unchanged; the member's own banner (spec 0024 AC-619) stays.

### Value sourcing

| Action | Value | Source |
|---|---|---|
| Status | one of four | the fold above over spec 0024's `calendar_connections` and `calendar_calendars` |
| Since | time | the earliest `failing_since` of what broke, else the connection's status change time |
| Episode | start and end | the connection's move to `expired` or `failed`, and back to `connected` |
| Mass outage | yes or no | newly broken / checked in this sweep, at least a quarter and at least 4 (timefix's `MASS_FAILURE_FRACTION` and `MASS_FAILURE_COUNT`) |
| Email cap | 200 per sweep | this plan (timefix capped at 5 for its smaller platform) |

### Key invariants

- No read another member can call carries a calendar name, account email, provider error or event detail.
- Nobody changes another member's calendars.
- At most two emails per broken episode: one when it starts, one reminder 7 days later.

### Numbers

| Value | Number | Runner up |
|---|---|---|
| Sweep cadence and window | at least hourly (asked every 15 minutes), counting the last hour | every 15 minutes, set per deployment |
| Reminder while broken | after 7 days | after 3 days |
| Mass outage hold | at least 25 percent and at least 4 connections in one sweep | no hold |
| Emails per sweep | 200 | 50 |
| Ask to reconnect | once per member per 24 hours | once per 12 hours |

### Critical test scenarios

- A colleague with See reach reads `calendar.health` for a member whose secondary calendar fails: Some calendars skipped, with no calendar name or error text in the payload (AC-1307).
- A member's Google grant is revoked: one email, none on the next sweeps, one reminder after 7 days, none after that, none after reconnecting; a new revoke starts again (AC-1310).
- Five of twelve connections break in one sweep (a provider outage in the fake adapter): no emails, one Sentry warning (AC-1311).
- A member without reach calls `calendar.askReconnect` for someone: `NOT_FOUND`; a lead presses it twice in an hour: 429 (AC-1309).
- A fixed host plus rotation booking: the event is on the fixed host's destination calendar, the picked host is an attendee (AC-1313).
