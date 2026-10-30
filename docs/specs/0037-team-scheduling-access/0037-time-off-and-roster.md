# 0037 · Time off, the Team week and meeting limits

**Part of**: [index.md](index.md) (owner decisions 16 to 18 and 31). **ACs**: AC-1281 to AC-1302. **Status**: decisions accepted 21 October 2026; **amended 31 October 2026**: built by J2, J6 and J7 (see [verify.md](verify.md#time-off-the-roster-and-limits-0037-time-off-and-rostermd)); the Team week is called the **Roster** and becomes its own Bookings tab; AC-1301 and AC-1302 record what was built beyond the plan.
**Extends**: spec 0027 (`booking_time_blocks`, blocks and holds), spec 0035 (schedules and date overrides), spec 0029 (rotations skip people who are off), spec 0030 (the Team day), [0037-scheduling-access.md](0037-scheduling-access.md) (Manage reach, audit, the member told).

## Summary

Three things people who run other people's calendars need. **Time off**: whole days away with a reason and an optional stand in; every page stops offering the person, rotations skip them, a known customer of theirs goes to the stand in, and meetings already booked in that time are flagged for reassignment. **The Roster** (the Team week): timefix's roster, done on spec 0035's own data: people down the side, the days of one dated week across, each cell that day's hours from the person's default schedule; changing a cell writes a date override, so "this week only" needs no new table, and "Copy to next week" and "Set usual hours for several people" make bulk changes easy. **Meeting limits**: at most N meetings a day or a week for one person, across every page, so a person in three rotations isn't booked three times over.

## User stories

- As a doctor, I want to mark my holiday once and have every page and rotation stop booking me.
- As a practice manager, I want to put a doctor's sick day in and see which patients need moving.
- As a sales rep going on leave, I want my customers to book with my stand in while I'm away.
- As a manager, I want to see the team's week at a glance and change one person's Tuesday, or next week for everyone.
- As a rep, I want a cap on how many meetings I get a day, whichever page they come from.

## Acceptance criteria

*Time off*
- **AC-1281**: Time off is one member's whole days away: a from date and a to date (inclusive, at most 366 days), a reason (Vacation, Sick leave, Travel, Public holiday, Other), an optional note (up to 200 characters) and an optional stand in (an active non guest member other than them). The dates are read in the zone of the member's default schedule when it is saved, and that zone is stored with it.
- **AC-1282**: A member adds, changes and removes their own time off (with `booking.manage`); anyone with Manage over them does the same for them. Each change is audited and the member is told when someone else made it (AC-1263, AC-1264); a stand in is emailed when they're named or their dates change ("You're covering for Sam from 3 to 7 November.").
- **AC-1283**: During time off every page that books the member offers no times with them (time off closes every page, private ones included); a rotation skips them for slots and for `assignOwner`, as spec 0029 AC-731 skips someone switched off.
- **AC-1284**: Returning guests and owners: when the owner (spec 0029 AC-739) or the last host ([round robin](0037-round-robin.md), AC-1328) is away at the chosen time and has a stand in who is free then, the booking goes to the stand in with reason `standin`, whether or not they are in the rotation (the ledger row counts toward their share only when they are); with no free stand in, the rotation decides as usual. `assignOwner` does the same for a known record's owner who is away today.
- **AC-1285**: Saving time off over existing bookings lists them in the dialog ("You have 3 meetings in this time.") with each one's guest, page and time; they show "Host away" on Bookings and on the Team day, and round robin ones offer Reassign (spec 0029 AC-748). Nothing is cancelled or moved by itself.
- **AC-1286**: Availability gains a Time off section: upcoming entries first, then past ones (dates, reason, stand in, note, "Changed by" when it applies), Add time off (a Modal: a date range calendar, reason Select, note Field, stand in picker), and each row's menu (Edit, Delete). Someone else's time off, in their Availability (AC-1268) or as "Away" days in the Team week, shows its reason and note only to the member and to Manage over them; See shows "Away" alone.
- **AC-1287**: The Team day (spec 0030) draws time off as an all day "Away" band across the member's column, the Bookings week shows the member's own time off as an all day item, and the column header's status reads "Away" that day.
- **AC-1288**: A member has at most 50 upcoming time off entries (409 `TIME_OFF_LIMIT`); entries may overlap and show merged.

*The Team week*
- **AC-1289**: Bookings › Roster (AC-1447; built first as Availability's Team view, `bookings/availability?view=team`, which redirects there) shows the Team week: one row per active non guest member in the caller's See reach (me first, then by name; a team filter; search by name; 50 rows a page) and one column per day of one week, weeks starting on Monday.
- **AC-1290**: Each cell shows that day's hours from the member's default schedule: the date's override when it has one (with a dot meaning "this week only"), else the weekly hours; "Off" when there are none; "Away" on time off. The row shows the member's time zone as an absolute offset ("UTC+5:30") only when it differs from the viewer's, and their merged hours for the week.
- **AC-1291**: With Manage over the member, a cell opens a Popover with up to 6 ranges (spec 0025's `BOOKING_RANGES_MAX`) in 15 minute steps, Off, and "Usual hours" (which removes that date's override); Save writes the date override on their default schedule through spec 0035's write path (its stale check, the audit row and the notice). A member who never saved hours gets their default stored first (spec 0035 AC-963).
- **AC-1292**: Each row's menu offers "Copy this week to next week" (next week's days become this week's: a day with an override copies it, a day on usual hours removes next week's override) and "Set usual hours" (edits the default schedule's weekly hours); the header offers "Set usual hours for…", which applies one week of hours to several chosen members at once, one audited write each.
- **AC-1293**: Weeks before the current one are read only; the week stepper goes back 8 weeks and forward up to 52 weeks. Every schedule write drops that schedule's date overrides dated more than 8 weeks before today, and a schedule holds up to 400 date overrides (a limit of its own in `ScheduleHours`, above a page's 120), so a rostered week after week never fills it; a schedule that is full answers 422 `CONFIG_INVALID` (as built; there is no `VALUE_INVALID` code), "A schedule holds at most 400 date overrides. Remove some, or set usual hours instead."
- **AC-1294**: A footer row counts, per day, the people working and their merged hours.
- **AC-1295**: A member whose booking pages use a schedule other than their default shows "2 pages use other schedules" in their row, linking to their schedules.
- **AC-1296**: One request answers a week for up to 50 members (`availability.teamWeek`), in under 300 ms p75 server time on the seed, with one query for schedules, one for time off and none per member.

*Meeting limits*
- **AC-1297**: A member may have meeting limits across every page, labelled "Meetings a day" (1 to 50) and "Meetings a week" (1 to 200) as rotations' caps are, each optional, set by them (with `availability.own`) or by Manage over them; days and weeks are counted in their default schedule's zone, weeks from Monday; bookings they host count, cancelled ones don't.
- **AC-1298**: At a limit, every page stops offering that member for that day or week (personal, collective and round robin, where a rotation skips them); the booking's recheck under the host lock refuses a booking that would pass a limit with `SLOT_TAKEN` and fresh slots.
- **AC-1299**: Availability gains a Limits section: the two limits as optional number Fields and this week's count beside each ("4 of 20 this week"), read only without `availability.own` or Manage.

*Quality*
- **AC-1300**: The Team week works by keyboard (arrow keys move between cells, Enter opens one, Escape closes it), every cell is labelled ("Monday 3 November, Sam Lee: 9:00am to 5:00pm"), it meets WCAG AA in both themes, and every screen here uses the library only; `design-system-guardian` and `ux-interaction-reviewer` review it.

*Built beyond the plan (recorded 31 October 2026)*
- **AC-1301**: While the workspace has a workspace link, the Roster's footer adds a quiet second line under each day, "Link: 3": of the rows working that day and not away, how many the link's rotations hold switched on (the first link, a live one before a paused one, then the oldest), read in the same request with one more query; each row shows its calendar health chip under the name for viewers with See over that member (AC-1308). *Built (5d931de3f, d89c38449).*
- **AC-1302**: New meeting, for the caller or a colleague they Manage, reads `limits.at` for the chosen time and host and, at or past a day or week limit, shows an announced warning Callout ("Sam is at their limit of 4 meetings that day.") before Book it; booking in still goes through, since a person booking by hand may mean it. It answers nothing for a member without limits, a time gone by, or past a year. *Built (e2cf07d01).*

## Design

### Data model

**Time off lives on `booking_time_blocks`** (spec 0027), the table every slot read already loads, so the engine needs no new query:
- `kind` gains `away`. The engine already reads any kind but `hold` as a block (`booking/blocks.ts`), so time off closes every page, private ones included, even before the display code learns the new kind.
- New columns: `reason` (text, nullable), `note` (text, nullable), `standin_member_id` (uuid, nullable, foreign key carrying `workspace_id` to `members`).
- Checks: an `away` row has `repeat = 'once'`, `during` set, `time_zone` set (the zone its dates were chosen in; the existing shape check allows `time_zone` on `once` rows only for `away`), `reason in ('vacation', 'sick', 'travel', 'holiday', 'other')`; other kinds have `reason`, `note` and `standin_member_id` null; `char_length(note) <= 200`; `standin_member_id <> member_id`; `upper(during) - lower(during) <= interval '367 days'`.
- `during` is [the from date's midnight, the day after the to date's midnight) in `time_zone`.
- The 50 upcoming entries limit is counted in core under the member's advisory lock.

**`member_booking_limits`** (tenant table; forced row level security; audit columns)
- `workspace_id`, `member_id` (primary key with the workspace; foreign key to `members`), `per_day` (smallint, nullable, 1 to 50), `per_week` (smallint, nullable, 1 to 200). A row with both null is deleted rather than kept.

The Team week has no table of its own: it reads and writes spec 0035's `availability_schedules` (each member's default) and the `away` blocks.

### Services and procedures

| Service → procedure | Key inputs | Key outputs | Access | Key errors |
|---|---|---|---|---|
| `listTimeOff` → `timeOff.list` | `memberId?`, `from?` | entries (reason and note only with Manage or self) | self; See | 404 |
| `createTimeOff` → `timeOff.create` | `memberId?`, `fromDate`, `toDate`, `reason`, `note?`, `standinMemberId?`, `mutationId` | entry, `bookingsInside[]` | self with `booking.manage`; Manage | 403, 404, 409 `TIME_OFF_LIMIT`, 422 `VALUE_INVALID` |
| `updateTimeOff` → `timeOff.update` | `id`, fields, `updatedAt` | entry, `bookingsInside[]` | as create | 404, 409 `STALE` |
| `deleteTimeOff` → `timeOff.delete` | `id` | none | as create | 404 |
| `readTeamWeek` → `availability.teamWeek` | `weekStart`, `teamId?`, `search?`, `cursor?` | rows: member, time zone, days (ranges, source: usual, override or away), week hours, other schedules count; footer totals | any member (rows from See reach) | 422 `VALUE_INVALID` (not a Monday) |
| `setDayHours` → `availability.setDay` | `memberId`, `date`, `hours: ranges[] \| 'off' \| 'usual'`, `updatedAt` | the row's day | Manage (or self with `availability.own`) | 403, 404, 409 `STALE` |
| `copyWeek` → `availability.copyWeek` | `memberIds[]` (1 to 50), `fromWeekStart`, `toWeekStart` | `{ changed }` | Manage over each | 403, 404 |
| `setUsualHours` → `availability.setUsualHours` | `memberIds[]` (1 to 50), `weekly` | `{ changed }` | Manage over each | 403, 404 |
| `getLimits`, `setLimits` → `limits.get`, `limits.set` | `memberId?`, `perDay?`, `perWeek?` | limits and this week's counts | self (`availability.own` to set); See to read, Manage to set | 403, 404, 422 |
| `limits.at` (built, AC-1302) | `memberId?`, `at` | the day's and week's count against each limit, or nothing | self, or Manage with `booking.manage` | 404 |

Every write goes through spec 0035's one schedule write path or the blocks service, so the audit row and the notice ([scheduling access](0037-scheduling-access.md)) come from one place. Audit actions: `time_off.created`, `time_off.changed`, `time_off.deleted`, `limits.changed`, and spec 0035's `schedule.changed` for the Team week's writes.

### The engine

- Time off: no change (it's a block). The owner and last host rules (AC-1284) work out, from the read before any lock, the owner, the last host and their stand ins for the chosen time; those people join the busy read and the lock set of AC-1321, so every host lock is still taken in one id ordered pass. If the recheck under the locks finds a stand in that wasn't in the set (time off changed in between), the booking restarts once from the read; a second miss answers `SLOT_TAKEN` with fresh slots.
- Limits: the slots read loads, per member, the count of confirmed bookings they host per local day and per local week over the requested range widened to whole weeks (one grouped query over `booking_hosts`, or `bookings_by_host` before spec 0029); days at the day limit and weeks at the week limit offer nothing for that member. The booking recheck counts again under the host lock.
- Rotations (spec 0029): a member away or at a limit is skipped like a member at their daily cap.

### Screens

- **Bookings › Availability**: spec 0035's schedule list, then the Time off section (a list of rows with the Add time off Modal) and the Limits section (two optional number Fields with a Switch each). Built.
- **Bookings › Roster** (its own tab from the roster editor lane; built as Availability's Team view): the Team week grid (built as the `TeamWeek` module on Table, with HoursEditor's single day variant for a cell), the week stepper ("This week", previous, next), the team filter and search; cell Popover with the range rows from the HoursEditor, Off and Usual hours; the row menu; "Set usual hours for…" Modal with a member multi select and the weekly HoursEditor.
- References: Cal.com's Team Availability and its "Go Out of Office" dialog (dates, reason, notes, a team member to send people to), Front's "Create time off" for a teammate, Fresha's "Add time off" with type, Square's team availability grid, timefix's roster (`docs/roster.md`).

### Value sourcing

| Action | Value | Source |
|---|---|---|
| Time off dates' zone | zone | the member's default schedule's time zone at save (spec 0035 `defaultSchedule`), stored in `time_zone` |
| Away at a time | yes or no | `away` blocks whose `during` covers it |
| Stand in at booking | member | `standin_member_id` of the owner's (or last host's) covering `away` block, free under their host lock |
| Cell hours | ranges | the default schedule's override for that date, else its weekly hours for that weekday |
| "This week only" dot | yes | an override exists for that date |
| Row offset | "UTC+5:30" | the default schedule's zone's offset on that week's Monday, shown when it differs from the viewer's |
| Week hours | duration | the union of that week's ranges (merged, not summed) |
| Footer | people and hours | the rows drawn on that page, per day |
| Week start | Monday | fixed in this plan (decision 31) |
| Limit counts | numbers | confirmed bookings hosted, grouped by local day and week |

### Key invariants

- Time off only ever closes time; it never moves or cancels a booking.
- The Team week writes only through spec 0035's write path; it has no data of its own.
- A limit is never passed: the recheck under the host lock is the last guard.

### Numbers

| Value | Number | Runner up |
|---|---|---|
| Longest time off | 366 days | 90 days |
| Upcoming entries per member | 50 | 100 |
| Note length | 200 characters | 500 |
| Team week rows per page | 50 | 100 |
| Team week forward reach | 52 weeks | 8 weeks (timefix's booking horizon) |
| Team week back reach, and overrides kept | 8 weeks | 13 weeks |
| Date overrides per schedule | 400 | 240 |
| Ranges per day in a cell | 6 (spec 0025's `BOOKING_RANGES_MAX`) | 4 (timefix's `MAX_WINDOWS_PER_DAY`) |
| Limits | 1 to 50 a day, 1 to 200 a week | per day only |

### Critical test scenarios

- A member adds Vacation 3 to 7 November with a stand in: their personal page and a round robin page offer nothing with them those days; a known customer booking the round robin page on 4 November goes to the stand in with reason `standin`; the stand in got an email (AC-1281 to AC-1284).
- A manager adds Sick leave for a doctor over two booked meetings: the dialog lists both; both show Host away; the doctor gets one notice (AC-1282, AC-1285).
- The Team week: a manager sets Sam's Tuesday to 10 to 2 (an override), copies the week to next week, and sets usual hours for three people; every write is audited once and each person gets one email; a viewer with See only can't open a cell (AC-1289 to AC-1292).
- A member with a limit of 2 a day and three pages: after two bookings that day no page offers them; a third booking racing in is refused `SLOT_TAKEN` (AC-1297, AC-1298).
- DST week: a member in London on the week clocks change keeps 9 to 5 local each day and the offset updates (AC-1290).
