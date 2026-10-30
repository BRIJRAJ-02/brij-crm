# 0037 · Scheduling access: who may see and set whose time

**Part of**: [index.md](index.md) (owner decisions 7 to 13 and 31). **ACs**: AC-1251 to AC-1275. **Status**: decisions accepted 21 October 2026; **amended 31 October 2026**: built by J1, J4 and J5 except team reach (L3a) and colleagues' pages and the last notice lines (L1), see [verify.md](verify.md#scheduling-access-0037-scheduling-accessmd); co hosts act on bookings and a grant's granter is its `updated_by`, as built.
**Extends**: spec 0009 (one door, fail closed), spec 0030 (`schedule.manage`, `visibleMembers`, acting on a teammate's column), spec 0035 (AC-971, a colleague's schedules), spec 0027 (blocks, Book someone in), spec 0031 (audit, teams, removal).

## Summary

"Availability set by an admin or someone else" becomes one rule with two levels. **See** shows a person's scheduling; **Manage** changes it. Every member has Manage over themself. Over other people, reach comes from the role (their teams, or everyone) and from **delegations**: per person grants of See or Manage over one member, one team or everyone, made by admins for anyone or by a member for their own scheduling (their assistant). The reach is read once per transaction at the scheduling choke point and every check goes through one pure function, `canActFor`. A member can lose the right to change their own hours (`availability.own`), which makes their hours managed by others. Every change someone makes to another person's scheduling is audited, and the person is told by email, ten minutes of changes at a time.

This settles the seam between specs 0030 and 0035: `booking.admin` stays the permission for things (booking pages, team pages, rotations); people's time (hours, time off, limits, their bookings, reassigning) is scheduling reach.

## What each level covers

| | See | Manage |
|---|---|---|
| Team calendar column (spec 0030), outside events as Busy only | yes | yes |
| Their schedules, date overrides, time off (reason shows to Manage only), meeting limits | read | change (hours only when allowed, AC-1255) |
| Their bookings: guest name, page title, time, status | yes | yes |
| A guest's email and answers | | yes |
| Block, hold or close their time; book someone in as them; book outside their hours | | yes |
| Cancel, reschedule, mark a no show | | yes |
| Reassign their round robin bookings (needs Manage over the new host too) | | yes |
| Their personal booking pages | read | change (decision 13), except "Add events to" (AC-1273) |
| Their round robin shares and routing decisions | yes | yes |
| Their calendar health status (spec 0037 calendars) and "Ask to reconnect" | yes | yes |
| Their calendar accounts, calendars, switches, destination; private event details; their profile and account | never | never |

## User stories

- As an assistant, I want my manager to let me run their calendar, so I can set their hours, block time and move their meetings.
- As a receptionist, I want to manage every doctor's day without being an admin.
- As a team lead, I want to see and change my team's hours and time off, and nobody else's.
- As a doctor, I want to see my hours and know they're set by the practice manager, and be told when they change.
- As a member, I want to know who can manage my scheduling, and to take my own grant back.

## Acceptance criteria

*Levels and reach*
- **AC-1251**: Scheduling reach has two levels, See and Manage, covering exactly the table above; nothing gives anyone reach over another member's calendar accounts, calendar choices, private event details, profile or account.
- **AC-1252**: A member always has Manage over themself, within their own permissions: `booking.manage` for their booking pages, bookings, blocks and time off, and `availability.own` for their schedules, date overrides and meeting limits.
- **AC-1253**: Reach over others is the most open of: the role's permissions (`schedule.view` or `schedule.manage` over every active non guest member; `schedule.view.team` or `schedule.manage.team` over every active non guest member who shares a team with them, spec 0031 slice 8), and their delegations. Owners and admins hold `schedule.manage` through their built in role. Reach that comes from a custom role, or from a team scope, never covers an owner or an admin: reach over an owner or admin comes only from the built in Owner or Admin role, or from a delegation that owner or admin granted over themself (or, over an admin, one an owner granted).
- **AC-1254**: A delegation gives one member (the delegate) See or Manage over one target: a member, a team (its active members at the moment of each check) or everyone. It is stored in `schedule_delegations`; a level or target type the code doesn't know grants nothing.
- **AC-1255**: A member may grant a delegation over themself to any active non guest member, and remove any delegation over themself; holders of `members.manage` may grant and remove any delegation over members (never over an owner, and over an admin only when they are an owner); a delegate may remove their own. Without `members.manage`, a grant over anyone else answers 403 `FORBIDDEN`; a guest, removed member or the target themself as delegate answers 422 `DELEGATE_INVALID`. A delegation a member granted over themself (`granted_by_self`) never gives more than they hold over themself: through it, a delegate can't change the member's schedules, date overrides or meeting limits while the member lacks `availability.own`, so hours set by others stay set by others (decision 10). Only Manage from a role, or from a delegation granted by a `members.manage` holder, changes such a member's hours.
- **AC-1256**: A delegate holds at most 50 delegations (team and everyone delegations count once each) and a member has at most 20 delegates naming them as the target (only member target delegations count). A grant takes the delegate's and the target's advisory locks in key order, so two grants at once can't pass either cap (409 `DELEGATION_LIMIT`, with the messages in the index's Errors table).
- **AC-1257**: Granting, changing or removing a delegation writes one audit row (`delegation.granted`, `delegation.changed`, `delegation.revoked`) and one `access` outbox row naming the delegate, so their open screens reload (spec 0009, AC-146); the delegate gets an email ("You can now manage Ada's scheduling"), and so does the member when someone else granted it ("Priya can now manage your scheduling"), as the index's Emails table says.

*One function, at the choke point*
- **AC-1258**: Every service that reads or changes another member's scheduling reads the reach once per transaction (`schedulingReach`, one query) and decides through `canActFor(reach, memberId, 'view' | 'manage')`. A member outside the caller's See reach answers `NOT_FOUND` exactly as an unknown member; a member they may See but not Manage answers 403 `FORBIDDEN`, "You can see Bea's scheduling but not change it." The services and their checks are the table under Design.
- **AC-1259**: The door doesn't read delegations or team members for reach: CRM requests pay nothing, and spec 0009's AC-149 holds unchanged (measured with 100 delegations in the workspace).

*Hours set by others*
- **AC-1260**: A member without `availability.own` sees their own schedules, overrides and limits read only, with "Your hours are set by the people who manage your scheduling."; their writes answer 403 `FORBIDDEN` with that sentence; people with Manage over them change them. Time off and blocks stay theirs to add (they only remove times).
- **AC-1261**: `access.mine` gains `scheduling: { seesOthers, managesOthers, seesEveryone, managesEveryone }` (booleans for the screens); `members.visible` (spec 0030) answers the members in the caller's See reach, each with `canManage`.

*Bookings*
- **AC-1262**: Who may do what with a booking is exactly the Booking actions table under Design. In short: the host and its co hosts, Manage over the host or a co host, and the managers of its page (the page's owner and editors, and `booking.admin`, which manages every page) list it, see the guest's email and answers, cancel, reschedule and mark a no show; See over the host shows the guest's name, page title, time and status only; reassigning needs Manage over both hosts. `booking.admin` deliberately sees and acts on every page's bookings, because a page's bookings belong to the page (decision 12), while the Team day and member pickers still show only See reach.

*Audit and the member told*
- **AC-1263**: Every change to a member's schedules, date overrides, time off, meeting limits or blocks writes one audit row (`schedule.changed`, `time_off.created`, `time_off.changed`, `time_off.deleted`, `limits.changed`, `block.created`, `block.removed`) with the actor, the member whose scheduling it is (in `before` and `after` as `memberId`), and before and after of the changed fields only; changes a member makes to their own are audited too. A time off row stores its reason code, never the note's text ("Note changed"). Bookings made, moved, cancelled or reassigned for someone else write `booking.changed_for` with the actor and host; edits by anyone but the owner to a personal booking page write `booking_page.changed_for` with before and after of the changed fields.
- **AC-1264**: The member is told: changes someone else makes to their schedules, overrides, time off, limits or personal booking pages, and being added to or removed from a rotation, are gathered per actor for 10 minutes from the first one and sent as one email ("Priya changed your scheduling"), one line each in the member's time zone and clock ("Working hours, Monday: 9:00am to 5:00pm became 10:00am to 6:00pm"; "Time off added: 3 to 7 November, Vacation"; "Intro call: location changed from Zoom to Google Meet"; "Added to the Sales rotation"); nothing is sent when the changes cancel out. Bookings keep their own immediate emails (spec 0030 AC-776, spec 0029 AC-748). The same notice appears in the inbox (spec 0038, built since): one notification per sent email, naming the actor, read through the door when opened, and in the daily digest for a member who chose one.
- **AC-1265**: A schedule, time off entry or limit last changed by someone else shows "Changed by Priya, 2 hours ago" where it is shown.

*Screens*
- **AC-1266**: Settings › Account › Scheduling access lists "Who can see or manage your scheduling" (each person or role with the level and its source: "Admin", "Sales lead role, shares Sales with you", "You added") and "Whose scheduling you can see or manage" (people, teams or everyone, with level and source). "Add someone" opens a Modal with a member picker (active non guests) and See or Manage; each delegation over you has Remove.
- **AC-1267**: Settings › Workspace › Members gains a Scheduling column for holders of `members.manage`: each member's reach in a few words ("Everyone", "Their teams", "Sam and Bea", "Only their own"), opening a Popover with the reach from their role (read only, linking to the role) and their delegations (add a person, a team or everyone with See or Manage; remove). It replaces timefix's "Sees all calendars" switch.
- **AC-1268**: Availability (spec 0035) shows a "Viewing" member Select to anyone with See over at least one other member, listing exactly those members (me first, then by name). For someone they may only See, the schedules are read only with "You can see Bea's hours but not change them."; with Manage they edit, under the line "Bea will be told about changes."

*Removal and tests*
- **AC-1269**: Removing a member deletes every delegation where they are the delegate or the target, in spec 0031's removal transaction, with `access` rows; deleting a team deletes the delegations that target it, listed in the team's delete dialog ("2 people lose access to manage Sales' scheduling.").
- **AC-1270**: `canActFor`, the reach combination and the level parsing are pure and unit tested over the grid: each role permission, overlapping and separate teams, each delegation target and level, unknown levels and targets, a removed target and a guest target; a denied actor test exists for every service in the table under Design.
- **AC-1271**: Every screen here is keyboard usable, labelled ("Scheduling access for Priya Shah"), meets WCAG AA in both themes, and uses the library only; `design-system-guardian` and `ux-interaction-reviewer` review it.

*Acting for someone*
- **AC-1272**: A member with Manage over others gets a "For" picker (Me first, then the people they Manage, by name) in New meeting, Block time and Time off on Bookings, which act as that person (spec 0030's `forMemberId`).
- **AC-1273**: Editing someone else's personal booking page with Manage shows "Editing Bea's page" in the editor's header, and Captures › Links lists the pages of the people the caller Manages under each person's name (after the caller's own and the Workspace group). For anyone but the owner, "Add events to" (spec 0024 AC-997) is read only and reads "Set by Bea", with no calendar name or id in the page's answer, and the update refuses a change to `destination_calendar_id` from anyone but the owner (403 `FORBIDDEN`, "Only Bea chooses where her events go."). Decision 14 holds: nobody sees or changes another person's calendars.
- **AC-1274**: Reach changes reach open screens. Granting, changing or removing a delegation, a team membership change, deleting a team, a role change and a member becoming a guest each store an `access` outbox row naming every member whose reach changed (the delegate; holders of a `.team` permission who share the team; delegates whose team or member target changed); on that row the client's data layer drops and reloads every scheduling store it holds (availability, the Roster, bookings lists, time off, limits, rotations, routing), not only records. A two browser check: removing Priya's delegation over Bea takes Bea's row and hours off Priya's open Roster within spec 0009 AC-146's 5 seconds.
- **AC-1275**: Every service in the Services table that acts on someone else also needs the actor's own permission named in its "Actor also needs" column; a delegate without `booking.manage` can change a target's hours (when allowed) but can't book, block or edit pages for them.

## Design

### Data model

**`schedule_delegations`** (migration 0125, built; tenant table; forced row level security, the standard policy; audit columns, where `created_by` is who first granted it and `updated_by` who granted its current level: the API's `grantedBy` reads `updated_by`, since a level change is a new grant by whoever made it; there is no `granted_by` column)
- `workspace_id`, `id` (uuidv7), `delegate_member_id` (uuid), `target_type` (text), `target_member_id` (uuid, nullable), `target_team_id` (uuid, nullable), `level` (text). `target_type` and `level` are text with no value check, as spec 0032 keeps `access_rules.level`, so a value from a newer deploy fails closed after a rollback; core validates both on write.
- Primary key (`workspace_id`, `id`). Foreign keys carrying `workspace_id`: delegate and target member to `members`; target team to `teams` with `on delete cascade` (added by L3a once teams exist, AC-1443; until then a team target is refused 422 `DELEGATE_INVALID`, as built).
- `granted_by_self` (boolean): true when the target granted it over themself (AC-1255).
- Checks: `num_nonnulls(target_member_id, target_team_id) <= 1`; `delegate_member_id <> target_member_id`.
- Unique (`workspace_id`, `delegate_member_id`, `target_type`, `coalesce(target_member_id, target_team_id, '00000000-0000-0000-0000-000000000000')`).
- Indexes: (`workspace_id`, `delegate_member_id`); (`workspace_id`, `target_member_id`) where not null; (`workspace_id`, `target_team_id`) where not null.
- Limits (AC-1256) checked in core under the delegate's and the target's advisory locks, taken in key order.

### The reach (`packages/core/src/access/scheduling.ts`)

- `schedulingReach(tx, scope)`: for a member principal, one query inside the caller's transaction returns, for the caller: `all` (`manage`, `view` or none) from their role's `schedule.manage` or `schedule.view` and any `everyone` delegation; and `members`, a map from member id to level, from (a) the active non guest members sharing any of the caller's teams, at the level of their `.team` permission when the role holds one, and (b) their delegations' targets (a member, or a team's active members), keeping the highest level per member. Owners and admins are left out of `all` and of team scope unless the caller holds the built in Owner or Admin role; they enter `members` only through a delegation they (or, for an admin, an owner) granted. The system principal gets `all: manage`; API keys get `all` from their scopes; form, booking and router principals get none.
- `canActFor(reach, memberId, need, what?)` (pure): yourself always; `need = 'view'` when `all` or the member's level is `view` or `manage`; `need = 'manage'` when `all` or the member's level is `manage`; with `what = 'hours'`, a level that comes only from a self granted delegation counts as `view` while the member lacks `availability.own`. The reach records, per member, whether their level came from a role, an admin's delegation or a self grant. Services still check the target is an active member of the workspace and their own permissions (AC-1252).
- Reverse reach, `managersOf(tx, memberId)`: who may see or manage this member (role holders of the everyone permissions, `.team` holders sharing a team, delegates covering them), for the "Who can see or manage your scheduling" list and "What can Priya do". Read only, for the member themself and `members.manage`.

### Services and their checks

"On yourself" is what a member needs to act on their own scheduling; "On someone else" is the reach `canActFor` must answer; "Actor also needs" is the actor's own permission when acting for someone else (AC-1275).

| Service (spec) | On yourself | On someone else | Actor also needs |
|---|---|---|---|
| `listSchedules`, `getSchedule`, `schedules.members` (0035) | `booking.manage` | See | nothing |
| `createSchedule`, `updateSchedule`, `setDefaultSchedule`, `duplicateSchedule`, `deleteSchedule`, `saveDefaultHours` (0035) | `booking.manage` and `availability.own` | Manage (not through a self granted delegation while the member lacks `availability.own`, AC-1255) | nothing |
| `createTimeBlock`, `removeTimeBlock` (0027) | `booking.manage` | Manage | `booking.manage` |
| `timeOff.*` ([time off](0037-time-off-and-roster.md)) | `booking.manage` | Manage | `booking.manage` |
| `limits.set` ([limits](0037-time-off-and-roster.md)) | `availability.own` | Manage (as for schedules) | nothing |
| `bookAsHost` with `forMemberId` (0027, 0030) | `booking.manage` | Manage | `booking.manage` |
| others' personal booking pages (0025) | owner | Manage over the owner, the page's editors, or `booking.admin` | `booking.manage` |
| `bookings.teamDay`, `members.visible` (0030) | own | See | nothing |
| `availability.teamWeek` and its writes ([roster](0037-time-off-and-roster.md)) | own | See to read, Manage to write | nothing |
| `calendar.health`, `calendar.askReconnect` ([calendars](0037-calendars.md)) | own | See, or `booking.admin` | nothing |
| rotation shares (0029) | own | See | nothing |

### Booking actions

One rule per action, for every booking (decision 12): the host and its co hosts act on their own; the page's managers (its owner and editors, and `booking.admin` for every page) act on the page's bookings; people's reach acts on the host's and co hosts' bookings. As built, `bookingAccess` (`packages/core/src/booking/seen.ts`) answers `act` for the first three columns (page editors from L2; a workspace link has no page owner) and `see` for the last.

| Action | Host or co host | Page's owner, editors, `booking.admin` | Manage over the host or a co host | See over the host or a co host |
|---|---|---|---|---|
| List it (Bookings, calendars) | yes | yes | yes | yes |
| Guest's name, page title, time, status | yes | yes | yes | yes |
| Guest's email and answers | yes | yes | yes | no |
| Cancel, reschedule | yes | yes | yes | no |
| Mark a no show | yes | yes | yes | no |
| Reassign | only with Manage over the new host (the host counts as Manage over themself) | only with Manage over both hosts | needs Manage over the new host too | no |

`hostTarget` and the bookings lists check these through two helpers beside `canActFor` (`isHostOf(booking, principal)` and `managesPageOf(booking, scope)`), the only other places allowed to compare a principal's member id (AC-1221).

### Procedures

| Procedure | Key inputs | Key outputs | Access | Key errors |
|---|---|---|---|---|
| `scheduling.delegations.list` | `memberId?` | delegations where the member is delegate or target | self; `members.manage` for anyone | 404 |
| `scheduling.delegations.grant` | `delegateMemberId`, `target: { type: 'member', memberId } \| { type: 'team', teamId } \| { type: 'everyone' }`, `level: 'view' \| 'manage'`, `mutationId` | the delegation | over yourself with `booking.manage`; otherwise `members.manage` | 403, 404, 409 `DELEGATION_LIMIT`, 422 `DELEGATE_INVALID` |
| `scheduling.delegations.revoke` | `id` | none | the target (for a delegation over themself), the delegate, or `members.manage` | 404 |
| `scheduling.summary` | `memberId` | `{ role, permissions, reach: { all, members, teams }, delegations, managers }` | self, or `members.manage` | 404 |
| `members.visible` (0030) | none | members in See reach with `canManage` | any member | none |
| `members.list` (0031, changed) | as 0031 | each row gains `scheduling` (the summary words' parts: `all`, `teamScope`, delegation targets) for holders of `members.manage`, read for the whole page in one grouped query over `schedule_delegations` and the listed members' roles | as 0031 | as 0031 |

A grant over the same delegate and target updates the level (idempotent by `mutationId`).

### The notice

- Each audited change made by someone else (actor ≠ the member) queues `scheduling.notice` with the job key `scheduling-notice:<workspace>:<actor>:<member>` to run 10 minutes after the first change (the job key keeps the first run time; later changes ride along).
- The job reads the actor's `audit_events` about that member since the first change, folds them into before and after per item (a schedule's weekly hours and overrides through spec 0035's summary helper, time off by dates, limits by numbers), drops items whose before equals after, and sends `SchedulingChangedEmail` (packages/emails, the shared footer) through the Mailer with the job's id as the idempotency key. Nothing is sent when nothing is left.
- Times print in the member's default schedule zone and their 12 or 24 hour clock.

### Screens

- **Settings › Account › Scheduling access** (spec 0026's Account group): two SettingsStack sections of rows, the "Add someone" Modal (member Select, a SegmentedControl See | Manage).
- **Members page Scheduling column**: a text cell with a Popover: From their role (read only), Delegations (rows with Remove), Add (Select "A person, A team, Everyone", then the picker, then See | Manage).
- **"What can Priya do"**: a Panel from the member's row menu, sections Role, Permissions, Scheduling reach, Managed by.
- **Availability's Viewing Select** and the read only state: spec 0035's admin view, listing members from `members.visible`.
- **The "For" picker**: a Select at the top of spec 0027's quick action card and of New meeting.
- References: Calendly's "manage availability for your users" (a user picker on the scheduling page), Cal.com's My Availability | Team Availability switch, timefix's Team page grid.

### Value sourcing

| Action | Value | Source |
|---|---|---|
| Any scheduling check | reach | `schedulingReach`: role permissions, `team_members` (spec 0031), `schedule_delegations` |
| Error for a member out of reach | `NOT_FOUND` text | the service's existing "doesn't exist" sentence; new services say "That person isn't in this workspace." (timefix's wording, the same for unknown and out of reach) |
| Error for See but not Manage | sentence | "You can see <first name>'s scheduling but not change it." with the member's name from `members.name` |
| Members page summary | words | the Manage reach in words: "Everyone" when `all`, else "Their teams" for the team scope and the delegations' names (up to two, then "and N others"), joined with commas; "Only their own" when there is none; then, when See reaches further, that in brackets ("Their teams (sees everyone)") |
| Source labels | text | "Admin" or "Owner" (built in role), "<role name> role", "shares <team> with you", "You added", "<name> added" (the grant's `updated_by`) |
| Notice lines | before and after | the audit rows' `before` and `after`, summarised by spec 0035's weekly summary helper |
| "Changed by" | name and time | the row's `updated_by` member's name and `updated_at`, shown when `updated_by` isn't the member |

### Key invariants

- Every "for someone else" decision is `canActFor`; nothing else compares member ids for scheduling.
- Reach only adds: delegations and team scopes never take away the member's own rights.
- A member outside See is absent; See without Manage is visible and refused.
- Nobody gets anything over another member's calendar connections.
- Every change to someone's scheduling is audited; every change by someone else reaches them.

### Security model

Reach is read inside the service's transaction under row level security, so it can't cross a workspace. Granting reach over others needs `members.manage` (not `schedule.manage`: a verb shouldn't be its own gate, timefix's `schema/organizations.ts` note); a member can only grant over themself. Delegates are non guests. `security-access-reviewer` on J1, J4 and J5; `state-performance-reviewer` on the reach query (J1).

### Numbers

| Value | Number | Runner up |
|---|---|---|
| Delegations one delegate may hold | 50 | 100 |
| Delegates over one member | 20 | 50 |
| Notice gathering window | 10 minutes | an email per change |

### Critical test scenarios

- A member with no reach asks `bookings.teamDay` for every member: only their column; `updateSchedule` on a colleague's schedule: `NOT_FOUND` (AC-1253, AC-1258).
- A "Sales lead" (`schedule.manage.team`) in team Sales manages a Sales member's hours, sees nobody outside Sales, and loses reach the moment the member leaves Sales (AC-1253).
- Bea delegates Manage over herself to Priya: Priya books for Bea, changes her hours; Bea gets one email for three changes made within ten minutes; Bea removes the delegation; Priya's next call answers `NOT_FOUND` and her screen reloads (AC-1255, AC-1257, AC-1264).
- An admin gives Priya Manage over everyone (timefix's switch): Priya acts on every column; removing it narrows her again (AC-1267).
- A "Doctor" role without `availability.own`: their schedule is read only; the practice manager's change reaches them by email; their own Time off still works (AC-1260).
- Reassign needs Manage over both hosts: a lead reassigning to someone outside their team is refused (table).
- Door cost unchanged with 100 delegations (AC-1259).
- A Doctor without `availability.own` grants Manage over themself to a colleague: the colleague can book and block for the Doctor but `updateSchedule` on the Doctor's schedule answers 403; an admin's delegation over the Doctor can change it (AC-1255).
- A custom role with `schedule.manage` sees and manages members but not the owner or admins; the owner's own delegation to that person works (AC-1253).
- Two grants naming the same target at once never make 21 delegates (AC-1256).
- A team membership change removes a lead's reach and their open Team week drops the person (AC-1274).
