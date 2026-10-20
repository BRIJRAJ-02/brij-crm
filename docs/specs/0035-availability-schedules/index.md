# 0035. Availability schedules: several per person, one per booking page

**Date**: 2026-10-20
**Status**: Proposed
**Numbering**: handed out by the coordinator on 20 October 2026 (roadmap, Release 1). This spec owns AC-961 to AC-990.

## Summary

A member can keep several sets of hours, called schedules (for example "Working hours" and "Evenings"), each with its weekly hours, its date overrides and its own time zone. One is their default, and each booking page picks a schedule or simply follows the default. Today each member has one set of hours and each page either follows it or keeps its own; the migration turns the member's hours into "Working hours" (their default) and each page's own hours into a schedule of the page's owner, so every page offers exactly the same times the day after as the day before. Round robin (spec 0029) and the team calendar (spec 0030) read members' schedules from here.

Reasoning and options: see [rationale.md](rationale.md).

## Dependencies

| Feature | What this spec needs | When it is missing |
|---|---|---|
| Spec 0025 booking pages | `booking_pages`, `booking_member_hours`, the slot engine (`engineHours`, `loadPage`), the page editor | hard prerequisite |
| The Availability redesign (lane `wip/avail`) | the editor it is building: fixed width time Selects, 12 hour times, the SaveBar, DaysOff | this spec wraps that editor; if it hasn't landed, wrap today's |
| Spec 0034 sidebar | Availability at `/w/$slug/availability` in the Scheduling group | the screen lives at `/bookings/availability` until 0034 lands |
| Spec 0029 round robin | reads `scheduleFor` per member; `rotation_members.schedule_id`; "one schedule for everyone" on a team page | 0029 milestone 1 reads `booking_member_hours`; the switch is a column swap |
| Spec 0030 team calendar | each member's default schedule for the open hours band and the column's time zone | reads `booking_member_hours` until this lands |

The public booking page (`/b/:key`) is frozen by the owner: nothing here changes how it looks or behaves; it only gets its hours from a schedule.

## Requirements

**User stories**:
- As a member, I want different hours for different kinds of meetings (sales calls in the day, partner calls in the evening), without copying hours into every page.
- As a member, I want to change my working hours once and have every page that follows them change too.
- As a member travelling, I want a schedule in another time zone for a few weeks.
- As an admin setting up a team page, I want to see and, if needed, fix a colleague's hours.

**Acceptance criteria** (AC-961 to AC-978 used; the rest of the range is spare):

*Schedules*
- **AC-961**: A member has up to 20 schedules. Each has a name (1 to 60 characters, unique among the member's schedules ignoring case), a time zone (IANA), weekly hours (ranges per weekday, 15 minute steps, no overlaps) and date overrides (a date with its own ranges, or none for a day off), all read in the schedule's time zone.
- **AC-962**: Exactly one schedule per member is their default, marked "Default". "Set as default" moves the mark at once. The default can't be deleted.
- **AC-963**: A member who has never saved hours sees one default, "Working hours", Monday to Friday 9:00 to 17:00 in their browser's time zone; it is stored the first time they change anything, and until then the slot engine uses the same hours (today's fallback).
- **AC-964**: New schedule asks for a name only, creates it with the default's weekly hours and time zone, and opens it. Duplicate makes "<name> copy" with the same hours and overrides.

*Pages*
- **AC-965**: Each booking page has an Hours choice: "Default schedule (<name>)" or one of the owner's schedules by name. Default follows whichever schedule is the owner's default at the time of each slot read, so moving the default moves those pages. The editor shows the chosen schedule's summary and an "Edit hours" link to it.
- **AC-966**: A personal or collective page can use only a schedule of its owner; a round robin page uses each member's default or the schedule their rotation pins (spec 0029, AC-732), or one schedule of the page owner for everyone. The server refuses any other with `SCHEDULE_NOT_ALLOWED`.
- **AC-967**: Deleting a schedule that pages or rotations use asks first, naming them ("Used by Intro call and Demo. They will use Working hours."), then points them at the default. Deleting one nobody uses asks once.
- **AC-968**: A change to a schedule applies to the next slot read of every page using it; bookings already made never move or cancel because of it.

*Screens*
- **AC-969**: Scheduling › Availability lists the member's schedules: name, "Default" badge, a one line summary of the weekly hours in 12 or 24 hour time by locale ("Mon to Fri, 9:00am to 5:00pm"), the time zone, and "Used by N booking pages" (a link listing them). New schedule sits in the header. The default comes first, then by name.
- **AC-970**: Opening a schedule shows its editor: the name (rename in place, Enter saves, Esc cancels), the time zone Select, the weekly hours and the date overrides from the Availability redesign, and its SaveBar. Leaving with unsaved changes asks first. A menu holds Set as default, Duplicate and Delete.
- **AC-971**: A member with `booking.admin` can switch the screen to another member ("Viewing: Bea's schedules") and edit or create theirs; everyone else sees and edits only their own. A member viewing a team page's settings can read the names and summaries of the schedules it uses.
- **AC-972**: Both screens work fully by keyboard, every control is labelled, errors are said on their row, and contrast meets WCAG AA.

*Migration*
- **AC-973**: The migration creates, for each `booking_member_hours` row, a default schedule "Working hours" with those hours and time zone; for each live page with `hours_mode = 'own'`, a schedule "<page title> hours" owned by the page owner (a name clash gets " 2", " 3") with the page's hours, and points the page at it; pages with `hours_mode = 'mine'` (and `members`, if spec 0029 added it) get no schedule, so they follow the default.
- **AC-974**: For every live page, the slots offered for the next 60 days are the same before and after the migration (a test over the seed and a dry run against a branch of production before it runs).
- **AC-975**: The old columns stay readable for one release (expand, then contract): the contract migration drops `booking_pages.hours_mode`, `booking_pages.availability` and `booking_member_hours` only after a release in which nothing reads them.

*Services for other specs*
- **AC-976**: Core exposes `defaultSchedule(tx, memberId)` and `scheduleFor(tx, { memberId, scheduleId? })`, each answering the schedule's hours in the engine's shape (`engineHours`) with its time zone, the virtual default of AC-963 when nothing is stored; spec 0029's `memberSlots` and spec 0030's `readTeamDay` call them.
- **AC-977**: Changes are live: a schedule saved in one tab shows in the member's other tabs and in the page editor of anyone viewing a page that uses it within 1 second (a `schedules` outbox kind, ids only).
- **AC-978**: `availability_schedules` forces row level security and has its policy; a cross workspace read returns nothing; removing a member keeps their schedules while pages still name them and deletes them with the member's purge.

## Decision

Make schedules their own tenant table owned by a member, with the hours in today's `BookingAvailability` shape so the slot engine is unchanged, a partial unique index for the one default, and `booking_pages.schedule_id` (null means "the owner's default") replacing `hours_mode`. Migrate in place with an expand and contract pair, proving slots are identical. The Availability screen becomes a list with a detail editor that wraps the redesigned hours editor. See [rationale.md](rationale.md).

## Feature design

### Data model

**`availability_schedules`** (tenant table: `workspace_id` first, forced RLS, audit columns)
- `workspace_id`, `id`, `member_id` (foreign key to `members`), `name` (text, 1 to 60), `is_default` (boolean), `availability` (jsonb, the `BookingAvailability` shape: `{ timeZone, weekly: { mon: [[start, end]], … }, overrides: [{ date, ranges }] }`, times `HH:MM`). Schedules are hard deleted, so there is no `deleted_at`.
- Primary key (`workspace_id`, `id`). Unique (`workspace_id`, `member_id`, `lower(name)`). Partial unique (`workspace_id`, `member_id`) where `is_default`. Index (`workspace_id`, `member_id`). Check: `char_length(name) between 1 and 60`. The 20 per member limit is enforced in core under the member's advisory lock.

**`booking_pages`** gains `schedule_id` (uuid, nullable; foreign key (`workspace_id`, `schedule_id`) to `availability_schedules`, `on delete set null`). Null means the owner's default (personal and collective) or each member's default (round robin, spec 0029). Contract migration drops `hours_mode` and `availability`.

**`rotation_members.schedule_id`** (spec 0029) gets the same foreign key with `on delete set null`.

### State

A schedule is `stored` or (for a member with none) `virtual`: the virtual default is computed, never written, until the member saves (AC-963). Default moves by one transaction that clears the old mark and sets the new one.

### Services (`packages/core/src/availability/`, new)

- `listSchedules(scope, { memberId })`: the member's schedules with summaries and usage counts (pages and rotations naming each one, plus pages following the default for the default). Members may list their own; `booking.admin` anyone's; everyone may read the schedules named by a page they can see (AC-971).
- `createSchedule`, `updateSchedule` (name, time zone, weekly, overrides; with the stale check `updatedAt` the SaveBar sends), `setDefault`, `duplicateSchedule`, `deleteSchedule` (refuses the default; repoints users to null in the same transaction).
- `defaultSchedule` and `scheduleFor` (AC-976). `loadPage` in `booking/slots.ts` resolves the page's hours through them instead of `hours_mode`.
- Validation in contracts reuses `BookingAvailability` and adds `ScheduleName`; overlaps and order are the existing HoursEditor checks, run again on the server.
- Every write emits a `schedules` outbox row with the schedule id and member id; pages using it need no event, since the editor reads the schedule through the store.

### API surface

| Procedure | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|
| `schedules.list` | `memberId?` | schedules with summary, usage | own, or `booking.admin` | 403 |
| `schedules.get` | `id` | schedule | own, `booking.admin`, or a page using it is visible | `NOT_FOUND` |
| `schedules.create` | `memberId?`, `name` | schedule | own, or `booking.admin` | `VALUE_INVALID`, `SCHEDULE_LIMIT`, `NAME_TAKEN` |
| `schedules.update` | `id`, `name?`, `availability?`, `updatedAt` | schedule | own, or `booking.admin` | `VALUE_INVALID`, `NAME_TAKEN`, `STALE` |
| `schedules.setDefault` | `id` | schedule | own, or `booking.admin` | `NOT_FOUND` |
| `schedules.duplicate` | `id` | schedule | own, or `booking.admin` | `SCHEDULE_LIMIT` |
| `schedules.delete` | `id` | `{ repointed: { pages, rotations } }` | own, or `booking.admin` | `DEFAULT_SCHEDULE` (can't delete the default) |
| `booking.pages.update` (existing) | `scheduleId: uuid \| null` replaces `hoursMode` and `availability` | page | as today | `SCHEDULE_NOT_ALLOWED` |

Errors are `{ code, message }` with plain messages ("Another schedule is called Evenings.", "Set another schedule as default first.").

### Screens

- **Availability** (`/w/$slug/availability`; `/bookings/availability` until spec 0034): a TopBar "Availability" with New schedule; a list of schedule rows (Card rows: name, Default Badge, summary, zone, usage link, a `…` menu). New schedule opens a Modal with one Field (Name) and Create.
- **Schedule** (`/w/$slug/availability/$scheduleId`): the header with the name (rename in place) and the menu; "Used by" line; then the redesigned editor unchanged: time zone Select, HoursEditor (weekly), DaysOff (date overrides), SaveBar. Built from the library only; no new component.
- **Page editor**: the hours card swaps the own or mine SegmentedControl for a Select of the owner's schedules ("Default schedule (Working hours)" first), the chosen schedule's summary, and "Edit hours" (opens the schedule in a new route, returning to the page). The page's inline hours editor goes away.
- **Admin view**: a member Select in the Availability header for `booking.admin` (AC-971).

### Value sourcing

| Action | Value | Source |
|---|---|---|
| Virtual default | hours and zone | Monday to Friday 09:00 to 17:00; zone from the browser (sent with the read), else the page's zone in the engine (today's fallback) |
| Migrated "Working hours" | hours and zone | `booking_member_hours.availability` |
| Migrated page schedule | name, hours, zone, owner | `booking_pages.title` + " hours"; `booking_pages.availability`; `booking_pages.owner_member_id` |
| Summary line | text | derived from `weekly`, by locale's 12 or 24 hour clock |
| Used by count | number | pages with `schedule_id` = id, plus pages with null for the default, plus rotation members naming it |
| Page's hours at slot time | schedule | `schedule_id`, else the owner's `is_default` schedule, else the virtual default |

### Key invariants

- At most one default per member (partial unique index); a member with stored schedules always has exactly one default (the service sets one on first create and refuses to delete it).
- A page's schedule belongs to its owner (AC-966), checked in core on write; a schedule's owner never changes.
- The slot engine sees the same `engineHours` input before and after the migration (AC-974).

### Security model

Hours aren't secret inside a workspace (spec 0030 shows colleagues' hours bands), so reads are open to members through the page they can see; writes are the owner's or `booking.admin`'s. Guests read nothing here. No schedule data is on the public page beyond the slots it already offers.

### Critical test scenarios

- Migration: seed members with hours, pages with own and mine hours, a clashing page title; run it; every page's 60 day slots match; verifies **AC-973**, **AC-974**.
- Default moves: two pages follow the default; set Evenings as default; both offer evening slots on the next read; verifies **AC-962**, **AC-965**.
- Delete in use: delete a schedule used by a page and a rotation member; both now use the default; verifies **AC-967**.
- Permission: a member updating a colleague's schedule gets 403; `booking.admin` succeeds; a page pointing at a colleague's schedule is refused `SCHEDULE_NOT_ALLOWED`; verifies **AC-966**, **AC-971**.
- Bookings stay: change hours under an existing booking; it stays confirmed; verifies **AC-968**.
- Guards: forced RLS, cross workspace read empty; verifies **AC-978**.

## Build plan

**Milestone 1: schedules behind today's screens** (one thread through every layer)
1. Migration (expand): `availability_schedules`, `booking_pages.schedule_id`, the data move of AC-973, guard tests, the slot equality test, satisfies **AC-961**, **AC-973**, **AC-974**, **AC-978**.
2. Core: the schedule services, `defaultSchedule`, `scheduleFor`, `loadPage` reading through them, the `schedules` kind, satisfies **AC-962**, **AC-963**, **AC-965**, **AC-966**, **AC-968**, **AC-976**.
3. API: the `schedules.*` procedures; `booking.pages.update` takes `scheduleId`, satisfies **AC-964**, **AC-965**, **AC-967**.
4. Screens: today's Availability screen edits the default schedule; the page editor's Select of schedules, satisfies **AC-965**, **AC-977**.

**Milestone 2: the list and the editor**
5. The Availability list, New schedule, the schedule route wrapping the redesigned editor, Set as default, Duplicate, Delete with its repoint confirm; stories where a module changes; `design-system-guardian`, `ux-interaction-reviewer`, satisfies **AC-964**, **AC-967**, **AC-969**, **AC-970**, **AC-972**.

**Milestone 3: admins and the contract**
6. The admin member Select; reads through visible pages; `security-access-reviewer`, satisfies **AC-971**.
7. One release after milestone 1: the contract migration dropping `hours_mode`, `booking_pages.availability` and `booking_member_hours`, satisfies **AC-975**.

## Consequences

**Positive**:
- Round robin and the team calendar get one source of hours per member, with no special case for "the page's own hours".
- Changing working hours once updates every page that follows them.

**Negative / tradeoffs**:
- Pages that kept their own hours now show a schedule in their owner's list named after the page, which adds rows the owner didn't create. They can rename, merge (point the page at another) or delete them.
- A page's hours are no longer edited on the page; it takes one more click ("Edit hours").
- Two migrations and a release of double columns.

**Neutral**:
- The public booking page is untouched.
- Schedules have no team owner; a team wide schedule waits for a customer asking.

## Follow-up

- [ ] Out of office ranges across schedules (one entry blocks every schedule), with the team calendar showing them.
- [ ] Schedules owned by a team (#23) for team pages.
- [ ] A calendar view of a schedule (Calendly's List and Calendar toggle).
- [ ] Copy a day's hours to other days in one action, if the redesigned editor doesn't already.

## Rationale

See [rationale.md](rationale.md).
