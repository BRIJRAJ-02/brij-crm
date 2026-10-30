# 0037. Team scheduling and access: rationale

## Context

The owner asked on 21 October 2026 for "multi user with their calendars and a whole roundrobin system with their availability being set either by admin or someone else. like we currently have in timefix. also the whole role based users and all. with access levels. the best and advance system", and later the same day for a sales team link where "anyone of team is assigned based on the qualification and type", "smart and also trained so it's a one format".

Much of the ground is already decided and accepted (20 October 2026): roles and one door (0009), members, guests and teams (0031), access rules with most open wins (0032), calendars per account with Outlook (0024 M4 and M5), round robin (0029), the team calendar (0030), several schedules per person (0035). Two lanes are building 0031 and 0035 right now, and 0024 M4 and M5 are the next job. So this plan had to extend, not reopen, and had to say exactly what each in flight lane should do differently.

The forces:

- **One door, fail closed, one tenant round trip** (spec 0009, AC-134, AC-149). Anything new about access must be answered by the door's sealed scope or by a pure function at a choke point, and anything unknown must grant nothing.
- **Hidden means absent** (0009) and **Busy only for colleagues' calendars** (0030, owner decision).
- **The public booking page `/b/:key` is frozen** (owner, 20 October 2026); `/f/:key` is open for its redesign.
- **Two seams left open**: spec 0035 lets `booking.admin` edit a colleague's schedules (AC-971), spec 0030 gates acting on a colleague with `schedule.manage`; a team lead or an assistant fits neither.
- **Timefix's lessons** (below): a per person switch beat a role change for "who sees all calendars"; a log and a notice for hours changed by someone else; no AI in the booking path; a scoring feature nobody configured was deleted as noise.
- **Scale**: 100 people online, room for 1,000, a million records; 20 member pools must keep spec 0025's 1.5 s slots budget.

## What timefix does (read only; paths inside the timefix repository)

| Area | What it does | Where | What this plan does with it |
|---|---|---|---|
| Roles | Four flat roles (owner, admin, member, viewer) over fifteen permissions, written out per role (owner 15, admin 14, member 8, viewer 3); an admin can't make an owner; nobody removes the last owner; an unknown role grants nothing | `packages/core/src/org.ts` (`PERMISSIONS`, `ROLE_PERMISSIONS`, `roleCan`, `canChangeRole`, `invitableRoles`) | Spec 0009 already has this shape; custom roles go further (decision 1) |
| One axis apart from the role | `organization_members.schedule_access`, the "Sees all calendars" switch, grants `schedule.manage` ("may see and set other people's time") without changing the role; grants only add (`may()` is the role's answer or the grant); handed out by `team.manage` holders, not by `schedule.manage` holders, so a verb is never its own gate | `packages/core/src/authz.ts` (`may`), `db/queries/organizations.ts` (`grantsFrom`), migration 0073, `timefixapp/src/app/(dashboard)/[workspace]/settings/team/page.tsx` | Delegations (decision 8), granted with `members.manage` |
| Object access | `object_grants`: a role grant may only narrow the role's base level, a user grant may only widen it up to that base; owners are never narrowed | `org.ts` (`objectLevel`, `GRANT_LEVELS`) | Spec 0032 decided roles and teams, most open wins; per person rules stay a follow up |
| Job title | A label per membership that never gates anything | `db/schema/organizations.ts` (`job_title`) | Amends 0031 (AC-1441) |
| Team calendar | One column per member for one day; seeing others needs `schedule.manage`, enforced in the query, not the screen; a colleague's column only if they shared their link (`handles.shared_with_org`, later on by default) | `db/queries/team-calendar.ts`, migrations 0074 and 0082, `timefixapp/src/components/bookings/team-day.tsx` | Spec 0030, fed by See reach; the per link "share with workspace" isn't carried (timefix itself turned it on for everyone) |
| Acting on a colleague | Three checks before any write: the role allows the kind of write, the link is in this workspace (and shared), and `schedule.manage` when it isn't yours; book for a member, set their hours for a day, close a span, reassign a booking with both ends proved (`bookings.assignee_user_id`, migration 0071) | `timefixapp/src/lib/team-write.ts` (`resolveTarget`), `.../apps/bookings/team/actions.ts` | `canActFor` and the services table; reassign needs Manage over both hosts (AC-1337) |
| Hours changed by someone else | One function for four doors: audit every change, stay silent when nothing changed, never fail the save, and email the workspace's admins when the actor's role isn't an administrator (grant holders included) | `packages/core/src/schedule-log.ts` (`noteHoursChange`) | One write path for schedules (AC-1444), audit, and the member told (decision 11; timefix's admin email is the runner up) |
| Named and dated schedules | Named sets of hours; one with no owner belongs to the workspace; a schedule with a Monday (`week_of`) replaces the standing week for that week only | `db/schema/schedules.ts`, `docs/availability-model.md` §3 and §4 | Spec 0035 has named schedules; dated weeks become date overrides written by the Team week (decision 17); workspace schedules are a follow up |
| Roster | People down the side, days across; a dated week stepper (this week forward editable, past read only); up to 4 windows a day; the first edit of a week copies the person's usual week; leave and overtime not built | `docs/roster.md` | The Team week (AC-1289 to AC-1296); time off now exists; overtime stays out |
| The founder's asks about availability | "a doctor can only see their s", "but the perosn booking for them can see all of them", "their availabilty can be set for a week on week basis", "need a log and needs to be notified to workspace owner or the admisitrator", "until workspace owener gives access"; left open: should a doctor set their own hours at all | `docs/availability-model.md` §5, §10, §11 | See and Manage reach, delegations, the Team week, audit and notices, and `availability.own` (decision 10) |
| Calendars | Each member connects their own Google calendars and picks which count as busy; per link calendars (`handle_calendar_connections`); a paused switch per connection | `db/schema/calendar-connections.ts` | Spec 0024 M5's per calendar switches and "Add events to" |
| Calendar health | Probe on every sweep; email the member after two failing sweeps, once per episode, again after 7 days; a quarter of the platform failing (and at least 4) silences everyone; at most 5 emails per sweep | `packages/core/src/calendar-health.ts` (`NOTIFY_AFTER_SWEEPS`, `MASS_FAILURE_FRACTION`, `MASS_FAILURE_COUNT`, `MAX_ALERTS_PER_SWEEP`) | AC-1310, AC-1311, with 200 emails per sweep for a multi tenant service |
| Round robin | Never built: publicly one link is one person; one assignee per capture form; the team calendar chose "named people plus reassign" (Model A) over pooled pages (Model B) | `docs/access-and-mapping.md` §1, `docs/qa-plan.md`, `docs/magnets-and-sequences.md`, `docs/team-calendar.md` §2 | Spec 0029, then [0037-round-robin.md](0037-round-robin.md) |
| Routing design (written, not built) | Strategies: sticky, sticky then balanced (the default), balanced, least recently assigned, weighted, collective; hard attributes never shed, soft ones shed in order; a fallback ladder ending with a human; every decision logged with its rule, shed attributes and continuity break; assignment inside the booking's transaction | `docs/care-programmes-and-routing.md` §4 | Rules with required skills (hard) and fit (soft), fallbacks, returning guests to their last host (sticky), decisions logged, assignment under the booking's locks |
| AI and assignment | "These are not agents and must not become agents: ... assignment (round robin, balanced, sticky)"; no AI call in the booking path since 20 August 2026 | `docs/scheduling-agents.md` §3, `FEATURES.md` §2 | Decision 27: no AI call while a visitor waits |
| Lead scoring | Built (rules over form fields, a score, a band) and deleted on 3 September 2026 as "noise": no account ever saved a ruleset | `FEATURES.md` (CRM settings), `db/schema/icp.ts` | Routing works with no configuration and learns by itself (decisions 25, 26) |
| Team issues | "5 issues · 2 outside shift · 4 clash" counted on the grid | `packages/core/src/team-grid.ts` (`findTeamIssues`) | AC-1436 |
| Booked by someone else | The host must be emailed when a colleague books them in (a defect timefix found and fixed) | `docs/availability-model.md` §10.1 | Spec 0030 AC-776, kept |

## Decision 1 to 6: going past fixed roles

### Option 1: custom roles built from the catalog, built in roles fixed (chosen)

A custom role is a database row: a name, a description, and permissions from the catalog whose grant level allows it. Built in roles stay pinned in code.
- **Pros**: matches HubSpot's and Linear's model of roles as named bundles; one role per person keeps "what can Priya do" answerable in one place; the pinned table keeps the built in roles reviewable; escalation is blocked by grant levels and the invite rule.
- **Cons**: custom roles can't be pinned by a test the way built in ones are, so they're validated at read; one more thing for admins to understand.

### Option 2: editable built in roles

Admins change what Member can do per workspace (Attio's workspace defaults, HubSpot's editable default roles).
- **Pros**: no new concept; an open sales team flips one switch.
- **Cons**: breaks spec 0009's pinned table; "Member" would mean something different in every workspace, which makes support and tests harder. The "default role for new people" (AC-1237) gives the same convenience without changing Member.

### Option 3: permission sets added per person (Salesforce)

Each person has a minimal profile plus any number of additive permission sets, often grouped.
- **Pros**: the most flexible; exceptions without new roles.
- **Cons**: the answer to "what can Priya do" is spread over many bundles; Salesforce's own guidance needed permission set groups and muting to tame it; heavier than this product's customers need.

### Option 4: per person switches only (timefix)

- **Pros**: tiny; worked for one axis.
- **Cons**: timefix's own note says a grants table is "the shape this becomes if a second per member permission ever appears", and the owner asked for the advanced system.

Decision 2's grant levels follow the rule "nobody can hand out more than they hold": the six admin only permissions are exactly those that decide who gets in (members, teams, roles and access rules) or where data leaves (API keys, webhooks, and workspace settings such as join domains). Decision 3 copies rules once (no live inheritance) because spec 0009 forbids roles inheriting from roles, and a live link would silently widen a custom role whenever Member was widened. Decision 5 keeps spec 0031's flat teams: a "Sales lead" role with team scope reaches the teams the lead is in, which covers the common case without a manager flag. Decision 6 defers record sharing because spec 0032's record predicate is already an `exists` per row and hop; an `or exists` over a sharing table would need its own index and a million record measurement, and spec 0032 decided records outside a rule are absent. After the review, four more became admin only: `members.invite` (comparing permission lists can't stop an invite into a role with wider data rules, or a second account), `jobs.manage` (it confirms admins' prepared purges), `audit.read` (audit rows hold time off reasons and rule changes) and `routing.manage` (Test shows what the CRM knows about any email). Decision 3's copy ships with its backfill in the same release as spec 0032's rules, so the copy can never be skipped.

## Decisions 7 to 13: who may see and set whose scheduling

### Option 1: two levels, reach from roles and from delegations, one function (chosen)

- **Pros**: covers every case in the asks: a receptionist (a role or a delegation over everyone), a team lead (a role with team scope), an assistant (a delegation over one person, which the member can grant themself), a doctor whose hours are set for them (a role without `availability.own`). See without Manage serves open sales teams that want visibility without edits. One pure function, `canActFor`, at one choke point keeps the door unchanged and testable.
- **Cons**: one more query per scheduling transaction; two sources of reach to explain (the access summary and the Members page column show both, with their source).

### Option 2: spec 0030's single permission with a team variant

- **Pros**: already designed.
- **Cons**: no assistant for one person, no visibility without edit rights, and the admin only `booking.admin` path of spec 0035 stays a second rule.

### Option 3: delegations only, no role scopes

- **Pros**: one mechanism.
- **Cons**: a workspace with ten team leads needs ten delegations kept in step with team changes; role scopes follow team membership by themselves.

**Settling `booking.admin` and `schedule.manage` (decision 12)**: by what they act on. Pages, team pages and rotations are things, owned by whoever configures scheduling; hours, time off, limits and meetings are a person's time. Owners and admins hold both, so nothing changes for them; a custom role can hold one without the other (a coordinator who runs people's days but not the pages, or an ops person who runs pages but not people). The runner up, one permission for both, is simpler but forces every team lead who should fix a teammate's hours to also control every page in the workspace. The review asked for one rule per booking action; the Booking actions table gives it: a page's managers act on the page's bookings, reach acts on the host's, and reassigning (moving work between people) always needs Manage over both. Two guards came from the security review: reach from a custom role or a team never covers owners and admins, and a delegation a member grants over themself can't change hours they aren't allowed to change themselves (otherwise decision 10's managed hours would be one click from undone).

**Telling the member (decision 11)**: timefix emailed admins when a non admin changed a colleague's hours, because the colleague was never told. Telling the person whose time changed is the more humane default and the audit log keeps the admin's view; ten minutes of gathering keeps a busy manager from sending ten emails.

## Decisions 14 and 15: each member's calendars

Calendar access is a personal OAuth grant: a manager can't connect someone's calendar without their account, and shouldn't see what's on it. What a team needs is whether it can trust a person's busy times. A four value status answers that without leaking anything; account emails (sometimes personal) and calendar names (sometimes "Therapy") stay with the member. The health email copies timefix's measured rules, raising the per sweep cap from 5 to 200 because this service sweeps many workspaces at once.

## Decisions 16 to 18: time off, the Team week, limits

- **Time off on the blocks table (chosen)** vs a table of its own: the slot engine already reads blocks on every request and treats any kind but `hold` as closing every page, so time off costs no new query and is fail safe even before the display code learns about it. A separate table would add a read to every slots request.
- **The Team week writes date overrides (chosen)** vs timefix's dated week schedules: spec 0035's overrides already hold several ranges per date, which is exactly why timefix needed dated schedules (its overrides held one window per date). Writing overrides keeps one source of hours per person and needs no table. The runner up, dated schedules, would add a second layer to spec 0035's resolution. A schedule allows 120 overrides today, which weekly rostering fills in about six months, so schedules get a limit of 400 and each write drops overrides older than 8 weeks; the Team week therefore looks back 8 weeks.
- **Limits per person** vs per rotation only: a person in three rotations and two personal pages can be booked five times over today; a cap where the person is, not where the page is, fixes that.
- **No redirect banner on the frozen page**: Cal.com shows "X is away, book with Y" on the booking page. With `/b/:key` frozen, a personal page simply shows no times while the stand in covers round robin and owner routing; the runner up needs the page unfrozen.

## Decisions 19 to 22: round robin beyond spec 0029

- **Fixed hosts plus up to 3 rotations** generalises spec 0025's collective pages and spec 0029's single rotation with one rule (Hall's condition on the candidate sets), matching Cal.com's fixed hosts and round robin groups and Calendly's co host plus rotating pool. The runner up (one rotation) can't express "an AE and an SE on every demo".
- **Locks**: spec 0029 locks the next candidate after a failed recheck, which takes host locks out of id order; Postgres survives that by aborting one side of a deadlock. Locking every candidate up front in id order can't deadlock and stays cheap (at most 67 advisory locks for stored rotations, held for one short transaction). The review found that stand ins (who may sit outside every rotation) would still be locked late; the lock set therefore includes every possible owner, last host and stand in, taken in the same id ordered pass. (Amended 31 October: built one key at a time with no restart; a stand in outside the set is simply not seated. See below.)
- **Even** (Calendly's equal distribution), **weekly caps**, **team rotations** (Cal.com's "add all team members, including future members"), **returning guests to the last host** (timefix's "sticky" strategy) and **adjustments** (Chili Piper's calibration credits) are each small additions to spec 0029's ledger; the Distribution tab is what scope #58 calls "members see their share and admins can rebalance".
- **Editors** give a team lead their team's page and rotation without `booking.admin` over every page (Calendly's "let others edit availability for specific event types").
- **Managed pages** are Cal.com's managed event types; useful at twenty reps, but independent of everything else, so they come last and can be cut.

## Decisions 23 to 30: routing

*This section records the reasoning of 21 October. On 31 October decisions 23, 24, 28, 29 and 30 were amended to build on spec 0043; the reasoning for that is in [Amendments of 31 October 2026](#amendments-of-31-october-2026) below, and where the two differ, that section wins.*

### What one routing setup buys

**One setup for the workspace (chosen on 21 October, amended 31 October)** vs one per team link vs rules on each form (spec 0023's types and logic revision): "one format" read literally means every lead judged the same way; it also means outcomes from the website's team link and from every inbound form land in one model with one set of segments, so learning has enough data. Spec 0023's revision itself deferred "routing as its own object shared across forms ... until a customer has several forms routing the same way"; the owner's ask is that case.

### Where the team link lives

After the review, rules come in two kinds: visitor rules (reading only answers and the address) decide what the visitor gets, and host rules (which may read what the CRM knows) only change who hosts. Otherwise an anonymous visitor could type any email and learn from the ending whether it is a customer. The company is reached only through an exactly matched person, never a domain alone, and the rail always shows the page's own hosts. The forms track's own hand off token is reused unchanged; the decision is found from the submission, so the one change to the frozen page is that its slots request carries the token it already stores.


**A routing form at `/f/:key` (chosen)** vs asking inside `/b/:key`: the booking page is frozen and a visitor must answer before slots can be shown, because the answers choose the pool. Spec 0023's hosted form already evaluates its ending on the server and answers `{ next }`, and spec 0025's hand off already carries prefilled answers to a booking page; the routing adds a decision id to that hand off, and the page reads the pool from the stored decision. Cal.com's routing forms work the same way.

### How free reps are ranked

- **Option 1: bounded preference over the fair order (chosen)**. The pick minimises load minus slack × preference; preference blends fit and learned record, each 0 to 1; slack is the admin's allowance times the pool's mean load plus 1. With the allowance at 0 it is exactly spec 0029. Because preference can never be worth more than the slack, nobody drifts more than the slack (plus one meeting) above the lowest load: a property the tests check. It explains itself in one sentence. After the review: the learned part is a lift over the team's rate (10 points for full lift, nothing under 2), not a stretch between the best and worst candidate, which turned noise into full preference; the slack never drops below one meeting, so the promise holds at small counts and the Smart tab states it as a number of meetings; and 10 percent of picks stay plain fair, so Insights can show whether learning beats fair rotation.
- **Option 2: hard filters by score** (only reps above a score get a lead). Starves new reps, needs a threshold nobody can choose, and breaks fairness without a bound.
- **Option 3: a learning to rank model or a bandit** (Thompson sampling over reps). Strong in theory; hard to explain to a rep, hard to bound against fair shares, and non deterministic, which timefix's rule against agents in assignment rejects.
- **Option 4: rules and fair rotation only (runner up)**. Safe and simple; it doesn't answer "smart and also trained".

### How it learns

**Smoothed rates per member, meeting type and segment, nightly (chosen)**: (successes + 20 × team rate) ÷ (trials + 20). A new rep starts at the team's rate, small samples barely move anyone, and a cell only counts once 100 meetings have finished. Counting, not fitting, keeps it reproducible (AC-1387) and explainable ("48 percent became deals, team 35 percent"). The runner up, a shared model learned across workspaces, would mix customers' data and is refused for a multi tenant product; a per workspace logistic regression would need features beyond the segment and is harder to explain for a small gain at these data sizes. Cells are also keyed by the pool's rotation, so a rep is compared with the leads the rules gave that pool; trials are intent to treat (credited to the rep the ranking picked, host cancellations and reassignments counted as failures, owner and stand in picks left out) so the record can't be cherry picked; each deal is credited to one booking; and the default goal is Deals created, because a held meeting is marked by the host and would reward never marking no shows.

**Outcomes**: held needs a no show mark, which the product doesn't record today (decision 28); deals come from the CRM's own relationships and stage history, so they need no new tracking beyond "Won means".

**Never personal traits**: segments may only use one choice facts asked on the team link or bound to Companies or Deals attributes; the model sees a member only by id; fit uses skills people are given, matched to what the lead asked for (a language they chose, their region), never inferred from a name.

### An AI step

**No AI call while a visitor waits (chosen)**: the booking path has had no AI call since timefix removed it, latency and cost matter on a public form, and a model's answer can't be replayed. A background classifier that fills a CRM attribute (labelled AI, overridable) keeps the routing deterministic while letting free text and domains help next time; it waits for #54's vendor wrapper. The runner up (AI at submit with a 1.5 second limit and rules as fallback) gives smarter first routing at the cost of determinism, latency and sending answer text to a vendor while the visitor waits.

### Leads that don't book, and forms

Assigning a lead's owner from its booking, or from the same pool after the hand off's 24 hours, gives exactly one assignment per decision and keeps leads and meetings in one count per rotation (spec 0029's reason for the ledger). Replacing spec 0023's per form rules with "Hand over to routing" keeps rules in one place; a form can still offer one fixed page.

## Amendments of 31 October 2026

### Context

The plan was accepted on 21 October and then sat on `wip/specs-teamsched` while lanes built it from the files directly. By 31 October main (298735334) had J1 to J8, J11 and most of J13. Three things moved under it:

- **Spec 0043 shipped routing first** (22 October), as a smaller slice the coordinator accepted: one rule format for forms and team pages, rules kept on each surface (at most 20), `routing_decisions` with one row per submission and per team page booking (migrations 0074 and 0088), a per rule Report, and No show. Its own text says a workspace wide setup "can come later". Decisions 23 and 30 of this plan said the opposite: one setup replaces per form rules.
- **Spec 0029's milestone 3 shipped form lead owners** (`forms.owner_rotation_id`, `pickLeadOwner`, 23 October), independent of routing.
- **The owner reshaped the screens**: Calendars and Round robin became Bookings tabs (26 October), the workspace link arrived with a rotation that follows the whole workspace on read (30 October), the Roster and Notes left the sidebar (30 October), and the Roster becomes its own Bookings tab (31 October).

The forces are the plan's own (one door, fail closed, the CRM never visible to an anonymous visitor, no AI in the booking path, smart must work with nothing configured), plus two new ones: **rules customers have already written must keep working**, and **ship less, ship quality** (owner, 25 October: better designs, fewer things, functionality first).

### Routing: keep spec 0043's rules per surface, or migrate into one setup

**Option A: keep 0043's rules per surface and add a shared layer on top (chosen).** A form's rules stay the visitor rules (they read only answers, by construction, so they choose the next step); a team page's rules stay the host rules (they read the CRM and only narrow hosts). One Bookings › Routing tab holds what every surface shares: skills, the smart ranking and its learning, Insights, Test and one Decisions log. `routing_decisions` gains columns.
- **Pros**: nothing that works today changes and no customer's rules are moved; the visitor and host split of decision 25, which the review fought for, is already enforced by where a rule lives, so no publish check can be got wrong; the smart ranking and learning, the parts that answer "smart and also trained", are untouched by the choice and land the same; the team link becomes something the owner can click after one lane (L6). It is also what spec 0043 itself left room for.
- **Cons**: rules live on many surfaces, so "every rule" is a list, not one document, and two forms can disagree about the same visitor; facts are per surface (a question key means something on one form only), so the shared parts (fit links, segments) are keyed by CRM attributes instead of the plan's workspace facts; a form's rules can't route by what the CRM knows (a deliberate limit, as before).

**Option B: migrate every form's and page's rules into one workspace routing setup** (the plan's decisions 23 and 30, the runner up).
- **Pros**: literally one format and one document; facts defined once; publishing checks every rule together; the original design is fully specified.
- **Cons**: a data migration of live rules into a new document with versions, a period where two rule systems run, and either a forced move for customers using form rules or a second editor to maintain; the generated team link form (questions edited only in Routing) breaks spec 0023's own editor; most of the cost buys structure, not anything a visitor or rep would notice. It also redoes work shipped nine days earlier.

**Option C: keep 0043 as it is, with no shared layer.**
- **Pros**: nothing to build.
- **Cons**: no ranking, no learning, no skills: it doesn't answer "smart and also trained".

The reading of "one format" that matters to the owner is that every lead is judged the same way and outcomes compare. Option A keeps one rule format (spec 0043's), one ranking and one learning model per team page, and one place where every decision is visible; that meets the ask without a migration. The workspace setup stays a follow up for the day customers copy the same rules between many forms.

**What follows from it**, each decided here:
- **J16a to J18 become L6 to L9** and extend `routing_decisions` (new nullable columns: `steps`, `assigned_member_id`, `assigned_at`, `facts`, `snapshot`, `holdout`, `segment_key`) rather than create it. Learning's partial index moves from `bookings` to `routing_decisions` (only ranked rows carry a snapshot). `bookings.routing_decision_id` isn't added: a booking's decisions are found by `routing_decisions.booking_id`, which spec 0043 fills.
- **Ranking runs at every team page booking**, not only routed ones, so the workspace link (the door most visitors will use) learns too. With nothing configured its preference is 0 and the pick is exactly today's.
- **Fit links and segments are keyed by CRM attributes** (People, Companies or Deals options for fit; Companies or Deals for segments, never People, as before). A lead's value comes from an answer that files to that attribute, else the record, so a form's questions still feed them.
- **Required skills join the host routes** as an alternative to named members. **Owner and named member outcomes are dropped**: a rotation's Returning guests go to their owner or last host already (with stand ins), and one named member is a host list of one. **Deal facts and Known** join a team page's record facts (L7).
- **Routing's home** is a Bookings tab after Round robin, following the owner's move of Round robin out of Settings (26 October), shown only to `routing.manage`, because Test and Decisions show what the CRM knows about any email. Runner up: a section inside Round robin, which can't hold reads that span forms and pages.
- **`routing.manage` stays admin grant** and covers only the shared layer; each surface's rules stay with that surface's editors (`forms.manage`; the page's owner, `booking.admin` and L2's editors), as spec 0043 built.

### The team link and the workspace link (decision 24)

Two doors, one story. The workspace link (0128) is a team page that books whoever is free; since spec 0057 a booking page asks its own questions, and its rules can read them at booking, when they only narrow hosts free at the chosen time (spec 0043, AC-1610). So the workspace link alone covers "one link, the right rep" for a single meeting type. A **team link** is needed only when there are several meeting types or some visitors should get another ending; then it is a form (spec 0023) in front of the team pages, whose rules pick the page. Making that form in one step from Captures › Links (the Team link starter) is the visible part; afterwards it is an ordinary form, so there is nothing new to learn or maintain. Runner up: a dedicated team link object with generated questions (the original AC-1424), which duplicates the form editor.

**Only through a form** stays, as a per page switch **off by default**: the public booking page is frozen for behaviour (owner, 20 and 24 October), and a default of on would change existing pages by itself. A sales lead who wants every visitor qualified turns it on. **The free time check at submit** stays (a visitor sent to an empty calendar is the worst outcome of a routing form), checked once with a 2.5 second limit.

### Leads that don't book (decisions 29 and 30)

Forms already get a lead owner from a rotation through `pickLeadOwner`, with caps, time off, returning owners and the "keep an existing owner" rule. Options:
- **Owner follows its meeting when they share a rotation (chosen).** When the form's owner rotation is one the booked team page uses, the lead's owner waits for the booking (the host becomes the owner, one ledger row for both), else 24 hours (the hand off's life), then `pickLeadOwner`; every other case picks at submit as today. One conditional update on the form's decision row makes exactly one path assign. This keeps the plan's reason for decision 29 (a lead's owner and its meeting's host shouldn't split, and a rotation keeps one count) without a second owner mechanism.
- **Always pick at submit (as built).** Simplest, but the owner and the host of the lead's first meeting often differ, and the rotation counts the lead twice.
- **"Hand over to routing" as a new owner kind** (the original decision 30). A second way to set an owner beside the form's own setting, which already exists and works.

**No Last resort owner**: it belonged to the workspace setup. When `pickLeadOwner` finds nobody, the form's notify list (its maker at least, migration 0129) is still told, so no lead is lost. **No "New lead for you" email**: spec 0023's new submission notice already goes to the lead's owner; a waiting owner gets it when assigned.

### No show (decision 28)

Built by spec 0043 and widened by J4: anyone who may act on the booking marks it from its start, with no end. Keeping it as built: a 7 day end would refuse late but true marks, and learning recounts every night anyway, so a late mark simply changes Held at the next run. Held is counted 7 days after the meeting, so a booking enters learning with its likely final state.

### Smaller calls, each as built or decided

- **Owner only permissions (AC-1227)**: five, with `security.manage` (spec 0033). The pinned table builds them from grant `owner`, so a later owner only permission needs no change here.
- **API keys and `schedule.*` (AC-1245)**: as built, keys never hold the four. A key has no member behind it, and decision 7 says reach over owners and admins comes only from their built in roles or their own grant; a key holding `schedule.manage` would be reach without a person. `availability.own` and `routing.manage` stay key scopes (harmless without a person, and an integration may read settings).
- **Locks (AC-1321)**: as built, one advisory lock per key, in id order, with no restart. Taking them one statement at a time changes nothing about deadlock safety (the order is what matters). Not restarting is safer than the plan: a stand in whose time off changed between the read and the locks isn't in the set, so they are never seated (the seat picks from the rotation as usual) and nobody is ever booked without their lock.
- **Rotations that follow a team (AC-1327, AC-1442)**: the `rotations.follows` pattern of the workspace link, extended to `'team'` with `follows_team_id`, read through `rotation_roster`. Options: follow on read (chosen: nothing to keep in step, a joiner bookable at once, no refusal when a team grows); stored members synced on every team change (the original plan: a write hook on every membership change, a 409 when the team passes 20, drift if a hook is missed). **The 20 member cap doesn't apply to a following rotation**, as it doesn't to the everyone rotation: the cap guarded stored rows and the lock set, and the everyone rotation already lives with one lock per free candidate at that time. Stored rotations keep 2 to 20. Leaving the team deletes the leaver's stored settings for that rotation, so a rejoiner starts at the pool's average (the plan's rule) and doesn't get a burst of meetings.
- **The health sweep (AC-1311)**: state one hour. The crontab asks for every 15 minutes, but `brij-crm` drains jobs hourly on Vercel's Hobby plan (Timefix adds a 15 minute cron), and the mass outage count already looks at the last hour, so the rules hold at either cadence. A setting per deployment would be a knob nobody turns.
- **A delegation's granter** is its `updated_by` (a level change is a new grant by whoever made it); `created_by` is who first granted it.
- **Co hosts** act on a booking as its host does (`bookingAccess` answers `act`), which the Booking actions table now says.
- **The 400 override limit** landed with the Roster (J6), answering `CONFIG_INVALID` (there is no `VALUE_INVALID` code).
- **Guests before custom roles**: AC-1229, AC-1432 and the Roles screen assume Guest exists. P2 (spec 0031 slice 9, after teams) lands before L4, so the Roles screen never ships without it and custom roles never have to be retrofitted around it. Until then, the `rotation_roster` view and the time off and scheduling code already leave out any role but owner, admin and member.
- **Where things live (AC-1447)**: Bookings tabs in the order Calendar, List, Roster, Availability, Round robin, Routing, Calendars: daily views first, then the member's own setup, then team setup, then connections. The Roster shows only to people who can see someone else (alone it would be a one row grid). Settings keeps account and workspace pages, as the owner's 26 October move made it.
- **Built beyond the plan, recorded rather than undone**: the Roster's link coverage line (AC-1301) and the New meeting warning past a limit (AC-1302) both serve the plan's users and need no design change; "Meetings a day" and "Meetings a week" replace "limits" in labels, matching rotations' caps.

## Calls made without a question

Each child's Numbers table lists its numbers with a runner up; decision 31 asks the owner to accept them. Other calls, each with its runner up:
- Weeks start on Monday in the Team week and for weekly limits (runner up: each viewer's start of week setting, once spec 0025's General settings add one).
- Time off reasons: Vacation, Sick leave, Travel, Public holiday, Other (Cal.com's list; runner up: free text, which can't be filtered).
- The notice gathers by actor and member with a job key, not a table (runner up: a pending notices table, one more thing to clean up).
- The access summary and Members column show reach with its source, not just the result (runner up: the result only).
- One routing setup is enforced by a partial unique index, so allowing several later is a one line migration (runner up: no constraint). Withdrawn 31 October with the setup itself; `routing_settings` is keyed by the workspace.
- Segment keys are text (`attribute=option;attribute=option` since 31 October), so a changed option set starts a new cell instead of mixing old data (runner up: hashed keys).
- Routed ledger rows keep the rotation's own reason when the ranking didn't change the pick, and say `routed` only when it did, so the Distribution tab shows how often smart ranking mattered.
- `members.visible` is the one list behind every member picker for scheduling (runner up: each screen asks its own question).

## References

**Project sources**: specs 0009, 0023 (and `0023-types-and-logic.md`, `0023-public-surface.md` on `wip/forms-track`), 0024, 0025 (and `0025-calcom-alignment.md`), 0026, 0029, 0030, 0031, 0032, 0034, 0035; `docs/plan/roadmap-2026-10-20.md`; `docs/scope/team-and-security.md` (#23, #24), `docs/scope/integrations.md` (#44, #58, #59); code at 55919346: `packages/contracts/src/access.ts`, `packages/core/src/access/{door,policy,table,check}.ts`, `packages/core/src/booking/{slots,host,list,change,blocks,connected}.ts`, `packages/db/src/schema/{booking,calendar,workspaces}.ts`; `wip/members` (80f08e6c: invitations, `audit_events`, `roles.ts`) and `wip/schedules` (7a9d7720 and its working tree: `availability_schedules`, `mayChange` and `targetMember` in `packages/core/src/availability/schedules.ts`).

**Project sources for the 31 October amendment** (main 298735334): spec [0043](../0043-lead-routing/index.md) and its rationale; spec [0057](../0057-booking-page-questions.md); migrations 0074, 0088, 0089, 0115, 0125, 0127, 0128, 0129, 0133 and 0134; `packages/contracts/src/{access.ts,forms/routing.ts,booking/rotations.ts,booking/settings.ts}`; `packages/core/src/routing/{decide,forms,booking,facts}.ts`, `packages/core/src/rotation/{assign,owner,roster}.ts`, `packages/core/src/forms/{process,notify}.ts`, `packages/core/src/booking/{change,seen}.ts`, `packages/core/src/scheduling/delegations.ts`; `apps/api/src/jobs/calendar-health.ts`, `.github/workflows/jobs.yml`; `apps/web/src/features/bookings/tabs.ts`; the commits listed in [index.md](index.md#what-is-built-main-298735334).

**Timefix** (the owner's earlier app, read only): `FEATURES.md`, `PRODUCT.md`, `docs/availability-model.md`, `docs/roster.md`, `docs/team-calendar.md`, `docs/access-and-mapping.md`, `docs/care-programmes-and-routing.md`, `docs/scheduling-agents.md`, `docs/qa-plan.md`, `docs/magnets-and-sequences.md`, `packages/core/src/{org,authz,schedule-log,calendar-health,team-grid}.ts`, `packages/core/src/db/schema/{organizations,schedules,calendar-connections,icp}.ts`, `packages/core/src/db/queries/{organizations,team-calendar}.ts`, `timefixapp/src/lib/team-write.ts`, `timefixapp/src/app/(dashboard)/[workspace]/apps/bookings/team/actions.ts`, `timefixapp/src/app/(dashboard)/[workspace]/settings/team/page.tsx`, migrations 0071, 0073, 0074, 0082.

**Best in class** (searched 21 October 2026):
- Cal.com round robin (priority, weights and the new host adjustment, fixed hosts, round robin groups, reassign): https://cal.com/help/event-types/round-robin
- Cal.com managed event types (locked fields, propagation): https://cal.com/help/event-types/managed-events
- Cal.com routing with attributes and fallback members: https://cal.com/help/routing/routing-with-attributes and https://cal.com/help/routing/routing-overview
- Cal.com out of office with a redirect to a teammate: https://cal.com/help/availabilities/out-of-office
- Calendly round robin, "Optimize for availability" and "equal distribution" (within three meetings): https://calendly.com/help/round-robin-distribution-overview
- Calendly admins managing users' availability, by host or for all hosts, and event type permissions: https://calendly.com/help/how-to-manage-availability-for-your-users
- Chili Piper weights and calibration: https://help.chilipiper.com/hc/en-us/community/posts/20310236921363-Tips-to-ensure-a-fair-Round-Robin-distribution-among-your-reps and https://www.chilipiper.com/intelligent-meeting-distribution/
- HubSpot round robin meeting links and "Prioritize contact owner": https://knowledge.hubspot.com/meetings-tool/understand-group-and-round-robin-meeting-availability
- HubSpot permissions (All records, their team's, their own; property view and edit levels): https://knowledge.hubspot.com/user-management/hubspot-user-permissions-guide
- Salesforce profiles and permission sets: https://www.salesforceben.com/permission-sets-vs-profiles-why-most-orgs-are-still-stuck/ and https://blog.netwrix.com/understanding-roles-profiles-and-permission-sets-in-salesforce/
- Linear roles (Owner, Admin, Member, Guest), team owners and private teams: https://linear.app/docs/members-roles
- Attio object access (workspace, team and member levels; admins see everything): https://attio.com/help/reference/managing-your-data/objects/manage-access-to-objects and https://attio.com/help/reference/users-and-permissions/manage-members-and-admins

**Screens** (Mobbin, web, 21 October 2026):
- Roles: PandaDoc built in and custom roles https://mobbin.com/screens/45354dd7-0e9e-4597-b6d0-7b0e0e307dc9 ; Shopify grouped permissions with counts https://mobbin.com/screens/8a478eef-4fda-457e-90ea-77218ede07ef ; StackAI roles matrix https://mobbin.com/screens/cdb99363-8bc0-4c12-8127-96b001fae463 ; Vanta permission details https://mobbin.com/screens/6dd83a18-ede6-44a5-adc5-2ebff239c7de ; Klaviyo levels per area https://mobbin.com/screens/0a9158f6-3c02-4718-aead-7ad8e7051f85 ; Workable role change confirm https://mobbin.com/screens/fa11feb3-58b7-45c4-9cd3-9e71765fc3bc
- Team availability: Cal.com Team Availability https://mobbin.com/screens/60f3492c-3bff-43c6-abb2-7f0da24f1cbf ; Square team availability grid https://mobbin.com/screens/784bbf80-5fb1-4250-af8f-5e15f49745c3 ; Wix staff working hours with split days https://mobbin.com/screens/28829b47-b168-454a-b086-0ce4defdd3bd ; Lyssna team members with "check availability on" and a booking calendar https://mobbin.com/screens/4e937b87-ad95-43a1-81de-8c9c8d04ceed ; Fresha "not working" warning https://mobbin.com/screens/0b033b75-05fa-4d28-9d26-086b20351f56
- Round robin and routing: Calendly rotating host pool https://mobbin.com/screens/fc635bae-c81f-4af0-be10-dd9bd37e198e ; Cal.com assignment and fixed hosts https://mobbin.com/screens/b940c6e8-5a13-4ccd-a32a-0e36089b1721 ; HubSpot contact owner assignment https://mobbin.com/screens/5f04ff6c-1376-4a10-bbd5-fee217250c43 ; Zoom Scheduler routing logic https://mobbin.com/screens/662ceae1-1e30-406d-bd12-232f4021851c
- Time off: Cal.com Go Out of Office https://mobbin.com/screens/eae781e2-ca01-45c3-bb56-7220cabb5c4c ; Front time off for a teammate https://mobbin.com/screens/0e15fee4-b496-4085-ae40-b8f8a9325d7e ; Fresha add time off https://mobbin.com/screens/8866c5e9-dddf-43ef-a0e1-84d4fe4e3737
