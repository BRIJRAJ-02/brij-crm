# 0037. Team scheduling and access: roles, availability set by others, every member's calendars, round robin and routing

**Date**: 2026-10-21 (amended 2026-10-31)
**Status**: Accepted (21 October 2026: all 31 decisions, then updated after the five lens review the same day). **Amended 31 October 2026** to match what main built (main 298735334) and to settle routing against spec 0043; the owner delegated these product and design calls on 21 October ("do it yourself"). Jobs J1 to J8, J11 and most of J13 are built; the rest are queued as lanes L1 to L10 below.
**Numbering**: the coordinator reserved AC-1221 to AC-1450 for this plan. Each child owns a block (table below); the numbers a block doesn't use are that child's spare. The 31 October amendment adds AC-1301, AC-1302, AC-1393 and AC-1447 from their blocks' spares and withdraws AC-1371, AC-1390 and AC-1424 (withdrawn numbers are never reused).
**Scope**: follow ups of #23 and #24 (custom roles, scheduling access), #58 round robin assignment (routing, rebalancing, assignment that learns), #59 booking pages (team hosts, managed pages), #44 calendar sync (calendar health for teams), polish F2 (the team calendar).
**Builds on** (decided, not redone here): [0009](../0009-access-model/index.md) access model, [0023](../0023-forms/index.md) forms, [0024](../0024-calendar-sync/index.md) calendar sync with M4 and M5, [0025](../0025-booking-pages/index.md) booking pages, [0029](../0029-round-robin-booking/index.md) round robin, [0030](../0030-team-calendar/index.md) team calendar, [0031](../0031-workspaces-members-teams/index.md) members and teams, [0032](../0032-access-rules/index.md) access rules, [0035](../0035-availability-schedules/index.md) availability schedules, [0043](../0043-lead-routing/index.md) lead routing (rules per form and per team page), [0057](../0057-booking-page-questions.md) a booking page's own questions, and the workspace link (migration 0128).

## What changed on 31 October 2026

The plan was accepted on 21 October and built in pieces while it sat on its own branch. Meanwhile spec 0043 shipped routing rules per form and per team page, and the owner moved scheduling screens into Bookings. This amendment brings the plan in line, and decides what was left open. Each change is recorded where it applies, and argued in [rationale.md](rationale.md#amendments-of-31-october-2026).

1. **Routing builds on spec 0043, nothing migrates.** Rules stay per surface (a form's rules choose the next step, a team page's rules choose hosts); a Bookings › Routing tab holds only what every surface shares. Decisions 23, 24, 29 and 30 change. The routing child is rewritten ([0037-routing.md](0037-routing.md)); J16a to J18 now extend `routing_decisions` and build L6 to L9.
2. **No show is as built**: markable from the start with no end, audited `booking.no_show` and `booking.no_show_undone` (decision 28, AC-1367).
3. **A form lead's owner** stays the form's owner setting (`forms.owner_rotation_id`, `pickLeadOwner`), and follows its meeting when both share a rotation (AC-1372, AC-1423).
4. **Where things live**: Bookings tabs (Calendar, List, Roster, Availability, Round robin, Routing, Calendars); Settings keeps only account and workspace pages (AC-1447).
5. **Naming**: "Settings › Booking pages" is Captures › Links (AC-1273, AC-1332).
6. **Five owner only permissions**, with `security.manage` from spec 0033 (AC-1227).
7. **API keys never hold the four `schedule.*` permissions** (AC-1245).
8. **Locks are taken one key at a time in id order, with no restart**; a stand in outside the lock set is never seated (AC-1321).
9. **Rotations follow a team the way the everyone rotation follows the workspace** (`rotations.follows`, resolved on read by `rotation_roster`), with no 20 member cap (AC-1327, AC-1442).
10. **The workspace link and the team link are one story** (AC-1357).
11. **The calendar health sweep's window is one hour** (AC-1311).
12. **As built**: a delegation's granter is its `updated_by`; co hosts act on a booking; the 400 override limit landed in J6 (with `CONFIG_INVALID`).
13. **Guests (spec 0031 slice 9) come before custom roles**: P2 before L4.
14. **Built beyond the plan**: the Roster's link coverage line (AC-1301), the meeting limits warning in New meeting (AC-1302), health chips on the Roster, Round robin and Members, "Meetings a day" and "Meetings a week" wording, and a sidebar without Roster, Notes or Favourites.

## The children

Each child is a flat file beside this one with its own design and acceptance criteria. Where a child and this file differ, the child wins for its subject; the owner decisions below win over both.

| File | Subject | Block | Used |
|---|---|---|---|
| this file | Cross cutting criteria | AC-1221 to AC-1225, AC-1445 to AC-1450 | AC-1221 to AC-1225, AC-1445 to AC-1447 |
| [0037-roles.md](0037-roles.md) | Custom roles built from the permission catalog, the catalog's new permissions and grant levels, the Roles screen | AC-1226 to AC-1250 | AC-1226 to AC-1248 |
| [0037-scheduling-access.md](0037-scheduling-access.md) | Who may see and set whose scheduling: See and Manage, reach from roles and delegations, availability managed by others, audit and the member being told | AC-1251 to AC-1280 | AC-1251 to AC-1275 |
| [0037-time-off-and-roster.md](0037-time-off-and-roster.md) | Time off with a stand in, the Roster (the Team week, timefix's roster), meeting limits per person | AC-1281 to AC-1305 | AC-1281 to AC-1302 |
| [0037-calendars.md](0037-calendars.md) | Each member's own calendars on a team: what others see, health, how spec 0024 M4 and M5 feed round robin and the team calendar | AC-1306 to AC-1318 | AC-1306 to AC-1315 |
| [0037-round-robin.md](0037-round-robin.md) | Round robin at timefix parity and beyond: fixed hosts plus several rotations, Even, weekly caps, rotations that follow a team, returning guests, rebalancing, editors, managed pages | AC-1319 to AC-1350 | AC-1319 to AC-1341 |
| [0037-routing.md](0037-routing.md) | Two doors for sales calls (the workspace link and a team link), rules per surface, smart ranking that learns from outcomes, lead owners that follow their meeting | AC-1351 to AC-1420 | AC-1351 to AC-1393 (AC-1371 and AC-1390 withdrawn) |
| [0037-amendments.md](0037-amendments.md) | "Amends 00XX" sections for specs 0009, 0023, 0024, 0025, 0026, 0029, 0030, 0031, 0032 and 0035 | AC-1421 to AC-1444 | all (AC-1424 withdrawn) |

Reasoning and options: [rationale.md](rationale.md). Verification plan, the AC map with each criterion's state, and the self check: [verify.md](verify.md).

## Summary

A workspace becomes a real team for scheduling and for access. Admins can build **custom roles** from the permission list (a "Sales lead" who sees the team's calendars, a "Doctor" whose hours the practice manager sets), while Owner, Admin, Member and Guest stay as fixed built in roles (Guest arrives with spec 0031 slice 9, before custom roles). **Scheduling access** gets two levels, See and Manage, over three reaches (their teams, everyone, chosen people), coming from the role or from a per person **delegation**, so an assistant, a receptionist or a team lead can set someone's hours, time off and bookings; every such change is audited and the member is told. Each member keeps **their own calendars**: others only ever see Busy times and a health status, and nobody can change another person's calendar. **Time off** with a stand in, a **Roster** of the team's week and **meeting limits** per person feed round robin. **Round robin** grows past spec 0029 to fixed hosts plus up to three rotations, an Even strategy, rotations that follow a team, returning guests, count adjustments and page editors. Finally, **routing** builds on spec 0043's rules per surface: the team books through the **workspace link**, or through a **team link** form whose rules pick the meeting type; a team page's own rules pick among hosts by what the CRM knows; and inside the allowed hosts the free reps are ranked by fit and, once there is enough data, by their track record with similar leads, always inside a fairness allowance, with every assignment explained and every decision in one place.

Nothing here adds a second access door. Roles still come from the door's one tenant round trip; who may act on whose time is answered by one pure function at the scheduling choke point; everything unknown grants nothing.

## The owner's asks (21 October 2026, verbatim)

1. "Also add and make a plan for multi user with their calendars and a whole roundrobin system with their availability being set either by admin or someone else. like we currently have in timefix. also the whole role based users and all. with access levels. the best and advance system"
2. Added the same day: "also roundrobin for whole sales setup calls. where a meeting is booked on team link and anyone of team is assigned based on the qualification and type? can this be smart and also trained so it's a one format"

### What "like we currently have in timefix" covers

Studied read only (paths are inside the timefix repository; details in [rationale.md](rationale.md)):

- **Roles**: four flat roles over fifteen permissions (`packages/core/src/org.ts`), plus one permission that moves without the role: `organization_members.schedule_access`, the "Sees all calendars" switch on the Team page, which grants `schedule.manage` ("may see and set other people's time") and can only add (`packages/core/src/authz.ts`, `may()`).
- **Availability set by someone else**: the team calendar books, sets hours and closes time on a colleague's column after three checks (`timefixapp/src/lib/team-write.ts`, `resolveTarget`); a roster edits people's weeks; every change of hours is logged and, when a non admin changed a colleague's week, the admins are emailed (`packages/core/src/schedule-log.ts`, `noteHoursChange`).
- **Calendars**: each member connects their own Google calendars and picks which count as busy; a broken grant emails the member once per episode (`packages/core/src/calendar-health.ts`).
- **Round robin**: **timefix never built it.** Publicly one link is one person (`docs/access-and-mapping.md` §1; `docs/qa-plan.md` records round robin, collective meetings and team members as not existing). It had a written routing design (`docs/care-programmes-and-routing.md`: sticky, balanced, weighted, collective, a fallback ladder and a decision log) and a rule that assignment stays deterministic with no AI in the booking path (`docs/scheduling-agents.md` §3). It also built and then deleted lead scoring because nobody ever configured its rules (`FEATURES.md`, CRM settings, 3 September 2026). This plan takes the parity target for round robin from that design and from the best tools, and takes those two lessons as constraints.

## Owner decisions

The owner accepted all 31 recommendations on 21 October 2026, and approved the team page AvatarStack the same day (up to 4 faces plus "+N", the line "Intro call with Acme", the host's name only on the confirmation, personal pages unchanged). A five lens review (security, feasibility, product, completeness, routing) followed; where a fix changed what a decision means, the decision says so under **Changed after review**. On 31 October 2026 the plan was amended to match main; where that changed a decision, it says so under **Amended 31 October 2026** (decided under the owner's delegation of 21 October). Runners up stay for the record.

**Roles and access**

1. **Custom roles.** Accepted (21 Oct 2026): admins build roles from the permission list; Owner, Admin, Member and Guest stay fixed and can't be edited. Runner up: no custom roles, only timefix style per person switches. **Changed after review**: a custom role can also be Read only (a "Viewer" preset), which timefix had. **Amended 31 October 2026**: the guest role isn't built yet; spec 0031 slice 9 (lane P2) lands before custom roles (lane L4), so Guest is a built in role from the first Roles screen.
2. **What a custom role may hold.** Accepted (21 Oct 2026): any permission except the owner only ones and those that decide who gets in or where data goes. Runner up: anything an admin holds. **Changed after review**: for security, inviting people, managing everyone's background jobs, reading the audit log and setting up routing are admin only too, so only owners and admins invite, and an invitation is rechecked against its sender when accepted. **Amended 31 October 2026**: there are five owner only permissions now (spec 0033 added `security.manage`), and `comments.manage` (spec 0038) joined the catalog at grant `any`.
3. **A new custom role's data access.** Accepted (21 Oct 2026): copied once from Member (or from a chosen custom role) when the role is made, then independent. Runner up: it keeps following the Member role's rules as they change. **Changed after review** (clarified): the copy ships with its backfill, in the same release as the access rules themselves (spec 0032's first milestone), so no custom role misses a Member rule that existed when rules began.
4. **Extra permissions for one person on top of their role.** Accepted (21 Oct 2026): no; one role per person, with scheduling access per person (decision 8) as the one exception, as timefix's switch was. Runner up: per person extra permissions, like Salesforce permission sets.
5. **Team managers.** Accepted (21 Oct 2026): no manager flag; "their teams" means the teams a person is in, given through a role, which keeps spec 0031's flat teams. Runner up: a manager flag on each team membership.
6. **Sharing one record with a person or team beyond the rules.** Accepted (21 Oct 2026): not now; it adds a second check to every record read at a million records, and spec 0032 decided records outside a rule are absent. Runner up: build it now.

**Who can see and set whose scheduling**

7. **Levels and reach.** Accepted (21 Oct 2026): two levels, See and Manage; reach from the role (their teams, or everyone) and from delegations (a person, a team, or everyone); owners and admins manage everyone; Members see and manage only themselves. Runner up: one level, as spec 0030 has it. **Changed after review**: reach from a custom role or a team never covers owners and admins; an owner's or admin's scheduling is reached only through the built in Owner or Admin role or a delegation they granted themself. **Amended 31 October 2026** (as built): API keys never hold any of the four `schedule.*` permissions, so a key never reaches anyone's time.
8. **Scheduling access for one person without changing their role** (timefix's "Sees all calendars"). Accepted (21 Oct 2026): admins give any member See or Manage over a person, a team or everyone from the Members page. Runner up: only through roles.
9. **Members choosing their own assistant.** Accepted (21 Oct 2026): any member can let a colleague see or manage their own scheduling, and take it back. Runner up: admins only. **Changed after review**: a member whose hours are set by others (no "Change your own hours") can't pass the right to change those hours to a colleague; their assistant can still book, block and manage their meetings.
10. **Who sets a member's hours.** Accepted (21 Oct 2026): by default the member and anyone who manages them; a role without "Change your own hours" makes hours managed by others. Runner up: one workspace switch, "Only managers set hours".
11. **Telling the member.** Accepted (21 Oct 2026): the member gets an email whenever someone else changes their hours, time off or limits (changes within 10 minutes in one email), and the inbox notice once spec 0038 exists; every change is in the audit log. Runner up: also email the admins, as timefix does. **Changed after review** (widened): edits to their personal booking pages and being added to or removed from a rotation are told the same way. **Amended 31 October 2026**: the inbox exists now, so the inbox notice is owed (lane L1).
12. **`booking.admin` and `schedule.manage`, settled.** Accepted (21 Oct 2026): `booking.admin` is for things (every booking page, team pages, rotations), `schedule.*` for people's time (hours, time off, their bookings, reassigning). Runner up: one permission for both. Clarified after review in the Booking actions table: a page's managers (its owner, editors and `booking.admin`) list and act on that page's bookings; reassigning always needs Manage over both hosts. **Amended 31 October 2026** (as built): a booking's co hosts act on it as its host does.
13. **Managers and personal booking pages.** Accepted (21 Oct 2026): Manage reach also lets you edit that person's personal booking pages. Runner up: other people's pages only with `booking.admin`. **Changed after review**: except "Add events to", which stays the owner's, so nobody sees or changes another person's calendars (decision 14).

**Each member's calendars**

14. **What others see of a member's calendars.** Accepted (21 Oct 2026): Busy times and a health status, only for members they may see; never calendar names, account emails or event details; nobody changes another person's calendars. Runner up: admins also see account emails.
15. **Calendar health emails.** Accepted (21 Oct 2026): one email per broken episode, one reminder a week later if still broken, held back during a mass outage; managers can press "Ask to reconnect". Runner up: the in app banner only. **Amended 31 October 2026**: the sweep's window is one hour (it counts the last hour's breaks), so its rules hold whether a deployment drains jobs every 15 minutes or every hour; no setting per deployment.

**Time off, the team week and limits**

16. **Time off.** Accepted (21 Oct 2026): whole days with a reason, a note and an optional stand in; round robin, owner first and routing skip them and the stand in covers; meetings already booked are flagged for reassignment; the frozen public page shows no times. Runner up: send visitors of a personal page to the stand in.
17. **Team week (timefix's roster).** Accepted (21 Oct 2026): Availability gets a Team week that edits each person's default schedule, with "Copy to next week" and "Set usual hours for several people". Runner up: dated week schedules in their own table. **Changed after review**: it looks back 8 weeks, not without limit, because old overrides are cleared so a schedule never fills up. **Amended 31 October 2026**: it is called the Roster and becomes its own Bookings tab (the owner, 31 October; built by the roster editor lane); its footer also counts whom the workspace link can book each day.
18. **Meeting limits per person across every page.** Accepted (21 Oct 2026): a cap per day and per week. Runner up: only spec 0029's per rotation daily cap. **Amended 31 October 2026** (as built): they read "Meetings a day" and "Meetings a week" everywhere, and New meeting warns, without blocking, before booking someone in past one.

**Round robin**

19. **Team pages with fixed hosts and several rotations.** Accepted (21 Oct 2026): up to 7 fixed hosts plus up to 3 rotations, one host from each. Runner up: fixed hosts plus one rotation.
20. **More round robin controls.** Accepted (21 Oct 2026): Even, weekly caps, rotations that follow a team, returning guests to the host they met last, count adjustments with a note, a distribution report. Runner up: only the weekly cap and the report. **Amended 31 October 2026**: a rotation follows a team the way the everyone rotation follows the workspace (`rotations.follows`, its members resolved on read through the `rotation_roster` view), so nothing is copied on team changes and the 20 member cap doesn't apply to it. Runner up: stored members kept in step on every team change, capped at 20 (the original plan).
21. **Page and rotation editors.** Accepted (21 Oct 2026): a booking page or rotation can name editors, so a team lead runs their team's page and rotation without being an admin. Runner up: `booking.admin` only. **Changed after review**: an editor can add as a host only people whose scheduling they manage (admins anyone), and editing a rotation alone doesn't show members' calendar health.
22. **Managed booking pages.** Accepted (21 Oct 2026): in this plan as its last, optional job. Runner up: its own later spec.

**Routing ([0037-routing.md](0037-routing.md))**

23. **What "one format" means.** Accepted (21 Oct 2026): one routing setup for the whole workspace, used by the team link and every form that hands over to it. Runner up: one routing setup per team link. **Amended 31 October 2026**: one rule format (spec 0043's), kept on each surface: a form's rules choose the next step, a team page's rules choose hosts. What all surfaces share (skills, the smart ranking and its learning, Insights, Test, one Decisions log) lives in one Bookings › Routing tab. Nothing migrates. Runner up: migrate every form's and page's rules into one workspace setup.
24. **The team link while `/b/:key` is frozen.** Accepted (21 Oct 2026): the team link is a routing form at `/f/:key` that asks the questions, then opens the chosen meeting type's booking page showing only the chosen pool's times. Runner up: unfreeze `/b/:key`. **Changed after review**: the booking page gets one invisible code change (its slots request carries the forms track's hand off token); and a page listed as a meeting type is bookable only through the team link by default. **Amended 31 October 2026**: two doors, one story. The workspace link is the team's booking page; a team link is an ordinary form (made in one step from Captures › Links) whose rules book team pages. The slots token change is built (spec 0043). "Only through a form" is a per page switch, off by default, so no page changes behaviour by itself.
25. **What decides and what ranks.** Accepted (21 Oct 2026): rules first choose the pool; inside it, free reps are ranked by fit, then by learned record, within a fairness allowance (default 20 percent, admins 0 to 50). Runner up: rules plus a plain fair rotation. **Changed after review**: rules that read what the CRM knows can only choose who hosts, never whether the visitor gets a meeting or which page; the allowance never drops below one meeting, and the Smart tab states the real bound. **Amended 31 October 2026**: the split is by surface (a form's rules can't read the CRM; a team page's rules only choose hosts), and the ranking runs at every team page booking, so the workspace link learns too.
26. **How it learns.** Accepted (21 Oct 2026): from this workspace's own outcomes only, nightly, switching on for a segment after 100 finished meetings, never personal traits, never across workspaces. Runner up: a shared model across workspaces. **Changed after review**: the default goal is Deals created, a rep's record counts only as a lift over the team's rate, and 10 percent of picks stay plain fair as a holdout. **Amended 31 October 2026**: cells are per team page; segments come from up to two Companies or Deals attributes.
27. **An AI step.** Accepted (21 Oct 2026): no AI call while a visitor waits; later, after #54, an optional background classifier. Runner up: an AI step at submit with a 1.5 second limit.
28. **Marking no shows.** Accepted (21 Oct 2026): the host and their managers mark No show from 15 minutes after the start to 7 days after; unmarked meetings count as held. Runner up: learn from deals only. **Changed after review**: Held is decided only when the 7 day marking window closes, and Insights shows each rep's marking rate beside the team's. **Amended 31 October 2026** (as built by spec 0043 and J4): anyone who may act on the booking marks it from its start, with no end; Held is counted 7 days after the meeting and a later mark changes it at the next nightly run.
29. **Leads that don't book.** Accepted (21 Oct 2026): the same routing assigns owners to form leads. **Changed after review**: an owner at once when nobody has time, "New lead for you", and a Last resort owner. **Amended 31 October 2026**: a form lead's owner is the form's owner setting (a member, or a rotation through `pickLeadOwner`, migration 0089). When the form's rotation is one the booked team page uses, the owner waits for the booking (the host becomes the owner, one count), else 24 hours, then `pickLeadOwner`. There is no Last resort owner (the form's notify list catches unowned leads) and no separate email (spec 0023's submission notice is it).
30. **Forms' own routing rules.** Accepted (21 Oct 2026): replaced by "Hand over to routing". Runner up: keep per form rules beside the routing setup. **Amended 31 October 2026: reversed.** Spec 0043 built per form rules and they stay; there is no "Hand over to routing".

**Numbers**

31. **The numbers and small calls.** Accepted (21 Oct 2026) as listed in each child's Numbers table, the tables below and rationale.md's calls. Changed values after review are in decisions 17, 25, 26, 28 and 29 above, plus: unbooked lead job 5 minutes after the 24 hour hand off, a schedule holds 400 date overrides, a Roster cell takes 6 ranges (was 4), and the calendar health email count is exactly two per episode. **Amended 31 October 2026**: rules are 20 per surface (spec 0043), the health sweep's window is one hour, No show marking has no end.

## Dependencies

| Feature | Status (31 October 2026, main 298735334) | What this plan needs | When it is missing |
|---|---|---|---|
| Spec 0009 access | built | the door, the catalog, the sealed scope, the access table walk | hard prerequisite |
| Spec 0031 members and teams | slices 1 to 7 built (`audit_events`, `roles.list`, removal hooks, invitations); slice 8 (teams, membership, the door's `teamIds`) in lane P1 on `wip/crm-teams`; slice 9 (guests) is lane P2, after P1; `workspaces.time_zone` not built | teams for "their teams" reach, team delegations, team rotations, the team filter; the guest role | team reach stays empty (`teamIds` is always `[]` today); team targets are refused `DELEGATE_INVALID`; the nightly job uses 03:00 UTC |
| Spec 0035 schedules | built, with J4's reach and J6's 400 overrides | schedules, `scheduleFor`, one write path | none |
| Spec 0029 round robin | built with Amends 0029 (migration 0058 onward), except `rotations.team_id`, which becomes `follows` (L3b) | rotations, the ledger, `pickLeadOwner`, the lock set | none |
| Spec 0024 M4 and M5 | built (`calendar_calendars`, migration 0068) | per calendar status, per member busy | none |
| Spec 0023 forms | built: the hand off, Show when, owner kinds, the submission notice and notify list (0129, 0130) | the team link form and lead owners | none |
| Spec 0043 lead routing | built: rules per form and team page, `routing_decisions`, the Report, No show | the rule format, decisions, the Routing card | none |
| Spec 0057 booking page questions | built (migration 0115) | a team page's own answers as facts (L6) | L6 waits |
| The workspace link | built (migration 0128) | the team's booking page, the everyone rotation, `rotation_roster` | none |
| Spec 0030 team calendar | in progress as J12 on `wip/team-day` | the Team day | Away bands, the Needs a host lane and the Team day's chips wait |
| Spec 0032 access rules | not started | `access_rules`, the Access tab, Preview as | custom roles ship first without rule subjects; L5 adds them with 0032 M1 |
| Spec 0038 inbox | built | in app notices | none (the scheduling notice in the inbox is owed in L1) |
| Spec 0008 jobs | built | heavy and light lanes, cron fan out, the worker login | hard prerequisite |
| `packages/emails` | built | the new emails' templates | hard prerequisite |

## Requirements

**User stories** (the children hold the rest):
- As an owner, I want roles that match how my business works, so a receptionist, a team lead and a contractor each get exactly what they need without being admins.
- As a practice manager, I want to set the doctors' hours and time off myself, and have them told.
- As an assistant, I want to run my manager's calendar and booking pages without seeing their private events.
- As a member, I want my calendars to stay mine: colleagues see when I'm busy, never what I'm doing.
- As a sales lead, I want one team link where the right rep gets each meeting, fairly, and to see why.
- As a rep, I want my share to stay fair even when the system favours someone for a lead.

**Acceptance criteria** (across every child):
- **AC-1221**: Every service this plan adds or changes has an entry in the access table (spec 0009, AC-139) and a denied actor test. A source scan fails on any `can(…)` of a `schedule.*` permission, and on `booking.admin` used as a check over another person's time, outside `packages/core/src/access/scheduling.ts`; the only other places that compare a principal's member id with a booking's or page's are the helpers `isSelf`, `isHostOf` and `managesPageOf` beside it.
- **AC-1222**: The door stays one tenant round trip: a custom role is read in the same statement as the member row; delegations, team co membership and routing facts are read at their choke points inside the service's own transaction, never in the door. Spec 0009's AC-149 (at most 5 ms p95 added per request) is measured again with 20 custom roles and 100 delegations.
- **AC-1223**: Fail closed everywhere: an unknown permission name in a stored role, an unknown delegation level or target, an unknown routing outcome or smart mode all grant nothing; a routing rule that reads a fact which can't be read (its attribute archived, a record not found, or a record fact on a form) is skipped, never matched, and the decision says so; each child's unit grid covers its unknown values.
- **AC-1224**: Every change named in this plan writes exactly one `audit_events` row (spec 0031, AC-830) in its own transaction, with the actor, the target, and before and after of only the changed fields; the audit action names are added to `AUDIT_ACTIONS` in contracts, as each child lists.
- **AC-1225**: Every new screen is built from the component library, works fully by keyboard, is labelled, meets WCAG AA in both themes, follows the full width and "every setting under Settings" rules (owner, 20 October 2026, as narrowed by AC-1447), and passes `design-system-guardian` and `ux-interaction-reviewer`.
- **AC-1445**: Every action here that ends something or can't be undone in one click asks first in a Modal saying the consequence in plain words (owner rule, 21 October 2026): removing a delegation ("Bea will no longer be able to manage your scheduling."), deleting time off, "Copy this week to next week" and "Set usual hours for…" ("This replaces next week's hours for 3 people."), removing an editor, removing a member from a managed page ("Sam's Intro call page will be removed."), voiding an adjustment, deleting a skill or a role, turning Only through a form on ("Visitors who open this page's address without a form will see that it isn't available."), and setting Learn from ("Smart ranking starts over from this date."). Undoable deletes keep their one click Undo.
- **AC-1446**: Migrations are safe on large tables: each starts with `set local lock_timeout = '5s'`; new columns on `bookings`, `form_submissions`, `routing_decisions` and `booking_time_blocks` are nullable with no default; every new foreign key and check on them is added `NOT VALID` and validated in a later migration outside the deploy (as `0040_forms.sql` does); each job takes the next free migration number when it merges.
- **AC-1447**: Every scheduling screen of this plan is a Bookings tab or lives inside one, in this order: Calendar, List, Roster (shown to anyone with See over at least one other member), Availability, Round robin, Routing (holders of `routing.manage` only), Calendars. Settings keeps only a member's own account pages (Scheduling access among them) and the workspace's (Members, Teams, Roles). An old address redirects to its new home keeping its search (`settings/scheduling/rotations` and `settings/scheduling/round-robin` to Bookings › Round robin, built; `bookings/availability?view=team` to Bookings › Roster). The sidebar's Scheduling group holds Bookings and Captures only (no Roster, Notes or Favourites, owner, 30 October 2026).

## Decision

Extend spec 0009's model additively in three layers, each with one owner of its rule:

1. **What a person may do** stays a flat list of permissions on one role. Custom roles are database rows validated against the catalog at read; built in roles stay pinned in code. ([0037-roles.md](0037-roles.md))
2. **Whose time a person may see or change** is a reach: the person themself, plus role permissions with a team or everyone scope, plus per person delegations, combined most open wins and answered by one pure function, `canActFor`, at the scheduling choke point. ([0037-scheduling-access.md](0037-scheduling-access.md))
3. **How work is shared** stays spec 0029's rotations and ledger, extended to fixed hosts and several rotations; spec 0043's rules on each surface decide the next step (forms) and who may host (team pages), and a bounded smart ranking orders the free reps those rules allow, learning from outcomes. ([0037-round-robin.md](0037-round-robin.md), [0037-routing.md](0037-routing.md))

See [rationale.md](rationale.md).

## Design overview

### The model in one picture

```
What may I do       person → one role → a flat list of permissions (built in, or custom)
Whose time          reach = me + role scope (their teams, or everyone) + delegations (a person, a team, everyone)
                    See is inside Manage; canActFor(reach, member, 'view' or 'manage') answers every check
Who gets it         a form's rules (answers only) → the next step: a team page, a message, a link
                    a team page's rules (CRM facts, answers) → which of its hosts may take it
                    rank the free hosts: load minus slack × preference (fit, learned record)
                    one ledger row per assignment (spec 0029), one decision row per routing (spec 0043)
```

### New and changed data (details in each child)

| Table or column | Child | Purpose | State |
|---|---|---|---|
| `workspace_roles` | roles | custom roles: name, description, permissions, data access (`default_object_level`), `started_from`, default for new people | L4 |
| `members.custom_role_id`, `invitations.custom_role_id` | roles | a member's or an invitation's custom role (role stays `member`) | L4 |
| `access_rules.subject_custom_role_id`, `record_rules.subject_custom_role_id` | roles, amends 0032 | rules for a custom role | L5 |
| `schedule_delegations` | scheduling access | See or Manage over a person, a team or everyone, with `granted_by_self` | built (migration 0125); team foreign key in L3a |
| `booking_time_blocks`: kind `away`, `reason`, `note`, `standin_member_id` | time off | time off on the block table the slot engine already reads | built (0127) |
| `member_booking_limits` | time off and roster | per person caps per day and week | built (0133) |
| `calendar_connections.health_broken_at`, `health_notified_at`, `health_reminded_at` | calendars, amends 0024 | two health emails per broken episode at most | built (0134) |
| `booking_page_rotations` | round robin, amends 0029 | up to 3 rotations per page | built |
| `rotations`: strategy `even`, `even_gap`, `returning`, `follows`; `rotation_members.weekly_cap`; `rotation_assignments.units`; the `rotation_roster` view | round robin, amends 0029 | Even, returning guests, weekly caps, adjustments, rotations resolved on read | built (0058 onward, 0128); `follows = 'team'` with `follows_team_id` in L3b |
| `scheduling_editors` | round robin | editors of a booking page or a rotation | L2 |
| `booking_pages`: kind `managed`, `template_id`, `locked`, `follow_team_id`; `managed_page_members` | round robin (managed pages) | templates and member pages | L10 |
| `routing_decisions`: `steps`, `assigned_member_id`, `assigned_at`, `facts`, `snapshot`, `holdout`, `segment_key` | routing | fallbacks, the lead owner claim, the ranking's snapshot and learning | table built (0074, 0088); columns in L6, L8, L9 |
| `routing_settings`, `routing_skills`, `member_skills`, `routing_stats` | routing | what every surface shares: Won means, smart settings, skills, learned cells | L7 to L9 |
| `booking_pages.form_only`, `booking_pages.routing_objective` | routing | Only through a form; a team page's learning objective | L6, L9 |
| `bookings.no_show_at`, `no_show_by_member_id` | routing, amends 0025 | No show | built (0074) |
| `members.job_title` | amends 0031 | a label, never a permission (timefix parity) | L3a |

Not built and no longer planned: `routers`, `router_versions`, `forms.router_id`, `form_submissions.routing_decision_id`, `bookings.routing_decision_id`, `rotations.team_id`.

All new tables are tenant tables: `workspace_id` first in every key, forced row level security with the standard policy, audit columns. Migrations follow AC-1446.

### Permission catalog changes

Full table, with labels, descriptions and grant levels: [0037-roles.md](0037-roles.md#the-catalog). All of these are in the catalog on main (J1); `routing.manage` is checked from L6.

| Permission | Owner | Admin | Member | Custom role may hold | Key may hold | New in |
|---|---|---|---|---|---|---|
| `availability.own` (change your own hours) | yes | yes | yes | yes | yes | 0037 |
| `schedule.view` (see everyone's scheduling) | yes | yes | | yes | no | 0037 |
| `schedule.view.team` (see their teams' scheduling) | yes | yes | | yes | no | 0037 |
| `schedule.manage` (manage everyone's scheduling) | yes | yes | | yes | no | named by 0030, landed in J1 |
| `schedule.manage.team` (manage their teams' scheduling) | yes | yes | | yes | no | named by 0030, landed in J1 |
| `routing.manage` (the shared routing settings, skills, Test, Decisions, Insights) | yes | yes | | no | yes | 0037 |
| `members.invite`, `jobs.manage`, `audit.read` | unchanged | unchanged | unchanged | no (grant `admin` after review) | as before | 0009 |
| every other existing permission | unchanged | unchanged | unchanged | per its grant level | as before | 0009 |

`access.manage` now also covers custom role definitions. Guest holds nothing, as spec 0031 decided.

### Services and contract (new procedure namespaces)

`roles.*` (list, overview, get, create, update, duplicate, delete, setDefault), `members.setRole` gains `customRoleId`, `scheduling.delegations.*` (list, grant, revoke), `scheduling.summary`, `timeOff.*` (list, create, update, delete), `availability.teamWeek`, `availability.setDay`, `availability.copyWeek`, `availability.setUsualHours`, `limits.get`, `limits.set`, `limits.at` (the New meeting warning, built), `calendar.health`, `calendar.askReconnect`, `rotations.adjust`, `rotations.distribution`, `editors.list`, `editors.set`, `managedPages.*`, `routing.*` (spec 0043's `report`, plus `overview`, `decisions`, `decision`, `settings.get`, `settings.set`, `test`, `insights`, `skills.*`, `memberSkills.set`), `bookings.markNoShow` (built), and spec 0023's public `POST /api/public/forms/:publicKey/submissions` (unchanged in shape; L6 adds the free time check). Each is listed with its inputs, outputs, access and errors in its child.

### Access table entries (spec 0009, AC-139)

Every new service gets one entry. New entry kinds, each with a denied actor test in the table walk:

| Kind | Means | Used by | State |
|---|---|---|---|
| `{ scheduling: 'view' \| 'manage' }` | the actor's own permission from the services table, then `canActFor` over the one member it names | schedules, blocks, time off, limits, Roster writes, `bookAsHost` for someone, reassign, no shows, `calendar.askReconnect` | built (J1, J4) |
| `{ filtered: '<rule>' }` | any member may call it; rows are filtered inside the service by the named rule, so a principal with no reach gets an empty answer | `members.visible`, `availability.teamWeek`, `calendar.health`, `rotations.distribution` | built (J1) |
| `{ delegation: true }` | over yourself with `booking.manage`, otherwise `members.manage` (never over an owner; over an admin only by an owner); the delegate may remove their own | `scheduling.delegations.*` | built (J1) |
| `{ editor: 'booking_page' \| 'rotation' }` | `booking.admin`, or an editor of that page or rotation; adding a person also needs Manage over them (round robin AC-1340) | page and rotation edits, `rotations.adjust`, managed page templates | L2 |

The `{ router: true }` kind of the original plan is withdrawn: there is no router principal (routing AC-1377). Everything else uses existing kinds: `{ permission: 'access.manage' }` for `roles.*` writes, `{ permission: 'routing.manage' }` for every `routing.*` procedure but `report` (the surface's editors, as built) and `skills.list` (`{ anyMember: true }`), `{ anyMember: true }` for `roles.list` and `roles.overview`. Jobs: `routing.learn`, `scheduling.notice` and the calendar health tasks are named system jobs; `routing.assign_unbooked` runs as the submission's form actor.

### Errors

New codes join `ERROR_MAP` in contracts; refusals keep the `{ code, message }` shape and never name what the caller can't see.

| Code | Status | Message | State |
|---|---|---|---|
| `ROLE_NAME_RESERVED` | 422 | "Owner, Admin, Member and Guest are built in roles. Pick another name." | L4 |
| `PERMISSION_NOT_ALLOWED` | 422 | "Custom roles can't hold <label>. Only built in roles can." | L4 |
| `ROLE_LIMIT` | 409 | "A workspace can have at most 20 custom roles." | L4 |
| `MOVE_TO_INVALID` | 422 | "Pick Member or another custom role." | L4 |
| `DELEGATE_INVALID` | 422 | "Pick another active teammate who isn't a guest." (a team before slice 8: "Teams aren't set up in this workspace yet.") | built |
| `DELEGATION_LIMIT` | 409 | "<name> can already see or manage 50 people's scheduling." or "<name> already has 20 people managing their scheduling." | built |
| `TIME_OFF_LIMIT` | 409 | "Someone can have at most 50 upcoming time off entries." | built |
| `HOSTS_INVALID` | 422 | "A round robin page needs 1 to 3 rotations and at most 8 hosts in all." | built |
| `EDITOR_LIMIT` | 409 | "A page or rotation can have at most 20 editors." | L2 |
| `MEMBER_INVALID` | 422 | "Guests can't take bookings." | P2 |
| `ROUTING_IN_USE` | 409 | "Rule 3 of Contact us sends people here. Change the rule first." (AC-1341) | L6 |
| `SKILL_IN_USE` | 409 | "<skill> is used by <where>." (for example "Rule 3 of Intro call and 2 fit links") | L7 |
| `SKILL_LIMIT` | 409 | "A workspace can have at most 100 skills." | L7 |
| `TEAM_IN_USE` (spec 0031's, widened) | 409 | "<team> is followed by <rotations or managed pages>. Change them first." | L3b |

Withdrawn with the 31 October amendment: `ROUTER_INVALID` (no published versions), `ROUTER_IN_USE` (now `ROUTING_IN_USE`), `NOT_MARKABLE` (No show answers `BOOKING_CLOSED` before the start, as built), `ROTATION_TOO_LARGE` (no cap on a rotation that follows a team).

Reused: `FORBIDDEN` (with each permission's or rule's sentence), `NOT_FOUND`, `STALE`, `NAME_TAKEN`, `RATE_LIMITED`, `SEAT_LIMIT`, `LAST_OWNER`, `SLOT_TAKEN`, `BOOKING_CLOSED`, `VALUE_INVALID`, and `CONFIG_INVALID` for a schedule full of date overrides (as built by J6: there is no 422 `VALUE_INVALID` for that case).

### Emails

All through the Mailer with `packages/emails` templates and the shared footer, each keyed for idempotency by its job.

| Email | To | When | Subject | State |
|---|---|---|---|---|
| Scheduling changed | the member | 10 minutes after the first change someone else made (AC-1264) | "<actor> changed your scheduling" | built |
| Scheduling access given | the delegate; the member, when someone else granted it | on grant or a level change (AC-1257) | "You can now <see or manage> <member>'s scheduling" / "<delegate> can now <see or manage> your scheduling" | L1 |
| Scheduling access removed | the delegate, when someone else removed it | on removal | "You can no longer see <member>'s scheduling" | L1 |
| Covering for someone | the stand in | time off naming them is saved or its dates change (AC-1282) | "You're covering for <member>, <dates>" | built |
| Ask to reconnect | the member | on the press (AC-1309) | "<actor> asked you to reconnect your calendar" | built |
| Calendar stopped syncing | the member | an episode starts, and once more 7 days later if still broken (AC-1310) | "Your <provider> calendar stopped syncing" | built |
| New submission (spec 0023) | the lead's owner and the form's listed members | at submit; for an owner who waits for a booking, when assigned (AC-1391) | as spec 0023 | built; the wait in L8 |
| Editor added | the person, or each member of the team | on add (AC-1331) | "You can now edit <page or rotation>" | L2 |
| Managed page | the member | their page is made or removed (AC-1335) | "You have a new booking page: <title>" / "Your <title> page was removed" | L10 |

Withdrawn: "New lead for you" (the submission notice is it) and "Routing has no one to send leads to" (no Last resort owner).

### Audit actions

Added to `AUDIT_ACTIONS` (spec 0031): `role.created`, `role.updated`, `role.deleted`, `role.default_changed`, `delegation.granted`, `delegation.changed`, `delegation.revoked`, `schedule.changed`, `time_off.created`, `time_off.changed`, `time_off.deleted`, `limits.changed`, `block.created`, `block.removed`, `booking.changed_for`, `booking_page.changed_for`, `calendar.reconnect_asked`, `rotation.changed`, `rotation.adjusted`, `editors.changed`, `managed_page.changed`, `routing.settings_changed`, `routing.skills_changed`, `routing.tested`; and, from spec 0043, `routing.changed`, `booking.no_show` and `booking.no_show_undone` (which replace this plan's `booking.no_show_marked` and `routing.published`). Time off rows store the reason code, never the note's text. Spec 0031's role change action records custom roles in its before and after.

### Live updates and the client

- Role, delegation and team membership changes store `access` outbox rows naming every member whose access or reach changed (spec 0009, AC-146; scheduling access AC-1274), and on that row the data layer drops and reloads every scheduling store it holds, not only records.
- Schedule writes, the Roster's included, use spec 0035's `schedules` kind (ids only).
- Time off and limits share one outbox kind, `time_off` (migration 0132, as built), so every open tab sees them at once. Rotations, editors and routing settings are settings, as bookings are: no new outbox kind; screens read again when the window regains focus (spec 0030, AC-781), and the writer's own screens update optimistically with rollback.
- Every screen reads and writes through `packages/data` (one store per area: roles, scheduling access, availability with time off, limits and the Roster, rotations, routing), never fetching on its own (`crm-frontend-state`); `state-performance-reviewer` reviews each.

### Screens

| Where | What | Child | State |
|---|---|---|---|
| Settings › Roles | roles list, Compare matrix, role page with permissions and scheduling reach | roles | L4 |
| Settings › Members | custom roles in the role Select, a Scheduling column (timefix's "Sees all calendars", widened), a Calendar column, "What can Priya do" | roles, scheduling access, calendars | columns built; roles and the panel in L4 |
| Settings › Account › Scheduling access | who can see or manage my scheduling, whose I can | scheduling access | built |
| Bookings › Availability | "Viewing: Bea" for anyone with reach; Time off and Limits sections | scheduling access, time off and roster | built |
| Bookings › Roster | the team's week (timefix's roster) | time off and roster | built as Availability's Team view; its own tab with the roster editor lane |
| Bookings › Calendar and List | a "For" picker for New meeting and Block time; Away and Host away flags; No show; the limits warning | scheduling access, time off, routing | built; For on Time off in L1 |
| Bookings › Calendar › Team (spec 0030) | columns from See reach, Away bands, a Needs a host lane, clash and outside hours counts | amendments to 0030 | J12 |
| Bookings › Round robin | hosts, Even, weekly caps, returning guests, Distribution, health chips; follow a team; Sharing | round robin | built; follow a team in L3b, Sharing in L2 |
| Bookings › Routing | Overview, Decisions, Skills, Test, Smart, Insights | routing | L6 to L9 |
| Captures › Links | team pages and the workspace link with their Routing card and Only through a form; New › Team link; colleagues' pages under their names; managed pages | routing, scheduling access, round robin | Routing card built; the rest in L1, L6, L10 |
| Captures › Forms | the team link form, with its Routing card (spec 0043) | routing | built |

## Build plan

Sizes: **S** is one sitting for one builder, **M** a few sittings, **L** a lane of its own for several days. AC-1221, AC-1223 to AC-1225, AC-1445 and AC-1446 apply to every lane (J1 set up their tests and source scans). Every criterion of this plan is in exactly one row below, built or owed (verify.md checks it, and lists each criterion's state). Every lane runs its area's reviewers before handing back: `security-access-reviewer` for every lane touching access or the API, `state-performance-reviewer` for queries, jobs and live views, `design-system-guardian` and `ux-interaction-reviewer` for every screen. Lanes push their branches for CI (`lanepush.sh`); nothing heavy runs locally. Lane branches never edit `docs/specs/`: changes to this plan go through `/architect`.

The approach stays Tracer Bullet: each lane is a thin, real thread through data, service, contract, store and screen, visible in the product when it lands. L6 is the routing tracer bullet: after it, the owner can click through both doors and see every decision.

### What is built (main 298735334)

| Job | Built in | ACs |
|---|---|---|
| **J1** Catalog and scheduling reach | 1ed3896a3 (migration 0125), 44d4fcaf0, f3f940eeb | AC-1226, AC-1227, AC-1245, AC-1251, AC-1255, AC-1256, AC-1259, AC-1261, AC-1270, AC-1422 |
| **J4** Reach everywhere, and the member told | 46ae99c70, 2506ca0c3 (migration 0126) | AC-1252, AC-1258, AC-1260, AC-1262, AC-1265, AC-1275, AC-1444 |
| **J5** Scheduling access screens | 23cefdb38, 5de1d67e3, bec67464e, b061f94df | AC-1266, AC-1268, AC-1271 |
| **J2** Time off | 0c37564d4 (migration 0127), 51b6b4101, 7d851c8f6, da4b674b9 (0132) | AC-1281, AC-1282, AC-1283, AC-1285, AC-1286, AC-1288 |
| **J6** The Roster (Team week) | 63d26d7c5, 02c526370, 05ddcb6e6, 31f9dff48, 5d931de3f | AC-1290 to AC-1296, AC-1300, AC-1301 |
| **J7** Meeting limits | ef3b09292 (migration 0133), c02dcaf69, e2cf07d01, bd3dbecb6 | AC-1297, AC-1298, AC-1299, AC-1302 |
| **J3** and **J8** Calendar health | 7b97c5a9e (migration 0134), d89c38449, 4d1f6f202 | AC-1306, AC-1307, AC-1309 to AC-1313, AC-1315, AC-1425 |
| **J11** Spec 0029, amended | the round robin lane (459c37c97, migration 0058, onward) | AC-1428, AC-1429, AC-1430 |
| **J13** Round robin beyond (most) | f0cf9bb62, ca5b20e55, f35aa3f4f, 9288440e3, 09a1d1ce7, bf0b7e468 | AC-1319 to AC-1326, AC-1328, AC-1338, AC-1339 |
| Spec 0043 (routing's first slice, before this amendment) | ee2df170f, 586223198, 5103f2309 (migrations 0074, 0088) | AC-1355, AC-1359, AC-1360, AC-1367 |
| Members lane (spec 0031) | slices 3 and 5 | AC-1439, AC-1440 |

### Lanes running now

| Lane | Branch | 0037 work | ACs |
|---|---|---|---|
| **J12** Spec 0030, amended (team day) | `wip/team-day` | the Team day with See and Manage reach, Away bands, the Needs a host lane, issue counts, job title order, its health chips and No show marks | AC-1287, AC-1308, AC-1314, AC-1434 to AC-1438 |
| Roster editor | `fix/roster-editor` | the roster's popovers, the Roster as its own Bookings tab and its redirect, the bookings strings | AC-1447 |
| **P1** Teams (spec 0031 slice 8, `crm-bc`) | `wip/crm-teams` | `teams`, membership, the door's `teamIds` | spec 0031's own (feeds L3a, L3b) |

### Lane queue (each starts when the lanes it depends on are in)

| Lane | Job | What | Size | Depends on | ACs |
|---|---|---|---|---|---|
| **L1** | J4 and J5, finished | reach on colleagues' pages: "Editing Bea's page", their pages under their names in Captures › Links (the `bookingPages` entry's Manage half of AC-1332), "Add events to" kept the owner's, `booking_page.changed_for`; the notice's page and rotation lines and its inbox notice; For on Time off (New meeting's For after J12); the delegation emails | M | none (New meeting's For after J12) | AC-1257, AC-1263, AC-1264, AC-1272, AC-1273 |
| **L2** | J14 editors, J11 and J13 finished | `scheduling_editors`, the editor access kind, Sharing on pages and rotations, editors in the Captures › Links and Round robin lists, the `bookingPages` entry's editors half (its Manage half comes with L1); who may add hosts; adjustments and Distribution for editors; reassign with Manage over both hosts; `rotation.changed`; `pickLeadOwner`'s stand in for an away owner; the 30 booking race test | M | L1 | AC-1284, AC-1329, AC-1330, AC-1331, AC-1332, AC-1337, AC-1340, AC-1431, AC-1433 |
| **L3a** | J1 for teams | team reach and team delegations (with the `schedule_delegations` team foreign key), team targets in the Members column and on team deletion, `access` rows on team changes, the Roster's team filter, the job title | M | P1 | AC-1253, AC-1254, AC-1267, AC-1269, AC-1274, AC-1289, AC-1441, AC-1443 |
| **L3b** | J13 for teams | `rotations.follows = 'team'` with `follows_team_id` and the `rotation_roster` branch; Follow a team on Round robin; leavers' settings dropped; `TEAM_IN_USE` | S | P1, L2 | AC-1327, AC-1442 |
| **P2** | spec 0031 slice 9 | the guest role (the coordinator's chat builds it, agreed with `crm-bc`), on `wip/crm-teams` after P1's tip; guests out of rotations and delegations | M | P1 | AC-1432 |
| **L4** | J9 custom roles | `workspace_roles`, the door's join, policy, `roles.overview`, the Roles screens, the Members role Select, invitations rechecked, audiences and `enterAsActor`, "What can Priya do", the door budget with 20 roles | L | P1, P2 | AC-1222, AC-1228, AC-1229, AC-1231 to AC-1244, AC-1246, AC-1247, AC-1248, AC-1421 |
| **L5** | J10 custom roles in access rules | rule subjects, the copy on create, the backfill; Access tab and Preview as | S | L4, P1, in the release of spec 0032 M1 | AC-1230 |
| **L6** | J16a Two doors (routing's tracer bullet) | Bookings › Routing with Overview and Decisions (`routing.manage` checked); the page's own answers as facts; the Team link starter; the workspace link in the one story; Only through a form; the free time check at submit with `routing_decisions.steps`; `ROUTING_IN_USE`; the no leak test | M | this amendment; in the train after L2 (both edit the page editor) | AC-1341, AC-1351, AC-1352, AC-1353, AC-1357, AC-1358, AC-1375, AC-1378, AC-1380, AC-1383, AC-1384, AC-1388 |
| **L7** | J16b Skills, deal facts, Test | `routing_skills`, `member_skills`, Skills tab; required skills in host routes; `routing_settings` with Won means; `deal.<id>` and Known facts; Test | M | L6 | AC-1356, AC-1377, AC-1382, AC-1385, AC-1392, AC-1393 |
| **L8** | J17 Ranking and lead owners | fit links; the bounded ranking with its property test at every team page booking; `facts` and `snapshot`; the explanation tiers; the Smart tab (mode, allowance, fit); the owner that follows its meeting, the claim, the unbooked job and the deferred notice | M | L7 | AC-1361 to AC-1365, AC-1372, AC-1373, AC-1374, AC-1379, AC-1387, AC-1391, AC-1423, AC-1427 |
| **L9** | J18 Outcomes and learning | page objectives; outcomes and trials; `routing_stats`; the nightly job in the heavy lane with its hourly fan out; lift; the holdout; segment attributes; Insights with the marking rate; Learn from; the No show filter on Bookings › List | L | L8, J12 | AC-1354, AC-1366, AC-1368, AC-1369, AC-1370, AC-1376, AC-1381, AC-1386, AC-1389, AC-1426 |
| **L10** | J15 Managed booking pages (optional) | templates, member pages, locks, propagation | L | L2; in the train after L6 (both add a choice to Captures › Links › New) | AC-1333 to AC-1336 |

Every lane also carries AC-1221, AC-1223 to AC-1225, AC-1445 and AC-1446. Withdrawn, so in no lane: AC-1371, AC-1390, AC-1424.

### The order

Train (coordinator, 31 October): team day, roster editor, L1, L2, then spec 0062 (`crm-b5`), then the rest. For the rest, this plan recommends: **L6, L7, L8, L9** in that order (the owner's sales team link, visible after L6 and smarter with each lane), with L3a and L3b as soon as P1 lands, P2 then L4 and L5 when the teams lane is free, and L10 last by priority (decision 22: optional), free to run beside L7 to L9 when a lane is idle since it depends only on L2.

Not scheduled: the background AI classification (decision 27) waits for #54; record sharing (decision 6) waits for a customer.

### The critical path for the owner's sales team link

L6 (both doors clickable, every decision visible) → L7 (skills and what the CRM knows about deals) → L8 (smart ranking and lead owners that follow their meeting) → L9 (learning). L6 needs nothing unbuilt.

## Consequences

**Positive**:
- One access model answers "what may I do", "whose time may I touch" and "who gets this meeting", each in one function, all through the existing door.
- Timefix's per person switch, roster, hours log and calendar health emails came across, and the round robin it never built arrived with Cal.com's and Calendly's team features.
- The sales team link routes by rules anyone can read where they already edit forms and pages, gets smarter without anyone writing a score, and can never drift far from fair shares.
- Keeping spec 0043's rules where they are means nothing that works today changes, no migration of customers' rules, and no second rule list to keep in step.

**Negative / tradeoffs**:
- Many moving parts: ten queued lanes and amendments to eleven specs.
- Rules live on many surfaces, so "every rule in the workspace" is a list (Routing › Overview), not one document; two forms can disagree about the same visitor, which the original single setup prevented.
- Custom roles multiply what has to be tested; the pinned table covers built in roles only, so each custom role is validated at read and the unit grid grows.
- Delegations add a query at every scheduling choke point (one indexed read per transaction).
- Learning needs outcomes, and until a segment has 100 finished meetings the ranking is fit and fairness only.
- Locking every free candidate up front serialises bookings across overlapping pools a little more than spec 0029's per candidate locks, and a rotation that follows a large team or the workspace takes one advisory lock per free candidate at that time.
- `/b/:key` stays frozen for behaviour, so time off can't redirect visitors on a personal page.

**Neutral**:
- No new environment variables and no new dependencies.
- Built in roles keep their pinned table; custom roles live in the database.

## Follow-up

- [ ] AI classification of free text answers and company domains into attributes, in the background, after #54 (decision 27).
- [ ] Record sharing (decision 6), per list access (spec 0032 follow up), rules per person.
- [ ] Routing on import (#58: "a new record from an import can be given an owner by the rotation").
- [ ] Schedules owned by a team or the workspace (timefix's `schedules.owner_user_id` null), if the Roster's "Set usual hours for several people" isn't enough.
- [ ] Time off read from Google's "Out of office" events and Outlook's automatic replies.
- [ ] A waitlist that offers a cancelled slot to the next guest (timefix's routing design, "backfill").
- [ ] Custom roles based on Guest, for external hosts who take no seat.
- [ ] One rule list shared by several forms, if customers keep copying the same rules between forms (spec 0043's own follow up; the original decision 23 is the design to start from).
- [ ] `/sync`: amend specs 0009, 0023, 0024, 0025, 0026, 0029, 0030, 0031, 0032, 0035 and 0043 in their own files as each amended milestone is built, and record `canActFor` in `packages/core/AGENTS.md` as the one scheduling check (the file still says `booking.admin` reaches everyone).
- [ ] `/scope`: link this spec from #23, #24, #44, #58 and #59, and mark J1 to J8, J11 and J13 done there.

## Rationale

See [rationale.md](rationale.md).
