# 0029. Round robin booking pages: one team page, one fair host per booking

**Date**: 2026-10-20
**Status**: Proposed
**Feature**: #58 Round robin assignment (booking side, and the `assignOwner` contract forms need), finishing #59's team pages (spec 0025, AC-628)

## Summary

An admin puts a few members into a **rotation** (a pool) and points a team booking page at it. The visitor sees every time at least one member is free, books, and the booking goes to the fairest free member: the one with the fewest bookings in the last 30 days for their weight. That member gets the calendar event, the emails, and ownership of any new person or deal. The same rotation hands out owners for form submissions through `assignOwner`, so leads and meetings share one fair count. The public page stays as it is, with the team's avatars in the rail.

Reasoning and options: see [rationale.md](rationale.md).

## Owner decisions needed

The owner accepted every recommendation below on 20 October 2026; each is now a decision.


Each has my recommendation; answer only where you disagree.

1. **Is the pool its own thing (a rotation) shared by booking pages and forms, or a list on each page?** Recommend: its own thing, shared. Runner up: per page (simpler, but forms need a second pool and fairness splits per page).
2. **How is the host picked by default?** Recommend: **Fair** (fewest bookings in the window for their weight, among those free at the chosen time), with **Priority** (highest priority free member first) as the second option. Runner up: strict turn (only the next member's times shown), deferred.
3. **Fairness window?** Recommend: rolling 30 days, counted by when the booking was made. Runner up: calendar month.
4. **Who can be in a pool?** Recommend: any active member with a schedule (spec 0035) or a calendar connected, added by an admin; a member without a calendar is allowed with a warning. Runner up: calendar required.
5. **Reschedule: same host or back through the rotation?** Recommend: same host when free, otherwise the rotation, as a per page choice. Runner up: always the rotation.
6. **Known people go to their owner?** Recommend: yes, on by default, when the owner is in the pool and free at that time. Runner up: rotation only.
7. **When a member leaves the workspace, their future round robin bookings?** Recommend: reassigned automatically through the rotation, guest told the new host; any that can't be placed are flagged for an admin. Runner up: flag all for an admin to reassign by hand.
8. **What does the guest see before booking?** Recommend: up to 4 team avatars plus "+N" in the existing rail, the page title, no names; the host's name on the confirmation. Runner up: names listed.
9. **Limits?** Recommend: 2 to 20 members per rotation, weights 1 to 100 (default 100), five priority levels, optional daily cap per member. Runner up: 50 members.
10. **Build the forms `assignOwner` in this spec?** Recommend: yes, as milestone 3 (spec 0023 depends on it). Rules first routing (region, company size), imports and the rebalance screen wait for a later #58 spec.

## Dependencies

| Feature | What this spec needs | When it is missing |
|---|---|---|
| Spec 0025 booking pages | pages, `pickHost` seam, the booking flow under host locks, emails, manage links | hard prerequisite (built) |
| Spec 0024 calendar sync, and its M5 "calendars" | `freeBusy` over every conflict checked calendar of each member, `createEvent` on the member's destination calendar, `moveEvent`, `cancelEvent` | before M5, busy reads the primary calendar and events go there; a member without a calendar books from hours and bookings only (AC-631) |
| Spec 0035 availability schedules | each member's schedules (several per person, migrated "Working hours" as default), and `booking_pages.schedule_id` replacing `hours_mode` | milestone 1 reads `booking_member_hours` as each member's one schedule; the switch is a column swap |
| Spec 0023 forms (its routing revision) | routing a submission to a page, a member or a rotation; for a rotation it calls `assignOwner` on this spec's ledger | milestone 3 only |
| Spec 0009 access | `booking.admin`, the access door | hard prerequisite (built) |
| #23 teams | "create a rotation from a team" | rotations are member lists until then |

## Requirements

**User stories**:
- As an admin, I want one booking link for my sales team that spreads meetings fairly, so nobody is flooded and nobody is idle.
- As a visitor, I want to see every time someone on the team can meet me, and to know who I'm meeting once I book.
- As a member in a pool, I want my bookings to arrive on my calendar with the guest filed as my person, and to see why a meeting came to me.
- As an admin, I want to reassign a booking or cover for someone who left, without the guest falling through the cracks.
- As a forms builder, I want a submission's new record to get an owner from the same rotation.

**Acceptance criteria** (this spec owns AC-728 to AC-759):

*Rotations*
- **AC-728**: A member with `booking.admin` creates a rotation in Settings › Booking pages › Rotations: a name, 2 to 20 members, each with a weight (1 to 100, default 100), a priority (lowest, low, medium, high, highest; default medium), an optional daily cap, and an on or off switch. The strategy is **Fair** (default) or **Priority**; the window is 7, 30 (default) or 90 days.
- **AC-729**: Only active workspace members can be added. A member with neither a connected calendar nor their own hours can't be added ("Set hours or connect a calendar first"); one without a calendar is added with a warning badge.
- **AC-730**: A member added to a rotation starts at the pool's current average weighted count (calibration), so they are not flooded with every booking until they catch up.
- **AC-731**: A member switched off, at their daily cap, or on a day off is skipped by the rotation until they are back; their existing bookings stay theirs.

*Team page*
- **AC-732**: The page builder's `round_robin` kind (no longer "Coming soon") picks a rotation or creates one inline, and offers "Hours: each member's default schedule (default) | one schedule for everyone" (spec 0035; a rotation member may also pin which of their schedules this rotation uses), "Reschedule: same host when free (default) | through the rotation", and "Send known people to their owner" (on by default).
- **AC-733**: The public page (`/b/:key`, frozen) adds only the team avatar stack in the existing rail: up to 4 avatars of switched on members plus "+N", from each member's profile image or initials, with no names and no emails. Every other part of the page is unchanged.

*Slots*
- **AC-734**: Round robin slots are the **union** of each eligible member's slots, each computed by the existing engine with that member's schedule (spec 0035), their busy times across every conflict checked calendar (spec 0024 M5), their bookings across every page (`booking_hosts`) and their blocks. A slot is offered when at least one member is free for it.
- **AC-735**: Collective slots become the **intersection** of each required member's slots computed the same way, so each member's own hours and their bookings on other pages count. Today a collective page ignores a second member's bookings elsewhere and can double book them; this is fixed in milestone 1.
- **AC-736**: A member whose calendar refuses us (`blocked`) is dropped from the union for that read instead of closing the page; the page closes only when every member is blocked. Collective still closes when any required member is blocked.
- **AC-737**: The slots answer for a 20 member page stays inside spec 0025's 1.5 second p75, using the 60 second busy cache and one parallel read per member.

*Assignment*
- **AC-738**: At booking, under the rotation lock and then the candidate host's lock, the server rechecks the chosen slot for the picked member. Fair picks the lowest (active assignments in the window plus calibration) divided by weight; ties go to higher priority, then the longest since their last assignment, then member id. Priority picks the highest priority, then the same order.
- **AC-739**: With "Send known people to their owner" on, a visitor whose email matches a person owned by a pool member who is free at that slot goes to that owner, with reason `owner`, whatever the counts.
- **AC-740**: If the picked member's slot is gone on recheck, the next candidate is tried (up to every free member); only when none is free does the visitor get "That time was just taken" with fresh slots.
- **AC-741**: Two visitors booking the same page at the same moment are serialised by the rotation lock: each sees the other's assignment, no member passes their daily cap, and one slot never gives two bookings to one member.
- **AC-742**: Every assignment writes one ledger row with its reason: `fair`, `priority`, `owner`, `only_free` (one member was free), `manual` or `reassigned`, plus the counts and weights it compared. The booking's detail shows it in plain words ("Assigned to Sam: fewest bookings this month (4, weight 100)").

*After booking*
- **AC-743**: The event is created on the assigned host's destination calendar (spec 0024 M5; the page's override when it names a calendar of that host, else the host's default) with the host as organiser, the confirmation page and email name the host, and the host notice email goes to the assigned host only.
- **AC-744**: A person, company or deal created by the booking gets the assigned host as owner (when the object has an owner attribute); an existing record's owner never changes.
- **AC-745**: A booking occupies its host's time through a `booking_hosts` row (one per member it occupies, with its own exclusion constraint), so it blocks the member on every page they are on. Collective bookings write one row per required member.

*Changing a booking*
- **AC-746**: Reschedule by the guest keeps the host when the "same host" setting is on and the host is free at the new time; slots shown are that host's slots. Otherwise the new time goes through the rotation, and a new host means the old event is cancelled, a new one created, and both hosts and the guest told.
- **AC-747**: A cancelled booking voids its ledger row, so it stops counting toward fairness.
- **AC-748**: An admin can reassign an upcoming booking from the booking's detail or the team calendar: "Next in rotation" or a named member who is free at that time. The event moves to the new host's calendar, the guest gets "Your meeting is now with {name}", and the ledger records `manual` with who did it.
- **AC-749**: When a member is removed from the workspace, each of their upcoming round robin bookings is reassigned through its rotation; any with no free member is flagged "Needs a host" on Bookings and the admins are emailed. Personal page bookings are flagged, never moved.
- **AC-750**: Removing a member from a rotation (or switching them off) keeps their existing bookings; an admin is offered "Reassign their N upcoming bookings" as a separate action.

*Visibility and access*
- **AC-751**: Creating, editing and deleting rotations and round robin pages needs `booking.admin`, checked at the access door; members without it get 403 and see no Rotations section.
- **AC-752**: A pool member sees the rotation's name, members and their own share (count in the window) on Settings › Booking pages; only `booking.admin` sees everyone's counts and reasons.
- **AC-753**: A round robin booking is visible to its assigned host and to `booking.admin`, through the same `visibleTo` rule bookings use today (spec 0030 widens this for the team calendar).
- **AC-754**: Public answers never include member names before booking, member emails, counts, weights, or which member was busy (spec 0025, AC-644, still holds).

*Forms*
- **AC-755**: `assignOwner(rotationId, { objectId, recordId })` runs inside the caller's transaction, takes the rotation lock, applies owner first (when the record already has an owner in the pool), then the strategy, skipping members switched off, at cap or on a day off today in their own zone, writes the ledger row with `source = form`, sets the record's owner attribute, and returns `{ memberId, reason }`.
- **AC-756**: When no member is eligible, `assignOwner` returns `{ memberId: undefined, reason: 'none_available' }` and the record keeps no owner; the form's processing continues.

*Managing and quality*
- **AC-757**: The rotation screen lists members with their share this window as a small bar, weight, priority and cap, editable in place; changes apply to the next assignment.
- **AC-758**: A rotation used by a page or a form can't be deleted ("Used by 2 pages and 1 form"); an unused one can.
- **AC-759**: Every new screen is keyboard usable and meets WCAG AA in both themes; the avatar stack has an accessible label ("Team of 6").

## Decision

Add a rotation (pool) entity with an append only assignment ledger, counted on read under a per rotation advisory lock. Round robin slots are the union of per member engine runs; collective becomes the intersection. Booking takes the rotation lock, then the host lock, and rechecks. `pickHost` gives way to `assignHost`, and forms get `assignOwner` on the same ledger. See [rationale.md](rationale.md).

## Feature design

### Data model

Tenant tables with forced row level security, the standard policy, created and updated columns.

**`rotations`**: `id`, `name`, `strategy` (`fair` | `priority`), `window_days` (7 | 30 | 90), `owner_first` (bool, default true), `deleted_at`.

**`rotation_members`**: (`rotation_id`, `member_id`) primary key, `weight` (smallint 1 to 100, default 100), `priority` (smallint 0 to 4, default 2), `daily_cap` (smallint, nullable), `is_on` (bool), `schedule_id` (nullable, spec 0035: which of the member's schedules this rotation books on; their default when null), `calibration` (numeric, the count credited on join), `position`. Check: 2 to 20 members per rotation (enforced in core).

**`rotation_assignments`** (the ledger, append only apart from `voided_at`): `id`, `rotation_id`, `member_id`, `source` (`booking` | `form`), `booking_id` (nullable), `record_id` (nullable), `reason` (`fair` | `priority` | `owner` | `only_free` | `manual` | `reassigned`), `detail` (jsonb: the compared counts and weights, the actor for manual), `assigned_at`, `voided_at` (nullable).
- Index: (`workspace_id`, `rotation_id`, `assigned_at`) where `voided_at is null`, for the window count.
- Unique: (`booking_id`) where `voided_at is null`; (`record_id`, `rotation_id`) where `voided_at is null`, so one lead never has two live assignments.

**`booking_hosts`**: (`booking_id`, `member_id`) primary key, `during` (tstzrange, copied from the booking), `status` mirror. Exclusion constraint: `exclude using gist (workspace_id with =, member_id with =, during with &&) where (status = 'confirmed')`. The existing `bookings_no_overlap` stays as is.

**`booking_pages`** gains: `rotation_id` (nullable, required when `kind = round_robin`), `reschedule_host` (`same` | `rotation`, default `same`). Until spec 0035, `hours_mode` gains `members` (each member's own hours, the default for team pages); spec 0035 replaces it with `schedule_id`, where null on a team page means each member's own schedule.

**`bookings`** gains `needs_host_at` (nullable timestamp, AC-749).

### Slots (core)

- `memberSlots(page, member, reads)`: the existing `pageSlots` with that member's schedule (spec 0035; `booking_member_hours` before it), their busy, their bookings from `booking_hosts` and their blocks. Pure apart from its reads.
- `unionSlots(perMember)` and `intersectSlots(perMember)`: pure, keyed by slot start, each slot carrying the free member ids (union) so booking knows the candidates. Unit tested on their own, including DST days and members in different zones.
- `readPublicSlots` picks union or intersection by kind; members blocked by their calendar are left out of the union (AC-736).

### Assignment (core, `packages/core/src/rotation/`)

- `pickMember(candidates, counts, rotation, { ownerId })`: pure. Owner first, then the strategy's sort (AC-738). Returns `{ memberId, reason, detail }`.
- `windowCounts(tx, rotationId, since)`: one grouped count over the ledger plus each member's calibration.
- `assignHost(tx, page, slot, visitorEmail)`: lock `rotation:<workspace>:<id>`, read counts, order candidates, then for each: lock the host, recheck with `memberSlots`, insert the booking, `booking_hosts` and ledger rows; first success wins (AC-740).
- The ledger has one entry point, `assignFrom(tx, rotationId, { source, candidates, ownerId, subject })`, which takes the lock, counts, picks and writes the row. `assignHost` passes the free members at a slot; `assignOwner` passes everyone eligible today. Forms routing (spec 0023 revision) calls `assignOwner` for a rotation target, so leads and meetings share one count.
- `assignOwner(tx, rotationId, { objectId, recordId })`: lock, eligibility for "today" in each member's zone, pick, write the ledger and the owner value through the records service (as the `form` actor), return `{ memberId, reason }`.
- `reassign(tx, bookingId, { to: 'next' | memberId, actor })`: void the old ledger row, assign, then `cancelEvent` and `createEvent` after commit, queue the guest and host emails.

Lock order is always rotation, then hosts in id order. Blocks and personal bookings take host locks only, so no writer waits in the opposite order.

### Public surface

No new endpoints. `GET /api/public/booking/:publicKey` adds `team: { avatars: [{ image?, initials }], more: number }` for team pages; booking and confirmation answers add `hostName` (already present). The rail renders the avatar stack with the library's `AvatarGroup` (or a new variant reviewed by `design-system-guardian`).

### API (members)

| Procedure | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|
| `rotations.list` | none | rotations with members and window counts (own count only without admin) | `booking.manage` | 403 |
| `rotations.create` / `.update` | name, strategy, window, members[] | rotation | `booking.admin` | 403, `VALUE_INVALID` (size, weight) |
| `rotations.delete` | id | ok | `booking.admin` | 403, `IN_USE` |
| `bookings.reassign` | bookingId, to | booking | `booking.admin` | 403, `SLOT_TAKEN`, `NOT_ROUND_ROBIN` |
| `bookings.assignments` | bookingId | ledger rows with reasons | host or `booking.admin` | 404 |

### Value sourcing

| Action | Value | Source |
|---|---|---|
| Slots read | free members per slot | `memberSlots` per member, union |
| Booking | host | `assignHost`: ledger counts, `rotation_members` weight and priority, owner of the matched person |
| Booking | "fewest bookings this month (4)" text | the ledger row's `detail` |
| Rail | avatars | `auth.user.image` through `members.user_id`, else initials from `members.name` |
| Window count | since | now minus `rotations.window_days`, by `assigned_at` |
| Daily cap | the member's day | `booking_member_hours.availability.timeZone` |
| New person's owner | owner value | the assigned host's member id |

### Key invariants

- One live ledger row per booking and per (record, rotation).
- A member never has two confirmed overlapping `booking_hosts` rows.
- Lock order: rotation before host.

### Security model

Rotations and team pages: `booking.admin`. Ledger: the host sees their own rows, `booking.admin` sees all. Public: avatars only. All reads go through the access door with a denied actor test.

### Critical test scenarios

- Happy path: a 3 member page, a booking goes to the least booked free member, event on their calendar, person owned by them (AC-734, AC-738, AC-743, AC-744).
- Race: 20 parallel bookings on a 3 member page with caps of 5: no cap exceeded, no overlap, counts even within one (AC-741).
- Recheck: the picked member's slot is taken by a personal booking mid flight; the next member gets it (AC-740).
- Owner first: a known person goes to their owner even when the owner has the most bookings (AC-739).
- Leave: removing a member reassigns two bookings and flags one with nobody free (AC-749).
- Access: a member without `booking.admin` creating a rotation gets 403; a pool member sees only their own count (AC-751, AC-752).
- Forms: `assignOwner` inside a submission transaction sets the owner and writes a `form` ledger row; with everyone off returns `none_available` (AC-755, AC-756).

## Build plan

**Milestone 1: a round robin page books the fairest free member, and collective stops double booking** (thin thread, end to end)
1. Migration: `rotations`, `rotation_members`, `rotation_assignments`, `booking_hosts` (backfilled from confirmed bookings), the new columns; guard tests. AC-741, AC-745.
2. Core: `memberSlots`, `unionSlots`, `pickMember` (Fair only), `windowCounts`, `assignHost` with the two locks and recheck; tests including the race. AC-734, AC-736, AC-738, AC-740, AC-741, AC-742.
3. API and builder: `rotations.create/list`, the round robin kind in the page builder, the rail avatar stack. AC-728, AC-729, AC-732, AC-733, AC-751.
4. Event, emails and owner on the assigned host. AC-743, AC-744, AC-753, AC-754.
5. Collective as the intersection on `booking_hosts`, fixing today's double booking of a second member. AC-735.

**Milestone 2: control and change**
6. Priority strategy, caps, switch off, calibration, owner first. AC-730, AC-731, AC-739.
7. Reschedule rules, cancel voids, manual reassign, member leaves. AC-746 to AC-750.
8. Rotation screen with shares, delete guard, the load check for 20 members. AC-737, AC-752, AC-757, AC-758, AC-759.

**Milestone 3: forms**
9. `assignOwner` and its tests inside the forms processing transaction. AC-755, AC-756.

## Consequences

**Positive**:
- One fair count for meetings and leads; every assignment explains itself.
- Collective pages become correct for members with their own hours and bookings elsewhere.
- `booking_hosts` gives the team calendar (spec 0030) one table for "who is booked when".

**Negative / tradeoffs**:
- A slots read on a 20 member page makes 20 busy reads; a cold cache on a busy page leans on provider quotas.
- Reassignment creates a new calendar event and a new guest email; it can't be silent.
- Every booking now takes two locks and writes two more rows.
- Owner first can skew fairness for a member who owns many known people; the ledger shows it.

**Neutral**:
- `pickHost` is replaced by `assignHost`; personal pages behave as before.
- Rotations are member lists until #23 brings teams.

## Follow-up

- [ ] A later #58 spec: rules first routing (region, company size, form answers), assignment on import, the rebalance screen, and reports of share over time.
- [ ] Strict turn ("equal distribution") as a third strategy if a customer asks.
- [ ] Fixed host plus rotation (Cal.com's fixed hosts) and Cal.com's managed event types.
- [ ] Forms hand off: when the visitor's email is known before slots, show only the owner's times (owner first, earlier).
- [ ] Measure a 20 member page's slots on the load harness.

## Open questions

- **Which schedule a member books by on a team page** (assumed, 21 October 2026, after spec 0035's schedules landed): spec 0037 says a member page books by the member's default schedule (AC-1336) and counts weekly caps in that schedule's zone (AC-1326), but not which schedule a round robin or collective team page uses for each member. Assumed: each member's **default schedule** (the virtual weekdays 09:00 to 17:00 in the page's zone until they save one), so a team page names no schedule of its owner (`scheduleId` stays null; setting one is refused `CONFIG_INVALID`). A collective page keeps booking everyone by the page's own hours. Owner to confirm, or choose per member schedule picks on the page.

## Rationale

See [rationale.md](rationale.md).
