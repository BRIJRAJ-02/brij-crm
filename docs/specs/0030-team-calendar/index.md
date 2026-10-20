# 0030. Team calendar on Bookings: one column per member

**Date**: 2026-10-20
**Status**: Proposed
**Feature**: #59 Booking pages, polish plan F2 ("timefix's team calendar, one column per member, needs its own spec and permissions"); works with spec 0029 round robin

## Summary

Bookings › Calendar gains a **Team** view: one day, one column per member, like the timefix bookings page and Google Calendar's day view with several people. Each column shows that member's bookings and blocks, and their outside calendars only as "Busy" blocks, never titles. Seeing and acting on teammates' columns needs the `schedule.manage` permission (later scoped to your team); without it you see only yourself. From a teammate's column you can book someone in as them, block time, change hours and reassign round robin bookings. A day for 50 members loads in one request.

Reasoning and options: see [rationale.md](rationale.md).

## Owner decisions needed

The owner accepted every recommendation below on 20 October 2026; each is now a decision.


Each has my recommendation; answer only where you disagree.

1. **Team view as a day with members across, or a week?** Recommend: a day, one column per member (timefix, Google Calendar), plus a member picker on the week to see one teammate's week. Runner up: week with sub columns.
2. **Who sees whose calendar?** Recommend: one permission, `schedule.manage`, gates seeing and acting on teammates' columns (timefix's model: a receptionist sees every doctor, a doctor sees themselves). Owners and admins have it by default; members don't, and see only their own column. Once #23 brings teams, a team scoped variant (`schedule.manage.team`) gives managers their team only. Runner up: members see everyone by default (open sales teams).
3. **What do colleagues' outside calendar events show?** Recommend: always "Busy" blocks with their time only, never titles, whatever the calendar's sharing setting; Timefix bookings show in full. Runner up: follow spec 0024 sharing (shared calendars show titles).
4. **Who may book on someone's behalf?** Recommend: anyone with `schedule.manage` who sees the column (book, block time, time off, change hours), inside that member's hours unless they choose "Book outside hours"; the member is told by email. Runner up: booking for anyone with `booking.manage`, the rest admins only.
5. **Reassign a round robin booking by dragging it to another column?** Recommend: no, by its menu ("Reassign to…"), so a stray drag never moves a guest. Runner up: drag with an Undo toast.
6. **How many columns?** Recommend: up to 50 members in one day, columns at least 160px wide, scrolling sideways with the names and times pinned. Runner up: cap at 20 and require a filter.

## Dependencies

| Feature | What this spec needs | When it is missing |
|---|---|---|
| Spec 0029 round robin | `booking_hosts` (who is booked when), `bookings.reassign`, rotations for the pool filter | milestone 1 reads `bookings.host_member_id`; pool filter and reassign wait for 0029 |
| Spec 0024 calendar sync, M5 "calendars" | free and busy for every conflict checked calendar of each account | members without a calendar show bookings and blocks only |
| Spec 0035 availability schedules | each member's default schedule ("Working hours") for the open hours band | milestone 1 reads `booking_member_hours` until 0035 lands |
| Spec 0027 quick actions | `DrawCard`, `NewMeetingDialog`, blocks and holds | hard prerequisite (built) |
| Spec 0009 access | the door and the permission catalog | hard prerequisite (built) |
| #23 teams | `teamIds` on the principal for `schedule.manage.team` and the team filter | team scope behaves as own only, and the team filter is hidden |

## Requirements

**User stories**:
- As a manager, I want to see my team's day side by side, so I can spot who is free, who is overloaded and what clashes.
- As an assistant or SDR, I want to book a prospect into a rep's calendar from their column.
- As a member, I want my private meetings to show as Busy to colleagues, never their titles.
- As an admin, I want to reassign a round robin booking when someone is out.

**Acceptance criteria** (this spec owns AC-760 to AC-784):

*View*
- **AC-760**: Bookings › Calendar has a **Me | Team** switch beside the week controls (kept in the URL as `view=team`). Team shows one day with one column per visible member, a shared time axis, prev, next and Today moving by a day, and today's tint (F5).
- **AC-761**: Each column header pins to the top and shows the avatar, name, and a status: "N booked", "Free", "No hours" or "Calendar private"; the member's time zone shows only when it differs from the viewer's. The time axis pins to the left.
- **AC-762**: Columns are ordered: me first, then by name. Each column shows the member's open hours as the light band, bookings (guest name and page title), blocks and holds (hatched, as today), and synced events, all on the viewer's clock.
- **AC-763**: The week view gains "Calendar: Me ▾", a member picker listing only members the viewer may see; picking one shows that member's week with the same rules.
- **AC-764**: With fewer than two visible members, Team shows the empty state "A team calendar needs a team" with "Invite members" for admins.
- **AC-765**: Below 480px, Team shows one member at a time with a member switcher at the top, and swiping or the arrows move between members.

*Filters*
- **AC-766**: A filter bar (the CRM filter bar) offers Members (multi select), Pool (a rotation from spec 0029, showing its members), Team (from #23, hidden until it exists) and "Only members with bookings"; filters live in the URL and survive reload.
- **AC-767**: With a Pool filter on, each column header adds the member's share in the rotation's window ("6 this month"), visible only to `booking.admin` or to that member (spec 0029, AC-752).

*Permissions and privacy*
- **AC-768**: `schedule.manage` joins the permission catalog (owner and admin by default, not member). With it, Team shows every active member; without it, only your own column. When #23 lands, `schedule.manage.team` limits it to members who share a team with you.
- **AC-769**: The team day read is filtered on the server through the access door: a member you may not see is never in the answer, not hidden in the browser. A test shows a member without `schedule.manage` gets only their own column, even with other `memberIds` asked for.
- **AC-770**: A colleague's outside calendars (every calendar spec 0024 M5 checks for conflicts) show only as "Busy" blocks with their times: no title, location, attendees or calendar name ever leaves the server for anyone but that member. Opening one says "Busy".
- **AC-771**: Bookings made through Timefix pages show the guest's name, page title and status to anyone who may see the column; manage tokens, answers and the guest's email show only to the host and `booking.admin`.
- **AC-772**: A member's blocks show to viewers of their column as "Blocked" or "Held" without the label, except to the member and `schedule.manage` holders.

*Quick actions on another member's column*
- **AC-773**: Dragging or clicking empty time on a teammate's column opens the spec 0027 card with **Book someone in**, **Block time** and **Time off** when the viewer has `schedule.manage`; the booking uses one of that member's pages (or a round robin page they are in) with them as host, inside their hours.
- **AC-774**: **Book outside hours** is a choice in the same card for `schedule.manage` holders, and says so on the booking ("Booked outside Sam's hours").
- **AC-775**: Each action is checked again on the server: the permission, the target member is active in the same workspace, and the slot is free under that member's host lock. A refused action answers 403 or `SLOT_TAKEN` and the card says why.
- **AC-776**: A booking made for someone else records who made it ("Booked by Priya") and emails the host.
- **AC-777**: A round robin booking's menu offers "Reassign to…" (`schedule.manage` or `booking.admin`): "Next in rotation" or a member free at that time (spec 0029, AC-748); it moves to the new column when saved, with an Undo toast while the change can still be reversed.

*Performance and live*
- **AC-778**: One procedure `bookings.teamDay({ day, timeZone, memberIds? })` returns every visible member's column in one answer: hours band, bookings, blocks and synced events, each read with one query over all members; capped at 50 members and 2,000 items, with "Showing 50 of 64, filter to see the rest" past the cap.
- **AC-779**: A team day of 30 members with 300 items renders in under 300ms after data arrives on a mid range laptop, and scrolling stays at 60 frames a second; columns past twelve are windowed horizontally.
- **AC-780**: Busy blocks come from each member's conflict calendars through the existing 60 second busy cache (`createBusyCache`), one batched provider read per member per day at most, read in parallel; a member whose calendar can't be read shows "Calendar unavailable" in the header instead of blocks, and the rest of the day still loads.
- **AC-781**: A booking, block or reassignment made in the Team view appears at once (optimistic, rolled back on refusal); changes by others appear when the window regains focus, as the week does today.

*List and quality*
- **AC-782**: Bookings › List gains a Host column and the same Members filter, with the same permissions.
- **AC-783**: The Team view is fully keyboard usable: arrow keys move between columns and hours, Enter opens a block or the quick action card, and each column header is a labelled region; it meets WCAG AA in both themes.
- **AC-784**: Settings › Calendar says what teammates see: "People who manage schedules see your outside events as Busy, never their titles."

## Decision

Add a Team day view to Bookings › Calendar, fed by one batched `bookings.teamDay` read filtered at the access door by the `schedule.manage` permission, showing colleagues' outside calendars as Busy only and spec 0027's quick actions for writes. See [rationale.md](rationale.md).

## Feature design

### Data model

No new tables. The permission catalog (`packages/contracts/src/access.ts`) gains `schedule.manage` (owner, admin) and, with #23, `schedule.manage.team`. `bookings` gains `booked_by_member_id` (nullable, AC-776). Indexes used: `booking_hosts (member_id, during)` from spec 0029 (or `bookings_by_host` before it), `booking_time_blocks (member_id, …)`, and `meeting_sources` joined to `calendar_connections (member_id)`.

### Core

- `visibleMembers(principal)`: through the door: all active members with `schedule.manage`; those sharing a team with `schedule.manage.team` (after #23); else self.
- `readTeamDay(scope, { day, timeZone, memberIds })`: intersects the asked members with the visible ones, then in parallel: hours (each member's default schedule from spec 0035, `booking_member_hours` until then), bookings over the day (from `booking_hosts` joined to `bookings` and `booking_pages`), blocks (`blockOccurrences`, label dropped per AC-772), busy spans per member through the busy cache (AC-780), with the viewer's own synced events in full as today. Answers `{ columns: [{ member, timeZone, status, hours, items }] , truncated }`.
- Busy spans for colleagues are plain `{ start, end }`: the provider's details are never read into the answer, so there is nothing to redact.
- Writes reuse `bookAsHost`, `blocks.create`, the hours write and spec 0029's `reassign`, each gaining a `forMemberId` checked at the door (`schedule.manage` for anyone but yourself, AC-775).

### API

| Procedure | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|
| `bookings.teamDay` | day, timeZone, memberIds? | columns, truncated | signed in member; columns limited by `schedule.manage` | 400 bad day |
| `bookings.bookAsHost` | + forMemberId | booking | own with `booking.manage`; others with `schedule.manage` | 403, `SLOT_TAKEN`, `OUTSIDE_HOURS` |
| `bookings.blocks.create` | + forMemberId | block | own, or `schedule.manage` | 403 |
| `bookings.reassign` | bookingId, to | booking | `schedule.manage` or `booking.admin` | 403, `SLOT_TAKEN` |
| `members.visible` | none | members the viewer may see | signed in member | none |

### Client

- `data.bookings.teamDay(slug, day, filters)`: a held view in `packages/data/src/bookings/store.ts`, keyed by day and filters, prefetching the next and previous day; writes patch it optimistically.
- UI: a new `TeamDay` module in `packages/ui/src/modules/` sharing `placeBlocks`, block kinds and the draw layer with `WeekCalendar` (reviewed by `design-system-guardian`), windowed with TanStack Virtual on the column axis. The route stays `w.$slug.bookings.calendar.tsx` with `view=team`, `d` and the filters in `search.ts`.

### Value sourcing

| Action | Value | Source |
|---|---|---|
| Column header | avatar | `auth.user.image` via `members.user_id`, else initials |
| Column header | time zone | the default schedule's time zone (spec 0035) |
| Column header | status | derived: count of confirmed bookings that day; "No hours" when none set; "Calendar unavailable" when the busy read fails |
| Hours band | open hours | the member's default schedule (spec 0035; `booking_member_hours` before it), overrides applied, in the member's zone, drawn on the viewer's clock |
| Busy block | time only | the busy cache over spec 0024 M5's conflict calendars |
| Share | count in window | spec 0029 ledger |
| Day bounds | viewer's day | `timeZone` input, the browser's zone |

### Key invariants

- No member outside `visibleMembers` appears in any answer.
- A colleague's outside event title never leaves the server.
- A write for another member always passes their host lock.

### Security model

Reads and writes on anyone else's column: `schedule.manage` (team scoped after #23); own column as today. Colleagues' outside calendars are Busy only. Denied actor tests for each.

### Critical test scenarios

- Happy path: an admin opens Team, sees 5 columns, books a guest into Sam's column; Sam gets the booking and an email (AC-760, AC-773, AC-776).
- Privacy: a colleague's outside event shows as Busy with no title in the answer payload, and in full to its owner on their Me view (AC-770).
- Access: a member without `schedule.manage` gets one column; a crafted `memberIds` with others returns only self (AC-768, AC-769).
- Write refused: a member without `schedule.manage` tries Block time on a teammate's column through the API and gets 403 (AC-773, AC-775).
- Scale: 50 members and 2,000 items, one request, truncated flag past the cap (AC-778, AC-779).

## Build plan

**Milestone 1: see the team's day** (thin thread)
1. Permissions in the catalog with defaults; `visibleMembers`; `readTeamDay` with Busy only colleague spans; deny tests. AC-768 to AC-772, AC-778, AC-780.
2. `bookings.teamDay` procedure and the data layer view. AC-778, AC-781.
3. `TeamDay` module and the Me | Team switch, headers, hours band, empty state, phone layout. AC-760 to AC-762, AC-764, AC-765, AC-783.

**Milestone 2: act on a teammate's column**
4. `forMemberId` on book and blocks, server checks, `booked_by_member_id`, host email. AC-773 to AC-776.
5. The member picker on the week, the List's Host column and filter. AC-763, AC-782.

**Milestone 3: round robin and scale**
6. Filters (Members, Pool, Only with bookings) and shares in headers. AC-766, AC-767.
7. Reassign from the menu (after spec 0029 milestone 2). AC-777.
8. Column windowing and the render budget measured. AC-779.
9. Settings copy on what teammates see. AC-784.

## Consequences

**Positive**:
- One place to see and act on the team's day, matching timefix.
- Visibility is a real permission at the door, ready for teams and custom roles.
- Colleagues' outside calendars stay private: Busy only.

**Negative / tradeoffs**:
- With the recommended default, plain members can't see teammates; an open team must make them admins until editable roles (#24) exist.
- Busy reads cost one provider call per member per day on a cold cache; a 50 member day leans on provider quotas and on spec 0024 M5.
- `TeamDay` is a second calendar layout to keep in step with `WeekCalendar`.
- Without live updates, two people booking the same teammate see each other's bookings only on refocus; the host lock still prevents a clash.

**Neutral**:
- `schedule.manage.team` arrives with #23; until then the permission is all or nothing.

## Follow-up

- [ ] Live updates for the team day over the workspace channel (spec 0007) once bookings publish change events.
- [ ] Editable role permissions so a workspace can grant `schedule.manage` to members (#24).
- [ ] Clash and outside hours flags on bookings (timefix's red flag).
- [ ] Drag a booking between columns to reassign, if owners ask after using the menu.

## Rationale

See [rationale.md](rationale.md).
