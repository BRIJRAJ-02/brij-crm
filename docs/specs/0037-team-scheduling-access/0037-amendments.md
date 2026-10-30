# 0037 · Amendments to earlier specs

**Part of**: [index.md](index.md). **ACs**: AC-1421 to AC-1444 (new criteria the amended specs gain). **Status**: accepted with the plan, 21 October 2026; updated after the five lens review the same day; **amended 31 October 2026** to match main 298735334 (Amends 0023 rewritten for spec 0043; Amends 0029 as applied; AC-1424 withdrawn).

The amended specs' own files are not edited here. Each section says what changes, which existing criteria it replaces or widens, and when to apply it: the builder of that milestone applies it, and `/sync` records it in the amended spec's own file once built. Where this file and an amended spec disagree, this file wins. Each section's state is in [verify.md](verify.md#amendments-0037-amendmentsmd).

## Amends 0009

*Spec 0009: access model.*

**Apply with**: J1 (catalog, the `scheduling` access entry; built), L2 (the `editor` kind) and L4 (custom roles).

- The catalog (`PERMISSIONS`) gains `label`, `description`, `group` and `grant` per permission and six permissions ([0037-roles.md](0037-roles.md#the-catalog)); AC-133's pinned table grows to cover them. Owner holds all; Admin all but the five owner only ones (`workspace.delete`, `workspace.export`, `billing.manage`, `support.grant`, `security.manage`); Member `records.export`, `booking.manage`, `availability.own`. Built (J1).
- `access.manage` now also covers custom role definitions (the catalog row's description says so).
- `Principal` (member) gains `customRoleId?`; `roleAccess` takes the custom role's stored permissions kept to grant `any` (AC-1234); the door's member read left joins the custom role in the same statement (AC-149 holds, AC-1234).
- `AccessEntry` gains the kinds of the index's Access table entries: `scheduling`, `delegation` and `filtered` (built, J1) and `editor` (L2). The `router` kind is withdrawn (31 October): routing reads record facts for a team page's rules inside the booking's own transaction, so no router principal exists ([routing](0037-routing.md), AC-1377).
- `routing.learn`, `scheduling.notice` and the calendar health jobs join the named system kinds allowed to import `@crm/core/system`; `routing.assign_unbooked` runs as the form actor, never as the system.
- `audit.read`, `jobs.manage`, `members.invite` and `routing.manage` are grant `admin` (decision 2, after the security review), so the pinned table keeps them on Owner and Admin only.
- The decision line "a role never inherits from another" holds for custom roles too: a custom role is its own flat list, copied, never linked (decision 3).
- **AC-1421**: `enterAsActor` reads the member's custom role in its one query, so work a custom role holder started runs with the role as it is when the work runs (an edit between start and run applies), as AC-147 does for built in roles.
- **AC-1422**: The access table walk (AC-139) covers the new kinds: each `scheduling` service is called by a principal with no reach (expects `NOT_FOUND`) and, for Manage services, by one with See only (expects 403 `FORBIDDEN`); each `filtered` service answers a principal with no reach with an empty result.

## Amends 0023

*Spec 0023: forms, and its types and logic revision on `wip/forms-track`.*

**Apply with**: L6 (the free time check at submit) and L8 (the lead owner that waits for its meeting).

- **Decision 30 is reversed (31 October 2026).** Spec 0043 built the per form rules (AC-1601 to AC-1607, with `matchesShowWhen` and `visibleQuestions` in `packages/contracts/src/forms/show-when.ts` and `decideRoute` in core), and they stay: a form's rules are this plan's visitor rules. There is no "Hand over to routing", no `{ kind: 'routing' }` owner, no `forms.router_id` and no `form_submissions.routing_decision_id`; a submission's decision is found by `routing_decisions.submission_id`, as built.
- The booking hand off is the forms track's, unchanged (AC-1057 and AC-1058: the `fb1` token of the submission id and page id, kept in the tab's session storage), and spec 0043 already lets a page accept the page a rule chose.
- The form's owner setting stays `owner_member_id` or `owner_rotation_id` (migration 0089). L8 adds one behaviour: when the owner rotation is one the booked team page uses, the owner waits for the booking ([routing](0037-routing.md), AC-1372), and such a form writes its decision row even with no rules.
- The new submission notice to the lead's owner (`notify.ts`, reason `lead`) goes when a waiting owner is assigned, not at submit (AC-1391); the listed members are told at submit as today.
- **AC-1423**: `pickLeadOwner` stays the one place a form lead gets an owner from a rotation: the unbooked job of AC-1372 calls it as the submission's form actor, so caps, time off, returning `owner` and the "keep an existing owner" rule (AC-567) apply unchanged; routing never writes the owner attribute itself, and a source scan finds no write to it under `packages/core/src/routing/`. The submission's panel keeps spec 0043's "Rule 2, Enterprise: Qualified, sent to …" and adds "Owner: waiting for the booking" while a claim is open.
- **AC-1424**: *Withdrawn 31 October 2026*: the team link is an ordinary form made by the Team link starter ([routing](0037-routing.md), AC-1353); its questions are edited in the form editor like any other form's, so there is no generated form, badge or `router_id`.

## Amends 0024

*Spec 0024: calendar sync, milestones 4 and 5.*

**Apply with**: J3 and J8 (built: 7b97c5a9e, d89c38449, migration 0134).

- M5 adds the status only read `calendar.health` (AC-1307) beside the per calendar statuses it already builds.
- `calendar_connections.health_broken_at`, `health_notified_at` and `health_reminded_at` (timestamps, nullable, kept by a trigger on the connection's status): the episode's start, and when its first email and its one reminder went, all cleared when the connection is connected again (AC-1310); a cron task `crm_cron_calendar_health` and the definer function `crm_calendar_health_candidates()` (ids and counts only, across workspaces, for the worker login) drive them ([calendars](0037-calendars.md)). The sweep asks for every 15 minutes and runs at the deployment's job drain (hourly on `brij-crm`); its window is the last hour (AC-1311).
- The follow up "Notices and email for a disconnected calendar once #28 lands" is met by email; the sync no longer emails inline.
- AC-997's team page sentence widens: with fixed hosts, the event is on the first fixed host's destination, else the first rotation's host's (AC-1313).
- **AC-1425**: No calendar procedure or read that one member can call about another answers an account email, calendar name, provider error text or event field; a test calls each with a colleague's id and checks the payload.

## Amends 0025

*Spec 0025: booking pages.*

**Apply with**: J4 (reach, built), J11 (team pages, built), L1 and L2 (colleagues' pages, editors), L6, L8 and L9 (routing).

- AC-640 widens to the Booking actions table in [0037-scheduling-access.md](0037-scheduling-access.md): the host and co hosts, Manage over the host or a co host, and the page's managers (owner, editors, `booking.admin`) list, see guest details, cancel, reschedule and mark no shows; reassigning needs Manage over both hosts. Built (J4), editors in L2.
- AC-645 widens: Captures › Links also shows pages of people the caller Manages (decision 13) and pages they edit, labelled (AC-1273, AC-1332).
- The `bookingPages` access entry becomes: own pages, pages of people the reader Manages, pages they edit, or all with `booking.admin` (AC-1332).
- AC-627's collective pages are unchanged; a round robin page keeps its fixed hosts in `booking_page_members` (AC-1319).
- The public page's slots request carries the stored hand off token: built by spec 0043 (AC-1609), the one invisible change to the frozen `/b/:key`. A team page with Only through a form on (off by default, AC-1388) answers without a valid hand off with its existing unavailable state.
- **AC-1426**: No show uses `bookings.no_show_at` and `no_show_by_member_id` (migration 0074, AC-1367); a booking's routing decisions are found through `routing_decisions.booking_id` (the form's row filled at booking, the team page's row written with it), so `bookings` gains no `routing_decision_id`. Bookings › List shows "No show" (built) and can filter by it (L9); marking one changes nothing else about the booking.
- **AC-1427**: The routed booking uses the forms track's `fb1` hand off unchanged (no new token field, no version bump): the server finds the decision by `routing_decisions (workspace_id, submission_id)` and fills its `booking_id` (built, spec 0043); in L8 the booking also claims the form's decision in its transaction when the lead's owner waits for it (AC-1372), setting `assigned_member_id` and `assigned_at` on winning. Booking refuses a hand off past its expiry.

## Amends 0026

*Spec 0026: settings area.*

**Apply with**: the jobs that add each page.

- Account gains **Scheduling access** after Calendars (built). Workspace has **Members**, **Teams** and **Roles** (specs 0031 and 0032). Settings has no Scheduling group any more (owner, 26 October 2026): scheduling screens are Bookings tabs (AC-1447: Calendar, List, Roster, Availability, Round robin, Routing, Calendars), and booking pages and forms are Captures › Links and Captures › Forms. Old settings addresses redirect, keeping their search. Pages and tabs a member can't use are left out (spec 0031 AC-832's rule).

## Amends 0029

*Spec 0029: round robin. Applied: the round robin lane built spec 0029 with these amendments (migration 0058 onward), and the workspace link added `rotations.follows` and the `rotation_roster` view (0128).*

**Apply with**: J11 (built), L2 (editors, the race test) and L3b (`follows = 'team'`). Built: `booking_page_rotations` (positions 0 to 2), `units` with the adjustment check, the live row unique per booking and rotation, `returning` in place of `owner_first`, `even` with `even_gap`, the new ledger reasons, `rotation_members.weekly_cap`, the lock set with stand ins, and reach checks on `canActFor`. Not built, and replaced: `rotations.team_id` becomes `follows = 'team'` with `follows_team_id` (L3b, AC-1327).

- **Tables**: the page's rotation is a row of `booking_page_rotations` (position 0) instead of `booking_pages.rotation_id`; `rotations.returning` (`owner` | `last_host` | `none`, default `owner`); `rotations.strategy` admits `even` with `even_gap`; `rotations.follows` (`everyone` built; `team` with `follows_team_id` in L3b), read through `rotation_roster`; `rotation_members.weekly_cap`; `rotation_assignments.units`, the new reasons and source, and the live row unique per (`booking_id`, `rotation_id`) ([0037-round-robin.md](0037-round-robin.md#data-model)).
- **AC-729** narrows: only active **non guest** members can be in a rotation (the roster view already reads owner, admin and member roles only; P2 adds the refusal).
- **AC-731** widens: members away (AC-1283), at a meeting limit (AC-1298) or at a weekly cap (AC-1326) are skipped too.
- **AC-738, AC-740, AC-741** change how locks are taken, as built: every rotation lock in id order, then the host lock of every fixed host, every free candidate, any kept host, and the stand in of an away owner or last host, one key at a time in id order; then recheck and pick. There is no restart: a stand in who isn't in the set is never seated, and the seat picks from its rotation as usual (AC-1321). Spec 0029's "lock the next candidate after a failed recheck" took host locks out of id order; taking them all up front in order can't deadlock, at the cost of one lock per free candidate for a moment (up to 67 with stored rotations; more on a rotation that follows a large team or the workspace).
- **AC-739** widens: an away owner's free stand in takes the booking (AC-1284), and "Returning guests go to" adds the last host (AC-1328).
- **AC-742** adds the reasons `even`, `last_host`, `standin`, `routed` and `adjustment`.
- **AC-733** is replaced by the owner approved design (21 October 2026): a team page's rail shows the AvatarStack (up to 4 faces of the page's own hosts plus "+N") and the line "<page title> with <workspace name>"; the host's name appears only on the confirmation; personal pages are unchanged (AC-1339).
- **AC-748** and spec 0030's **AC-777**: reassigning needs Manage over the current host and the new host (AC-1337).
- **AC-751**: rotation editors may change a rotation too (AC-1331); creating and deleting still need `booking.admin`.
- **AC-752** and **AC-753** widen: shares and round robin bookings are visible to See reach and editors as well (AC-1262, AC-1330).
- **AC-1428**: The page builder stores the rotation of a round robin page as `booking_page_rotations` position 0, and the slots and booking code read the page's rotations from that table only (a test fails on any read of `booking_pages.rotation_id`).
- **AC-1429**: `rotations.returning` replaces `owner_first` with the same default behaviour (`owner`); `none` is spec 0029's "rotation only".
- **AC-1430**: The ledger's window count is the sum of live `units`; assignments write 1; one live row per booking and rotation.
- **AC-1431**: Under 30 parallel bookings across two round robin pages sharing members, where an away owner's stand in is a candidate on the other page, no deadlock error (40P01) occurs and every recheck holds (the lock set of AC-1321); L3b runs it again with a 50 member rotation that follows a team.
- **AC-1432**: Adding a guest to a rotation answers 422 `MEMBER_INVALID` ("Guests can't take bookings."); a member who becomes a guest leaves every stored rotation in that role change's transaction, with spec 0029 AC-750's reassign offer, and drops out of every following rotation by the roster view's role filter. Lands with the guest role (P2).
- **AC-1433**: Rotations live at Bookings › Round robin (owner, 26 October 2026; `settings/scheduling/rotations` and `settings/scheduling/round-robin` redirect there), and the rotation screen's Members, Distribution and Sharing tabs follow [0037-round-robin.md](0037-round-robin.md); Sharing arrives with editors (L2).

## Amends 0030

*Spec 0030: team calendar, before its build.*

**Apply with**: J12.

- **AC-767, AC-768** and the column list: reach as below; the Team day's health chips follow AC-1307.
- **AC-768** is replaced: Team shows the members in the caller's See reach (role permissions and delegations, [0037-scheduling-access.md](0037-scheduling-access.md)); `schedule.manage` and `schedule.manage.team` land in the catalog with J1, beside `schedule.view` and `schedule.view.team`. **AC-769** holds with `members.visible` as the filter.
- **AC-771** and **AC-772**: guest emails, answers and block labels show to Manage over the member (and the host, the page's owner and editors, and `booking.admin` for bookings), not to `schedule.manage` holders only.
- **AC-773 to AC-777**: actions on a teammate's column need Manage over them (and over the new host for reassign).
- **AC-767**: shares show to `booking.admin`, the rotation's editors, the member, and See reach.
- **AC-1434**: The Team day's columns, the week's member picker and the List's Host filter are fed by `members.visible`, so a member with a delegation over two people sees exactly those two beside themself.
- **AC-1435**: For people with Manage over at least one member or `booking.admin`, a "Needs a host" lane pinned at the left lists that day's bookings flagged by spec 0029 AC-749 or showing "Host away" (AC-1285), each with Reassign (timefix's driver calendar "Unassigned" column).
- **AC-1436**: The Team day's header counts the day's issues among the visible columns: bookings outside their host's hours and clashes (two confirmed items of one host overlapping), as "2 outside hours · 1 clash", each opening a list; derived on read, with nothing stored (timefix's `findTeamIssues`, `packages/core/src/team-grid.ts`).
- **AC-1437**: Time off shows as the Away band and the "Away" header status (AC-1287); No show marks (AC-1367, built) show on the Team day's bookings.
- **AC-1438**: The Team day and the Roster can order columns or rows by job title (AC-1441, from L3a; until then by name only), then by name, besides the default "me first, then by name".

## Amends 0031

*Spec 0031: workspaces, members and teams, for the members lane.*

**Apply with**: AC-1439 and AC-1440 are built (slices 3 and 5); slice 8 (teams) is lane P1 on `wip/crm-teams` and slice 9 (guests) lane P2; L3a owns AC-1441 and AC-1443; L3b owns AC-1442.

- **AC-803, AC-811** widen: invitations and the role Select include custom roles (AC-1236, AC-1242).
- **AC-814, AC-815** widen: the removal also removes the member from rotations (spec 0029's `rotation_members`, with AC-749's reassignment), deletes their delegations both ways (AC-1269), their time off and limits, their member skills, their editor rows, and their managed pages' member pages (AC-1335); "booking_page_members" in AC-814 means collective pages' required members.
- **AC-806** widens: accepting rechecks the sender's current role and the named custom role (AC-1236).
- Team membership changes, team deletion and a role change to Guest store `access` rows naming every member whose scheduling reach changed (AC-1274).
- **AC-826** widens: a team can't be deleted while a rotation (`follows_team_id`) or a managed page follows it (409 `TEAM_IN_USE`, naming them); delegations to it are deleted with it.
- **AC-1439**: The role Select of the Invite dialog, the Members page, the invite link and join approvals is fed by `roles.list` (built in and custom roles, with the default for new people), not by a constant list of roles.
- **AC-1440**: The removal's effects run as one hook per feature inside the removal transaction (booking pages, calendars, rotations, delegations, time off and limits, skills, editors, managed pages), each owned by its feature's module, and a test fails when a table with a `member_id` foreign key has no hook or a written reason to keep the rows.
- **AC-1441**: Members gain a job title (Account › Profile and the Members page, 0 to 60 characters, `members.job_title`), a label shown on the Members page, the Team day and the Team week, never read by any access check (timefix's `organization_members.job_title`).
- **AC-1442** (amended 31 October 2026): A team change needs no rotation write but one: a rotation that follows the team reads its members through `rotation_roster` on every read, so a joiner is bookable at once (switched on, weight 100, at the pool's average count; switched off with spec 0029's warning badge when they have neither hours nor a calendar) and a leaver never; nothing refuses a team growing (no 20 member cap on a following rotation). Leaving the team deletes the leaver's stored settings for every rotation following it, in the membership change's transaction (one statement), so rejoining starts afresh. A following rotation left with fewer than 2 members offers no times and its screen says "Needs 2 people" (AC-1327).
- **AC-1443**: `schedule_delegations.target_team_id` (migration 0125, no foreign key yet, "there is no `teams` table yet") gains its foreign key to `teams` (`on delete cascade`, added `NOT VALID` and validated later) in L3a's migration once P1 has landed; team delegations answer 422 `DELEGATE_INVALID` until then, as built.

## Amends 0032

*Spec 0032: access rules.*

**Apply with**: J10, which ships in the same release as spec 0032's milestone 1 and backfills every custom role made before with its Start from role's rules (decision 3, AC-1230).

- **AC-842** widens: a subject may be a custom role (`subject_custom_role_id`); owner and admin stay refused.
- **AC-844**: a custom role holder's role view is their custom role's rules with Member's default (`write`), never the Member role's rules; teams still grant on top.
- **AC-856, AC-858**: the Access tab lists custom roles as subjects; Preview as works for their holders (AC-1230).
- **AC-857**: Workspace › Roles becomes editable for custom roles (AC-1239 to AC-1241); built in roles stay read only.

## Amends 0035

*Spec 0035: availability schedules. Built, with this section applied: J4 swapped reach into `mayChange` and `schedules.members` and made the after change seam async (46ae99c70); J6 added the 400 override limit and the pruning (63d26d7c5).*

**Apply with**: J4 and J6 (both built).

- **AC-971** is replaced: a member with See over a colleague reads their schedules, and with Manage changes them ([0037-scheduling-access.md](0037-scheduling-access.md)); `booking.admin` alone no longer grants it (owners and admins hold `schedule.manage`, so nothing changes for them).
- Writes to one's own schedules need `availability.own` besides `booking.manage` (AC-1260).
- The Viewing Select lists the members from `members.visible` (AC-1268).
- Date overrides keep several ranges per date; the Roster writes them (AC-1291). A schedule gets its own override limit of 400 (`SCHEDULE_OVERRIDES_MAX`; a page keeps `BOOKING_OVERRIDES_MAX`, 120), and every schedule write drops overrides dated more than 8 weeks ago (AC-1293); a full schedule answers 422 `CONFIG_INVALID`.
- **AC-1444**: Every schedule write (create, update, set default, duplicate, delete, the default hours save) goes through one internal function (`writeSchedules`) whose after change seam (`afterScheduleChange`) becomes async and is awaited inside the write's transaction, writing the `schedule.changed` audit row with before and after summaries and, when the actor isn't the schedule's member, queueing the notice (AC-1263, AC-1264); a source scan finds no other write to `availability_schedules`.
