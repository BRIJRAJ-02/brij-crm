# 0037. Team scheduling and access: verify

**Status**: accepted 21 October 2026, updated after the five lens review; **amended 31 October 2026** against main 298735334. J1 to J8, J11 and most of J13 are built; J12 and the roster editor are running; L1 to L10, P2 are queued. Each lane fills its row under "Verification per job" with results when it lands (commands run, numbers measured, flows passed, reviewers' findings and fixes).

## The AC map (31 October 2026, main 298735334)

Every criterion of the plan, with its state. **Built** means on main, with the job or spec that built it; a lane name means it is owed there; **partly** names what is built and what the lane still owes. This is the same split as the build plan's rows in [index.md](index.md#build-plan).

### Cross cutting ([index.md](index.md))

| AC | State | Where |
|---|---|---|
| AC-1221 | built (the source scan and the access table walk), and in force for every lane | J1 |
| AC-1222 | partly: the door reads no delegations (J1); the measure with 20 custom roles waits | L4 |
| AC-1223, AC-1224, AC-1225 | in force for every lane; met by every built job | every lane |
| AC-1445 | in force; built for delegations, time off, the Roster's copy and set usual hours, adjustments | every lane |
| AC-1446 | in force; every 0037 migration so far follows it | every lane |
| AC-1447 | partly: Calendars and Round robin are Bookings tabs with redirects (e5b25e75c), the sidebar has no Roster, Notes or Favourites (7f96f35f3); the Roster tab and its redirect are owed | roster editor |

### Roles ([0037-roles.md](0037-roles.md))

| AC | State | Where |
|---|---|---|
| AC-1226, AC-1227 | built (the catalog's labels, descriptions, groups and grant levels; five owner only permissions) | J1 |
| AC-1228, AC-1229 | owed (AC-1229 also needs the guest role) | L4 (after P2) |
| AC-1230 | owed | L5 |
| AC-1231 to AC-1244 | owed (AC-1243, "What can Priya do", moved here from J5) | L4 |
| AC-1245 | built, as amended: keys never hold the four `schedule.*` permissions | J1 |
| AC-1246 to AC-1248 | owed | L4 |

### Scheduling access ([0037-scheduling-access.md](0037-scheduling-access.md))

| AC | State | Where |
|---|---|---|
| AC-1251, AC-1252 | built | J1, J4 |
| AC-1253, AC-1254 | partly: role and member reach built; team scope and team targets wait for teams | L3a |
| AC-1255, AC-1256 | built | J1 |
| AC-1257 | partly: audit and `access` rows built; the two emails owed | L1 |
| AC-1258 to AC-1262 | built | J1, J4 |
| AC-1263 | partly: every row but `booking_page.changed_for` built | L1 |
| AC-1264 | partly: the email for hours, time off and limits built; page and rotation lines and the inbox notice owed | L1 |
| AC-1265, AC-1266 | built | J4, J5 |
| AC-1267 | partly: built for people and everyone; team targets owed | L3a |
| AC-1268 | built | J5 |
| AC-1269 | partly: removal built; team deletion owed | L3a |
| AC-1270, AC-1271 | built | J1, J5 |
| AC-1272 | partly: For on Block time and New meeting built; For on Time off owed, New meeting's after J12 | L1 |
| AC-1273 | owed | L1 |
| AC-1274 | partly: delegations and role changes built; team changes owed | L3a |
| AC-1275 | built | J4 |

### Time off, the Roster and limits ([0037-time-off-and-roster.md](0037-time-off-and-roster.md))

| AC | State | Where |
|---|---|---|
| AC-1281 to AC-1283 | built | J2 |
| AC-1284 | partly: returning guests' owner and last host go to a free stand in; `pickLeadOwner` for an away owner owed | L2 |
| AC-1285, AC-1286 | built | J2 |
| AC-1287 | partly: the Bookings week and Home's Team today show Away; the Team day band owed | J12 |
| AC-1288 | built | J2 |
| AC-1289 | partly: built without the team filter | L3a |
| AC-1290 to AC-1296 | built (AC-1293 answers `CONFIG_INVALID`) | J6 |
| AC-1297 to AC-1299 | built | J7 |
| AC-1300, AC-1301 | built | J6 |
| AC-1302 | built | J7 |

### Calendars ([0037-calendars.md](0037-calendars.md))

| AC | State | Where |
|---|---|---|
| AC-1306, AC-1307 | built | J3, J8 |
| AC-1308 | partly: chips on Members, the Roster and Round robin built; the Team day header owed | J12 |
| AC-1309 to AC-1313 | built (AC-1311 counts the last hour) | J8, J13 |
| AC-1314 | partly: the Round robin and Roster chips built; the Team day owed | J12 |
| AC-1315 | built | J8 |

### Round robin ([0037-round-robin.md](0037-round-robin.md))

| AC | State | Where |
|---|---|---|
| AC-1319 to AC-1326 | built (AC-1321 as amended: one key at a time, no restart) | J11, J13 |
| AC-1327 | owed, as amended (`rotations.follows`) | L3b |
| AC-1328 | built | J13 |
| AC-1329, AC-1330 | partly: built for `booking.admin` and members; editors owed | L2 |
| AC-1331, AC-1332 | owed | L2 |
| AC-1333 to AC-1336 | owed | L10 |
| AC-1337 | partly: reassign with Manage over both hosts built; the editors half owed | L2 |
| AC-1338, AC-1339 | built | J13 |
| AC-1340 | partly: `booking.admin` only today; Manage over the member owed | L2 |
| AC-1341 | owed, as amended (`ROUTING_IN_USE`) | L6 |

### Routing ([0037-routing.md](0037-routing.md))

| AC | State | Where |
|---|---|---|
| AC-1351 | owed | L6 |
| AC-1352 | partly: record facts and the handing form's answers built (spec 0043); the page's own answers owed | L6 |
| AC-1353 | owed | L6 |
| AC-1354 | owed | L9 |
| AC-1355 | built | spec 0043 |
| AC-1356 | partly: routes built (spec 0043); required skills owed | L7 |
| AC-1357, AC-1358 | owed | L6 |
| AC-1359, AC-1360 | built | spec 0023, spec 0043 |
| AC-1361 to AC-1365 | owed | L8 |
| AC-1366 | owed | L9 |
| AC-1367 | built, as amended | spec 0043, J4 |
| AC-1368 to AC-1370 | owed | L9 |
| AC-1371 | withdrawn | none |
| AC-1372, AC-1373, AC-1374 | owed | L8 |
| AC-1375 | owed | L6 |
| AC-1376 | owed | L9 |
| AC-1377 | built (spec 0043); L7 keeps it for its new facts | L7 |
| AC-1378 | built by design (spec 0043); the test owed | L6 |
| AC-1379 | owed (the source scan) | L8 |
| AC-1380 | owed | L6 |
| AC-1381 | owed | L9 |
| AC-1382 | owed | L7 |
| AC-1383, AC-1384 | owed | L6 |
| AC-1385 | owed | L7 |
| AC-1386 | owed | L9 |
| AC-1387 | owed | L8 |
| AC-1388 | owed | L6 |
| AC-1389 | owed | L9 |
| AC-1390 | withdrawn | none |
| AC-1391 | partly: the submission notice reaches the lead's owner (spec 0023); the wait owed | L8 |
| AC-1392, AC-1393 | owed | L7 |

### Amendments ([0037-amendments.md](0037-amendments.md))

| AC | State | Where |
|---|---|---|
| AC-1421 | owed | L4 |
| AC-1422 | built | J1 |
| AC-1423 | owed, as rewritten | L8 |
| AC-1424 | withdrawn | none |
| AC-1425 | built | J3, J8 |
| AC-1426 | partly: the columns, marking and the list's No show status built; the List filter owed | L9 |
| AC-1427 | partly: the hand off and `booking_id` built (spec 0043); the claim owed | L8 |
| AC-1428 to AC-1430 | built | J11 |
| AC-1431 | partly: locks taken in id order built; the 30 booking race test owed | L2 |
| AC-1432 | owed (the `rotation_roster` view already leaves out any role but owner, admin and member) | P2 |
| AC-1433 | partly: Bookings › Round robin with Members and Distribution built; Sharing owed | L2 |
| AC-1434 to AC-1438 | owed | J12 |
| AC-1439, AC-1440 | built | members lane (spec 0031) |
| AC-1441 | owed | L3a |
| AC-1442 | owed, as amended | L3b |
| AC-1443 | owed | L3a |
| AC-1444 | built | J4 |

**Counts**: 178 criteria (174 accepted on 21 October, plus AC-1301, AC-1302, AC-1393 and AC-1447 on 31 October). 68 built in full, 3 withdrawn, 6 in force for every lane, and 101 owed in full or in part (J12 8, roster editor 1, L1 5, L2 9, L3a 8, L3b 2, P2 1, L4 21, L5 1, L6 12, L7 6, L8 13, L9 10, L10 4).

## The self check (21 October 2026, before the owner read the plan)

### 1. Every value a build has to produce, and where this plan names it

| Value | Named in |
|---|---|
| The permission catalog: names, labels, descriptions, groups, grant levels, which built in role holds which | [0037-roles.md](0037-roles.md#the-catalog) |
| Refusal sentences of the new permissions | 0037-roles.md, under the catalog |
| Custom role limits, name and description lengths, reserved names | 0037-roles.md (AC-1228, Numbers) |
| How a custom role's permissions are read, and what an unknown stored name does | AC-1234, AC-1244 |
| The scheduling Selects' mapping to permissions | AC-1241 |
| Who may invite into which role | AC-1236 |
| The default role for new people, and what deleting a role does to its holders, invitations, rules and the default | AC-1237, AC-1238 |
| What See and Manage cover, and what nothing covers | [0037-scheduling-access.md](0037-scheduling-access.md), "What each level covers", AC-1251 |
| How reach combines (role scope, teams, delegations), and how unknown values behave | AC-1253, AC-1254, the reach design |
| Which service checks what, on yourself and on others | the services table in 0037-scheduling-access.md |
| The answer for a member out of reach, and for See without Manage | AC-1258, Value sourcing |
| Who may grant and remove delegations, limits and their errors | AC-1255, AC-1256, the index's Errors table |
| The Members page reach summary words and source labels | Value sourcing in 0037-scheduling-access.md |
| What the member is told, when, how changes are gathered, and the email lines | AC-1264, "The notice", the index's Emails table |
| Audit action names | the index's Audit actions list |
| Time off fields, reasons, lengths, zone, limits, effects on slots, rotations, owners and existing bookings | [0037-time-off-and-roster.md](0037-time-off-and-roster.md), AC-1281 to AC-1288, Data model |
| The Roster's rows, order, cells, offsets, totals, reach, week start, forward and back limits, write path | AC-1289 to AC-1296, AC-1301, Value sourcing |
| Meeting limits: ranges, zone, what counts, the engine and recheck | AC-1297, AC-1298, AC-1302, "The engine" |
| Calendar health statuses, the fold that computes them, who sees them, where they show | [0037-calendars.md](0037-calendars.md), AC-1307, AC-1308, "The health status" |
| Health email timing, episode, reminder, mass outage hold, cap, rate limit for Ask to reconnect | AC-1309 to AC-1311, Numbers |
| Fixed hosts and rotations per page, the slot rule, lock order, pick order, organiser | [0037-round-robin.md](0037-round-robin.md), AC-1319 to AC-1322, "Slots and booking" |
| Even's load formula and gap; weekly caps; team rotations' members; returning guests' lookback | AC-1325 to AC-1328, Value sourcing |
| Adjustments' range, note, ledger shape; the Distribution tab's numbers and who sees which rows | AC-1329, AC-1330, Data model |
| Editors: what they may do, limits, lists | AC-1331, AC-1332 |
| Managed pages: lock groups, slugs, propagation, removal, template deletion | AC-1333 to AC-1336, Value sourcing |
| The rule shape and its limits | [0037-routing.md](0037-routing.md), "The rule shape", Numbers |
| Which facts each surface's rules read | AC-1352, AC-1393, Value sourcing |
| The team link starter's questions, rules and fallback | AC-1353 |
| Rule evaluation, routes, fallbacks, the 14 day check and the "no one is free" message | AC-1355 to AC-1360 |
| The ranking formula, its constants and its tie order; ledger reasons for ranked picks | AC-1362, AC-1363, "Ranking" |
| Outcomes, their windows, no show marking, learning schedule, smoothing, warm threshold, segments, versions kept | AC-1366 to AC-1370, "Learning", Numbers |
| A form lead's owner: when it waits, how one path wins | AC-1372 |
| The explanation sentence | AC-1373 |
| Error codes, statuses and messages | the index's Errors table, each child's procedures table |
| Access table entries for every new service | the index's Access table entries |
| Where each screen lives | AC-1447, the index's Screens table |
| Every limit and default number | each child's Numbers table |

### 2. Decisions a builder would otherwise have to invent, and where they are settled

| Question | Settled by |
|---|---|
| Can admins edit Member's permissions? | owner decision 1 (no; custom roles and a default role instead) |
| What can't a custom role hold? | decision 2 and the grant levels |
| Does a new role follow Member's access rules? | decision 3 (copied once) |
| Extra permissions for one person? | decisions 4 and 8 (no, except scheduling reach) |
| Is there a team manager? | decision 5 (no) |
| Is record sharing in scope? | decision 6 (not now) |
| One level or two for scheduling? | decision 7 |
| Can a member grant their own assistant? | decision 9 |
| Can a member's hours be locked? | decision 10 (`availability.own`) |
| Who is told, admins or the member? | decision 11 |
| What is `booking.admin` for, and what is `schedule.*` for? | decision 12 |
| Can a manager edit someone's booking pages? | decision 13 |
| What do others see of someone's calendars? | decision 14 |
| Health emails or banner only? | decision 15 |
| Does time off redirect visitors? | decision 16 (not while `/b/:key` is frozen) |
| Dated week schedules or overrides? | decision 17 |
| Limits per person? | decision 18 |
| How many rotations per page? | decision 19 |
| Which extra round robin controls? | decision 20 |
| Editors? | decision 21 |
| Managed pages now or later? | decision 22 |
| One routing setup or rules per surface? | decision 23, amended (rules per surface, one shared Routing tab) |
| Where does the team link start? | decision 24, amended (two doors, one story) |
| How are reps ranked, and how far may it tilt? | decision 25 |
| What does it learn from, and from whose data? | decision 26 |
| Any AI step? | decision 27 |
| How are no shows recorded? | decision 28, amended (as built) |
| Who owns a lead that never books? | decision 29, amended (the form's owner setting, waiting for a shared rotation's booking) |
| What happens to spec 0023's per form routing rules? | decision 30, reversed (they stay) |
| Week start, reason lists, notice mechanics, segment key format, how ranked ledger reasons read | decision 31 and "Calls made without a question" in [rationale.md](rationale.md) |
| Lock order with several rotations | AC-1321 (one key at a time in id order, no restart) |
| How Ask to reconnect is rate limited | 0037-calendars.md (from the audit log; no new table) |

### 3. Gaps the check found, fixed in the plan on 21 October

- The team link's submit path named an endpoint that doesn't exist; it is spec 0023's `POST /api/public/forms/:publicKey/submissions`, answering `{ next }`.
- A public handler can't import `@crm/core/system` (spec 0009's lint rule). (The router principal this led to is withdrawn on 31 October: record facts are read for team page rules inside the booking's own transaction.)
- "Ask to reconnect" had two possible stores for its limit; it reads the audit log.
- Health emails needed somewhere to remember an episode: `calendar_connections.health_notified_at` (Amends 0024).
- Error codes, emails, audit actions and access table entry kinds were spread over the children; the index lists each once.
- Reassigning ships with spec 0029's own build, so its criterion moved to J11.
- Insights' window was unstated; it is the learning window.
- Spare numbers inside each child's block were unclear; the index's children table shows each block and what it uses.
- An outcome kind and a hosts kind were both called "owner" (both withdrawn on 31 October).
- Where learning runs, and what a later AI step may send, were implicit; the routing child's Learning section states both.
- Setting a built in role while a custom role is held would break the check constraint; `members.setRole` clears `custom_role_id` in the same update.
- The Members page's Scheduling column would have cost a reach query per row; `members.list` reads the whole page's summaries in one grouped query.

### 4. The five lens review (21 October 2026)

Every finding was checked against the spec and the code (base 55919346 and the lane branches at the time). Held findings are fixed in the files; the decisions they changed say so in [index.md](index.md#owner-decisions). Rejected, or taken only in part:

- **Product 1 (a team lead flag)**: rejected. Decision 5 (no manager flag) is accepted by the owner; the part that held, team reach covering owners and admins, is fixed by AC-1253.
- **Product 3, avatars from the routed pool**: rejected for security (it would show an anonymous visitor whom the CRM knows); the rail shows the page's own hosts (AC-1339, AC-1388).
- **Product 5, a 1 hour unbooked wait**: rejected; 24 hours stays (a shorter wait would split a lead's owner from their later meeting's host).
- **Product 12 (rewording the decisions for the owner)**: not taken; changed meanings are listed under each decision instead.
- **Security 3, part 3 (name the host only in the guest's email)**: rejected; the owner approved the host's name on the confirmation.
- **Security 11, the alternative of masking audit rows**: superseded by making `audit.read` admin only and never storing a time off note's text.
- **Feasibility 4 (the schedules lane would build AC-971 twice)**: overtaken; the lane built M3 through one service.
- **Routing 6, counting only holdout picks toward learned rates**: not taken by default (ten times slower learning); the review's fallback stays available if bias appears.
- **Routing 11, the fleet budget as a criterion**: taken as a load scenario rather than a new criterion.

## The self check of the 31 October amendment

### 5. What was checked against main

Each amendment was read against the code at 298735334 before it was written (file references in [0037-routing.md](0037-routing.md#what-main-already-has-31-october-2026-main-298735334) and [rationale.md](rationale.md#amendments-of-31-october-2026)):

- Routing: `routing_decisions` (migrations 0074 and 0088: two surface kinds, one row per submission and per team page booking), the rule shape and its 20 rule cap (`packages/contracts/src/forms/routing.ts`), `routeSubmission`, `routeBooking`, `recordBookingRouting`, `RECORD_FACTS_MAX`; no workspace routing table exists.
- Lead owners: `forms.owner_rotation_id` (0089), `pickLeadOwner` (`packages/core/src/rotation/owner.ts`), `chooseFor` (`packages/core/src/forms/process.ts`, which never reads routing), the submission notice to the lead's owner (`notify.ts`).
- No show: `markNoShow` refuses only before the start or when cancelled; audit `booking.no_show` and `booking.no_show_undone`.
- The catalog: five permissions of grant `owner`; `KEY_FORBIDDEN_PERMISSIONS` holds the four `schedule.*`; `routing.manage` exists and is checked nowhere.
- Locks: `lockHosts` takes one advisory lock per key in sorted order; stand ins are added before the host locks; a stand in outside the set fails `freeAt` and isn't seated; no restart.
- The workspace link: `booking_pages.scope`, `rotations.follows` (only `'everyone'`), the `rotation_roster` view, the Roster's "Link: N" line; `ROTATION_MEMBERS.max` is 20, with the everyone rotation exempt.
- Health: `CALENDAR_HEALTH_CRONTAB` asks every 15 minutes with 15 minutes of fill; on `brij-crm` the hourly drain runs it; `crm_calendar_health_candidates()` counts the last hour.
- Delegations: no `granted_by` column; the API's `grantedBy` reads `updated_by`. Co hosts: `bookingAccess` answers `act` for them. The 400 override limit: `SCHEDULE_OVERRIDES_MAX` (J6).
- Guests: `member_role` is owner, admin, member only.
- Screens: Bookings tabs are calendar, list, availability, round robin, calendars; the Roster is `bookings/availability?view=team`; settings redirects for rotations exist; booking questions are built (0115).

### 6. Values the amendment needs, and where they are named

| Value | Named in |
|---|---|
| Which facts each surface reads, including the page's own answers | AC-1352 |
| The team link starter's title, questions, rules and fallback | AC-1353 |
| When a form lead's owner waits, the claim, the job's timing | AC-1372 |
| Where the ranking's settings, skills and learned cells live | the routing child's Data model (`routing_settings`, `routing_skills`, `member_skills`, `routing_stats`) |
| What extends `routing_decisions`, and in which lane | the routing child's Data model |
| A team page's objective | AC-1354 (`booking_pages.routing_objective`) |
| Only through a form | AC-1388 (`booking_pages.form_only`) |
| A rotation that follows a team | AC-1327 (`follows = 'team'`, `follows_team_id`, the view's branch) |
| The Bookings tab order and redirects | AC-1447 |
| The health sweep's window | AC-1311 |

### 7. Mechanical checks (rerun 31 October 2026)

- 178 criteria are defined (AC-1221 to AC-1225, AC-1226 to AC-1248, AC-1251 to AC-1275, AC-1281 to AC-1302, AC-1306 to AC-1315, AC-1319 to AC-1341, AC-1351 to AC-1393, AC-1421 to AC-1447), each exactly once, all inside the reserved AC-1221 to AC-1450.
- Every criterion is in exactly one row of the build plan (built, running, or a lane), or in the "every lane" line, or withdrawn; every criterion a row names exists.
- Every relative link resolves; every table row has its header's columns.
- No em or en dash anywhere; hyphens appear only inside code, file names, branch names and URLs, and the house heading "Follow-up".

### 8. Observations for the coordinator

- Spec numbers 0036 and 0037 were each used twice on old branches (`wip/import`'s `0037-import-export`); main has no other 0037, so this folder takes the number.
- `packages/core/AGENTS.md` still says "today `booking.admin` reaches everyone" for schedules; `/sync` should say `canActFor` over the reach.
- AC-1441 (job title) had no lane in the 31 October plan file; it is placed in L3a.
- AC-1257's emails and AC-1264's inbox notice had no lane either; they are placed in L1.

## Verification per job

Every lane: its unit tests beside the source, integration tests against a real Postgres (never a mocked database), the two guard tests for any new tenant table (forced row level security with a policy; a cross workspace read returns nothing), a denied actor test per new service in the access table walk, the reviewers named in [index.md](index.md#build-plan), and its results written here.

| Job or lane | What proves it | Result |
|---|---|---|
| J1 Catalog and reach | the pinned role table with the new fields; `canActFor` unit grid; delegation services' tests including limits, self grants and removal; `access` rows reloading a delegate's browser; door time unchanged with 100 delegations | built (1ed3896a3); the AC-1221 scan and the walk's new kinds are in the suite |
| J2 Time off | slots closed on every page kind during time off; rotations skipping; owner and last host going to a free stand in; the dialog's bookings list; audit and stand in email | built (0c37564d4, 51b6b4101) |
| J3 and J8 Health | a colleague's payload has no names, emails or errors; exactly two emails per episode; the mass outage hold with a Sentry warning; the 200 cap; Ask to reconnect's 24 hour limit; an editor without reach sees "Hidden" | built (7b97c5a9e, d89c38449, review fixes 4d1f6f202) |
| J4 Reach everywhere | each moved service refusing out of reach (`NOT_FOUND`) and See only (403); one notice for three changes in ten minutes, none when they cancel; `availability.own` read only state; the schedule write path source scan (AC-1444) | built (46ae99c70, reviewers' fixes 2506ca0c3) |
| J5 Screens | Account › Scheduling access add and remove; Members column popover; Viewing Select read only and edit states; axe in both themes; keyboard only run | built (23cefdb38, bec67464e, b061f94df) |
| J6 Roster | 50 rows in one request in three statements; cell writes through spec 0035's path; copy week and set usual hours; DST week offsets; keyboard grid; screenshots | built (63d26d7c5, 05ddcb6e6, tests 79086364c, 2e5d7d104) |
| J7 Limits | slots stop at a day and a week limit on personal, collective and round robin pages; the racing booking refused; the New meeting warning | built (ef3b09292, c02dcaf69, e2cf07d01) |
| J11 Spec 0029, amended | spec 0029's scenarios plus `returning`, `even` and the new reasons; guests refused (P2); reassign needing Manage over both hosts | built, except the 30 booking race (L2) and guests (P2) |
| J12 Spec 0030, amended | spec 0030's scenarios plus: columns from `members.visible`; Away bands; Needs a host lane; issue counts; job title order; chips; No show on the Team day | running (`wip/team-day`) |
| J13 Round robin beyond | Hall's condition unit tests; fixed plus two rotations booking; Even gap; last host; adjustments and Distribution numbers | built; team rotations in L3b |
| L1 | colleagues' pages with "Editing Bea's page" and "Set by Bea"; `booking_page.changed_for`; the notice's page and rotation lines and its inbox notice; the two delegation emails | pending |
| L2 Editors | an editor changing a rotation and a page, refused deleting them or changing editors; lists with the Editor badge; 30 parallel bookings across two pages sharing members with a stand in, no 40P01 | pending |
| L3a and L3b Teams | a Sales lead's reach follows Sales; a team delegation; a team deletion's dialog; a rotation following Sales gains a new hire with no write and loses a leaver; the race test with a 50 member following rotation | pending |
| P2 Guests | a guest refused in rotations and as a delegate; the roster view leaves them out | pending |
| L4 Custom roles | the policy grid of AC-1248; a stored admin only name granting nothing; invitations' escalation rule; delete with move; audiences and `enterAsActor` with custom roles; door time with 20 roles; Roles screens with axe and keyboard | pending |
| L5 Roles in rules | a new role started from Member carrying Member's rules, independent afterwards; Access tab subjects; Preview as | pending |
| L6 Two doors | both doors' decisions in Decisions; the starter's form; Only through a form on and off; the free time fallback and the contact sentence; two submits differing only in a CRM known email give the same `next`; `ROUTING_IN_USE`; 100 submits a second on the load stack | pending |
| L7 Skills and deal facts | required skills narrowing and falling back; `SKILL_IN_USE`; deal facts and Known only on team pages; Test audited and storing nothing | pending |
| L8 Ranking and owners | the fairness property test (10,000 arrivals, random weights, Even, Priority, availability); fit from day one; Off and 0 percent equal to plain spec 0029; the owner that follows its meeting; the unbooked job and a late booking racing, one assignment; replayed snapshots | pending |
| L9 Learning | trials and outcomes per AC-1366 and AC-1368 on seeded data; a late No show flipping Held; lift with its dead band; cold, warm and `?` cells; the holdout comparison; Learn from; the nightly run within 60 seconds for 100,000 ranked bookings; the hourly fan out; Insights | pending |
| L10 Managed pages | 12 member pages updated in one transaction on a locked change; unlocked changes kept; removal and template deletion | pending |
