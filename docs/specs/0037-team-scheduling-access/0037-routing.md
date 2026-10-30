# 0037 · Routing: one team link for sales calls, assigned by rules, fit and what has worked

**Part of**: [index.md](index.md) (owner decisions 23 to 31). **ACs**: AC-1351 to AC-1393. **Status**: decisions accepted 21 October 2026; **amended 31 October 2026** to build on what spec 0043 shipped instead of replacing it (decisions 23, 24, 28, 29 and 30 changed, see [index.md](index.md#owner-decisions) and [rationale.md](rationale.md#amendments-of-31-october-2026)). Each criterion below says whether it is built, and if not, which lane builds it.
**Pulls in**: the routing that scope #58 asks for ("by rules first, for example by region or company size, and the rotation as the fallback") and that spec 0029 decision 10 deferred.
**Builds on**: [spec 0043](../0043-lead-routing/index.md) (rules per form and per team page, `routing_decisions`, the per rule report, No show), spec 0029 (rotations, the ledger, `pickLeadOwner`, the form owner rotation of migration 0089), spec 0023 (hosted forms, the `fb1` hand off, the new submission notice), spec 0025 (booking pages), spec [0057](../0057-booking-page-questions.md) (a booking page's own questions), the workspace link (migration 0128), [0037-round-robin.md](0037-round-robin.md) (fixed hosts plus rotations, returning guests), [0037-time-off-and-roster.md](0037-time-off-and-roster.md) (time off, stand ins).

## The owner's ask (21 October 2026, verbatim)

"also roundrobin for whole sales setup calls. where a meeting is booked on team link and anyone of team is assigned based on the qualification and type? can this be smart and also trained so it's a one format"

How this child reads it (each reading is an owner decision in [index.md](index.md)):
- **"Team link"**: one public front door for sales calls. Since 31 October it is two doors with one story (decision 24, amended): the **workspace link** (a team booking page that books whoever is free, migration 0128) and, when a team offers several meeting types or turns some visitors away, a **team link**: a form in front of the team pages whose rules pick the meeting type.
- **"Assigned based on the qualification and type"**: the visitor's answers choose the meeting type or another ending (a form's rules); what the CRM already knows and the page's own questions choose among the hosts (a team page's rules), with the rotation as the fallback (decision 25).
- **"Smart"**: inside the hosts the rules allow, the free reps are ranked by fit (skills such as language, region, segment), by fairness, and by their track record with similar leads; every booking records why that rep was chosen (decision 25).
- **"Trained"**: it learns from this workspace's own outcomes (held, no show, deal created, deal won) per team page and segment; it starts as a plain fair rotation until there is enough data, admins cap how far it may tilt away from fair shares, it never uses personal traits, and every assignment is explained (decisions 26 to 28).
- **"One format"**: one rule format for every surface (spec 0043's rules, the same on forms and team pages), one ranking, one learning model and one place to see every decision (Bookings › Routing), so every lead is judged the same way and outcomes compare (decision 23, amended).

## Two lessons from timefix, taken as constraints

- **Assignment stays deterministic, with no AI call while a visitor waits.** Timefix removed AI from its booking path and wrote down that assignment (round robin, balanced, sticky) "must not become an agent" (`docs/scheduling-agents.md` §3, `FEATURES.md` §2). Here, the rules and the ranking are plain functions of stored data; "trained" means counts of outcomes, recomputed nightly; an AI step is at most an optional background classifier (decision 27).
- **Smart must work with nothing configured.** Timefix built lead scoring with a rules editor and deleted it because no account ever saved a ruleset (`FEATURES.md`, CRM settings, 3 September 2026). Here, with no rules the routing is a fair rotation, fit needs only the skills people already have, and learning switches itself on when the data is there; nobody has to write a score.

## What main already has (31 October 2026, main 298735334)

| Piece | Where | From |
|---|---|---|
| The rule shape: `RoutingRule` `{ id, name?, when, then, qualified? }`, `when` a `ShowWhen` of 1 to 5 conditions, at most 20 rules per surface (`ROUTING_RULES_MAX`) | `packages/contracts/src/forms/routing.ts` | spec 0043 |
| Routes: `book` (page, optional hosts up to 8), `message`, `redirect` on forms; `hosts` on team pages | same file (`FORM_ROUTES`, `PAGE_ROUTES`) | spec 0043 |
| A form's rules in its document (`routing`), a team page's in `booking_pages.routing` (jsonb), only round robin pages | `forms/document.ts`, migration 0074 | spec 0043 |
| `decideRoute(rules, facts, { unreadable, routes })`: first match, unreadable facts skip a rule | `packages/core/src/routing/decide.ts` | spec 0043 |
| `routeSubmission` (forms, answers and hidden fields only), `routeBooking` and `recordBookingRouting` (team pages, record facts by the guest's email, at most 10, `RECORD_FACTS_MAX`) | `packages/core/src/routing/{forms,booking,facts}.ts` | spec 0043 |
| `routing_decisions`: `surface_kind` (`form` or `booking_page`), `surface_id`, `rule_id`, `qualified`, `skipped`, `submission_id`, `routed_page_id`, `hosts`, `booking_id`, `decided_at`; one row per submission and one per team page booking (migration 0088), forced row level security | migrations 0074 and 0088 | spec 0043 |
| The per rule Report (`routing.report`), the Routing card (`RulesCard`) on the form's Settings tab and the team page's Hosts tab | `apps/web/src/features/routing/` | spec 0043 |
| No show: `bookings.no_show_at`, `no_show_by_member_id`, `bookings.markNoShow`, audited `booking.no_show` and `booking.no_show_undone` | migration 0074, `packages/core/src/booking/change.ts` | spec 0043, widened by J4 |
| A form lead's owner from a rotation: `forms.owner_rotation_id` and `pickLeadOwner` (strategy, caps, time off, returning `owner`, `kept` when the record has an owner) | migration 0089, `packages/core/src/rotation/owner.ts` | spec 0029 milestone 3 |
| The new submission notice to the lead's owner and the form's listed members | `packages/core/src/forms/notify.ts`, migrations 0129 and 0130 | spec 0023 |
| The workspace link: `booking_pages.scope = 'workspace'`, the everyone rotation (`rotations.follows = 'everyone'`) read through the `rotation_roster` view | migration 0128 | owner, 30 October |
| A booking page's own questions | migration 0115 | spec 0057 |
| The permission `routing.manage` (grant `admin`) in the catalog, checked nowhere yet | `packages/contracts/src/access.ts` | J1 |

## Summary

Routing keeps spec 0043's rules where they already live: **a form's rules** read the visitor's answers and choose what they get next (a team page, a message, a link), and **a team page's rules** read what the CRM knows, the handing form's answers and the page's own questions, and only choose among its hosts. That split is the visitor rule and host rule split of the original plan, enforced by where a rule lives, so nothing about the CRM shows to an anonymous visitor. Nothing migrates. On top, one **Routing** tab under Bookings holds only what every surface shares: a list of every routed surface, a **Decisions** log across them, **Skills**, **Test**, the **Smart** settings and **Insights**. The **workspace link** is the team's booking page; a **team link** is a form in front of team pages, made in one step from Captures. When a team page books, the free reps its rules allow are **ranked**: the rotation's own fair order, nudged by **fit** (their skills against the lead) and, once a segment has enough finished meetings, by a **learned lift** over the team's rate, never by more than the admin's **fairness allowance**, with a small holdout left plain fair. Every decision explains itself. A nightly job **learns** from outcomes. A form lead's owner follows its meeting when the two share a rotation, else comes from the form's owner setting as today.

## User stories

- As a sales lead, I want one link on our website that gets every prospect to the right rep: enterprise to the enterprise team, Spanish speakers to someone who speaks Spanish, existing customers to their account owner.
- As a visitor, I want to answer a few questions and see times that work, without choosing a person.
- As a sales lead, I want people who aren't a fit sent to a self serve page or a group demo, not a rep's calendar.
- As a sales lead, I want the best closer for mid market setup calls to get a little more of them, but never so much that the rest of the team starves.
- As a rep, I want to see why a meeting came to me, and to know my share stays near fair.
- As an admin, I want to test the rules, see every decision in one place, and switch the smart part off if I don't trust it.

## Acceptance criteria

Each criterion ends with its state: **built** (on main, with where it came from), or the lane that builds it (L6 to L9, see [index.md](index.md#build-plan)); **withdrawn** ones stay listed so their numbers never get reused.

*The shape*
- **AC-1351**: Rules stay on their surfaces (spec 0043): a form's rules in its document, a team page's in `booking_pages.routing`, each edited where it lives by whoever may edit that form or page. There is no workspace rule list and no published routing versions. What every surface shares lives in one place per workspace, **Bookings › Routing**, changed only by holders of `routing.manage` (owners and admins, grant `admin`): skills (AC-1382), the smart settings (AC-1374), Won means (AC-1385), and the reads across surfaces (AC-1383). Its settings are one `routing_settings` row per workspace; a workspace without the row uses the defaults in Numbers. *L6* (the tab and the permission check; each later lane adds the settings it needs).
- **AC-1352**: The facts a rule reads, by surface. A form's rules read its own answers and hidden fields (`hidden.*`), never what the CRM knows: record facts are unreadable on a form, so a visitor's next step never depends on the CRM. A team page's rules read record facts of the person matched by the guest's exact email and of that person's company (`person.<attributeId>`, `company.<attributeId>`, at most 10 a page), the answers of the form that handed the visitor over, and the page's own questions' answers (spec 0057) by question key; when the form and the page asked the same key, the page's answer wins, since it was given last. AC-1393 adds deal facts and Known. *Built (spec 0043), except the page's own answers: L6.*
- **AC-1353**: Captures › Links › New offers **Team link** beside Workspace link, to holders of `forms.manage`. It makes an ordinary form (spec 0023) titled "Book a call" with Name and Email, then "What would you like to book?" (one choice per live team page the maker may use, the workspace link first, up to 8), one rule per choice whose route books that page, and the workspace link (else the first team page) as its After someone sends it; then it opens the form's editor. From then on it is a form like any other: questions, rules and style are edited in the form editor. With no live team page the option is disabled with "Make a team page or the workspace link first." *L6.*
- **AC-1354**: Each team page has a learning objective: Deals created (the default), Deals won (offered only once Won means is set, AC-1385) or Meetings held, stored in `booking_pages.routing_objective` (null reads as Deals created) and set on Routing › Smart, one row per team page. *L9.*
- **AC-1355**: Rules: 0 to 20 per surface, tried in order; the first whose condition (all or any of 1 to 5 comparisons: is, is not, is any of, contains, is answered, is empty, more than, less than) matches decides, else the surface's fallback (a form's After someone sends it; a team page's whole rotation). A form's rules are decision 25's **visitor rules** (they choose the next step) and a team page's are its **host rules** (they only choose among hosts); the split is by surface, so no publish check is needed for it. A rule reading a fact that can't be read is skipped, never matched, and the decision lists it in `skipped`. *Built (spec 0043, AC-1601, AC-1602, AC-1604, AC-1608).*
- **AC-1356**: Routes: on a form, `book` (a booking page, and on a team page optionally its hosts), `message` (up to 500 characters) or `redirect` (an https address); on a team page, `hosts`. Hosts are 1 to 8 named members of the page's rotations, or **required skills**: the members of the page's rotations holding each of 1 to 3 skills, with "If none of them is free: use the whole rotation". There is no owner outcome and no assign outcome: a returning guest's owner or last host is the rotation's own rule (AC-1328, with stand ins, AC-1284), and a form lead's owner is the form's owner setting (AC-1372, AC-1423). *Built (spec 0043), except required skills: L7.*

*The team link and the workspace link*
- **AC-1357**: One story, two doors. The **workspace link** is the team's booking page: one address that books whoever is free, which can ask its own questions and whose own rules choose hosts. A **team link** is a form in front of one or more team pages (the workspace link among them) whose rules choose the meeting type or an ending, handing the visitor to the page with the hand off (AC-1359). A visitor who opens the workspace link directly still goes through its rules and the ranking. Both doors write the same decision rows, so one Decisions log, one Report per surface and one learning model cover both: a test books the workspace link directly and through a team link and finds both decisions in Decisions. *L6.*
- **AC-1358**: Before a form answers a `book` route (a rule's or its fallback's), it checks once that the page, with the route's hosts, has a free time in the next 14 days for its first length (spec 0029's union slots, cached busy times). With none, the form's After someone sends it applies instead; when that is a page with no free time too, the visitor reads "Thanks. Someone from our team will contact you." The lead's owner then comes from the form's owner setting at once (AC-1372 never waits for a booking that can't happen). The decision records each step in `steps` ("Intro call had no free time in 14 days; used After someone sends it"). *L6.*
- **AC-1359**: For a booking route, the visitor reaches the page through the forms track's hand off, unchanged (the `fb1` token of the submission and page ids in the tab's session storage); the page's slots and book requests carry it, the server finds the decision by its submission (`routing_decisions_one_per_submission`), never from the browser, and offers only the decision's hosts' free times, answers prefilled. *Built (spec 0023, AC-1057, AC-1058; spec 0043, AC-1609).*
- **AC-1360**: A message route shows its message; a redirect sends the visitor to the address; the decision records which. *Built (spec 0043, AC-1604, AC-1606).*
- **AC-1388**: A team page (the workspace link included) has **Only through a form**, off by default, so no page changes behaviour on its own. When on, the page books only with a valid hand off; without one it answers with its existing unavailable state, so nobody skips a team link's questions by keeping the page's address. It is `booking_pages.form_only`, changed by whoever may edit the page, in the Hosts tab under the Routing card. The rail's AvatarStack always shows the page's own hosts (AC-1339), never a routed narrowing. *L6.*

*Who gets the meeting*
- **AC-1361**: The smart ranking runs at every team page booking (routed or not, the workspace link included) for each rotation seat with 2 or more free candidates, after the page's host rules narrowed them and after the rotation's returning guest rule (AC-1365). It orders candidates within the rotation's strategy (Fair, Priority or Even) under the locks as built (AC-1321). With smart mode Off, or nothing to rank, the pick is exactly today's. *L8.*
- **AC-1362**: Fit: each fit link joins one option of a select or status attribute on People, Companies or Deals to one skill ("Preferred language is Spanish" to the Spanish skill). A link applies when the lead has that option: the answer of a question that files to that attribute (the handing form's or the page's own), else the attribute's value on the matched person, their company, or their latest open deal. A candidate's fit is the share of applying links whose skill they hold, from 0 to 1; with no applying link, everyone's fit is 0. *L8.*
- **AC-1363**: The smart ranking: each candidate's load is (their count in the window plus calibration) × 100 ÷ weight (as AC-1325); their preference is their fit (mode Fit), or the mean of their fit and their learned lift (mode Learn), from 0 to 1; the pick is the lowest load minus slack × preference, where slack is the larger of the fairness allowance (`routing_settings.tilt_percent`, 0 to 50 percent, default 20) times the pool's mean load, and 1. Ties follow spec 0029's order; with Priority, priority is compared first. Mode Off, or an allowance of 0, picks exactly as the rotation's own strategy. *L8.*
- **AC-1364**: A property test over random arrivals, random weights (1 to 100), Even, Priority and random availability shows no member's load ends more than the slack plus one meeting's load (100 ÷ their weight) above the lowest switched on member's, whatever the preferences. The Smart tab states the live bound in plain words: "Smart routing can give someone up to 3 more meetings than the least busy person in the last 30 days." *L8.*
- **AC-1365**: Before ranking, the rotation's Returning guests go to (AC-1328) applies with stand ins (AC-1284), as built; the ranking only orders the rest. *L8.*
- **AC-1389**: A holdout keeps learning honest: a share of ranked decisions (default 10 percent, admins set 0 to 20), chosen by a hash of the decision id so replays agree, picks with mode Off and is recorded as holdout (`routing_decisions.holdout`). Insights compares, per team page, the objective's rate for picks the ranking changed, picks it left alone and the holdout, with counts and a 90 percent interval ("Smart routing: 41 percent against 35 percent without it; not yet certain"). *L9.*

*Learning*
- **AC-1366**: Outcomes, per ranked booking: **Deal created** (the booking created a deal, or a deal linked to its person, or to their company, was created between the booking and 30 days after the meeting, and no earlier ranked booking for that person, else that company, already claims it); **Deal won** (that deal reached a Won means stage within 90 days after the meeting); **Held** (no No show mark 7 days after the meeting; a later mark or undo changes the outcome at the next nightly run, because every run counts again from the bookings). A booking counts toward its page's objective only once its outcome window has passed. *L9.*
- **AC-1367**: No show, as built: whoever may act on the booking (the host, a co host, the page's owner, `booking.admin`, or Manage over the host or a co host, `bookingAccess` answering `act`) marks it No show, and undoes it, from its start with no end (`bookings.markNoShow`; one that hasn't started, or is cancelled, answers 409 `BOOKING_CLOSED`). Each change writes one audit row, `booking.no_show` or `booking.no_show_undone`, and stores `bookings.no_show_at` and `no_show_by_member_id` (migration 0074). It shows on Bookings; page editors join with L2's editors and the Team day shows it with J12. Each member's marking rate is in Insights (AC-1376). *Built (spec 0043 AC-1613, widened by J4).*
- **AC-1368**: Trials are intent to treat: one per ranked decision (a rotation seat with 2 or more candidates after host rules, not a holdout, not a returning guest's owner, last host or stand in), credited to the member the ranking picked (the ledger row's original member, even if voided later), one per person per team page per learning window. A cancellation by the host and a reassignment count as a failure for every objective; a guest's cancellation before the meeting counts as a failure for Held and stays a trial for the deal objectives. *L9.*
- **AC-1369**: A cell is (team page, the seat's rotation, segment, the page's current objective). Its team rate is the sum of successes over the sum of trials of every member's row in it; it is warm when that sum of trials is at least 100. A member's smoothed rate is (successes + 20 × team rate) ÷ (trials + 20), and their learned lift is that rate minus the team rate, divided by 10 percentage points, kept between 0 and 1, and 0 when the difference is under 2 points; so two reps at 35.1 and 35.2 percent get nothing. A cold cell falls back to the page's all segments cell for that rotation when warm; else learning gives 0. *L9.*
- **AC-1370**: Learning sees only the team page, the rotation, the segment, the member's id and outcomes. A segment is the values of at most 2 **segment attributes**, each a select or status attribute of Companies or Deals with at most 6 options (never People), chosen on the Smart tab; a lead's value is the answer of a question that files to it, else the record's. A missing value makes the `?` segment, which is never warm and always uses the all segments cell. Each ranked decision stamps its `segment_key`; changing the segment attributes restarts segment learning (Insights says so) while the all segments cells carry on. Nothing about a member but their id is used, and nothing is learned or shared across workspaces. *L9.*
- **AC-1386**: "Learn from" (a date) makes the next nightly run ignore outcomes of bookings made before it, so a team can restart learning after it changes how it sells; Insights shows the date. *L9.*

*Leads that don't book*
- **AC-1371**: *Withdrawn 31 October 2026* (decision 30 reversed): forms keep their own rules and owner setting, so there is no "Hand over to routing". AC-1357, AC-1372 and AC-1423 say how a form and the team pages meet.
- **AC-1372**: A lead's owner follows its meeting when the two share a rotation. When a form's owner is a rotation (`forms.owner_rotation_id`) and a submission's route books a team page that uses that same rotation, the owner waits for the booking: the host the page picks from that rotation becomes the lead's owner, and the booking's ledger row is the one count for both (no `form` row). If no booking is made within the hand off's life (24 hours), a job (`routing.assign_unbooked`, 5 minutes after it expires) picks the owner through `pickLeadOwner` as the submission's form actor. Exactly one path assigns: the booking and the job each first claim the form's decision row (`update routing_decisions set assigned_member_id = …, assigned_at = now() where id = … and assigned_at is null`), and only the winner writes the owner; a booking that loses still books its host. Booking refuses an expired hand off. In every other case (an owner who is a member, a route that isn't a booking, a rotation the page doesn't use, no free time under AC-1358) the owner is picked at submit, as today. Such a form writes its decision row even when it has no rules (rule id null, its fallback page as `routed_page_id`), so there is always a row to claim. *L8.*
- **AC-1390**: *Withdrawn 31 October 2026*: with no workspace routing setup there is no Last resort owner. When `pickLeadOwner` has nobody to pick (`none`), the lead keeps no owner and the form's notify list (migration 0129, which always holds its maker unless removed) is told of the submission as today, so no lead goes unseen.
- **AC-1391**: The lead's owner hears of the lead once, when the owner is known: a waiting owner (AC-1372) gets spec 0023's new submission notice (`notify.ts`, reason `lead`) when the booking or the job assigns them, not at submit; the form's listed members are told at submit, as today. There is no separate "New lead for you" email: the submission notice is that email. *L8.*

*Explanations, overrides and audit*
- **AC-1373**: At booking, a ranked seat freezes a snapshot of every candidate's numbers (load, fair share, fit, trials, successes, smoothed rate, team rate, learned lift, slack, the smart mode, holdout, the model version) in the page's decision row (`routing_decisions.snapshot`), and every explanation is built from that snapshot, never from `routing_stats`. Explanations have two tiers. Anyone who may see the booking sees the rule (by name, or its condition's summary), the hosts it allowed, the picked rep's matched skills and "picked by fair share" or "picked by track record" ("Rule 2 chose Mid market. Sam Lee: speaks Spanish; picked by track record."). The picked rep also sees their own numbers ("3 of 11 in the last 30 days, fair share 3.7; 48 percent to a deal, team 35 percent"). Other candidates' numbers and every rate show only to holders of `routing.manage`. Window wording follows the rotation's window. *L8.*
- **AC-1374**: Admins steer it: rules come first on each surface; the Smart tab sets the mode (Off, Fit, Learn), the fairness allowance and the fit links (L8), the holdout, segment attributes, Learn from and each team page's objective (L9); required skills sit in host routes (L7); any booking can be reassigned (AC-1337). Rule changes stay audited as `routing.changed` (spec 0043); every settings change writes `routing.settings_changed` and every skill change `routing.skills_changed`, with before and after. *L8.*
- **AC-1375**: Who sees decisions: holders of `routing.manage` every decision, in Routing › Decisions; a surface's editors its Report (spec 0043, AC-1612); anyone who may see a booking its explanation (AC-1373). Every member facing read of a decision shows record facts through the viewer's own scope (`visibleAttributes` and the record rule): a fact on an attribute or record the viewer can't see reads "Hidden", and a decision whose person record they can't see is left out. *L6.*

*Insights*
- **AC-1376**: Routing › Insights (holders of `routing.manage`) shows, per team page and segment, the ranked bookings in the learning window, the team's rate for the objective, whether learning is on ("Learning starts after 100 finished meetings: 37 so far, 12 more waiting for their outcome, ready from 4 December"), the holdout comparison (AC-1389), and per member their trials, smoothed rate, share against their fair share, and their No show marking rate beside the team's. A member sees their own numbers in their own bookings' explanations (AC-1373), not in a tab. *L9.*

*Access, privacy and safety*
- **AC-1377**: Record facts are read only for a team page's rules, inside the booking's own transaction under the public booking page's scope, and only the attributes those rules name (at most 10); nothing reads them for a form's rules, and nothing writes CRM data while deciding. There is no router principal. AC-1393's deal facts and Known follow the same rule. *Built (spec 0043); L7 keeps it for the new facts.*
- **AC-1378**: Public answers never include facts, rules, which rule matched, member names before booking, counts or scores. A test submits a team link twice with the same answers and two emails, one the CRM knows as a customer: both answers have the same `next` kind and page. *Built by design (spec 0043); L6 adds the test.*
- **AC-1379**: No AI call happens anywhere in the routing path (decision 27); if the owner later turns on AI classification, it runs only as a background step that fills an attribute, labelled AI, and never at submit or at booking. A source scan finds no AI vendor import under `packages/core/src/routing/`. *L8.*
- **AC-1392**: Routing › Test (`routing.test`, `routing.manage`) runs a chosen surface's live rules (a form, or a team page) on typed answers and an email, resolves record facts under the caller's own scope, shows the decision it would make as its explanation, stores nothing, and writes one audit row per run that names an email (`routing.tested`). *L7.*
- **AC-1393**: A team page's rules gain deal facts and Known: `deal.<attributeId>` reads the most recently updated open deal linked to the matched person, else to their company; `known` is New, Known person, Known company or Customer (a deal of the person or their company in a Won means stage, offered only once Won means is set). Both are record facts, so only a team page's rules read them (AC-1352, AC-1377). *L7.*

*Performance and the nightly run*
- **AC-1380**: A team link's submit is answered within 1.5 s p75 and 3 s p95 server time for a team page of 20 hosts, AC-1358's free time check included; past 2.5 s of checking, the submit answers the route unchecked and records "free time not checked: timeout". Ranking at booking (L8) adds one indexed read, under 20 ms p95. *L6.*
- **AC-1381**: The nightly learning job runs in the heavy lane in batches (one team page per batch, with a checkpoint), writes the new model version beside the old one and switches in its last batch, so bookings never wait on it. An hourly cron enqueues it for each workspace whose local time is 03:00 (spec 0031 slice 7's `workspaces.time_zone`), spread over 30 minutes by a hash of the workspace, keyed by workspace and date, and skips a workspace where nothing it reads changed since `routing_settings.model_trained_at`. It finishes within 60 seconds of worker time for 100,000 ranked bookings on the seed. A partial index `routing_decisions (workspace_id, decided_at) where snapshot is not null` serves it. *L9.*

*Skills, screens and quality*
- **AC-1382**: Routing › Skills: up to 100 skills in groups (Language, Region, Segment, Product, Other), each named 1 to 40 characters, unique in its group ignoring case; members gain skills from a members table on the same tab and from each member's row on Round robin; deleting a skill used by a host route or a fit link is refused 409 `SKILL_IN_USE`, naming where ("Rule 3 of Intro call and 2 fit links"). *L7.*
- **AC-1383**: Bookings › Routing is a Bookings tab after Round robin, shown only to holders of `routing.manage`. Its tabs: **Overview** (every form and team page with rules, and the workspace link always, each with its rule count, its fallback, the last 30 days' matched and booked counts, and a link to edit its rules where they live), **Decisions** (recent decisions across surfaces, filtered by surface, rule, host, qualified and date, each opening its explanation), then **Skills** and **Test** (L7), **Smart** (L8) and **Insights** (L9). No rule is edited here. *L6 (the tab, Overview and Decisions).*
- **AC-1384**: Every screen here is keyboard usable, labelled, meets WCAG AA in both themes and uses the library only; the team link meets spec 0023's public page rules at 375 px and up; `design-system-guardian` and `ux-interaction-reviewer` review it. *L6, and every later routing lane for its own screens.*
- **AC-1385**: "Won means" picks the Deals object's stage attribute (api slug `stage`) and one or more of its options, stored in `routing_settings.won_stage`; Known's Customer (AC-1393) and the Deals won objective (AC-1354) are offered only once it is set. *L7.*
- **AC-1387**: A decision is reproducible: the same rules, facts, smart settings, holdout draw and frozen snapshot give the same pick (a test replays stored decisions through the pure functions). *L8.*

## Design

### Data model

No new decision table: `routing_decisions` (migrations 0074 and 0088) grows. Everything new is a tenant table with forced row level security, the standard policy and audit columns unless noted, and follows AC-1446 (nullable new columns with no default on large tables, `set local lock_timeout = '5s'`, foreign keys and checks `NOT VALID` then validated later).

**`routing_decisions`, new nullable columns** (each added by the lane that first writes it):
- `steps` (jsonb, L6): what happened beyond the rule, in order, as `{ kind, pageId?, reason }` (no free time, fallback used, timeout).
- `assigned_member_id` (uuid, foreign key to `members`) and `assigned_at` (timestamptz) (L8): the lead owner claim of AC-1372, on form rows only.
- `facts` (jsonb, L8): the values the ranking and fit used, as option ids, numbers or yes or no, each marked `answered` or `record`; never free text.
- `snapshot` (jsonb, L8): every candidate's numbers at booking (AC-1373), on team page rows only.
- `holdout` (boolean) and `segment_key` (text: `*` never, `?`, or the canonical `attribute=option;attribute=option`) (L9).
- Index (L9): `routing_decisions (workspace_id, decided_at) where snapshot is not null`, for the nightly run.
- `surface_kind` keeps its two values; the two unique indexes (one row per submission, one per team page booking) stay. Rows still go with their submission (spec 0023's retention and purge) or their booking's person when erased (#36).

**`routing_settings`** (one row per workspace; primary key `workspace_id`; created by the first lane that stores a setting, each later lane adds its columns): `won_stage` (jsonb `{ attributeId, optionIds[] }`, L7); `smart_mode` (text `off` | `fit` | `learn`, default `learn`), `tilt_percent` (smallint 0 to 50, default 20), `fit` (jsonb, up to 100 `{ attributeId, optionId, skillId }`) (L8); `holdout_percent` (smallint 0 to 20, default 10), `segment_attribute_ids` (uuid[], at most 2), `learn_since` (date), `model_version` (int, default 0), `model_trained_at` (timestamptz) (L9). An unknown `smart_mode` reads as `off` (fail closed toward plain fairness).

**`routing_skills`** (L7): `workspace_id`, `id`, `skill_group` (text `language` | `region` | `segment` | `product` | `other`), `name`, `position`. Unique (`workspace_id`, `skill_group`, `lower(name)`). At most 100 per workspace (core).

**`member_skills`** (L7): `workspace_id`, `member_id`, `skill_id`; primary key (`workspace_id`, `member_id`, `skill_id`); foreign keys to `members` and `routing_skills` (cascade); index (`workspace_id`, `skill_id`). Removal deletes a member's rows (spec 0031's removal hook, AC-1440).

**`routing_stats`** (L9): `workspace_id`, `model_version`, `page_id`, `rotation_id`, `segment_key`, `objective` (`held` | `deal` | `won`), `member_id`, `trials`, `successes`, `waiting`. Primary key (`workspace_id`, `model_version`, `page_id`, `rotation_id`, `segment_key`, `objective`, `member_id`); the ranking reads one cell by that prefix. No audit columns (machine written, replaced nightly).

**`booking_pages`**: `form_only` (boolean, not null, default false, L6; `booking_pages` is small, so the default is safe) and `routing_objective` (text, nullable, `deal` | `won` | `held`, L9).

**Not added** (from the original plan): `routers`, `router_versions`, `forms.router_id`, `form_submissions.routing_decision_id`, `bookings.routing_decision_id` (a booking's decisions are found by `routing_decisions.booking_id`), and new No show columns (0074 has them).

### The rule shape

Spec 0043's, unchanged except where marked (contracts `packages/contracts/src/forms/routing.ts`):

```ts
RoutingRule = { id: string; name?: string; when: ShowWhen; then: Route; qualified?: boolean };  // 0 to 20 per surface
Route = { kind: 'book'; bookingPageId: Uuid; hosts?: Hosts; message }     // forms
      | { kind: 'message'; message } | { kind: 'redirect'; url }           // forms
      | { kind: 'hosts'; hosts: Hosts };                                  // team pages
Hosts = Uuid[]                                                            // 1 to 8 members of the page's rotations (built)
      | { requireSkillIds: Uuid[] /* 1 to 3 */; ifNoneFree: 'whole_rotation' };   // L7
FactKey = <question key> | 'hidden.<name>'                                 // forms and team pages
        | 'person.<attributeId>' | 'company.<attributeId>'                 // team pages only (built)
        | 'deal.<attributeId>' | 'known';                                  // team pages only (L7)
```

A team page's question keys (spec 0057) join its fact keys in L6 with the same bare key as a form's questions. Record keys are unreadable on forms by construction (`isRecordFact`), which is what keeps the CRM out of a visitor's next step.

### Deciding (`packages/core/src/routing/`)

- **At submit** (`routeSubmission`, built): decides a form's rules over its answers and hidden fields and writes the `form` row once. L6 adds the free time check of AC-1358 for a `book` route, within AC-1380's time limit, writing `steps`. L8 makes a form whose owner waits for a booking (AC-1372) write its row even with no rules.
- **At a team page booking** (`routeBooking` then `recordBookingRouting`, built): a hand off's hosts win, otherwise the page's rules run over record facts (and, L6, the page's own answers), narrowing the rotation among those free at the slot; if none of them is free the whole rotation picks. L8 then ranks each rotation seat (below) inside the booking's locks, writes `facts` and `snapshot` on the `booking_page` row, and claims the form row for a waiting owner.
- **The unbooked job** (L8, `routing.assign_unbooked`, keyed by the form decision, run 5 minutes after the hand off expires, cancelled when a booking claims the decision): enters as the submission's form actor (spec 0023's `enterAsForm`), claims the decision, and on winning calls `pickLeadOwner` on the form's rotation, files the owner through spec 0023's processing, and queues the lead's notice (AC-1391).

### Ranking (pure, `rankCandidates`, L8)

```
load(c)    = (units in window(c) + calibration(c)) × 100 ÷ weight(c)
fit(c)     = |applying fit links whose skill c holds| ÷ |applying fit links|        (0 when none apply)
teamRate   = Σ successes ÷ Σ trials over every member row of the cell
rate(c)    = (successes(c) + 20 × teamRate) ÷ (trials(c) + 20)
lift(c)    = clamp((rate(c) − teamRate) ÷ 0.10, 0, 1); 0 when rate(c) − teamRate < 0.02; 0 when the cell is cold
pref(c)    = Off or holdout: 0;  Fit: fit(c);  Learn: (fit(c) + lift(c)) ÷ 2
slack      = max(tilt ÷ 100 × mean load of the seat's switched on members, 1)
key(c)     = load(c) − slack × pref(c)
pick       = Even: drop members over the gap; Priority: highest priority first; then the lowest key;
             ties as spec 0029 (priority, longest since their last assignment, member id)
```

The ledger row's reason is the rotation's own (`fair`, `priority`, `even`) when the pick equals what the rotation alone would have picked, else `routed`. The decision's `snapshot` holds every candidate's numbers; the ledger row's `detail` points at the decision. A seat filled by a returning guest's owner, last host or stand in isn't ranked and isn't a trial.

### Learning (job `routing.learn`, L9)

- Scheduled by the hourly fan out of AC-1381, as a named system job (`routing.learn` joins the system kinds allowed to import `@crm/core/system`), heavy lane, one team page per batch with a checkpoint.
- Reads ranked decisions through the partial index, joins each to its booking (status, no show, host, end), the ledger row's original member and its page's current objective, decides outcomes by AC-1366 and trials by AC-1368 (deal links through spec 0014's relationships from the deal to the person or company; won through the stage value's history, spec 0004's `values` with `active_from` and `active_until`), and writes `routing_stats` for `model_version + 1` per segment, for `*`, and for `?`, with the `waiting` counts.
- The learning window is 180 days, or 270 days for Deals won (180 plus its 90 day outcome window), or since `learn_since` when later.
- The last batch switches `routing_settings.model_version` and `model_trained_at`, then deletes versions older than the previous one.
- **Where it runs and what it sees**: in our own worker, as an ordinary job (spec 0008), with SQL over this workspace's tables under row level security; no outside model or service is called and no data leaves the product. The only inputs are those of AC-1370.
- **If AI classification is turned on later** (decision 27, after #54): it runs as a background job through #54's one AI vendor module, sends only one free text answer and the company domain (never a name, email, phone or other record), asks the vendor not to keep or train on them, and writes its result to an attribute marked as set by AI; routing reads it like any other value, and a person can change it.

### Procedures

| Procedure | Key inputs | Key outputs | Access | Key errors | Lane |
|---|---|---|---|---|---|
| `routing.report` | a surface, `days` | per rule counts | the surface's editors | 404 | built |
| `routing.overview` | none | every surface with rules, and the workspace link: kind, name, rule count, fallback, matched and booked in 30 days | `routing.manage` | none | L6 |
| `routing.decisions` | filters (surface, rule, host, qualified, from, to), cursor | decisions with their one line summaries, record facts through the caller's scope (AC-1375) | `routing.manage` | none | L6 |
| `routing.decision` | `id` | the explanation at the caller's tier (AC-1373) | `routing.manage`; the booking's own read carries its explanation for everyone else | 404 | L6 |
| `routing.settings.get`, `routing.settings.set` | the lane's settings, `updatedAt` | settings | `routing.manage` | 409 `STALE`, 422 `VALUE_INVALID` | L7, L8, L9 |
| `routing.skills.list`; `.create`, `.update`, `.delete`; `routing.memberSkills.set` | as named | skills | list: any member; the rest `routing.manage` | 409 `SKILL_IN_USE`, 409 `SKILL_LIMIT` | L7 |
| `routing.test` | `surface`, `answers`, `email?` | the decision it would make (no slot check unless asked) | `routing.manage` | 422 | L7 |
| `routing.insights` | `weeks?` | per page and segment numbers, per member rows | `routing.manage` | none | L9 |
| `booking.pages.update` (changed) | adds `formOnly` (L6), `routingObjective` (L9) | page | as today | as today | L6, L9 |
| `bookings.markNoShow` | `bookingId`, `noShow`, `mutationId` | booking | `bookingAccess` `act` | 404, 409 `BOOKING_CLOSED` | built |
| public `POST /api/public/forms/:publicKey/submissions` (spec 0023) | as spec 0023 | `{ next: message \| redirect \| booking }` | public, spec 0023's key, Origin, challenge and rate limits | as spec 0023 | built; L6 adds the free time check |

### Screens

- **Bookings › Routing** (holders of `routing.manage`): a TopBar with the tab's one line description ("Who gets each meeting, across every form and team page."); tabs Overview, Decisions (L6), Skills, Test (L7), Smart (L8), Insights (L9). **Overview** is a DataTable of surfaces (name, kind, rules, fallback, matched, booked) with "Edit rules" opening the form's Settings tab or the page's Hosts tab. **Decisions** is a DataTable with the filters of AC-1383; a row opens a Panel with the explanation. **Smart**: mode (SegmentedControl Off, Fit, Learn), the fairness allowance (a Field with a percent suffix and the live sentence of AC-1364), fit links (rows: attribute, option, skill), then in L9 the holdout, segment attributes, Learn from and each team page's objective. **Skills**: groups of skills and a members table with skill pickers. **Test**: a surface Select, its questions, an email Field and the decision shown as its explanation.
- **The Routing card** (`RulesCard`, built) on the form's Settings tab and the team page's Hosts tab: L6 lists the page's own questions among the facts; L7 adds "Members with skills" beside named members in the hosts picker; L6 adds the Only through a form Switch under the card on team pages.
- **Captures › Links › New**: the Team link option (L6), beside Workspace link.
- **The booking's detail and the record's timeline**: the explanation at the viewer's tier (AC-1373) in the "Why Sam" disclosure that round robin already shows.
- References: Cal.com's routing forms with attributes and fallback members, HubSpot's "Assign to: contact owner; if there is no contact owner, assign to; only to available users", Zoom Scheduler's routing logic, Chili Piper's weighted fair round robin.

### Value sourcing

| Action | Value | Source |
|---|---|---|
| Submit | the next step | the form's rules over its answers and hidden fields (`decideRoute`), else After someone sends it |
| Submit | free time for a `book` route | spec 0029's union slots for the page and the route's hosts over 14 days, first length, cached busy times |
| Submit | the lead's owner | the form's owner setting at submit, unless AC-1372's wait applies |
| Team page booking | the person, the company | spec 0023's match by exact email, read only; the company only through the person's company relationship |
| Team page booking | record facts | the attributes the page's rules name, on the person, their company, or (L7) their latest open deal |
| Team page booking | page answers | the booking's own answers to the page's questions (spec 0057), by question key |
| Team page booking | Known (L7) | the matched person, their company, and a deal in a `won_stage` option |
| Team page booking | candidates | the seat's rotation members free at the slot, after host rules, caps, limits and time off |
| Ranking | load, weight, calibration | spec 0029's ledger (sum of `units`) and the `rotation_roster` view |
| Ranking | fit | `routing_settings.fit`, the lead's options (answers that file to the attribute, else the record), `member_skills` |
| Ranking | team rate, warm, lift | `routing_stats` at `routing_settings.model_version` for (page, rotation, segment, the page's objective) |
| Ranking | slack | `routing_settings.tilt_percent` and the seat's mean load, at least 1 |
| Ranking | holdout | a hash of the decision id below `holdout_percent` |
| Ranking | segment | `routing_settings.segment_attribute_ids` and the lead's options for them |
| Explanation | sentences | the decision's rule name or condition summary and its `snapshot`, at the viewer's tier |
| Explanation | window words | the rotation's window ("in the last 30 days") |
| Learning | trials and outcomes | AC-1366 and AC-1368 over bookings, deals, stage history and no show marks |
| Unbooked lead | owner | `pickLeadOwner` on the form's rotation after the claim, 5 minutes after the hand off expires |
| Team link starter | choices | live team pages the maker may use (`booking.pages` list with `kind = round_robin`), the workspace link first |

### Key invariants

- A form's rules read only what the visitor typed; what the CRM knows changes only who hosts, on a team page.
- Rules decide who may host; ranking only orders people the rules already allowed.
- No member's load drifts more than the slack plus one meeting above the lowest because of preference.
- One lead owner per submission, claimed in the database; one rotation keeps one count for leads and meetings.
- No AI call happens at submit or at booking; learning sees no personal trait.
- Explanations come from the frozen snapshot, and rates show only to the rep themself and `routing.manage`.

### Security model

Rules on a surface are edited by that surface's editors (`forms.manage` for forms; the page's owner and `booking.admin` for team pages, plus L2's editors); the shared settings, Test, Decisions and Insights need `routing.manage` (owners and admins only, because Test and Decisions show what the CRM knows about any email). Record facts are read only for team page rules, inside the booking's transaction, only the attributes the rules name; an anonymous visitor's next step never depends on them, the rail shows the page's own hosts, and the company is reached only through an exactly matched person (a remaining signal, which free times a narrowed pool offers, is noted and accepted, as before). Facts store ids and numbers, never free text; member facing decision reads go through the viewer's scope; decisions follow their submission's retention. `security-access-reviewer` on L6 to L9; `state-performance-reviewer` on the submit path, the ranking read and the nightly job.

### Numbers

| Value | Number | Runner up |
|---|---|---|
| Rules per surface | 20, each of 1 to 5 comparisons (spec 0043) | 30 per workspace setup (the original plan) |
| Record facts per team page | 10 (spec 0043's `RECORD_FACTS_MAX`) | 20 |
| Hosts in a route | 1 to 8 members (spec 0043) | none |
| Required skills per host route | 3 | 5 |
| Team link starter choices | up to 8 team pages | 12 |
| Fit links | 100 | 200 |
| Skills | 100 | 300 |
| Segment attributes | 2, of at most 6 options each | 3 of 4 |
| Fairness allowance | 0 to 50 percent, default 20; slack at least 1 meeting | 0 to 30, default 10 |
| Holdout | 0 to 20 percent, default 10 | none |
| Smart mode default | Learn (lift only in warm cells, so nothing changes until data or skills exist) | Fit |
| Default objective | Deals created | Meetings held |
| Fit and lift mix | half and half | lift only |
| Prior strength | 20 meetings | 10 |
| Lift scale and dead band | 10 points for full lift, nothing under 2 points | 5 and 1 |
| Warm cell | 100 finished trials | 50 |
| Learning window | 180 days (270 for Deals won) | 90 days |
| Nightly run | 03:00 in the workspace's zone, spread over 30 minutes | 03:00 UTC for everyone |
| Model versions kept | 2 | 7 |
| Free time check at submit | 14 days | 7 days |
| Hand off life, unbooked lead owner | 24 hours, job 5 minutes after | 2 hours |
| Held decided | 7 days after the meeting, changed by a later mark at the next run | 1 day after |
| Deal created window | 30 days after the meeting | 60 days |
| Deal won window | 90 days after the meeting | 180 days |
| No show marking | from the start, no end (as built) | 15 minutes after the start to 7 days after (the original plan) |
| Submit time | 1.5 s p75, 3 s p95, free time check stops at 2.5 s | 1 s p75 |

### Critical test scenarios

- **Two doors**: a visitor books the workspace link directly (its host rules narrow to the Spanish speakers by the page's own question); another goes through the team link, picks Demo, and books it; both decisions show in Decisions and on each surface's Report (AC-1352, AC-1357, AC-1383).
- **Team link starter**: with the workspace link and two team pages live, Team link makes a form with three choices, three rules and the workspace link as fallback; with none live the option is disabled (AC-1353).
- **No free time**: a rule books a page whose hosts are all on time off for the next 14 days: the visitor lands on the fallback page; with that full too, they read the contact sentence and the lead gets its owner at once (AC-1358, AC-1372).
- **Only through a form**: on, the page without a hand off shows its existing unavailable state; with a hand off it books; off, it books as before (AC-1388).
- **No CRM leak**: two team link submits that differ only in a CRM known email get the same `next` kind and page; a form's rule naming `person.<id>` is skipped as unreadable (AC-1352, AC-1378).
- **Skills**: a host route requiring Spanish narrows to those members, and falls back to the whole rotation when none is free; deleting the Spanish skill is refused naming the rule (AC-1356, AC-1382).
- **Fairness bound**: the property test over 10,000 random arrivals with random weights, Even, Priority and availability, tilt 20 and strong preferences (AC-1364).
- **Lift**: reps at 35.1 and 35.2 percent get no lift; a cold cell gives none; after seeding 100 finished trials in a cell, lift applies in that cell only; the holdout picks plain fair (AC-1369, AC-1389).
- **Trials**: a host cancellation, a reassignment, a returning guest's owner pick and a holdout pick are each counted as AC-1368 says; a company deal is credited once (AC-1366, AC-1368).
- **Learning**: seeded bookings with no shows, deals at 10 and 40 days and a won deal; the nightly run counts each by its window; a No show marked 9 days after the meeting flips Held at the next run; "Learn from" drops earlier ones; the `?` segment never warms (AC-1366, AC-1370, AC-1386).
- **Leads**: a form owned by the Sales rotation routes to a page using Sales: the booking's host becomes the owner with one ledger row; the unbooked job and a booking at 24 hours run at once and exactly one assigns; a form whose rotation has nobody leaves the lead unowned and its notify list told (AC-1372, AC-1390, AC-1391).
- **Privacy**: a See reach colleague and a co host reading an explanation see no rate; a viewer who can't see the Deals stage reads "Hidden" (AC-1373, AC-1375).
- **Reproducible**: replaying 1,000 stored decisions from their snapshots gives the same picks (AC-1387).
- **Load**: 100 team link submits a second against a 20 host page, with every page but the fallback full, hold AC-1380 on the load stack; the nightly run for 1,000 workspaces at the seed's median size fits one hour of worker time.
