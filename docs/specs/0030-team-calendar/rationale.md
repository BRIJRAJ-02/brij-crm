# 0030. Team calendar on Bookings: rationale

## Context

The polish plan (docs/plan/polish-phases.md, F2) leaves one item open on Bookings: "timefix's team calendar (one column per member, needs its own spec and permissions)". Today's Bookings › Calendar is one week grid for one person:

- `WeekCalendar` (`packages/ui/src/modules/WeekCalendar/`) draws one grid; its README calls it "one grid for one person".
- `readBookingsCalendar` (`packages/core/src/booking/list.ts`) already returns other people's bookings to `booking.admin` and to page owners, but the screen draws them in one undivided grid with no host label.
- Calendar events come only from the reader's own connections; blocks and holds only the reader's own (AC-712).
- Nothing is virtualised, and the views refresh on focus, not live.

Forces:

- **Privacy.** Spec 0024 lets each member mark a calendar connection `shared` or `private`, and an event marked private in the calendar is always private. A team view must never leak a private title.
- **Access goes through one door** (`crm-data-model-access`). Roles are flat lists of permissions. There is no calendar permission yet, and teams (#23) don't exist, so `Principal.teamIds` is always empty.
- **Scale.** The budget is 100 people online with room for 1,000. A day for 20 to 50 members must load as one request, not one per member.
- **Round robin** (spec 0029) needs a place to see a pool's members side by side and to reassign a booking.

## Options considered

### Decision 1: the shape of the team view

**Option 1: a team day, one column per member (chosen).** Timefix built exactly this (`team-day.tsx`), and its comment gives the reason: "a week of six people is 42 columns and answers nothing." Google Calendar's day view with several calendars, Cal.com's team availability and shift tools (Fresha, Deputy, 7shifts on Mobbin) all put people across and time down for a single day.
- Pros: answers "who is free at 3pm", room for each booking's guest name, quick actions land on one person.
- Cons: a week of one teammate needs a second control (Decision 4).

**Option 2: a week with a sub column per member each day.**
- Pros: one view.
- Cons: unreadable past three people; blocks too narrow for a name.

**Option 3: a week with all members overlaid, coloured by member.**
- Pros: no new layout.
- Cons: overlaps pile into lanes, colours run out past eight, and the private rules get hard to read.

### Decision 2: who sees whom

**Option 1: one permission, `schedule.manage`, gating every teammate's column (chosen).** Timefix's model (`canSeeEveryone = may(actor, "schedule.manage")`, enforced in the SQL, not the UI): a receptionist sees every doctor, a doctor sees only themselves. Owners and admins have it; a team scoped variant follows #23.
- Pros: one door, one flat permission, no special cases; the same permission covers acting on the column, so "can see" and "can book for" never disagree.
- Cons: plain members see only themselves until roles become editable (#24).

**Option 2: two read permissions (`bookings.read.team`, `bookings.read.all`) granted to members too.**
- Pros: open teams see each other at once.
- Cons: splits seeing from acting, and a default that shows everyone's day to every member is hard to walk back.

**Option 3: one workspace setting (Everyone, Team, Admins only).**
- Cons: bypasses roles, so a future custom role can't differ.

### Decision 3: what a colleague's outside calendar shows

**Option 1: Busy blocks only, read as free and busy (chosen).** Each member's conflict calendars (spec 0024 M5) are read through the busy cache, so only start and end ever reach the server's answer.
- Pros: nothing private can leak, whatever a member set for sharing; covers calendars that aren't synced into `meetings`.
- Cons: a provider read per member per day on a cold cache; assistants can't see what a busy block is.

**Option 2: follow spec 0024 sharing (shared shows titles).**
- Pros: richer for assistants.
- Cons: titles of shared calendars land in a view meant for scheduling; one more place a sharing mistake leaks.

### Decision 4: one teammate's week

**A member picker on the week ("Calendar: Me ▾") (chosen)**, runner up only the team day. Seeing a colleague's week before booking for them is common (Google's "Search for people"). It reuses the same reads and rules.

### Decision 5: booking on someone's behalf

**`schedule.manage` holders may book, block, set time off and change hours on a teammate's column, inside their hours unless they choose otherwise (chosen)**. Runner up: booking for anyone with `booking.manage`, the rest admins only. Timefix offers book, set hours and time off on a colleague's column, each checked again on the server, and checks the target belongs to the workspace.

## Rationale

The day with people across is what every reference converges on, and timefix already proved it for this product. One flat permission keeps the access door the only gate, which the house rules require, and leaves a clean seam for #23. Busy only for outside calendars means the team view can't leak a title, whatever each member's sharing says.

For scale, one procedure returns the whole day for every visible member: bookings from `booking_hosts` (spec 0029) and blocks, each one query with `member_id in (…)` and a range overlap, capped like timefix (2,000 rows), and busy spans read in parallel through the 60 second busy cache. The browser virtualises columns past twelve.

Calls made without a question, each with its runner up:
- Columns: me first, then by name (runner up: by role, as timefix sorts by job title, which the CRM doesn't store).
- Minimum column width 160px with horizontal scroll and sticky header and time axis (timefix uses 168px).
- Reassign by menu, not by dragging a booking between columns (runner up: drag), so a stray drag never moves a guest's meeting.
- A phone shows one member at a time with a member switcher (runner up: horizontal scroll), as the week already shows one day below 480px.

## References

**Project sources**:
- Polish plan F2 (docs/plan/polish-phases.md).
- `apps/web/src/routes/w.$slug.bookings.calendar.tsx`, `apps/web/src/features/bookings/BookingsScreen.tsx`, `DrawCard.tsx`, `NewMeetingDialog.tsx`; `packages/ui/src/modules/WeekCalendar/`; `packages/core/src/booking/list.ts`; `packages/data/src/bookings/store.ts`.
- Spec 0009 access (`packages/contracts/src/access.ts`, `packages/core/src/access/`), spec 0024 AC-611 and AC-612 (sharing and private meetings) and its M5 calendars, spec 0027 quick actions, spec 0029 round robin (`booking_hosts`, reassign), spec 0035 availability schedules.
- Timefix, read only: `timefixapp/src/components/bookings/team-day.tsx`, `team-draw.tsx`, `packages/core/src/db/queries/team-calendar.ts`, `docs/team-calendar.md`.

**Practices and standards**:
- Least privilege by default with explicit grants; deny tests for every new read.
- Batched range reads over per item fetches; windowed rendering for wide grids.

**Product references** (studied through Mobbin, 20 October 2026):
- Cal.com Team Availability (members down, days across, with each member's zone).
- Fresha scheduled shifts, Deputy and 7shifts schedules, Square workday: people as rows or columns over one day, with avatars and sticky headers.
- Google Calendar's day view with several people's calendars side by side (product knowledge, no link verified here).
