# 0030. Team calendar on Bookings: one column per member

**Date**: 2026-10-20
**Status**: Proposed
**Feature**: #59 Booking pages, polish plan F2 ("timefix's team calendar, one column per member, needs its own spec and permissions"); works with spec 0029 round robin

## Summary

Bookings › Calendar gains a **Team** view: one day, one column per member, like the timefix bookings page and Google Calendar's day view with several people. Each column shows that member's bookings, blocks and calendar events, with a private event shown only as "Busy". Who you can see is set by two new permissions (your team, or everyone); without them you see only yourself. From a teammate's column you can book someone in as them, and admins can also block time, change hours and reassign round robin bookings. A day for 50 members loads in one request.

Reasoning and options: see [rationale.md](rationale.md).

## Owner decisions needed

Each has my recommendation; answer only where you disagree.

1. **Team view as a day with members across, or a week?** Recommend: a day, one column per member (timefix, Google Calendar), plus a member picker on the week to see one teammate's week. Runner up: week with sub columns.
2. **Who sees whose calendar by default?** Recommend: owners, admins and members all see everyone (`bookings.read.all`), as a sales team works in the open. Runner up: members see only themselves, admins see everyone (timefix's default).
3. **What do other people's synced calendar events show?** Recommend: follow each member's calendar sharing from spec 0024: shared shows the title, private (or an event marked private) shows "Busy". Runner up: always "Busy".
4. **Who may book on someone's behalf?** Recommend: anyone with `booking.manage` who can see that column, inside that member's hours; the member is told by email. Blocks, hours and time off on someone else's column: admins only. Runner up: admins only for everything.
5. **Reassign a round robin booking by dragging it to another column?** Recommend: no, by its menu ("Reassign to…"), so a stray drag never moves a guest. Runner up: drag with an Undo toast.
6. **How many columns?** Recommend: up to 50 members in one day, columns at least 160px wide, scrolling sideways with the names and times pinned. Runner up: cap at 20 and require a filter.

## Dependencies

| Feature | What this spec needs | When it is missing |
|---|---|---|
| Spec 0029 round robin | `booking_hosts` (who is booked when), `bookings.reassign`, rotations for the pool filter | milestone 1 reads `bookings.host_member_id`; pool filter and reassign wait for 0029 |
| Spec 0024 calendar sync | `meetings` per connection, `sharing`, `is_private` | members without a calendar show bookings and blocks only |
| Spec 0027 quick actions | `DrawCard`, `NewMeetingDialog`, blocks and holds | hard prerequisite (built) |
| Spec 0009 access | the door and the permission catalog | hard prerequisite (built) |
| #23 teams | `teamIds` on the principal for `bookings.read.team` and the team filter | team scope behaves as own only, and the team filter is hidden |

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
- **AC-768**: Two permissions join the catalog: `bookings.read.team` (see members who share a team with you) and `bookings.read.all` (see everyone). Without either, Team shows only your own column. Defaults: owner, admin and member get `bookings.read.all` (owner decision 2).
- **AC-769**: The team day read is filtered on the server through the access door: a member you may not see is never in the answer, not hidden in the browser. A test shows a member with neither permission gets only their own column.
- **AC-770**: Another member's synced event shows its title, location and attendees only when its connection's `sharing` is `shared` and the event isn't private; otherwise it is a "Busy" block with its time only, and opening it says "Private". Internal only meetings follow the same rule.
- **AC-771**: Bookings made through Timefix pages show the guest's name, page title and status to anyone who may see the column; manage tokens, answers and the guest's email show only to the host and `booking.admin`.
- **AC-772**: A member's blocks show to viewers of their column as "Blocked" or "Held" without the label, except to the member and `booking.admin`.

*Quick actions on another member's column*
- **AC-773**: Dragging or clicking empty time on a teammate's column opens the spec 0027 card with **Book someone in** when the viewer has `booking.manage` and may see the column; the booking uses one of that member's pages (or a round robin page they are in) with them as host, inside their hours.
- **AC-774**: Admins (`booking.admin`) also get **Block time** and **Time off** on a teammate's column, and **Book outside hours**. Others see only Book someone in.
- **AC-775**: Each action is checked again on the server: the permission, the target member is active in the same workspace, and the slot is free under that member's host lock. A refused action answers 403 or `SLOT_TAKEN` and the card says why.
- **AC-776**: A booking made for someone else records who made it ("Booked by Priya") and emails the host.
- **AC-777**: A round robin booking's menu offers "Reassign to…" (admins): "Next in rotation" or a member free at that time (spec 0029, AC-748); it moves to the new column when saved, with an Undo toast while the change can still be reversed.

*Performance and live*
- **AC-778**: One procedure `bookings.teamDay({ day, timeZone, memberIds? })` returns every visible member's column in one answer: hours band, bookings, blocks and synced events, each read with one query over all members; capped at 50 members and 2,000 items, with "Showing 50 of 64, filter to see the rest" past the cap.
- **AC-779**: A team day of 30 members with 300 items renders in under 300ms after data arrives on a mid range laptop, and scrolling stays at 60 frames a second; columns past twelve are windowed horizontally.
- **AC-780**: Synced events come from the `meetings` table; the team day never calls a provider's `freeBusy`.
- **AC-781**: A booking, block or reassignment made in the Team view appears at once (optimistic, rolled back on refusal); changes by others appear when the window regains focus, as the week does today.

*List and quality*
- **AC-782**: Bookings › List gains a Host column and the same Members filter, with the same permissions.
- **AC-783**: The Team view is fully keyboard usable: arrow keys move between columns and hours, Enter opens a block or the quick action card, and each column header is a labelled region; it meets WCAG AA in both themes.
- **AC-784**: Settings › Calendar says what teammates see: "Teammates who can see your calendar see your shared events' titles. Private calendars show as Busy."

## Decision

Add a Team day view to Bookings › Calendar, fed by one batched `bookings.teamDay` read filtered at the access door by two new permissions, reusing spec 0024's sharing rule for titles and spec 0027's quick actions for writes. See [rationale.md](rationale.md).

## Feature design

### Data model

No new tables. The permission catalog (`packages/contracts/src/access.ts`) gains `bookings.read.team` and `bookings.read.all`, with role defaults per owner decision 2. `bookings` gains `booked_by_member_id` (nullable, AC-776). Indexes used: `booking_hosts (member_id, during)` from spec 0029 (or `bookings_by_host` before it), `booking_time_blocks (member_id, …)`, and `meeting_sources` joined to `calendar_connections (member_id)`.

### Core

- `visibleMembers(principal)`: through the door: all active members with `bookings.read.all`; those sharing a team with `bookings.read.team`; else self.
- `readTeamDay(scope, { day, timeZone, memberIds })`: intersects the asked members with the visible ones, then in parallel: hours (`booking_member_hours`), bookings over the day (from `booking_hosts` joined to `bookings` and `booking_pages`), blocks (`blockOccurrences`, label dropped per AC-772), meetings by connection owner with `redactFor(viewer)` applying AC-770. Answers `{ columns: [{ member, timeZone, status, hours, items }] , truncated }`.
- `redactFor(viewer, meeting, connection)`: pure, shared with timelines' `meetings.forRecord` so the rule lives once.
- Writes reuse `bookAsHost`, `blocks.create` and spec 0029's `reassign`, each gaining a `forMemberId` checked at the door (AC-775).

### API

| Procedure | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|
| `bookings.teamDay` | day, timeZone, memberIds? | columns, truncated | signed in member; columns limited by `bookings.read.*` | 400 bad day |
| `bookings.bookAsHost` | + forMemberId | booking | `booking.manage` and may see that member | 403, `SLOT_TAKEN`, `OUTSIDE_HOURS` |
| `bookings.blocks.create` | + forMemberId | block | own, or `booking.admin` | 403 |
| `bookings.reassign` | bookingId, to | booking | `booking.admin` (spec 0029) | 403, `SLOT_TAKEN` |
| `members.visible` | none | members the viewer may see | signed in member | none |

### Client

- `data.bookings.teamDay(slug, day, filters)`: a held view in `packages/data/src/bookings/store.ts`, keyed by day and filters, prefetching the next and previous day; writes patch it optimistically.
- UI: a new `TeamDay` module in `packages/ui/src/modules/` sharing `placeBlocks`, block kinds and the draw layer with `WeekCalendar` (reviewed by `design-system-guardian`), windowed with TanStack Virtual on the column axis. The route stays `w.$slug.bookings.calendar.tsx` with `view=team`, `d` and the filters in `search.ts`.

### Value sourcing

| Action | Value | Source |
|---|---|---|
| Column header | avatar | `auth.user.image` via `members.user_id`, else initials |
| Column header | time zone | `booking_member_hours.availability.timeZone` |
| Column header | status | derived: count of confirmed bookings that day; "No hours" when none set; "Calendar private" when every connection is private |
| Hours band | open hours | `booking_member_hours`, overrides applied, in the member's zone, drawn on the viewer's clock |
| Busy block | time only | `meetings` with `redactFor` |
| Share | count in window | spec 0029 ledger |
| Day bounds | viewer's day | `timeZone` input, the browser's zone |

### Key invariants

- No member outside `visibleMembers` appears in any answer.
- A private title never leaves the server for anyone but its holder.
- A write for another member always passes their host lock.

### Security model

Reads: own, team or all by permission. Writes on another column: `booking.manage` plus visibility for booking; `booking.admin` for blocks, time off, outside hours and reassign. Denied actor tests for each.

### Critical test scenarios

- Happy path: an admin opens Team, sees 5 columns, books a guest into Sam's column; Sam gets the booking and an email (AC-760, AC-773, AC-776).
- Privacy: a private connection's event shows as Busy to a teammate and with its title to its owner (AC-770).
- Access: a member without `bookings.read.*` gets one column; a crafted `memberIds` with others returns only self (AC-768, AC-769).
- Write refused: a member tries Block time on a teammate's column through the API and gets 403 (AC-774, AC-775).
- Scale: 50 members and 2,000 items, one request, truncated flag past the cap (AC-778, AC-779).

## Build plan

**Milestone 1: see the team's day** (thin thread)
1. Permissions in the catalog with defaults; `visibleMembers`; `readTeamDay` with `redactFor`; deny tests. AC-768 to AC-772, AC-778, AC-780.
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
- No provider calls for the team view.

**Negative / tradeoffs**:
- With the recommended default, members see each other's bookings and shared titles; a privacy minded workspace must change role permissions once custom roles exist (until then only by changing the default).
- `TeamDay` is a second calendar layout to keep in step with `WeekCalendar`.
- Synced events are only as fresh as the last sync, so the team view can lag a provider by minutes.
- Without live updates, two people booking the same teammate see each other's bookings only on refocus; the host lock still prevents a clash.

**Neutral**:
- `bookings.read.team` behaves as own only until #23.

## Follow-up

- [ ] Live updates for the team day over the workspace channel (spec 0007) once bookings publish change events.
- [ ] Editable role permissions so a workspace can choose own, team or all per role (#24).
- [ ] Clash and outside hours flags on bookings (timefix's red flag).
- [ ] Drag a booking between columns to reassign, if owners ask after using the menu.

## Rationale

See [rationale.md](rationale.md).
