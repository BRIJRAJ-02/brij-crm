# 0037 · Round robin at timefix parity and beyond

**Part of**: [index.md](index.md) (owner decisions 19 to 22 and 31). **ACs**: AC-1319 to AC-1341. **Status**: decisions accepted 21 October 2026; **amended 31 October 2026**: most of it is built (J11, J13; see [verify.md](verify.md#round-robin-0037-round-robinmd)); AC-1321 is written as built, a rotation follows a team the way the everyone rotation follows the workspace (AC-1327), and screens are named where they now live.
**Extends**: spec 0029 (rotations, Fair and Priority, the ledger, `assignHost`, `assignOwner`), spec 0025 (team pages, collective), spec 0031 (teams), [0037-time-off-and-roster.md](0037-time-off-and-roster.md) (time off, limits), [0037-scheduling-access.md](0037-scheduling-access.md) (reach). Spec 0029's own changes are in [0037-amendments.md](0037-amendments.md#amends-0029).

## Summary

Timefix had no round robin, so parity is set by its written routing design and by Cal.com, Calendly, Chili Piper and HubSpot. Spec 0029 already covers the core (a rotation shared by pages and forms, Fair and Priority, weights, a 30 day window, daily caps, owner first, a ledger that explains every pick, reassigning when someone leaves). This child adds what the best tools have beyond it:

- **Fixed hosts plus several rotations on one page**: up to 7 people who attend every meeting, plus one host from each of up to 3 rotations (an account executive from Sales and a solutions engineer from Solutions on every demo).
- **An Even strategy**: anyone 3 or more ahead waits until the others catch up (Calendly's equal distribution).
- **Weekly caps**, and the per person limits and time off from the time off child.
- **Rotations that follow a team**: joining Sales joins the rotation.
- **Returning guests** go to their owner, or to the host they met last.
- **Rebalancing**: an editor can add or take away counts with a note, and a Distribution tab shows each person's share against their fair share over 12 weeks.
- **Editors** for a page or a rotation, so a team lead runs their team's page without being an admin.
- **Managed booking pages** (optional, decision 22): one template, a page per member, locked parts kept in step.

## User stories

- As a sales lead, I want every demo to have one AE from the rotation and our SE always there.
- As a sales lead, I want new hires to start getting meetings the day they join the team, without anyone editing the rotation.
- As a member in a pool, I want to know that if I'm far ahead, the others catch up before I get more.
- As an admin, I want to fix an unfair month by hand and leave a note why.
- As a team lead, I want to edit my team's page and rotation without admin rights.
- As an admin, I want every SDR to have the same "Intro call" page with the same questions, without setting up twenty pages.

## Acceptance criteria

*Hosts*
- **AC-1319**: A round robin page has fixed hosts (0 to 7 members, kept in `booking_page_members` by position) and 1 to 3 rotations (`booking_page_rotations`, positions 0 to 2), with fixed hosts plus rotations at most 8. A member may be both fixed and in a rotation the page uses, or in two of its rotations; a booking never gives one person two seats.
- **AC-1320**: A time is offered when every fixed host is free and the rotations can each be given a different free member (in each rotation, members switched on, not at a cap or limit, not away, not a fixed host). With up to 3 rotations this is checked exactly: each rotation has someone, every two together have two different people, all three together have three. Each slot carries its candidates per rotation.
- **AC-1321** (as built, amended 31 October 2026): Booking takes every rotation lock in id order, then reads, under them and before any host lock, the returning guest's owner and each rotation's last host (AC-1328) and the stand in of whichever of them is away at that time (AC-1284). Its lock set is every fixed host, every candidate free at that time in every rotation (from the read before any lock), every host kept by a move (AC-1324) and those stand ins; it takes their host locks one key at a time in id order, never out of order. It then reads time off again and rechecks everyone under the locks, and picks one member per rotation in position order by that rotation's strategy, skipping anyone already chosen and anyone whose choice would leave a later rotation with nobody. There is no restart: someone outside the lock set is never seated, so a stand in named after the read, or one with a calendar the read didn't cover, isn't used and the seat picks from its rotation as usual (fail closed); a fixed host no longer free, or a seat with nobody left, answers `SLOT_TAKEN` with fresh slots. The ledger gets one row per rotation; `booking_hosts` one row per host.
- **AC-1322**: The event's organiser is the first fixed host by position, else the host picked from the first rotation; the other hosts and the guest are attendees. The confirmation and emails name every host; each host gets the host notice.
- **AC-1323**: The page builder's Hosts section lists Fixed hosts (a member picker, reorderable) and Rotations (add up to 3, each shown as "One from Sales"), with a preview line ("Every booking: Alice, plus one from Sales, plus one from Solutions").
- **AC-1324**: Rescheduling with "same host when free" keeps every host when all are free at the new time (the slots shown are those times); otherwise each rotation whose host isn't free picks again through its rotation, and fixed hosts must be free for a time to be offered.

*Strategies, caps and limits*
- **AC-1325**: A rotation's strategy may be Fair, Priority or **Even**. With Even, a switched on member whose load is at least the rotation's Even gap (1 to 10, default 3) above the lowest switched on member's load is left out of slots and picks until the others catch up; otherwise Even picks as Fair. Load is (count in the window plus calibration) × 100 ÷ weight, so at equal weights the gap counts meetings.
- **AC-1326**: A rotation member may have a weekly cap (1 to 200) beside the daily cap, counted Monday to Sunday in their default schedule's zone. Rotations also skip members away (AC-1283) or at a meeting limit (AC-1298).

*Teams and returning guests*
- **AC-1327** (amended 31 October 2026): A rotation may follow a team (spec 0031), the way the workspace link's rotation follows the whole workspace: `rotations.follows = 'team'` with `follows_team_id`, and its members are read through the `rotation_roster` view as the team's active non guest members, each joined to any settings stored for them (weight, priority, caps, on or off, all editable per member). Nothing is copied when the team changes: someone joining the team is in the rotation at once, switched on, weight 100, priority medium, at the pool's average count (the view's `joins_late`, spec 0029's calibration), or switched off with spec 0029's warning badge when they have neither hours nor a calendar; someone leaving is out at once (their bookings stay) and their stored settings for it are deleted, so rejoining starts afresh. There is no member cap on a following rotation, as on the everyone rotation (a settings change still names at most `ROSTER_MEMBERS_MAX`, 200, members). A following rotation with fewer than 2 members offers no times and its screen says "Needs 2 people". Only `booking.admin` makes a rotation follow a team, on Bookings › Round robin ("Follow a team" in its settings). *L3b.*
- **AC-1328**: "Returning guests go to" is one of: their owner (default, spec 0029 AC-739), the host they met last, or the rotation. The host they met last is the host of the guest's most recent confirmed booking on any page using this rotation in the last 180 days, matched by email, when that host is switched on and free; the ledger reason is `last_host`. Owner and last host give way to their stand in when away (AC-1284).

*Rebalancing and the report*
- **AC-1329**: A rotation's editors and `booking.admin` holders can adjust a member's count by a whole number from minus 20 to plus 20 (not 0) with a note (1 to 200 characters); it is a ledger row (`reason = 'adjustment'`, `units` the number, the actor in `detail`) counted in the window like assignments, undoable (voided) by the same people, and audited (`rotation.adjusted`).
- **AC-1330**: The rotation's Distribution tab shows for the window: each member's count, their fair share by weight, their difference, their adjustments, and how they got their meetings (fair, priority, even, owner, last host, stand in, routed, manual, reassigned, adjustment); and a weekly chart of the last 12 weeks per member. Members see their own row; editors, `booking.admin` and See reach see the rows of the people they may see.

*Editors*
- **AC-1331**: A booking page or a rotation may name up to 20 editors (members or teams). Editors change everything on it except its editors, its deletion and, for a page, its owner; for a rotation, they also adjust counts (AC-1329). Who takes bookings is guarded (AC-1340). `booking.admin` does everything. Pages and rotations show editors in a Sharing section; adding or removing one is audited (`editors.changed`) and the person, or the team's members, are told by email.
- **AC-1332**: Captures › Links and Bookings › Round robin list the pages and rotations a member edits with an "Editor" badge; spec 0025's `bookingPages` access entry becomes: the reader's own pages, pages of people they Manage (decision 13, the Manage half lands in L1), pages they edit, or any with `booking.admin`.

*Managed booking pages (optional, decision 22)*
- **AC-1333**: A holder of `booking.admin` (or a template's editor) makes a managed page: a template holding a page's settings, its members (chosen members, or a team it follows; up to 200) and which parts are locked (Details, Durations, Location, Questions, On booking, Limits, Hours rule). Each member gets their own personal page from it, owned by them, with the template's settings and the slug of the Value sourcing table (for example `intro-call-sam`). The template's own public link answers "This page is no longer available".
- **AC-1334**: Saving the template copies its locked parts to every member page in one transaction; unlocked parts are copied only when a member's page is made; a member sees locked parts read only with "Set by your workspace" and keeps their own changes to unlocked parts.
- **AC-1335**: Removing a member from a template deletes their page as spec 0025 AC-648 deletes one (bookings stay; the link answers no longer available); adding one makes their page live; each member is told by email. Deleting the template keeps every member page as that member's own, no longer linked to it.
- **AC-1336**: A member page books on that member's own hours: their default schedule when Hours rule is locked, or a schedule they pick when it isn't (spec 0035 AC-966).

*Access and quality*
- **AC-1337**: Reassigning a booking (spec 0029 AC-748, spec 0030 AC-777) needs Manage over the current host and over the new host; "Next in rotation" chooses only among free members the actor may Manage. Changing a rotation needs `booking.admin` or being its editor (spec 0029 AC-751, amended).
- **AC-1338**: Every screen here is keyboard usable, labelled ("Weight for Sam Lee in Sales"), meets WCAG AA in both themes and uses the library only; the Distribution chart follows the `dataviz` guidance with a table alternative; `design-system-guardian` and `ux-interaction-reviewer` review it.
- **AC-1339**: A team page's rail shows the owner approved AvatarStack: up to 4 faces of the page's hosts (its fixed hosts and the switched on members of its rotations, never a routed pool, [routing](0037-routing.md) AC-1388) plus "+N", and the line "<page title> with <workspace name>" ("Intro call with Acme"); no host name or email shows before booking, and the host's name appears only on the confirmation. Personal pages stay unchanged.
- **AC-1340**: Adding a member as a fixed host, a rotation member or a managed page member, and changing their weight, priority, caps or on and off, needs `booking.admin` or Manage over that member; anyone who may edit the page or rotation may remove a member. Otherwise 403 `FORBIDDEN`, "You can only add people whose scheduling you manage."
- **AC-1341** (amended 31 October 2026): Deleting or pausing a booking page that a published form's rule (or its After someone sends it) books is refused 409 `ROUTING_IN_USE`, naming the form and the rule ("Rule 3 of Contact us sends people here. Change the rule first."); a rotation a page uses is already kept by its foreign key. *L6.*

## Design

### Data model

Spec 0029's tables, with the changes below applied before its first migration where possible ([amends 0029](0037-amendments.md#amends-0029)):

- **`booking_page_rotations`** (new): (`page_id`, `rotation_id`) primary key with `workspace_id`, `position` (smallint 0 to 2, unique per page); foreign keys carrying `workspace_id` to `booking_pages` (cascade) and `rotations` (restrict). Replaces 0029's `booking_pages.rotation_id`.
- **`booking_page_members`** (spec 0025): on a round robin page it holds the fixed hosts (positions 0 to 6).
- **`rotations`**: `strategy` adds `even`; `even_gap` (smallint 1 to 10, default 3); `returning` (text: `owner` | `last_host` | `none`, default `owner`; replaces 0029's `owner_first`); `follows` (text, built for `everyone` by migration 0128; L3b admits `team`) with `follows_team_id` (uuid, nullable, foreign key to `teams`, `on delete restrict`, required exactly when `follows = 'team'`). The `rotation_roster` view gains a branch for `follows = 'team'`: the team's active members whose role is owner, admin or member, left joined to stored settings, with `stored` and `joins_late` as for the everyone rotation. A stored rotation (`follows` null) keeps 2 to 20 members (`ROTATION_MEMBERS`).
- **`rotation_members`**: `weekly_cap` (smallint 1 to 200, nullable).
- **`rotation_assignments`**: `units` (smallint, default 1; check: `reason = 'adjustment'` and units between minus 20 and 20 and not 0, or units = 1); `reason` adds `even`, `last_host`, `standin`, `routed`, `adjustment`; `source` adds `adjustment`; the unique live row per booking becomes (`booking_id`, `rotation_id`) where `voided_at is null`. The window count sums `units`.
- **`scheduling_editors`** (new tenant table; forced row level security; audit columns): `workspace_id`, `id`, `resource_type` (text: `booking_page` | `rotation`), `resource_id` (uuid), `member_id` (nullable, foreign key to `members`), `team_id` (nullable, foreign key to `teams`, cascade). Checks: exactly one of `member_id` and `team_id`. Unique (`workspace_id`, `resource_type`, `resource_id`, `coalesce(member_id, team_id)`). Indexes: (`workspace_id`, `resource_type`, `resource_id`); (`workspace_id`, `member_id`) where not null; (`workspace_id`, `team_id`) where not null. Deleting a page or rotation deletes its editor rows in the same transaction (core). 20 per resource, checked in core.
- **Managed pages**: `booking_pages.kind` adds `managed` (the template); `booking_pages.template_id` (uuid, nullable, foreign key to `booking_pages` in the same workspace, `on delete set null`), on member pages; `booking_pages.locked` (text[], on templates; values among `details`, `durations`, `location`, `questions`, `on_booking`, `limits`, `hours`); `booking_pages.follow_team_id` (uuid, nullable, foreign key to `teams`, `on delete restrict`) on templates; **`managed_page_members`** (`template_id`, `member_id`) primary key with `workspace_id`, for chosen members.

### Slots and booking (`packages/core/src/rotation/`)

- `hostSlots(fixed, rotations)` (pure): per slot, the fixed hosts' intersection, then each rotation's candidate set; a slot is offered when Hall's condition holds for the candidate sets (one, two and three at a time). Unit tested with overlaps, a fixed host inside a rotation, and DST.
- `chooseHosts` (`packages/core/src/rotation/assign.ts`, as built): rotation locks in id order (`lockRotations`); the owner, last hosts and away stand ins read under them; the lock set (fixed hosts, every free candidate, kept hosts, those stand ins); host locks one key at a time in id order (`lockHosts`, each `pg_advisory_xact_lock`); recheck each; for each rotation by position, order its candidates by the strategy (and, on a routed booking, by the routing ranking of [0037-routing.md](0037-routing.md)), and take the first whose choice leaves Hall's condition true for the rotations after it; write the booking, `booking_hosts` and one ledger row per rotation.
- Even: before ordering, members over the gap are removed from the candidate sets and from the slots' union.
- Returning guests: before the strategy, the owner or last host (or their stand in) is taken when free, with its reason.

### Procedures

| Procedure | Key inputs | Key outputs | Access | Key errors |
|---|---|---|---|---|
| `booking.pages.update` (changed) | `hosts: { fixed: memberIds[], rotations: rotationIds[] }` on round robin pages | page | page editors, `booking.admin` | 422 `HOSTS_INVALID` (counts) |
| `rotations.update` (changed) | `strategy`, `evenGap?`, `returning`, `followsTeamId?` (L3b), members with `weeklyCap?` | rotation | rotation editors, `booking.admin`; following a team `booking.admin` only | 422 |
| `rotations.adjust` | `rotationId`, `memberId`, `units`, `note` | the ledger row | rotation editors, `booking.admin` | 403, 422 `VALUE_INVALID` |
| `rotations.voidAdjustment` | `assignmentId` | none | rotation editors, `booking.admin` | 404 |
| `rotations.distribution` | `rotationId`, `weeks?` (default 12) | per member counts, fair shares, reasons, weekly series | members (own row), editors, `booking.admin`, See reach | 404 |
| `editors.list`, `editors.set` | `resourceType`, `resourceId`, `editors: [{ memberId } \| { teamId }]` | editors | `booking.admin` (set); editors and `booking.admin` (list) | 403, 409 `EDITOR_LIMIT` |
| `managedPages.create`, `.update`, `.setMembers`, `.delete` | the template's settings, `locked[]`, members or `followTeamId` | template with member pages | `booking.admin`, template editors | 422, 409 |

### Screens

- **Page builder, Hosts** (spec 0025's builder): Fixed hosts and Rotations as above.
- **Bookings › Round robin** (spec 0029's screen; a Bookings tab since 26 October 2026, with the old settings addresses redirecting): the rotation's members table has Weekly cap and each member's calendar health chip (built); its settings have Strategy (Fair, Priority, Even with its gap) and Returning guests (built), and Follow a team (a Select, L3b); tabs Members | Distribution (built) | Sharing (L2).
- **Distribution**: a table (member, count, fair share, difference, adjustments, reasons) and a 12 week chart; "Adjust" opens a Modal (member, a number with plus or minus, note).
- **Sharing**: editors list (people and teams) with Add and Remove, for pages and rotations.
- **Managed pages**: Captures › Links › New › Managed page; the template editor shows a lock Switch per part; member pages show "From <template>" and locked parts read only.
- References: Calendly's "Edit rotating host pool" and co hosts beside a rotating pool, Cal.com's Assignment section (Fixed hosts, "Add all team members, including future members", Maximize availability or Load balancing) and its round robin groups, Chili Piper's calibration credits.

### Value sourcing

| Action | Value | Source |
|---|---|---|
| Slot | candidates per rotation | each rotation's switched on members' slots (spec 0029 `memberSlots`), minus caps, limits, time off, fixed hosts |
| Pick | member per rotation | the rotation's strategy over the ledger (sum of `units` in the window), weights, priorities; the routing ranking on routed bookings |
| Even | left out | load minus the lowest load at least `even_gap` |
| Weekly cap | count | the member's live ledger rows' bookings in the local week |
| Team rotation members | members | the `rotation_roster` view: `team_members` of `rotations.follows_team_id`, active, role owner, admin or member, joined to stored settings |
| Joiner's calibration | count | the pool's average `units` sum in the window (spec 0029 AC-730) |
| Last host | member | host of the newest confirmed booking with the same visitor email on a page using the rotation, within 180 days |
| Fair share | count | window total × the member's weight ÷ the switched on members' weights |
| Organiser | member | first fixed host by position, else the first rotation's pick |
| Member page slug | text | the template's slug, a hyphen, the member's first name in lowercase letters and digits (the slug alphabet), then "-2", "-3" on clashes, cut to 60 characters (spec 0025's slug check) |

### Key invariants

- One person never fills two seats of one booking.
- Locks are always: every rotation lock in id order, then every host lock (fixed hosts, free candidates, kept hosts, away owners' and last hosts' stand ins) one key at a time in id order, then recheck; nothing that holds a host lock asks for another lock, and nobody outside the set is seated.
- The window count is the sum of live `units`; adjustments are visible and undoable.

### Numbers

| Value | Number | Runner up |
|---|---|---|
| Fixed hosts per page | 0 to 7 | 0 to 3 |
| Rotations per page | 1 to 3 | 1 |
| Hosts per booking | at most 8 (spec 0025's collective cap) | 6 |
| Even gap | 1 to 10, default 3 (Calendly) | default 2 |
| Weekly cap | 1 to 200 | none |
| Last host lookback | 180 days | 365 days |
| Adjustment | minus 20 to plus 20, note 1 to 200 characters | minus 10 to plus 10 |
| Distribution chart | 12 weeks | 6 weeks |
| Members of a stored rotation | 2 to 20 (spec 0029) | 2 to 50 |
| Members of a rotation that follows a team | no cap (as the everyone rotation) | 20 (the original plan) |
| Editors per page or rotation | 20 | 10 |
| Members per managed page | 200 | 50 |

### Critical test scenarios

- A page with fixed Alice and rotations Sales and Solutions: only times when Alice, someone in Sales and someone else in Solutions are free; a Solutions member also in Sales is never picked twice; the event is on Alice's calendar (AC-1319 to AC-1322).
- 30 parallel bookings on that page: no host double booked, no cap passed, no deadlock (locks in order) (AC-1321).
- Even with gap 3: a member three ahead stops appearing in slots until the others catch up (AC-1325).
- A rotation follows Sales; a new hire joins Sales and gets the next fair booking with no write to the rotation; a 25th member joins without refusal; a leaver drops out and, rejoining, starts at the pool's average (AC-1327, AC-1442).
- A returning guest goes to their last host; when that host is away, to the stand in (AC-1328, AC-1284).
- An editor adds +3 for Sam with a note; Sam's next assignments slow down; the Distribution tab shows it; undo restores (AC-1329, AC-1330).
- A team lead as editor changes the Sales rotation's weights but can't delete it or change its editors (AC-1331).
- A managed "Intro call" for 12 SDRs: changing locked Questions updates 12 pages in one transaction; an SDR's unlocked Description change stays (AC-1333, AC-1334).
