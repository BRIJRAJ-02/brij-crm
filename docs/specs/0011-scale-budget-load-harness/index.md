# 0011. Scale budget and load harness

**Date**: 2026-10-08
**Status**: Proposed

## Summary

This spec writes the CRM's speed targets down in one file and builds the tools that check them. One command fills a local database with a million records (people, companies and deals, linked to each other, with one very large company) and 1,000 members who are already signed in. A second command plays 100 people browsing and editing at once, through the real API and the real live connection, and prints how fast reads, writes and live updates were against the targets. Everything runs on the owner's machine, in Docker capped to the size of a small Neon database, because the owner keeps Neon on its free plan; nothing ever runs against production.

## Requirements

**User stories**:
- As the builder of any later feature, I want the targets in one file and one command that checks them, so every slice is measured, not guessed.
- As the owner, I want a plain table that says pass or miss for each target at 100 people online, so I know the product holds before customers arrive.
- As the builder of scale hardening (#41), I want the same harness to push 1,000 people and the hard shapes (a huge company, bursts, reconnects), so I can find what breaks first.
- As a reviewer (`state-performance-reviewer`), I want to ask for a harness run on a risky change and get comparable numbers, so a performance claim can be checked.

**Acceptance criteria** (this spec's reserved range is AC-192 to AC-221; it uses AC-192 to AC-214):
- **AC-192**: `packages/core/scripts/scale-budget.ts` exports one readonly `SCALE_BUDGET`: 100 online (the gate) and 1,000 (room), 1,000,000 records per workspace, p95 end to end of 300 ms for a read, 200 ms to open a record, 250 ms for an edit, 300 ms for a create, live delivery p95 of 1 second at 100 online (from the write's commit to the change visible to every holder, the measure spec 0007 AC-78 uses), Postgres CPU p95 under 70% of its cap, pool waits p95 under 50 ms, relay lag p95 under 250 ms, at most 0.1% unexpected errors, and the load model (0.2 actions per user per second; 60% scroll, 15% filter or sort, 10% open, 12% edit, 3% create). The harness reads every target and the load model from it and from nowhere else.
- **AC-193**: `pnpm load:stack` starts a load stack separate from the dev stack (its own compose file `docker-compose.load.yml`, project `crm-load`, volume and ports): Postgres 18.6 capped at 2 vCPU and 8 GB with `infra/postgres/load.conf`, PgBouncer in transaction mode logging in as the load stack's app login, the API and the worker from `apps/api/Dockerfile` (api capped at 1 vCPU and 1 GB, worker at 1 vCPU and 512 MB, the worker set never to sleep), Centrifugo (1 vCPU, 512 MB) and Mailpit. It refuses (exit 3) when Docker has less than 11 GB of memory. `pnpm load:stack:down` stops it and `pnpm load:stack:wipe` also deletes its volume. The dev stack and its data are never touched.
- **AC-194**: The `crm` seed profile makes one workspace (slug `load`) with 600,000 People, 150,000 Companies and 250,000 Deals (1,000,000 records), every template attribute filled at the rates in the fill rates table below, unique emails and domains, 90% of people linked to a company, one hub company (`Hub Company`) whose Team holds 150,000 people, 90% of deals linked to a company and every deal to 1 or 2 people, and 1% of each object in the trash (990,000 live records, so 10,000 creates fit under the 1,000,000 limit). It makes 1,000 users with verified emails `load-user-<n>@example.com`, each an active member with directory and membership rows (user 1 is the owner, the rest are members), and mints one session for each (AC-196). Stored sort keys are filled from their defining view, and the tables are vacuumed and analysed.
- **AC-195**: `pnpm load:seed` is one command: it starts the load stack if it is down, applies the migrations and creates the logins on it, seeds the profile (`--profile crm` by default, `--profile smoke` for 50,000 records and 50 users), mints the sessions, prints progress, and writes `.load/manifest.json`. It finishes the `crm` profile in under 60 minutes on the reference machine (a MacBook Pro, model `MacBookPro18,3`, Apple M1 Pro with 8 cores, 6 performance and 2 efficiency, 16 GB of memory, Docker Desktop given 8 CPUs and 12 GB). It refuses to run when the load database already holds a `load` workspace (it names `pnpm load:stack:wipe`), and refuses any database host but the load stack's localhost.
- **AC-196**: Sessions are minted, never signed in (the owner's brief). The seed writes one Better Auth `session` row per seeded user (a random token, 30 day expiry) as the owner login on the load database, and writes each user's signed cookie to `.load/sessions.json`, signed with the load stack's fixed `local-only` secret exactly as Better Auth signs its session cookie. `pnpm load:sessions` mints them again when they expire. Before warm up, `pnpm load:run` checks one session per 100 users with `me.get` and refuses (exit 3, naming `pnpm load:sessions`) if any is refused. A test proves the API accepts a minted cookie, so a Better Auth upgrade that changes the format fails the test, not a run. No code in `apps/api` or `packages/db` mints a session.
- **AC-197**: `pnpm load:run <scenario> [--users N] [--minutes M]` drives an open model: each user's actions arrive at random (exponential gaps, mean 1 / 0.2 seconds) whether or not earlier ones answered, users ramp up over a 60 second warm up that is not measured, then the measured window runs (10 minutes by default, 5 for `thousand`). Each action's time is measured from when it was scheduled, not when it was sent, so a slow server can't hide its queue. The achieved mix is within 1 point of the budget's mix.
- **AC-198**: Each simulated user behaves like the People table: it holds a view (People 50%, Deals 30%, Companies 20%) and the 100 row window it last loaded. A view that spec 0006's `canJump` admits (no filter, at most one sort on a stored key) scrolls by position: scroll fetches the next or previous 1 to 3 windows, or jumps (in `steady`, 70% of jumps land in the first 2,000 rows, 30% anywhere). Any other view runs in cursor mode as spec 0006 does: its first window and its count together, scroll follows `nextCursor`, and a jump reads forward in calls of 200 rows from the last checkpoint the user holds; it never sends a position. Filter or sort replaces the view with one of the object's fixed shapes; a newer action on the same view aborts a count still running. Open reads one record. Edit changes one editable attribute of a record in the user's window. Create adds a record with a unique name (and email or domain).
- **AC-199**: The report judges read (scroll plus filter or sort windows, cursor reads included), open, edit and create at p95 against the budget, each line with p50, p95, p99, max, count and a verdict. Counts and the hub open are reported on their own lines, not judged.
- **AC-200**: Every user holds a Centrifugo connection and its audience channel subscription as a browser does: `realtime.connectionToken`, then `realtime.subscriptionToken`, which answers `{ channel, token, head }` (spec 0007 and 0009's `workspace:<id>.<policyKey>`). A user skips events carrying its own `mutationId`; a user that holds any of an event's record ids fetches them with `records.get` (a coarse event refetches its window); a stub advances `seq` and fetches nothing. Live delivery (from the write's commit, the event's `at`, to the holder's `records.get` answer) is judged at p95 against 1 second; scheduled to visible (from the writer's scheduled action) and event arrival are reported for every subscriber. A `seq` with no event or stub within 10 seconds counts as missed; a gap the client fills through recovery or `realtime.catchUp` counts as a catch up, reported, not a miss. A gate run must miss none.
- **AC-201**: The report judges server health: Postgres CPU (p95 of 5 second samples of the container's CPU, as a share of its 2 vCPU cap) under 70%; the API's pool wait p95 (from the timing header, AC-202) and the pooler's wait (p95 of 5 second samples of PgBouncer's `SHOW POOLS` `maxwait`) under 50 ms; relay lag (`published_at` minus `created_at` of every outbox row written in the measured window) p95 under 250 ms, where `created_at` is the commit time spec 0007 writes with `clock_timestamp()`.
- **AC-202**: With `APP_ENV=local` and `LOAD_TIMING=on`, every `/api/rpc` answer carries `Server-Timing: pool;dur=<ms>, db;dur=<ms>, app;dur=<ms>` (time waiting for a database client, time in queries, whole handler). Without `LOAD_TIMING=on` the header is never sent, and the API refuses to boot with `LOAD_TIMING=on` outside `APP_ENV=local`.
- **AC-203**: A run is invalid (exit 2, with the reason) when the harness itself can't keep up (event loop delay p99 over 50 ms in any thread, or under 95% of the planned actions sent) or when unexpected errors pass 0.1% (5xx, `INTERNAL`, 429 `TOO_MANY_REQUESTS`, a 10 second timeout, a dropped connection, a 401 at any time). Expected refusals (409, 422) are counted apart and never fail a run. A count the harness aborted is neither. 429s also get their own line, since spec 0005 caps queries at 6 in flight per workspace and a person would see that refusal. Exit codes: 0 every judged line passes, 1 a budget miss in a gate scenario, 2 invalid, 3 setup refused.
- **AC-204**: Each run prints one table (metric, target, p50, p95, p99, max, count, verdict) and the run's facts (scenario, users, minutes, git commit, the host's model, cores and memory, Docker's CPUs and memory, the stack's caps, the database clock offset, the manifest's counts, start and end), plus the 10 statements with the most total time from `pg_stat_statements` and the WAL bytes written. It writes the same as JSON (`LoadResult`, a Zod schema in `packages/load`) to `.load/results/<scenario>-<time>.json`.
- **AC-205**: `spread` runs the steady mix with every jump, open and edit drawn evenly over the whole object instead of near the top, so most reads miss the cache. It is a gate like `steady`.
- **AC-206**: `hub` runs 100 users where half of the edits move a person to or from the hub company (from the person's Company, a side that holds one; once #15's `links.add` and `links.remove` exist, half of those moves are written from the hub's Team instead) and a fifth of the opens read the hub (its first 20 Team links and the total, spec 0005's cap). Meanwhile one user edits the hub record itself every 10 seconds (renaming it between two names), so the hub is edited while 100 users link to it, which is the contention spec 0014's lock on the far record adds. The report adds the hub edits' p95, the link writes' p95 while a hub edit (or its sort key refresh, once #15 and #8 exist) ran, how many writes ran out of retries (`runWrite`), and the WAL bytes. `pnpm load:reset` restores the Team afterwards.
- **AC-207**: `storm` runs the steady mix plus a burst every 10 seconds (every online user edits a different record in the same second) and, at the middle of the window, drops every live connection at once and reconnects them (new tokens, recovery from `head`). The report adds edit p95 inside bursts, the time until every user has recovered or caught up, how many caught up, and missed `seq`s (which must be 0).
- **AC-208**: `thousand` runs 1,000 users, each a different seeded member with its minted session, across worker threads with the steady mix for 5 measured minutes. It prints every verdict, but its exit code depends only on validity (AC-203): the budget at 1,000 is judged in #41.
- **AC-209**: `pnpm load:reset` moves every record the harness created (created after the manifest's `seededAt`) to the trash and purges it, through the engine's own services as the system actor, and puts the hub's Team back to the seeded 150,000 people in batches of 5,000. Before warm up, `pnpm load:run` refuses (exit 3, naming `pnpm load:reset`) when the free record slots are fewer than 1.5 times the creates the run plans.
- **AC-210**: Nothing in this feature can reach a remote host. `pnpm load:seed`, `pnpm load:sessions`, `pnpm load:run`, `pnpm load:reset` and `pnpm load:bench-hub-clear` refuse any API, database, Centrifugo or PgBouncer address that isn't localhost. All seeded data is made up, on `example.com`. `.load/` (manifest, sessions, results) is gitignored. The load stack's secrets are fixed local values marked `local-only`.
- **AC-211**: A weekly GitHub workflow (`load-smoke.yml`, Mondays and on demand) starts the load stack on the runner, seeds the `smoke` profile, runs `steady --users 20 --minutes 2`, uploads the result JSON, and fails only on an invalid run or a crash. Budget misses show as warnings, since shared runners don't give trustworthy times.
- **AC-212**: Tests: the pure parts (arrival scheduler, mix sampler, percentiles, budget verdicts, scheduled time measurement, the delivery join, the miss and catch up rule, the cookie signer) have unit tests; the seed runs a tiny `test` profile (2,000 records, 5 users) in Vitest against a real Postgres and checks counts, links, the hub, the trash, memberships, sessions and sort keys; the API accepts a minted cookie; the API's timing header and its env refusal have tests.
- **AC-213**: `docs/specs/0011-scale-budget-load-harness/verify.md` records the first `steady` and `spread` results at 100 users and one run of each stress scenario and of the hub clear bench, as printed, with every miss named and either fixed or given a plan (most go to #41).
- **AC-214**: Clearing a 150,000 link side is not a user action, so it is not in the harness. `pnpm load:bench-hub-clear` (`packages/core/scripts/bench-hub-clear.ts`) measures it at the engine level on the load seed: as the system actor it clears the hub's Team in one whole value write while 100 engine level writers link other people to the hub and to other companies at the harness's rate, through a pool of 10 connections like the API's. It prints the clear's time, the other writes' p95 and how many ran out of retries, and the WAL bytes, then writes the Team back. Reported, not judged.

## Decision

**Chosen option**: Option 1: a custom Node harness in `packages/load` on the real oRPC contract and the real Centrifugo client, against a capped local Docker stack, with the budget in one constant.

The budget lives in `packages/core/scripts/scale-budget.ts`; the seed profile lives beside spec 0004's scale seed; sessions are minted by the seed; the harness measures from scheduled time.

Calls made here, all decided (the owner took the recommended defaults for #11 to #22 on 3 October 2026; the cross check of 8 October settled sessions and the hub clear):
- Each user acts every 5 seconds on average (0.2 per second), so 100 users send about 20 actions a second plus the refetches live updates cause.
- `steady` and `spread` are gates (a miss exits 1); `hub`, `storm` and `thousand` report verdicts but fail only when invalid, and #41 judges them.
- `spread` means cold cache reads over the whole million, not many workspaces.
- Sessions are minted by the seed (the owner's brief), for every seeded member: the gates use the first 100, `thousand` all 1,000.
- The seed makes 1,000 members, so `thousand` has 1,000 different people.
- Clearing a hub side runs as an engine level bench outside the harness, since no person does it.
- Live delivery is judged from commit to visible, matching spec 0007; scheduled to visible is printed beside it.
- No hash partitioning of `values` by workspace (spec 0004's open question): it doesn't help one big workspace, which is the shape the budget is about.

**Implementation skills**: `vitest` (`antfu/skills`, `.claude/skills/vitest/`) · `zod` (`pproenca/dot-skills`, `.claude/skills/zod/`) · `pnpm` (`antfu/skills`, `.claude/skills/pnpm/`) · `turborepo` (`vercel/turborepo`, `.claude/skills/turborepo/`) · `centrifugo` (`pedronauck/skills`, community, `.claude/skills/centrifugo/`) · `drizzle` (`.claude/skills/drizzle/`) · `better-auth-best-practices` (`.claude/skills/better-auth-best-practices/`) · `system-design` (`anthropics/knowledge-work-plugins`, `.claude/skills/system-design/`) · `security-and-hardening` (`addyosmani/agent-skills`, `.claude/skills/security-and-hardening/`) · house skills `crm-api-backend`, `crm-data-model-access`

## Rationale

Reasoning and options: see [rationale.md](rationale.md).

## Feature design

**Dependencies** (named so the build order is clear):
- **#10 core loop (spec 0005)**: milestone 2 here needs 0005's milestone 2 (`records.query`, `records.count`, `records.get`, `records.create`, `records.setValues`, `members.list`, the many side cap of 20 links plus totals, the 6 queries in flight cap, cursors bound to object, filter and sorts); milestone 3 here needs 0005's milestone 3 (the outbox, the relay and its wake, the token procedures). Milestone 1 needs only what is built today.
- **#6 client data (spec 0006)**: filter and sorts on `records.query` and `records.count` and `canJump` in contracts (0006 task 6). If task 6 hasn't landed when milestone 2 starts, milestone 2 builds exactly that thin slice (engine and procedures only, as 0006 names them) and 0006 keeps it. The browser store's own gate is 0005's AC-40, not this spec.
- **#7 realtime (spec 0007)**: the outbox `created_at` as `clock_timestamp()` and the event's `at` (AC-77 there), audience channels with stubs, `realtime.catchUp`. If 0007 hasn't landed when milestone 3 starts, milestone 3 adds only the `clock_timestamp()` value to 0005's hook (0007 keeps it), the harness subscribes to 0005's one workspace channel, and delivery is joined to each row's `created_at` by `seq` after the run. Spec 0007's AC-78 runs on this harness: its "live scenario" is `steady` (100) and `thousand` (1,000) here.
- **#8 background jobs (spec 0008)**: the load stack's worker never sleeps (`WORKER_IDLE_SLEEP_SECONDS` unset) so runs measure a warm worker; the API still gets `WORKER_WAKE_SECRET` and `WORKER_INTERNAL_URL` as in production. Once 0008 lands, the load stack creates its `crm_worker_user` login too. `pnpm load:reset` calls the engine's delete and purge services directly in a local script.
- **#9 access model (spec 0009)**: the seed writes `members.role` (owner for user 1, member for the rest) when the column exists. The harness only does what a member may.
- **#11 monitoring (spec 0010)**: none. The timing header (AC-202) is local only and separate from 0010's spans.
- **#15 relations (spec 0014)**: when `links.add` and `links.remove` land, the hub scenario writes half its moves from the hub's Team; when the stored sort key lands, a person's Company write takes a key share lock on the hub, which is what `hub` measures against the hub's own edits.

**Data model sketch**: no new tables and no migration. Files on disk, all under `.load/` (gitignored):

| File | Written by | Shape |
|---|---|---|
| `.load/manifest.json` | `pnpm load:seed` | `LoadManifest`: `profile`, `workspaceId`, `slug`, `seededAt`, object ids by key, attribute ids by `object.apiSlug`, `hubCompanyId`, `hubTeamAttributeId`, counts per object (stored and live), `users` [{ `n`, `email`, `userId`, `memberId` }], `samples` (10,000 record ids per object, chosen by hash, for `spread`) |
| `.load/sessions.json` | `pnpm load:seed`, `pnpm load:sessions` | { `apiUrl`, `mintedAt`, `sessions`: { [n]: cookie } } |
| `.load/results/<scenario>-<time>.json` | `pnpm load:run` | `LoadResult` (AC-204) |

**The budget** (`packages/core/scripts/scale-budget.ts`, exported as `@crm/core/scale-budget`):

```ts
/** The CRM's scale targets and load model (spec 0011). The load harness judges every run against these, and only these. */
export const SCALE_BUDGET = {
  online: { gate: 100, room: 1_000 },
  recordsPerWorkspace: 1_000_000,
  // liveDelivery: from the write's commit (the event's `at`) to the change visible to each holder (spec 0007 AC-78).
  p95Ms: { read: 300, open: 200, edit: 250, create: 300, liveDelivery: 1_000, poolWait: 50, relayLag: 250 },
  postgresCpuP95Share: 0.7,
  unexpectedErrorShare: 0.001,
  load: {
    actionsPerUserPerSecond: 0.2,
    mix: { scroll: 0.6, filterSort: 0.15, open: 0.1, edit: 0.12, create: 0.03 },
  },
} as const;
```

**Fill rates** (`FILL_RATES` in `packages/core/scripts/seed-crm.ts`; the share of live records with a value):

| Object | Attribute and rate |
|---|---|
| People | name 100%; email addresses 95% (one address, a second on 10% of those); phone numbers 60%; job title 80%; description 20%; primary location 50%; avatar 30%; each social link 25%; owner 70%; time zone 50%; email opt out 100% (true on 5%); company 90% |
| Companies | name 100%; domains 95%; description 40%; logo 50%; categories 70% (1 to 3 options); primary location 60%; phone 40%; employee range 80%; estimated ARR 60%; annual revenue 30%; funding raised 20%; foundation date 50%; owner 70%; parent company 5%; each social link 25% |
| Deals | the rates `seed-scale.ts` already uses (stage and owner 100%, value 85%, close date 90%, next step 50%, and so on), moved into `FILL_RATES` so both seeds read one table; associated company 90%; associated people 100% (1 or 2) |

**The load stack** (`docker-compose.load.yml`, project `crm-load`, volume `crm-load-postgres`):

| Service | Image | Port (host) | Cap | Notes |
|---|---|---|---|---|
| postgres | `postgres:18.6-alpine` | 5434 | 2 vCPU, 8 GB, `shm_size` 1 GB | `load.conf`: `shared_buffers` 2 GB, `effective_cache_size` 6 GB, `work_mem` 16 MB, `shared_preload_libraries = pg_stat_statements`, `track_io_timing on`; the same init script as the dev stack |
| pgbouncer | `edoburu/pgbouncer:v1.25.2-p0` | 6434 | none | transaction mode, `DB_USER: crm_app_user`, `DB_PASSWORD: local-only-load-app` (the load stack's app login, created by `pnpm load:seed`), `STATS_USERS: crm_app_user`, `default_pool_size` 20, `max_client_conn` 1,000 |
| api | built from `apps/api/Dockerfile` | 3100 | 1 vCPU, 1 GB | `APP_ENV=local`, `NODE_ENV=development` (the env refuses local with production; nothing on the request path reads it), `LOAD_TIMING=on`, `APP_URL=http://localhost:3100`, `WORKER_INTERNAL_URL=http://worker:3101`, `WORKER_WAKE_SECRET` and `BETTER_AUTH_SECRET` fixed `local-only` values |
| worker | the same image, `node apps/api/src/worker.ts` | 3101 | 1 vCPU, 512 MB | the relay; `WORKER_IDLE_SLEEP_SECONDS` unset, so it never sleeps; `crm_worker_user` once spec 0008 lands |
| centrifugo | `infra/centrifugo/Dockerfile` | 8100, 9100 | 1 vCPU, 512 MB | allowed origin `http://localhost:3100` |
| mailpit | `axllent/mailpit:v1.31.4` | 1026, 8026 (127.0.0.1 only) | none | the API needs a mail target to boot; the harness never reads it |

Logins on the load database, created by `pnpm load:seed` through the same scripts as `pnpm db:setup`: `crm_app_user` (password `local-only-load-app`, through PgBouncer), `crm_identity_user` (direct), and from spec 0008 `crm_worker_user` (direct). The seed, `load:sessions`, `load:reset` and the bench use the owner login (`postgres`, direct on 5434).

**Commands and calls** (no new procedures; the harness is a client of the existing contract):

| Command or call | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|
| `pnpm load:stack` / `:down` / `:wipe` | none | the load stack up (healthy) or down | local Docker | exit 1 when Docker is missing; exit 3 under 11 GB of Docker memory |
| `pnpm load:seed` | `--profile crm` (default), `smoke`, `test` | `.load/manifest.json`, `.load/sessions.json`, progress lines | owner login on the load stack | exit 3: workspace exists, remote host |
| `pnpm load:sessions` | none | fresh session rows and `.load/sessions.json` | owner login on the load stack | exit 3: remote host, no manifest |
| `pnpm load:run` | scenario (`steady`, `spread`, `hub`, `storm`, `thousand`), `--users`, `--minutes`, `--seed` | the report, `.load/results/*.json` | minted session cookies | exit 1 miss, 2 invalid, 3 setup refused |
| `pnpm load:reset` | none | creates purged, hub Team restored, new free slot count | owner login on the load stack | exit 3: remote host |
| `pnpm load:bench-hub-clear` | none | the clear's numbers (AC-214) | owner login on the load stack | exit 3: remote host |
| `records.query` | `workspace`, `objectId`, `position` (position mode) or `cursor` (cursor mode), `limit` 100 (200 for a cursor jump), `filter?`, `sorts?` | a window, `nextCursor` | member session | 400 `INPUT_INVALID` (a cursor from another view: a harness bug), 422, 429 |
| `records.count` | `workspace`, `objectId`, `filter?` | `{ count, atLeast }` | member session | 429; an abort cancels it |
| `records.get` | `workspace`, `ids` | RecordView[] (many sides as their first 20 links plus `linkTotals`) | member session | 404 |
| `records.setValues` | `workspace`, `recordId`, `values`, `mutationId` | RecordView | member session | 409, 422 |
| `records.create` | `workspace`, `objectId`, `id`, `values`, `mutationId` | RecordView | member session | 409 `LIMIT_REACHED`, `UNIQUE_CONFLICT` |
| `realtime.connectionToken`, `realtime.subscriptionToken` | `workspace` | a connection token; `{ channel, token, head }` | member session | 404 |
| `Server-Timing` header on `/api/rpc` | `LOAD_TIMING=on`, local only | `pool`, `db`, `app` durations | none | never sent otherwise |

**Status codes, as the harness classifies them**: 2xx success. 409 and 422 are expected refusals, counted apart. A request the harness aborted is neither. Any 401, 429 `TOO_MANY_REQUESTS`, 400 `INPUT_INVALID`, every 5xx, `INTERNAL`, a 10 second timeout and a dropped HTTP or WebSocket connection are unexpected errors.

**Filter and sort shapes** (`packages/load/src/shapes.ts`, taken from spec 0004's benchmark grid rows that are held; each one runs in cursor mode unless `canJump` admits it): People: job title contains a common word, sorted by name; owner is a member, sorted by created; email opt out is true. Companies: categories include an industry, sorted by name; estimated ARR in a range. Deals: stage is an option, sorted by close date; value above a number, sorted by value descending; name contains a rare word (`zephyr`); owner is a member and close date in the next 30 days.

**Editable attributes per object**: People: job title (text), email opt out (checkbox), description (long text). Companies: description, employee range (select). Deals: stage (status), value (currency), close date (date), next step (text).

**Value sourcing**:

| Action | Value produced or displayed | Source |
|---|---|---|
| every judgement | each target and the load model | `SCALE_BUDGET` (`@crm/core/scale-budget`) |
| seed | how many records, users and links per object | the profile constant `SEED_PROFILES` in `packages/core/scripts/seed-crm.ts` (`crm`, `smoke`, `test`) |
| seed | which attributes get values, and how often | `FILL_RATES` (the table above) |
| seed | user emails and member names | `load-user-<n>@example.com`, `Load User <n>` |
| seed | the owner | user 1 (through `startWorkspace`, as `workspaces.create` does); users 2 to N are written in bulk with their member, membership and directory rows |
| seed | each session | a row in Better Auth's `session` table: `token` 32 random bytes (base64url), `user_id`, `expires_at` 30 days on, written as the owner login |
| seed | each cookie | `better-auth.session_token=<token>.<signature>`, the signature an HMAC SHA-256 of the token with the load stack's `BETTER_AUTH_SECRET`, base64, the whole value URL encoded (Better Auth's signed cookie format; local cookies have no `__Secure-` prefix) |
| seed | which people join the hub | the first 150,000 people by seed number; the hub is the company named `Hub Company` |
| seed | which records go to the trash | `abs(hashtext(id::text)) % 100 = 0` per object, as spec 0004's seed does |
| seed | sort keys | the `sort_key_sources` view, as `seed-scale.ts` does |
| seed | People emails and Company domains | `person<n>@load.example.com` and `company<n>.load.example.com` by seed number, unique by construction |
| seed | `samples` | 10,000 live ids per object, `order by hashtext(id::text)` |
| run | the API, database, Centrifugo and PgBouncer addresses | `LoadEnv` (Zod, `packages/load/src/env.ts`), every default pointing at the load stack; anything not localhost refused |
| run | a user's session | `.load/sessions.json` by user number |
| run | the workspace, object and attribute ids | `.load/manifest.json` |
| run | users online, minutes, warm up | the scenario's defaults in `SCENARIOS` (`packages/load/src/scenarios.ts`), overridden by `--users` and `--minutes` |
| run | when each action happens | exponential gaps with mean `1 / SCALE_BUDGET.load.actionsPerUserPerSecond`, drawn from a seeded random source (`--seed`, default the run's start time, printed) |
| run | which action | `SCALE_BUDGET.load.mix`, plus the scenario's own extras (hub moves and edits, bursts) |
| run | a user's object | 50% People, 30% Deals, 20% Companies, chosen once per user |
| run | position or cursor mode | `canJump(filter, sorts, attributes)` from `@crm/contracts` (spec 0006) |
| run | a scroll or jump position | position mode: the user's window ± 1 to 3 windows; jumps per the scenario (steady: 70% within the first 2,000 rows; spread: even over the live count). Cursor mode: the next `nextCursor`, or the last checkpoint and reads of 200 rows forward |
| run | the live count of a view | the first `records.count` answer for that view |
| run | an edit's record and value | a record in the user's window (spread: one of `samples`); a new value made per type (text from a word list, a checkbox flipped, an option other than the current one, a number or date nudged) |
| run | a create's values | name `Load <type> <id prefix>`, People email `<id>@load.example.com`, Companies domain `<id>.load.example.com` |
| run | record ids and `mutationId` | uuid v7 from `createIdMinter` (`@crm/data`) on Node's `crypto`; `mutationId` a random uuid per write |
| run | a timestamp | `performance.timeOrigin + performance.now()` in each thread, so threads share one clock |
| run | the database clock offset | the midpoint of a `select clock_timestamp()` round trip through the owner login at start and end, averaged; applied to every `at` and `created_at` |
| run | read, open, edit, create times | answer time minus scheduled time, per action |
| run | live delivery, scheduled to visible, arrival | joined after the run: each holder's (`mutationId`, arrival, `records.get` answer) with the event's `at` (or the row's `created_at` by `seq` before spec 0007) and the writer's scheduled time |
| run | missed and caught up `seq`s | per user: a `seq` not seen as an event or stub within 10 seconds of the next one, unless recovery or `realtime.catchUp` filled it (a catch up) |
| run | API pool wait | the `pool` entry of `Server-Timing` on each answer |
| run | pooler wait | `SHOW POOLS` `maxwait` and `maxwait_us` on PgBouncer's `pgbouncer` database as `crm_app_user`, every 5 seconds |
| run | Postgres CPU | `docker stats` for the `crm-load` postgres container every 5 seconds, divided by its 2 vCPU cap |
| run | relay lag | `published_at - created_at` of outbox rows with `created_at` inside the measured window, read once after the run through the owner login |
| run | top statements, WAL bytes | `pg_stat_statements` (reset at the start of the measured window) and `pg_stat_wal` before and after, through the owner login |
| run | free record slots | `SCALE_BUDGET.recordsPerWorkspace` minus `workspace_counters.live_records`, through the owner login |
| run | planned creates | users × minutes (plus warm up) × 60 × rate × create share |
| run | host facts | `sysctl hw.model` (or `/proc/cpuinfo`), `os.cpus()`, `os.totalmem()`, `docker info` CPUs and memory, `git rev-parse HEAD`, the caps from `docker inspect` |
| reset | what the harness created | records in the workspace with `created_at > manifest.seededAt` |
| reset | the hub's Team | the manifest's hub, and the first 150,000 people by seed number, found by their seeded email `person<n>@load.example.com` |

**Key invariants**:
- The targets live in `SCALE_BUDGET` and this spec only. No other file holds a number the harness judges against.
- Every time is measured from the action's scheduled moment (no coordinated omission), and arrivals never wait for answers (open model).
- The harness goes through the same doors as a browser for every action it measures: session cookies, the oRPC contract, the access door, Centrifugo tokens. Only setup (seeding, minting sessions, reset, the hub clear bench) goes to the database directly.
- A run whose harness can't keep up is invalid, never a pass.
- The load stack never shares a volume, port or database with the dev stack, and no load command reaches a host other than localhost.
- Users act at a human rate (one action every 5 seconds on average), so any per member rate limit added later still lets a run through.
- `pnpm load:reset` only removes what the harness made after `seededAt`; seeded data is never deleted.

**Security model**:
- Everything runs on the builder's machine or an ephemeral CI runner, against made up data. No production host, Neon branch or real person is ever involved (AC-210).
- Session minting lives only in `packages/core/scripts/load-sessions.ts` (run by `load:seed` and `load:sessions`), runs as the owner login guarded by `refuseRemote` with no allow host escape, and refuses any `BETTER_AUTH_SECRET` but the load stack's fixed `local-only` value. Nothing in `apps/api` or `packages/db` exports a way to mint a session, so production code never gains one.
- `.load/sessions.json` holds live cookies for the local load stack only; it is gitignored, and the API refuses the `local-only` secret outside local.
- `Server-Timing` exposes internal timings, so it is sent only with `LOAD_TIMING=on` and the API refuses that variable outside `APP_ENV=local` (AC-202).
- The smoke workflow needs no secrets and reads nothing from other jobs.
- `security-access-reviewer` reviews milestone 1 (minting) and milestone 2 (the timing header and the local only guards).

**Configuration required**:
- `LOAD_TIMING` (api, local only): `on` adds the timing header; refused outside `APP_ENV=local`.
- `LOAD_API_URL`, `LOAD_DATABASE_URL_OWNER`, `LOAD_PGBOUNCER_URL`, `LOAD_CENTRIFUGO_URL` (harness and scripts, all optional): default to the load stack's addresses; documented in `.env.example` as a commented block.
- The load stack's own secrets (`BETTER_AUTH_SECRET`, `WORKER_WAKE_SECRET`, Centrifugo keys, the login passwords) are fixed `local-only` values in `docker-compose.load.yml`.
- New pinned dependencies in the catalog: `ws` and `@types/ws` (the harness's WebSocket, so it can send an `Origin` header like a browser). `centrifuge` and `@orpc/client` are already pinned by spec 0005.
- Owner step before milestone 1: raise Docker Desktop's memory to 12 GB on the reference machine (it is 7.75 GB today).

**Critical test scenarios**:
- Happy path: `pnpm load:seed` then `pnpm load:run steady` on the reference machine prints a full table with every line judged and exits 0 or 1 with the misses named, verifies **AC-192** to **AC-201**, **AC-204**.
- Sessions: a minted cookie is accepted by `me.get` against the real API; an expired one makes `load:run` exit 3 naming `pnpm load:sessions`; `load:sessions` with any other secret refuses, verifies **AC-196**, **AC-212**.
- Validity: a run with the harness throttled (a test flag that blocks its event loop) exits 2 and says the harness couldn't keep up; a run with the API stopped mid window exits 2 on errors, verifies **AC-203**.
- Measurement: unit tests show a server that stalls 2 seconds raises the p95 of actions scheduled during the stall (scheduled time, not send time); the delivery join pairs writers and holders correctly with skipped own echoes and stubs; a gap filled by catch up is a catch up, one left open 10 seconds is a miss, verifies **AC-197**, **AC-200**, **AC-212**.
- Cursor views: a filtered view's scroll follows `nextCursor` and its jump reads forward in 200 row calls; no filtered request carries a position, verifies **AC-198**.
- Seed: the `test` profile in Vitest against real Postgres has the exact counts, the fill rates within 1 point, the hub's Team, 1% trashed, every user an active member with a directory row and a session, and sort keys present, verifies **AC-194**, **AC-212**.
- Guard: every load command with a non local address exits 3 and touches nothing; the API with `LOAD_TIMING=on` and `APP_ENV=production` refuses to boot, and without it sends no `Server-Timing`, verifies **AC-202**, **AC-210**.
- Stress: `hub`, `storm` and `thousand` each finish with their extra lines and exit by validity only; the hub clear bench prints its numbers, verifies **AC-206**, **AC-207**, **AC-208**, **AC-214**.
- Reset: after a run, `pnpm load:reset` brings free slots back to 10,000 and the hub's Team back to 150,000, verifies **AC-209**.

## Build plan

Tracer Bullet: each milestone ends with a command you can run and a result you can read. Milestone 1 can start now; milestone 2 waits for 0005's milestone 2 (and 0006 task 6, or builds its thin slice); milestone 3 waits for 0005's milestone 3.

**Milestone 1: the budget, the million record seed and minted sessions**
1. `packages/core/scripts/scale-budget.ts` with `SCALE_BUDGET` and its doc comments; export it as `@crm/core/scale-budget`, satisfies **AC-192**
2. Owner step: Docker Desktop memory to 12 GB. The load stack: `docker-compose.load.yml` with its logins and secrets, `infra/postgres/load.conf`, PgBouncer's stats user, the 11 GB check, `pnpm load:stack`, `load:stack:down`, `load:stack:wipe`; `.load/` added to `.gitignore`, satisfies **AC-193**, **AC-210**
3. `packages/core/scripts/seed-crm.ts` with the `crm`, `smoke` and `test` profiles and `FILL_RATES` (Deals' rates moved out of `seed-scale.ts`): users, the owner through `startWorkspace`, bulk members, memberships and directory rows, the three objects' values, links, the hub, the trash, sort keys, vacuum, the manifest, satisfies **AC-194**, **AC-210**
4. `packages/core/scripts/load-sessions.ts`: session rows and signed cookies, the secret check; `pnpm load:sessions`, satisfies **AC-196**, **AC-210**
5. `pnpm load:seed`: stack up, migrations and logins against the load stack, seed, sessions, refusals, satisfies **AC-195**, **AC-210**
6. The seed's Vitest suite on the `test` profile against real Postgres, and the test that the API accepts a minted cookie; `security-access-reviewer` on the minting, satisfies **AC-194**, **AC-196**, **AC-212**
7. Run the `crm` profile on the reference machine, note its time and size, and open the local app on the load stack with user 1's minted cookie to see the People count (once 0005's table exists), satisfies **AC-195**

**Milestone 2: reads and writes against the budget** (after 0005 milestone 2)
8. If 0006 task 6 hasn't landed: filter and sorts on `records.query` and `records.count` and `canJump` in contracts, exactly as 0006 names them, satisfies **AC-198**
9. `packages/load`: package, tag `server` for boundaries, `LoadEnv` with the localhost guard, the oRPC client on `@crm/contracts`, the manifest and sessions readers, the session check before warm up, satisfies **AC-196**, **AC-210**
10. The scheduler and user model: open model arrivals on a seeded random source, warm up ramp, worker threads (one by default), the mix sampler, views in position or cursor mode, windows, checkpoints, shapes, edits and creates, count aborts; unit tests for the pure parts, satisfies **AC-197**, **AC-198**, **AC-212**
11. The timing header: an acquire hook in `packages/db`'s `createDatabase`, the API's `Server-Timing` behind `LOAD_TIMING`, the env refusal, tests, satisfies **AC-202**, **AC-212**
12. Collectors: API pool wait from the header, PgBouncer `SHOW POOLS`, `docker stats`, `pg_stat_statements`, `pg_stat_wal`, host and Docker facts, satisfies **AC-201**, **AC-204**
13. The report, `LoadResult`, the validity rules and exit codes; unit tests for percentiles and verdicts, satisfies **AC-199**, **AC-203**, **AC-204**, **AC-212**
14. `spread`, `pnpm load:reset` and the free slot check, satisfies **AC-205**, **AC-209**
15. First `steady` (live lines marked "not built yet") and `spread` runs at 100 users; results into `verify.md`; `security-access-reviewer` and `state-performance-reviewer` before it lands, satisfies **AC-199**, **AC-205**, **AC-213**

**Milestone 3: live delivery** (after 0005 milestone 3)
16. If spec 0007 hasn't landed: the outbox hook writes `created_at` as `clock_timestamp()` (0007 keeps it). The relay lag reader and the database clock offset, satisfies **AC-201**
17. Live clients: one Centrifugo connection per user (`centrifuge` on `ws`), tokens through the procedures, the audience channel, own echo skip, stubs, holder refetch, coarse refetch, recovery and catch up, the miss rule, the delivery join and its unit tests, satisfies **AC-200**, **AC-212**
18. `storm`: bursts and the reconnect storm, with their extra lines, satisfies **AC-207**
19. A full `steady` run with live delivery at 100 users; `verify.md` updated, satisfies **AC-200**, **AC-213**

**Milestone 4: 1,000 users, the hub, and the weekly smoke**
20. Scale the harness out: users spread over worker threads (250 per thread), per thread event loop checks, the `thousand` scenario, satisfies **AC-203**, **AC-208**
21. `hub`: hub moves, opens and the hub's own edits, with their extra lines; the reset that puts the Team back, satisfies **AC-206**, **AC-209**
22. `pnpm load:bench-hub-clear` at the engine level, satisfies **AC-214**
23. `.github/workflows/load-smoke.yml` (weekly and on demand, smoke profile, warnings for misses, the result as an artifact), satisfies **AC-211**
24. `packages/load/AGENTS.md` (commands, scenarios, how to read the report); a run of each stress scenario and the bench into `verify.md` with every miss named and planned, satisfies **AC-213**

## Consequences

**Positive**:
- Every later slice has one command to prove it holds, and reviewers can ask for numbers instead of opinions.
- The budget is one typed constant, so a target changes in one place and every run follows.
- Measuring from scheduled time and refusing saturated runs keeps the numbers honest.
- Minted sessions make 1,000 users a seed step, not 1,000 sign ins, and keep sign in rate limits out of the numbers.
- The open questions earlier specs left for #12 get measured: the per workspace outbox counter row under bursts (0005), a hub edited while people link to it (0005, 0014), fan out at 1,000 (0001, 0005, 0007), Postgres CPU and pool use (0001).

**Negative / tradeoffs**:
- Local numbers are not production numbers. The capped Postgres is close to Neon's 2 vCPU, 8 GB compute but not the same storage, and the Vercel hop and the internet are not in the path (they add tens of milliseconds). #41 judges with that gap in mind; spec 0004's AC-26 stays deferred while Neon stays on its free plan.
- The `crm` seed is about 10 GB on disk with its indexes and takes up to an hour; the load stack needs Docker with at least 11 GB of memory, which leaves the 16 GB reference machine about 4 GB for the harness and macOS. `thousand` may come out invalid there (the harness can't keep up); then it runs on a larger machine with the same caps, and the run facts say so.
- Minted sessions skip the sign in path, so sign in is never load tested here.
- The harness's actions are a model of the People table, not the real browser: it doesn't measure rendering, the client store or the first load. Those stay with 0005's AC-40 and the size budget.
- One more package and one more compose file to keep in step with the API as procedures change; the cookie format follows Better Auth and is pinned by a test.
- Shared CI runners make the weekly smoke a crash and error check only.

**Neutral**:
- No migration.
- New pinned dependencies: `ws`, `@types/ws`.
- New root scripts: `load:stack`, `load:stack:down`, `load:stack:wipe`, `load:seed`, `load:sessions`, `load:run`, `load:reset`, `load:bench-hub-clear`.
- Each later feature that adds a user action (record page #17, notes #19, views #20, board #21, bulk #22) adds it to the user model and, if it needs one, a line to the budget.

## Follow-up

- [ ] **#41**: judge `thousand`, `hub`, `storm` and the hub clear bench; decide API replicas, per object channels (#7) and a second Centrifugo node from their numbers; add a many workspaces scenario (100 users over 10 workspaces) if tenant spread matters by then.
- [ ] **#15**: the hub writes half its moves from the Team side once `links.add` and `links.remove` exist; the key share lock on the hub is measured by `hub`.
- [ ] **Spec 0007** (`/sync`): AC-78's "#12 harness `live` scenario" is `steady` (100) and `thousand` (1,000) here; its discarded share and its prune during load are extra report lines 0007 adds.
- [ ] **Spec 0010**: `relay.lag` reads the same columns; consider `SCALE_BUDGET.p95Ms.relayLag` for its lag alert threshold.
- [ ] **Spec 0005** (`/sync`): its follow up for #12 ("clear a 150k link end on a hub while 100 users link to it") is split: the clear is `pnpm load:bench-hub-clear` (AC-214), and the linking under contention is the `hub` scenario (AC-206). Reading a hub's full reference value no longer happens, since 0005 caps many sides at 20 links.
- [ ] **Spec 0004** (`/sync`): record that #12 answered the partitioning question (no), and that the load seed covers People and Companies at scale beside `db:seed:scale`'s deals.
- [ ] **Spec 0001**: Vercel middleware usage and the internet hop are not measured locally; check them on production traffic with #11's charts.
- [ ] **Root `AGENTS.md`** (`/sync`): add the load commands and the load stack's ports; the `crm-api-backend` skill's "run it against the load harness seed" can name `pnpm load:run steady`.
- [ ] **Neon**: if the owner ever moves to a paid plan, add an opt in target for a benchmark branch (spec 0004's AC-26) behind its own allow host.

## Open questions for the owner

None open. Decided:
- The load model (0.2 actions per user per second), the gate set (`steady` and `spread`), `spread` as cold cache reads, and 1,000 seeded members: the owner's acceptance of the recommended defaults for #11 to #22 (3 October 2026).
- Sessions are minted, for the 100 gate users and the 1,000 of `thousand` alike (the owner's brief, confirmed in the cross check of 8 October 2026).
- Clearing a hub side is an engine level bench outside the harness (cross check, 8 October 2026).
