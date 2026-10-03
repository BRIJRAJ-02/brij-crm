# 0011. Scale budget and load harness

**Date**: 2026-10-03
**Status**: Proposed

## Summary

This spec writes the CRM's speed targets down in one file and builds the tools that check them. One command fills a local database with a million records (people, companies and deals, linked to each other, with one very large company). A second command plays 100 people browsing and editing at once, through the real API and the real live connection, and prints how fast reads, writes and live updates were against the targets. Everything runs on your machine, in Docker capped to the size of a small Neon database, because the owner keeps Neon on its free plan; nothing ever runs against production.

## Requirements

**User stories**:
- As the builder of any later feature, I want the targets in one file and one command that checks them, so every slice is measured, not guessed.
- As the owner, I want a plain table that says pass or miss for each target at 100 people online, so I know the product holds before customers arrive.
- As the builder of scale hardening (#41), I want the same harness to push 1,000 people and the hard shapes (a huge company, bursts, reconnects), so I can find what breaks first.
- As a reviewer (`state-performance-reviewer`), I want to ask for a harness run on a risky change and get comparable numbers, so a performance claim can be checked.

**Acceptance criteria** (this spec's reserved range, AC-192 to AC-213):
- **AC-192**: `packages/core/scripts/scale-budget.ts` exports one readonly `SCALE_BUDGET`: 100 online (the gate) and 1,000 (room), 1,000,000 records per workspace, p95 end to end of 300 ms for a read, 200 ms to open a record, 250 ms for an edit, 300 ms for a create, live delivery p95 of 1 second at 100 online, Postgres CPU p95 under 70% of its cap, pool waits p95 under 50 ms, relay lag p95 under 250 ms, at most 0.1% unexpected errors, and the load model (0.2 actions per user per second; 60% scroll, 15% filter or sort, 10% open, 12% edit, 3% create). The harness reads every target and the load model from it and from nowhere else.
- **AC-193**: `pnpm load:stack` starts a load stack separate from the dev stack (its own compose file `docker-compose.load.yml`, project `crm-load`, volume and ports): Postgres 18.6 capped at 2 vCPU and 8 GB with `infra/postgres/load.conf`, PgBouncer in transaction mode, the API and the worker from `apps/api/Dockerfile` (api capped at 1 vCPU and 1 GB, worker at 1 vCPU and 512 MB), Centrifugo (1 vCPU, 512 MB) and Mailpit. `pnpm load:stack:down` stops it and `pnpm load:stack:wipe` also deletes its volume. The dev stack and its data are never touched.
- **AC-194**: The `crm` seed profile makes one workspace (slug `load`) with 600,000 People, 150,000 Companies and 250,000 Deals (1,000,000 records), every template attribute filled at a realistic rate, unique emails and domains, 90% of people linked to a company, one hub company (`Hub Company`) whose Team holds 150,000 people, 90% of deals linked to a company and every deal to 1 or 2 people, and 1% of each object in the trash (990,000 live records, so 10,000 creates fit under the 1,000,000 limit). It makes 1,000 users with verified emails `load-user-<n>@example.com`, each an active member with directory and membership rows (user 1 is the owner, the rest are members). Stored sort keys are filled from their defining view, and the tables are vacuumed and analysed (the contains search reads `values` through its own index, so it needs nothing more).
- **AC-195**: `pnpm load:seed` is one command: it starts the load stack if it is down, applies the migrations and creates the app and identity logins on it, seeds the profile (`--profile crm` by default, `--profile smoke` for 50,000 records and 50 users), prints progress, and writes `.load/manifest.json`. It finishes the `crm` profile in under 60 minutes on the reference machine. It refuses to run when the load database already holds a `load` workspace (it names `pnpm load:stack:wipe`), and refuses any database host but the load stack's localhost.
- **AC-196**: Before warm up, `pnpm load:run` makes sure every user the scenario needs has a live session: it signs in through the real email code route (code read from the load Mailpit), saves the cookie in `.load/sessions.json`, reuses saved sessions that `me.get` accepts, and signs in again for any it refuses. Sign in time is never measured. No code writes session rows or signs cookies itself.
- **AC-197**: `pnpm load:run <scenario> [--users N] [--minutes M]` drives an open model: each user's actions arrive at random (exponential gaps, mean 1 / 0.2 seconds) whether or not earlier ones answered, users ramp up over a 60 second warm up that is not measured, then the measured window runs (10 minutes by default, 5 for `thousand`). Each action's time is measured from when it was scheduled, not when it was sent, so a slow server can't hide its queue. The achieved mix is within 1 point of the budget's mix.
- **AC-198**: Each simulated user behaves like the People table: it holds a view (People 50%, Deals 30%, Companies 20%) and the 100 row window it last loaded. Scroll fetches the next or previous 1 to 3 windows, or jumps (in `steady`, 70% of jumps land in the first 2,000 rows, 30% anywhere). Filter or sort replaces the view with one of the object's fixed shapes and fetches its first window and its count together; a newer action on the same view cancels a count still running. Open reads one record. Edit changes one editable attribute of a record in the user's window. Create adds a record with a unique name (and email or domain).
- **AC-199**: The report judges read (scroll plus filter or sort windows), open, edit and create at p95 against the budget, each line with p50, p95, p99, max, count and a verdict. Counts and the hub open are reported, not judged.
- **AC-200**: Every user holds a Centrifugo connection and the workspace subscription, with tokens from `realtime.connectionToken` and `realtime.subscriptionToken`, as a browser does. A user skips events carrying its own `mutationId`; a user that holds any of an event's record ids fetches them with `records.get` (a coarse event refetches its window). Visible delivery (from the writer's scheduled action to the holder's `records.get` answer) is judged at p95 against 1 second; event delivery (to arrival) is reported for every subscriber. An event that never arrives within 10 seconds, or a gap in `seq`, counts as missed, and a gate run must miss none.
- **AC-201**: The report judges server health: Postgres CPU (p95 of 5 second samples of the container's CPU, as a share of its 2 vCPU cap) under 70%; the API's pool wait p95 (from the timing header, AC-202) and the pooler's wait (p95 of 5 second samples of PgBouncer's `SHOW POOLS` `maxwait`) under 50 ms; relay lag (`published_at` minus `created_at` of every outbox row written in the measured window) p95 under 250 ms. The outbox hook writes `created_at` as `clock_timestamp()`, so a long transaction's own time is never counted as relay lag.
- **AC-202**: With `APP_ENV=local` and `LOAD_TIMING=on`, every `/api/rpc` answer carries `Server-Timing: pool;dur=<ms>, db;dur=<ms>, app;dur=<ms>` (time waiting for a database client, time in queries, whole handler). Without `LOAD_TIMING=on` the header is never sent, and the API refuses to boot with `LOAD_TIMING=on` outside `APP_ENV=local`.
- **AC-203**: A run is invalid (exit 2, with the reason) when the harness itself can't keep up (event loop delay p99 over 50 ms in any thread, or under 95% of the planned actions sent) or when unexpected errors pass 0.1% (5xx, `INTERNAL`, a 10 second timeout, a dropped connection, a 401 after warm up). Expected refusals (409, 422) are counted apart and never fail a run. Exit codes: 0 every judged line passes, 1 a budget miss in a gate scenario, 2 invalid, 3 setup refused.
- **AC-204**: Each run prints one table (metric, target, p50, p95, p99, max, count, verdict) and the run's facts (scenario, users, minutes, git commit, host CPU and memory, the stack's caps, the manifest's counts, start and end), plus the 10 statements with the most total time from `pg_stat_statements` and the WAL bytes written. It writes the same as JSON (`LoadResult`, a Zod schema in `packages/load`) to `.load/results/<scenario>-<time>.json`.
- **AC-205**: `spread` runs the steady mix with every jump, open and edit drawn evenly over the whole object instead of near the top, so most reads miss the cache. It is a gate like `steady`.
- **AC-206**: `hub` runs 100 users where a fifth of the edits move a person to or from the hub company and a fifth of the opens read the hub (its Team holds 150,000 ids). In the last minute one user clears the hub's Team in one write; the report adds that write's time, the p95 of the other writes while it ran, how many writes ran out of retries (`runWrite`), and the WAL bytes it wrote. `pnpm load:reset` restores the Team afterwards.
- **AC-207**: `storm` runs the steady mix plus a burst every 10 seconds (every online user edits a different record in the same second) and, at the middle of the window, drops every live connection at once and reconnects them. The report adds edit p95 inside bursts, the time until every user has recovered or refetched, how many refetched, and missed events (which must be 0 once recovered).
- **AC-208**: `thousand` runs 1,000 users from the seeded members across worker threads with the steady mix for 5 measured minutes. It prints every verdict, but its exit code depends only on validity (AC-203): the budget at 1,000 is judged in #41.
- **AC-209**: `pnpm load:reset` moves every record the harness created (created after the manifest's `seededAt`) to the trash and purges it, through the engine's own services as the system actor, and writes the hub's seeded Team back. Before warm up, `pnpm load:run` refuses (exit 3, naming `pnpm load:reset`) when the free record slots are fewer than 1.5 times the creates the run plans.
- **AC-210**: Nothing in this feature can reach a remote host. `pnpm load:seed`, `pnpm load:run` and `pnpm load:reset` refuse any API, database, Centrifugo or Mailpit address that isn't localhost. All seeded data is made up, on `example.com`. `.load/` (manifest, sessions, results) is gitignored. The load stack's secrets are fixed local values marked `local-only`.
- **AC-211**: A weekly GitHub workflow (`load-smoke.yml`, Mondays and on demand) starts the load stack on the runner, seeds the `smoke` profile, runs `steady --users 20 --minutes 2`, uploads the result JSON, and fails only on an invalid run or a crash. Budget misses show as warnings, since shared runners don't give trustworthy times.
- **AC-212**: Tests: the pure parts (arrival scheduler, mix sampler, percentiles, budget verdicts, scheduled time measurement, the delivery join) have unit tests; the seed runs a tiny `test` profile (2,000 records, 5 users) in Vitest against a real Postgres and checks counts, links, the hub, the trash, memberships and sort keys; the API's timing header and its env refusal have tests.
- **AC-213**: `docs/specs/0011-scale-budget-load-harness/verify.md` records the first `steady` and `spread` results at 100 users and one run of each stress scenario, as printed, with every miss named and either fixed or given a plan (most go to #41).

## Decision

**Chosen option**: Option 1: a custom Node harness in `packages/load` on the real oRPC contract and the real Centrifugo client, against a capped local Docker stack, with the budget in one constant.

The budget lives in `packages/core/scripts/scale-budget.ts`; the seed profile lives beside spec 0004's scale seed; the harness signs users in the real way and measures from scheduled time.

Calls taken from the brief's recommendations where the brief left the shape open (each listed as an owner question in the return):
- Each user acts every 5 seconds on average (0.2 per second), so 100 users send about 20 actions a second plus the refetches live updates cause.
- `steady` and `spread` are gates (a miss exits 1); `hub`, `storm` and `thousand` report verdicts but fail only when invalid, and #41 judges them.
- `spread` means cold cache reads over the whole million, not many workspaces.
- Sessions come from real sign ins through Mailpit, not rows written by a script.
- The seed makes 1,000 members (the brief said 100), so `thousand` has 1,000 different people; `steady` uses the first 100.
- No hash partitioning of `values` by workspace (spec 0004's open question): it doesn't help one big workspace, which is the shape the budget is about.

**Implementation skills**: `vitest` (`antfu/skills`, `.claude/skills/vitest/`) · `zod` (`pproenca/dot-skills`, `.claude/skills/zod/`) · `pnpm` (`antfu/skills`, `.claude/skills/pnpm/`) · `turborepo` (`vercel/turborepo`, `.claude/skills/turborepo/`) · `centrifugo` (`pedronauck/skills`, community, `.claude/skills/centrifugo/`) · `drizzle` (`.claude/skills/drizzle/`) · `system-design` (`anthropics/knowledge-work-plugins`, `.claude/skills/system-design/`) · `security-and-hardening` (`addyosmani/agent-skills`, `.claude/skills/security-and-hardening/`) · house skills `crm-api-backend`, `crm-data-model-access`

## Rationale

Reasoning and options: see [rationale.md](rationale.md).

## Feature design

**Dependencies** (named so the build order is clear):
- **#10 core loop (spec 0005)**: milestone 2 here needs 0005's milestone 2 (`records.query`, `records.count`, `records.get`, `records.create`, `records.setValues`, `members.list`); milestone 3 here needs 0005's milestone 3 (the outbox, the relay, the token procedures). Milestone 1 needs only what is built today.
- **#6 client data**: none. The harness calls `records.query` with a filter and sort directly; 0005's contract already accepts them and the engine compiles them. The browser store's own gate is 0005's AC-40, not this spec.
- **#7 realtime**: none beyond 0005. The thin slice this spec adds is one value: the outbox hook writes `created_at` as `clock_timestamp()` (AC-201). Spec 0010 charts the same `relay.lag` and gains accuracy from it.
- **#8 background jobs**: none. `pnpm load:reset` calls the engine's delete and purge services directly in a local script.
- **#9 access model**: none. The seed writes the thin role the owner decided (owner for user 1, member for the rest) if the `members` role column exists when this is built; the harness only does what a member may.
- **#11 monitoring (spec 0010)**: none. The timing header (AC-202) is local only and separate from 0010's spans.
- **#15 relations**: when `links.add` and `links.remove` land, the hub scenario's link churn moves to them, and the hub open (today the full 150,000 ids) changes to #15's first 20 links plus a total.

**Data model sketch**: no new tables and no migration. One change to 0005's outbox hook: its insert sets `created_at = clock_timestamp()` (the moment of insert, the last statement of the write) instead of the column default `now()` (the transaction's start). Files on disk, all under `.load/` (gitignored):

| File | Written by | Shape |
|---|---|---|
| `.load/manifest.json` | `pnpm load:seed` | `LoadManifest`: `profile`, `workspaceId`, `slug`, `seededAt`, object ids by key, attribute ids by `object.apiSlug`, `hubCompanyId`, `hubTeamAttributeId`, counts per object (stored and live), `users` [{ `n`, `email`, `userId`, `memberId` }], `samples` (10,000 record ids per object, chosen by hash, for `spread`) |
| `.load/sessions.json` | `pnpm load:run` | { `apiUrl`, `sessions`: { [email]: cookie } } |
| `.load/results/<scenario>-<time>.json` | `pnpm load:run` | `LoadResult` (AC-204) |

**The budget** (`packages/core/scripts/scale-budget.ts`, exported as `@crm/core/scale-budget`):

```ts
/** The CRM's scale targets and load model (spec 0011). The load harness judges every run against these, and only these. */
export const SCALE_BUDGET = {
  online: { gate: 100, room: 1_000 },
  recordsPerWorkspace: 1_000_000,
  p95Ms: { read: 300, open: 200, edit: 250, create: 300, liveDelivery: 1_000, poolWait: 50, relayLag: 250 },
  postgresCpuP95Share: 0.7,
  unexpectedErrorShare: 0.001,
  load: {
    actionsPerUserPerSecond: 0.2,
    mix: { scroll: 0.6, filterSort: 0.15, open: 0.1, edit: 0.12, create: 0.03 },
  },
} as const;
```

**The load stack** (`docker-compose.load.yml`, project `crm-load`, volume `crm-load-postgres`):

| Service | Image | Port (host) | Cap | Notes |
|---|---|---|---|---|
| postgres | `postgres:18.6-alpine` | 5434 | 2 vCPU, 8 GB, `shm_size` 1 GB | `load.conf`: `shared_buffers` 2 GB, `effective_cache_size` 6 GB, `work_mem` 16 MB, `shared_preload_libraries = pg_stat_statements`, `track_io_timing on`; the same init script as the dev stack |
| pgbouncer | `edoburu/pgbouncer:v1.25.2-p0` | 6434 | none | transaction mode, `default_pool_size` 20, `max_client_conn` 1,000, `stats_users = crm_app_user` |
| api | built from `apps/api/Dockerfile` | 3100 | 1 vCPU, 1 GB | `APP_ENV=local`, `NODE_ENV=development` (the env refuses local with production; nothing on the request path reads it), `LOAD_TIMING=on`, `APP_URL=http://localhost:3100` |
| worker | the same image, `node apps/api/src/worker.ts` | 3101 | 1 vCPU, 512 MB | the relay |
| centrifugo | `infra/centrifugo/Dockerfile` | 8100, 9100 | 1 vCPU, 512 MB | allowed origin `http://localhost:3100` |
| mailpit | `axllent/mailpit:v1.31.4` | 1026, 8026 (127.0.0.1 only) | none | `MP_MAX_MESSAGES` 2,000 |

**Commands and calls** (no new procedures; the harness is a client of the existing contract):

| Command or call | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|
| `pnpm load:stack` / `:down` / `:wipe` | none | the load stack up (healthy) or down | local Docker | exit 1 when Docker is missing |
| `pnpm load:seed` | `--profile crm` (default), `smoke`, `test` | `.load/manifest.json`, progress lines | owner login on the load stack | exit 3: workspace exists, remote host |
| `pnpm load:run` | scenario (`steady`, `spread`, `hub`, `storm`, `thousand`), `--users`, `--minutes` | the report, `.load/results/*.json` | sessions by real sign in | exit 1 miss, 2 invalid, 3 setup refused |
| `pnpm load:reset` | none | creates purged, hub Team restored, new free slot count | owner and app logins on the load stack | exit 3: remote host |
| `records.query` | `workspace`, `objectId`, `position`, `limit` 100, `filter?`, `sorts?` | a window | member session | 422, 503 `QUERY_CANCELLED` |
| `records.count` | `workspace`, `objectId`, `filter?` | `{ count, atLeast }` | member session | 503 when the harness cancels it |
| `records.get` | `workspace`, `ids` | RecordView[] | member session | 404 |
| `records.setValues` | `workspace`, `recordId`, `values`, `mutationId` | RecordView | member session | 409, 422 |
| `records.create` | `workspace`, `objectId`, `id`, `values`, `mutationId` | RecordView | member session | 409 `LIMIT_REACHED`, `UNIQUE_CONFLICT` |
| `realtime.connectionToken`, `realtime.subscriptionToken` | `workspace` | tokens | member session | 404 |
| `Server-Timing` header on `/api/rpc` | `LOAD_TIMING=on`, local only | `pool`, `db`, `app` durations | none | never sent otherwise |

**Status codes, as the harness classifies them**: 2xx success. 409 and 422 are expected refusals, counted apart. 503 `QUERY_CANCELLED` on a count the harness cancelled is neither. 401 during warm up triggers a fresh sign in; after warm up it is an error. 429, every 5xx, `INTERNAL`, a 10 second timeout and a dropped HTTP or WebSocket connection are unexpected errors.

**Filter and sort shapes** (`packages/load/src/shapes.ts`, taken from spec 0004's benchmark grid rows that are held): People: job title contains a common word, sorted by name; owner is a member, sorted by created; email opt out is true. Companies: categories include an industry, sorted by name; estimated ARR in a range. Deals: stage is an option, sorted by close date; value above a number, sorted by value descending; name contains a rare word (`zephyr`); owner is a member and close date in the next 30 days.

**Editable attributes per object**: People: job title (text), email opt out (checkbox), description (long text). Companies: description, employee range (select). Deals: stage (status), value (currency), close date (date), next step (text).

**Value sourcing**:

| Action | Value produced or displayed | Source |
|---|---|---|
| every judgement | each target and the load model | `SCALE_BUDGET` (`@crm/core/scale-budget`) |
| seed | how many records, users and links per object | the profile constant `SEED_PROFILES` in `packages/core/scripts/seed-crm.ts` (`crm`, `smoke`, `test`) |
| seed | user emails and member names | `load-user-<n>@example.com`, `Load User <n>` |
| seed | the owner | user 1 (through `startWorkspace`, as `workspaces.create` does); users 2 to N are written in bulk with their member, membership and directory rows |
| seed | which people join the hub | the first 150,000 people by seed number; the hub is the company named `Hub Company` |
| seed | which records go to the trash | `abs(hashtext(id::text)) % 100 = 0` per object, as spec 0004's seed does |
| seed | sort keys | the `sort_key_sources` view, as `seed-scale.ts` does |
| seed | People emails and Company domains | `person<n>@load.example.com` and `company<n>.load.example.com` by seed number, unique by construction |
| seed | `samples` | 10,000 live ids per object, `order by hashtext(id::text)` |
| run | the API, database, Centrifugo, Mailpit and PgBouncer addresses | `LoadEnv` (Zod, `packages/load/src/env.ts`), every default pointing at the load stack; anything not localhost refused |
| run | a user's session | `.load/sessions.json`, else a sign in with the code read from Mailpit's `GET /api/v1/messages` for that address |
| run | the workspace, object and attribute ids | `.load/manifest.json` |
| run | users online, minutes, warm up | the scenario's defaults in `SCENARIOS` (`packages/load/src/scenarios.ts`), overridden by `--users` and `--minutes` |
| run | when each action happens | exponential gaps with mean `1 / SCALE_BUDGET.load.actionsPerUserPerSecond`, drawn from a seeded random source (`--seed`, default the run's start time, printed) |
| run | which action | `SCALE_BUDGET.load.mix`, plus the scenario's own extras (hub moves, bursts) |
| run | a user's object | 50% People, 30% Deals, 20% Companies, chosen once per user |
| run | a scroll or jump position | the user's window ± 1 to 3 windows; jumps per the scenario (steady: 70% within the first 2,000 rows; spread: even over the live count) |
| run | the live count of a view | the first `records.count` answer for that view |
| run | an edit's record and value | a record in the user's window (spread: one of `samples`); a new value made per type (text from a word list, a checkbox flipped, an option other than the current one, a number or date nudged) |
| run | a create's values | name `Load <type> <id prefix>`, People email `<id>@load.example.com`, Companies domain `<id>.load.example.com` |
| run | record ids and `mutationId` | uuid v7 from `createIdMinter` (`@crm/data`) on Node's `crypto`; `mutationId` a random uuid per write |
| run | a timestamp | `performance.timeOrigin + performance.now()` in each thread, so threads share one clock |
| run | read, open, edit, create times | answer time minus scheduled time, per action |
| run | visible and event delivery | joined after the run: the writer's (`mutationId`, scheduled time) with each holder's (`mutationId`, arrival, `records.get` answer) |
| run | API pool wait | the `pool` entry of `Server-Timing` on each answer |
| run | pooler wait | `SHOW POOLS` `maxwait` and `maxwait_us` on PgBouncer's `pgbouncer` database as `crm_app_user`, every 5 seconds |
| run | Postgres CPU | `docker stats` for the `crm-load` postgres container every 5 seconds, divided by its 2 vCPU cap |
| run | relay lag | `published_at - created_at` of outbox rows with `created_at` inside the measured window, read once after the run through the owner login |
| run | top statements, WAL bytes | `pg_stat_statements` (reset at the start of the measured window) and `pg_stat_wal` before and after, through the owner login |
| run | free record slots | `SCALE_BUDGET.recordsPerWorkspace` minus `workspace_counters.live_records`, through the owner login |
| run | planned creates | users × minutes (plus warm up) × 60 × rate × create share |
| run | host facts | `os.cpus()`, `os.totalmem()`, `git rev-parse HEAD`, the caps from `docker inspect` |
| reset | what the harness created | records in the workspace with `created_at > manifest.seededAt` |
| reset | the hub's Team | the manifest's hub, and the first 150,000 people by seed number, found by their seeded email `person<n>@load.example.com` |

**Key invariants**:
- The targets live in `SCALE_BUDGET` and this spec only. No other file holds a number the harness judges against.
- Every time is measured from the action's scheduled moment (no coordinated omission), and arrivals never wait for answers (open model).
- The harness goes through the same doors as a browser: session cookies from a real sign in, the oRPC contract, the access door, Centrifugo tokens. It never calls the engine or the database to do an action it then measures.
- A run whose harness can't keep up is invalid, never a pass.
- The load stack never shares a volume, port or database with the dev stack, and no load command reaches a host other than localhost.
- Users act at a human rate (one action every 5 seconds on average), so any per member rate limit added later still lets a run through.
- `pnpm load:reset` only removes what the harness made after `seededAt`; seeded data is never deleted.

**Security model**:
- Everything runs on the builder's machine or an ephemeral CI runner, against made up data. No production host, Neon branch or real person is ever involved (AC-210).
- `.load/sessions.json` holds live session cookies for the local load stack only; it is gitignored and the load stack's `BETTER_AUTH_SECRET` is a fixed `local-only` value, which the API refuses outside local.
- `Server-Timing` exposes internal timings, so it is sent only with `LOAD_TIMING=on` and the API refuses that variable outside `APP_ENV=local` (AC-202).
- Seed and reset run as the owner login on the load database, guarded by `refuseRemote` (spec 0004's guard), with no `SEED_SCALE_ALLOW_HOST` escape for the load commands.
- The smoke workflow needs no secrets and reads nothing from other jobs.
- `security-access-reviewer` reviews milestone 2 (the timing header and the local only guards).

**Configuration required**:
- `LOAD_TIMING` (api, local only): `on` adds the timing header; refused outside `APP_ENV=local`.
- `LOAD_API_URL`, `LOAD_DATABASE_URL_OWNER`, `LOAD_IDENTITY_DATABASE_URL`, `LOAD_PGBOUNCER_URL`, `LOAD_CENTRIFUGO_URL`, `LOAD_MAILPIT_URL` (harness, all optional): default to the load stack's addresses; documented in `.env.example` as a commented block.
- The load stack's own secrets (`BETTER_AUTH_SECRET`, Centrifugo keys) are fixed `local-only` values in `docker-compose.load.yml`.
- New pinned dependencies in the catalog: `ws` and `@types/ws` (the harness's WebSocket, so it can send an `Origin` header like a browser). `centrifuge` and `@orpc/client` are already pinned by spec 0005.

**Critical test scenarios**:
- Happy path: `pnpm load:seed` then `pnpm load:run steady` on the reference machine prints a full table with every line judged and exits 0 or 1 with the misses named, verifies **AC-192** to **AC-201**, **AC-204**.
- Validity: a run with the harness throttled (a test flag that blocks its event loop) exits 2 and says the harness couldn't keep up; a run with the API stopped mid window exits 2 on errors, verifies **AC-203**.
- Measurement: unit tests show a server that stalls 2 seconds raises the p95 of actions scheduled during the stall (scheduled time, not send time), and the delivery join pairs writers and holders correctly with skipped own echoes, verifies **AC-197**, **AC-200**, **AC-212**.
- Seed: the `test` profile in Vitest against real Postgres has the exact counts, the hub's Team, 1% trashed, every user an active member with a directory row, and sort keys present, verifies **AC-194**, **AC-212**.
- Guard: every load command with a non local address exits 3 and touches nothing; the API with `LOAD_TIMING=on` and `APP_ENV=production` refuses to boot, and without it sends no `Server-Timing`, verifies **AC-202**, **AC-210**.
- Stress: `hub`, `storm` and `thousand` each finish with their extra lines and exit by validity only, verifies **AC-206**, **AC-207**, **AC-208**.
- Reset: after a run, `pnpm load:reset` brings free slots back to 10,000 and the hub's Team back to 150,000, verifies **AC-209**.

## Build plan

Tracer Bullet: each milestone ends with a command you can run and a result you can read. Milestone 1 can start now; milestones 2 and 3 wait for 0005's milestones 2 and 3.

**Milestone 1: the budget and the million record seed**
1. `packages/core/scripts/scale-budget.ts` with `SCALE_BUDGET` and its doc comments; export it as `@crm/core/scale-budget`, satisfies **AC-192**
2. The load stack: `docker-compose.load.yml`, `infra/postgres/load.conf`, PgBouncer's stats user, `pnpm load:stack`, `load:stack:down`, `load:stack:wipe`; `.load/` added to `.gitignore`, satisfies **AC-193**, **AC-210**
3. `packages/core/scripts/seed-crm.ts` with the `crm`, `smoke` and `test` profiles: users, the owner through `startWorkspace`, bulk members, memberships and directory rows, the three objects' values, links, the hub, the trash, sort keys, vacuum, the manifest, satisfies **AC-194**, **AC-210**
4. `pnpm load:seed`: stack up, migrations and logins against the load stack, seed, refusals, satisfies **AC-195**, **AC-210**
5. The seed's Vitest suite on the `test` profile against real Postgres, satisfies **AC-194**, **AC-212**
6. Run the `crm` profile on the reference machine, note its time and size, and sign in to the local app on the load stack as `load-user-1@example.com` to see the People count (once 0005's table exists), satisfies **AC-195**

**Milestone 2: reads and writes against the budget** (after 0005 milestone 2)
7. `packages/load`: package, tag `server` for boundaries, `LoadEnv` with the localhost guard, the oRPC client on `@crm/contracts`, the manifest reader, satisfies **AC-210**
8. Sessions: real sign in through the load Mailpit, saved and reused, a fresh sign in on 401 during warm up, satisfies **AC-196**
9. The scheduler and user model: open model arrivals on a seeded random source, warm up ramp, worker threads (one by default), the mix sampler, views, windows, shapes, edits and creates, count cancellation; unit tests for the pure parts, satisfies **AC-197**, **AC-198**, **AC-212**
10. The timing header: an acquire hook in `packages/db`'s `createDatabase`, the API's `Server-Timing` behind `LOAD_TIMING`, the env refusal, tests, satisfies **AC-202**, **AC-212**
11. Collectors: API pool wait from the header, PgBouncer `SHOW POOLS`, `docker stats`, `pg_stat_statements`, `pg_stat_wal`, satisfies **AC-201**, **AC-204**
12. The report, `LoadResult`, the validity rules and exit codes; unit tests for percentiles and verdicts, satisfies **AC-199**, **AC-203**, **AC-204**, **AC-212**
13. `spread`, `pnpm load:reset` and the free slot check, satisfies **AC-205**, **AC-209**
14. First `steady` (live lines marked "not built yet") and `spread` runs at 100 users; results into `verify.md`; `security-access-reviewer` and `state-performance-reviewer` before it lands, satisfies **AC-199**, **AC-205**, **AC-213**

**Milestone 3: live delivery** (after 0005 milestone 3)
15. The outbox hook writes `created_at` as `clock_timestamp()`; the relay lag reader, satisfies **AC-201**
16. Live clients: one Centrifugo connection per user (`centrifuge` on `ws`), tokens through the procedures, own echo skip, holder refetch, coarse refetch, seq gap and 10 second miss detection, the delivery join and its unit tests, satisfies **AC-200**, **AC-212**
17. `storm`: bursts and the reconnect storm, with their extra lines, satisfies **AC-207**
18. A full `steady` run with live delivery at 100 users; `verify.md` updated, satisfies **AC-200**, **AC-213**

**Milestone 4: 1,000 users, the hub, and the weekly smoke**
19. Scale the harness out: users spread over worker threads (250 per thread), per thread event loop checks, the `thousand` scenario, satisfies **AC-203**, **AC-208**
20. `hub`: hub moves and opens, the final clear with its extra lines, the reset that writes the Team back, satisfies **AC-206**, **AC-209**
21. `.github/workflows/load-smoke.yml` (weekly and on demand, smoke profile, warnings for misses, the result as an artifact), satisfies **AC-211**
22. `packages/load/AGENTS.md` (commands, scenarios, how to read the report); a run of each stress scenario into `verify.md` with every miss named and planned, satisfies **AC-213**

## Consequences

**Positive**:
- Every later slice has one command to prove it holds, and reviewers can ask for numbers instead of opinions.
- The budget is one typed constant, so a target changes in one place and every run follows.
- Measuring from scheduled time and refusing saturated runs keeps the numbers honest.
- The open questions earlier specs left for #12 get measured: the per workspace outbox counter row under bursts (0005), the hub's 150,000 links (0005), fan out at 1,000 (0001, 0005), Postgres CPU and pool use (0001).

**Negative / tradeoffs**:
- Local numbers are not production numbers. The capped Postgres is close to Neon's 2 vCPU, 8 GB compute but not the same storage, and the Vercel hop and the internet are not in the path (they add tens of milliseconds). #41 judges with that gap in mind; spec 0004's AC-26 stays deferred while Neon stays on its free plan.
- The `crm` seed is about 10 GB on disk with its indexes and takes up to an hour; the load stack needs Docker with at least 12 GB of memory.
- The harness's actions are a model of the People table, not the real browser: it doesn't measure rendering, the client store or the first load. Those stay with 0005's AC-40 and the size budget.
- The `hub` open is expected to miss the 200 ms target until #15 trims reference values; it is reported, not judged.
- One more package and one more compose file to keep in step with the API as procedures change.
- Shared CI runners make the weekly smoke a crash and error check only.

**Neutral**:
- No migration. One value changes in 0005's outbox hook (`clock_timestamp()`).
- New pinned dependencies: `ws`, `@types/ws`.
- New root scripts: `load:stack`, `load:stack:down`, `load:stack:wipe`, `load:seed`, `load:run`, `load:reset`.
- Each later feature that adds a user action (record page #17, notes #19, views #20, board #21, bulk #22) adds it to the user model and, if it needs one, a line to the budget.

## Follow-up

- [ ] **#41**: judge `thousand`, `hub` and `storm`; decide API replicas, Centrifugo per object channels (#7) and a second Centrifugo node from their numbers; add a many workspaces scenario (100 users over 10 workspaces) if tenant spread matters by then.
- [ ] **#15**: move the hub's link churn to `links.add` and `links.remove`, and judge the hub open once reads return the first 20 links and a total.
- [ ] **Spec 0010**: `relay.lag` reads the same columns; note there that `created_at` is now `clock_timestamp()`, and consider using `SCALE_BUDGET` for its lag alert threshold.
- [ ] **Spec 0004**: record that #12 answered the partitioning question (no), and that the load seed covers People and Companies at scale beside `db:seed:scale`'s deals.
- [ ] **Spec 0001**: Vercel middleware usage and the internet hop are not measured locally; check them on production traffic with #11's charts.
- [ ] **Root `AGENTS.md`** (`/sync`): add the load commands and the load stack's ports; the `crm-api-backend` skill's "run it against the load harness seed" can name `pnpm load:run steady`.
- [ ] **Neon**: if the owner ever moves to a paid plan, add an opt in target for a benchmark branch (spec 0004's AC-26) behind its own allow host.
