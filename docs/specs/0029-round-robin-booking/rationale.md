# 0029. Round robin booking pages: rationale

## Context

The owner asked for "round robin as well" on 20 October 2026. Scope feature #58 wants new leads and meetings shared fairly across a team, with weights, caps and per member availability, never giving one lead to two members, and saying why each assignment went where it did. Two specs already wait on it:

- Spec 0025 (booking pages) built personal and collective pages and left a seam: `pickHost` refuses the `round_robin` kind, and the builder shows it as coming soon (AC-628).
- Spec 0023 (forms) records a hard interface: `assignOwner(rotationId, { objectId, recordId })`, called inside the submission's transaction after the record exists, returning `{ memberId, reason }`.

The forces that shape the design:

- **Double booking is the failure that matters.** Spec 0025 serialises a host's bookings with a per host advisory lock and a Postgres exclusion constraint. Round robin adds a second race: two visitors booking the same team page at once must not both be judged "least booked" and handed to the same member past their cap, or to two members for one lead.
- **The slots engine is pure and per host.** `computeSlots` in `packages/core/src/booking/engine.ts` takes one set of hours, busy spans and bookings. Team pages need many members' slots combined, and today's collective page uses the page's hours for everyone and only reads bookings where a member is the host, so the other members' bookings elsewhere don't block them.
- **The public page is frozen** (`/b/:key`, owner, 20 October). A team page may only add the host avatar stack in the existing rail.
- **Teams as an entity don't exist yet** (#23 is planned). A pool must work from a list of members today.
- **Hours and calendars are being reshaped.** Spec 0035 (availability schedules) gives each person several schedules and each page one, and spec 0024 M5 checks every calendar for conflicts and writes to a chosen destination calendar. A pool member's slots must read both, not today's single `booking_member_hours` row and primary calendar.
- **Calendars may be missing or expired.** Spec 0025 offers hours minus bookings for a host with no calendar, and closes the page when a calendar refuses us.

## Options considered

### Decision 1: what a pool is

**Option 1: a rotation, its own entity, used by booking pages and by forms (chosen).** `rotations` and `rotation_members` hold the members, weights, priorities and caps; a round robin page points at one; forms call `assignOwner` with its id. One fairness ledger for both.
- Pros: meets spec 0023's interface as written; a team that takes leads from a form and meetings from a page shares one fair count; #58's later rules (region, size) attach to one place.
- Cons: one more settings surface; a page editor has to link to or create a rotation.

**Option 2: the pool lives on the booking page** (`booking_page_members` with weights).
- Pros: simplest; matches Cal.com, where hosts live on the event type.
- Cons: forms need a second pool; fairness splits per page, so a member on three pages can be "least booked" on each and get three times the share.

### Decision 2: how the host is chosen

**Option 1: fair by weighted count, union of slots (chosen).** The visitor sees every time at least one member is free. At booking, among the members free at that time, pick the one with the fewest active assignments in the window, divided by their weight. Calendly calls this "Maximize availability"; Cal.com's default round robin with "lowest number of bookings" is the same.
- Pros: the most slots for visitors, fair over time, weights work naturally.
- Cons: a member with wide hours wins more early morning slots, so the count drifts until fairness pulls it back.

**Option 2: strict turn ("Equal distribution" in Calendly).** Only the next member in line's slots are shown.
- Pros: perfectly even.
- Cons: far fewer slots; one busy member makes the page look empty. Kept as a later strategy.

**Option 3: priority first.** The highest priority free member always wins; fairness breaks ties. Cal.com and Chili Piper offer it for senior reps or overflow. Offered as the second strategy, since it is the same code with the sort keys swapped.

**Collective** (everyone free) already exists from spec 0025 and keeps its kind; this spec fixes it to use each member's own hours (intersection), not only the page's.

### Decision 3: where fairness state lives

**Option 1: an append only assignment ledger, counted on read (chosen).** `rotation_assignments` has one row per assignment with its reason; the count over the window is a single indexed query, taken under a rotation lock.
- Pros: every assignment explains itself (#58); cancelling or reassigning is one update (`voided_at`); no counters to drift; rebalancing and reports read the same rows.
- Cons: a count query per booking (cheap: one index range over at most a few thousand rows).

**Option 2: a counter per member** (Calendly's internal model is close to this).
- Pros: O(1) reads.
- Cons: counters drift on cancels and reassignments, and the "why" still needs a log, so it is two stores to keep in step.

### Decision 4: the window fairness counts over

**Rolling 30 days by assignment time (chosen)**; runner up the calendar month (Cal.com's default). Rolling never resets everyone to zero on the 1st, which would hand the first bookings of each month to whoever had the most last month.

### Decision 5: rescheduling

**Same host if free, else back through the rotation (chosen as the default)**; runner up always back through the rotation. Calendly offers both ("Use same hosts as original meeting" and "Reassign host(s) through round robin"). A guest who met someone usually wants the same person, and moving hosts creates a new event and a new email.

### Decision 6: known people

**Send a known person to their owner when the owner is in the pool and free at the chosen time (chosen, on by default)**; runner up rotation only. #58's Done when says "an existing customer goes back to their current owner instead of the rotation". HubSpot meetings and Chili Piper both route to the contact or account owner first.

## Rationale

The rotation as its own entity is the only shape that satisfies spec 0023's `assignOwner(rotationId, …)` as written, and keeps one fair count for a team that gets leads from both forms and pages. A ledger, not counters, because #58 asks that every assignment say why, and the same rows answer fairness, reports and rebalancing.

Concurrency follows spec 0025's pattern with one more lock. A booking takes the rotation lock first, then the chosen host's lock, then rechecks that host's slot. Blocks and personal bookings take only host locks, and nothing that holds a host lock ever asks for a rotation lock, so the order is always rotation then host and two writers can't deadlock. Under the rotation lock, two visitors booking the same page at once see each other's assignments, so the second goes to the next fairest member, never past a cap.

Slots are computed by running the existing pure engine once per member and taking the union (round robin) or intersection (collective). The engine stays per host and unchanged; the combining is a small pure function, tested on its own. A new `booking_hosts` table, one row per member a booking occupies with its own exclusion constraint, fixes the collective gap and gives the team calendar (spec 0030) one place to read who is busy.

Calls made without a question, each with its runner up:
- Pool size 2 to 20 (runner up 50): busy reads are one provider call per member per slots request, and 20 keeps the p75 under spec 0025's 1.5 seconds with the 60 second busy cache.
- Weights 1 to 100, default 100 (Cal.com's percentage style), runner up 1 to 10.
- Priority on five levels, lowest to highest, default medium (Cal.com), runner up three levels.
- New members start at the pool's average count, not zero (Cal.com's calibration), runner up start at zero, which floods the newcomer.
- The guest sees the team avatars before booking and the assigned host's name after (Cal.com, Calendly), runner up the host's name before booking (impossible: the host is chosen at booking).

## References

**Project sources**:
- Spec 0025 booking pages (`pickHost` seam, per host lock, exclusion constraint, AC-627, AC-628), and `packages/core/src/booking/slots.ts`, `engine.ts`, `public.ts`, `locks.ts`.
- Spec 0023 forms, Follow-up: the `assignOwner` interface.
- Spec 0024 calendar sync (`freeBusy`, `createEvent`, `moveEvent`, `cancelEvent`), spec 0009 access (`booking.manage`, `booking.admin`).
- Scope #58 (docs/scope/integrations.md), #23 teams (docs/scope/team-and-security.md).
- `crm-data-model-access` skill: one access door, flat roles, teams as groups.

**Practices and standards**:
- Advisory locks taken in one global order to avoid deadlock; exclusion constraints on range types as the last guard against overlaps.
- Append only ledgers over mutable counters when every change must be explained.

**Product references** (studied through Mobbin, 20 October 2026):
- Cal.com: "Add a new team event type" dialog with Collective, Round Robin and Managed Event; Routing forms with fallback members; Team Availability view.
- Calendly: "Edit rotating host pool" with a star per member (priority) and "Maximize availability" or "Equal distribution"; Rescheduling preferences "Reassign host(s) through round robin" or "Use same hosts as original meeting".
- SavvyCal, HubSpot meetings and Chili Piper (from their public product docs, no links verified here): owner first routing, weighted distribution, and per rep caps.
