# 0035. Availability schedules: rationale

## Context

Spec 0025 gave each member one set of hours (`booking_member_hours`, edited on Bookings › Availability) and each booking page an `hours_mode`: `mine` follows the owner's hours, `own` keeps the page's own copy in `booking_pages.availability`. That works for one person with one rhythm, but people keep different hours for different meetings, and copies on pages drift: change your hours and the pages with their own copy don't follow. Round robin (spec 0029) needs each member's hours for every pooled member, and the team calendar (spec 0030) needs a member's normal hours for its band; both were written against this spec.

Another builder is redesigning the Availability page right now (lane `wip/avail`: fixed width time Selects, a SaveBar, 12 hour times). The public booking page is frozen by the owner. The slot engine reads `BookingAvailability` and is tested; changing its input shape would put that at risk.

## Options considered

### Option 1: a schedules table, pages point at one, null follows the default (chosen)

**Pros**: one source of hours per schedule; pages follow changes; matches Calendly and Cal.com, so members recognise it; the engine's input shape doesn't change.
**Cons**: a data migration and a release of double columns; page specific hours turn into schedules in the owner's list.

### Option 2: keep `hours_mode`, add named presets copied onto pages

**Pros**: no change to how pages read hours.
**Cons**: copies drift, which is the problem being solved; round robin would still have no per member answer beyond the one set.

### Option 3: schedules as weekly rules in rows (one row per weekday range)

**Pros**: queryable ranges.
**Cons**: no query needs them; the engine and the editor both work on the JSON shape; more writes per save.

## Rationale

Option 1 removes the copy that drifts and gives 0029 and 0030 the function they were promised (`scheduleFor`), while keeping the engine's input identical so the migration can be proved by comparing slots. Null as "follow the default" keeps today's `mine` behaviour without a second flag, and is the same meaning spec 0029 already gave the column for team pages.

Calls made without a question, each with its runner up:
- Page own hours become schedules named "<page title> hours" (runner up: fold them into the default when identical, which would be clever but surprising).
- Up to 20 schedules per member (runner up: no limit).
- Hours readable by every member through pages they can see; writes by the owner or `booking.admin` (runner up: owner only, which would block an admin setting up a team page).
- Expand then contract over two releases (runner up: one migration that drops the old columns at once, which leaves no way back).
- The virtual default isn't stored until the member saves (runner up: create one for every member in the migration), so members who never use scheduling get no rows.

## Evidence

- **Calendly** (Mobbin, web): Availability shows "Working hours (default)" as a schedule picker with "Active on: N event types", Weekly hours and Date specific hours side by side, a time zone link under the week, and "Create schedule" asking only for a name. The list summary and the "Used by" line come from here.
- **Cal.com**: Availability lists schedules with a Default badge and a one line summary and zone; each event type picks one.
- **The owner's earlier scheduling app** (`timefixapp/src/components/availability`, read only): one hours editor reused for every schedule, which is why this spec wraps the redesigned editor rather than drawing a new one.

## References

**Project sources**: spec 0025 (`booking_member_hours`, `hours_mode`, the engine), spec 0029 (AC-732, AC-734, `rotation_members.schedule_id`, the null meaning), spec 0030 (hours band and time zone from the default schedule), `packages/core/src/booking/slots.ts` (`loadPage`, `engineHours`), `packages/db/src/schema/booking.ts`, `docs/plan/roadmap-2026-10-20.md`.

**Practices**: expand and contract migrations; proving a data migration by comparing outputs before and after.
