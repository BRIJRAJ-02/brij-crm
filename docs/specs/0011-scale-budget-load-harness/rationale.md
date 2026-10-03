# 0011. Scale budget and load harness: decision record

## Context

The scope promises 100 people online at once, room for 1,000, and a million records per workspace. Today those numbers live in prose. Spec 0004 proved the query engine at a million deals in the database call alone, and specs 0001 and 0005 left a list of things "the load harness must watch": Postgres CPU and connections, relay lag, Vercel middleware use, fan out at 1,000, the per workspace outbox counter row that makes writes in one workspace commit one at a time, and a hub record with 150,000 links. Without a harness, every later slice either guesses or repeats its own one off benchmark.

Forces:
- **No paid Neon.** The owner keeps Neon on its free plan (3 October 2026), whose branches cap at 1 GB; the million record seed is about 10 GB. Every scale proof runs locally, in Docker, capped. Production is never a target: it has real users and a sleeping free compute.
- **End to end, not database only.** The budget is what a person feels: the HTTP path, the session and access door, the engine, the pool, PgBouncer, and for live updates the outbox, the relay, Centrifugo and the refetch through `records.get`. A database benchmark can't see pool waits, door cost, or delivery.
- **Honest numbers.** Load tools that wait for each answer before sending the next (a closed model) hide a slow server: when it stalls, they simply send less. The CRM's users don't wait politely; they click.
- **The stack is TypeScript end to end.** The contract (oRPC with Zod) and the realtime protocol (Centrifugo's client) already exist as TypeScript packages. A tool that can't import them must copy the wire formats.
- **Sign in is deliberately hard to automate.** Email codes, rate limits per email and per trusted IP, an edge secret outside local. A harness needs many sessions without weakening any of it.
- **Several foundations are only half built.** 0005's milestones 2 (record procedures) and 3 (outbox, relay, tokens) are still ahead, so the harness must grow with them.

## Options considered

### Option 1: a custom Node harness on the real contract and Centrifugo client (chosen)

A small package, `packages/load`, that drives users with `@orpc/client` against `@crm/contracts` and the `centrifuge` client on WebSockets, with its own open model scheduler, collectors and report.

**Pros**: imports the real contract and protocol, so it can never drift from the API; the delivery join (writer to holder) and the holder refetch are ordinary code; runs anywhere Node runs, including CI; no new tool to install or learn.
**Cons**: we own the scheduler and the statistics, so they need tests; one Node process tops out somewhere, so 1,000 users need worker threads and a check that the harness itself keeps up.

### Option 2: k6

Grafana's load tool, scripted in JavaScript, with open model executors (constant arrival rate), thresholds and a mature report.

**Pros**: proven scheduler and statistics; thresholds map well to a budget; widely known.
**Cons**: its JavaScript runtime is not Node, so it can't import the oRPC contract, Zod or the Centrifugo client; both wire formats would be copied by hand, and Centrifugo would need a custom built k6 binary with an extension; joining one user's write to another user's refetch needs shared state k6 doesn't give virtual users; another binary outside the pnpm catalog.

### Option 3: Artillery

A Node based load tool with YAML scenarios, arrival phases and WebSocket support.

**Pros**: open model arrival phases; runs on Node, so custom JavaScript can import our packages.
**Cons**: anything beyond simple request flows (the oRPC client, Centrifugo subscriptions, cross user delivery timing) lives in custom processor functions anyway, so we write most of option 1 inside a framework's lifecycle; heavier dependency tree; its reports would still need our own budget verdicts.

### Option 4: real browsers (Playwright)

Launch 100 browser contexts on the real web app and time screens.

**Pros**: measures exactly what a person sees, rendering and the client store included.
**Cons**: 100 browsers need tens of GB of memory and 1,000 are out of reach on one machine; the client's own cost drowns the server's in the numbers; slow to run. 0005 already times two browsers for live delivery (AC-38), which is where real browsers belong.

## Rationale

Option 1 is the only one that measures the full path the budget is about (the forces "end to end" and "the stack is TypeScript") without copying two wire formats. k6's scheduler is better than one we write, but the cost of reimplementing oRPC and Centrifugo, and of building a custom binary, is higher than writing and testing a small open model scheduler. Artillery would end up as option 1 inside someone else's lifecycle. Browsers measure the client, which 0005's AC-38 and AC-40 already cover. The owner's "no paid Neon" settles where it runs: a local stack capped to Neon's 2 vCPU, 8 GB compute, accepted as an approximation that #41 reads with care.

Per decision:
- **The budget in `packages/core/scripts/scale-budget.ts`** (the brief's recommendation): beside spec 0004's seed and benchmark, and importable by `packages/load` through one package export. A typed constant can't drift from the harness that reads it.
- **The seed beside `seed-scale.ts`**: it uses the engine's services and the same bulk SQL patterns, the same `refuseRemote` guard, and the owner login.
- **A separate load stack** (own compose file, project, volume and ports): seeding 10 GB into the dev database would wreck a laptop's daily work, and a separate project means `wipe` can never delete dev data.
- **The API and worker in containers, capped**: a Node process uses one core, so 1 vCPU matches a single Railway instance; running on the host would give it the whole laptop.
- **Open model and scheduled time measurement**: the only honest way to see a queue (the force "honest numbers").
- **0.2 actions per user per second**: a busy person scrolling, filtering and editing every few seconds; 100 users give about 20 actions a second plus the refetches live updates cause. Lower would flatter the server; higher is not a human. Owner question.
- **Visible delivery as the judged live number**: it matches 0005's AC-38 (from the writer's action to the change on the other screen), which includes the refetch, the part most likely to grow at scale.
- **Gates and stress**: `steady` and `spread` decide pass or miss at 100 users, which is the scope's "Done when". `hub`, `storm` and `thousand` are there to find limits, and their judge is #41. Owner question.
- **`spread` as cold cache reads**: the seed (about 10 GB) is bigger than the capped memory (8 GB), so even reads over the whole million hit disk, which is what a small Neon compute will do. A many workspaces scenario goes to #41. Owner question.
- **`storm` as bursts plus a reconnect storm**: these are the two shapes 0005 and 0001 named as risks (the outbox counter row and Centrifugo's memory history on restart).
- **Real sign in for sessions**: writing session rows or signing cookies would need a session minting capability next to production code, exactly the kind of tool that leaks. Locally the API applies no per IP limit without a trusted forwarded header, and each user signs in once per 30 days, so the real route is cheap. Owner question (the brief said "minted").
- **1,000 seeded members**: `thousand` then has 1,000 different people, which is how real fan out looks; 10 tabs per person would test something else. Owner question (the brief said 100).
- **1% of each object in the trash**: it keeps hidden rows in every count and jump (spec 0004's AC-21 pattern) and leaves 10,000 free record slots under the 1,000,000 limit for the harness's creates; `pnpm load:reset` refills them.
- **A local only `Server-Timing` header**: the API's pool wait is invisible from outside, and the budget names it. A header behind a local only flag costs nothing in production and #11's spans can replace it later.
- **`clock_timestamp()` for the outbox `created_at`**: `now()` is the transaction's start, so a long write would show its own duration as relay lag. One value in the hook, no migration.
- **No partitioning of `values` by workspace** (spec 0004's open question): partitioning splits tenants, but the budget is about one workspace with a million records, which lands in one partition anyway; it would add planning cost and complicate unique indexes for no measured gain.
- **Weekly smoke with warnings**: catches a harness or API that no longer starts, without pretending shared runner times mean anything.

## Evidence

Read on 3 October 2026:
- `packages/core/scripts/seed-scale.ts` and `bench-scale.ts`: bulk SQL in 50,000 row chunks inside `withWorkspace`, sort keys rebuilt from `sort_key_sources`, `refuseRemote` in `local-only.ts`; the seed overrides `liveRecords` in its own scope, which the API can't.
- `docs/specs/0004-data-model/verify.md`: the million deal seed (9.6 million value rows) was about 6 GB with indexes on one run and about 10 GB on the later AC-26 note; every held grid query was under 300 ms at p95 in the database call locally; AC-26 (Neon) is deferred on the free plan's 1 GB branch cap.
- `apps/api/src/edge.ts` and `auth/auth.ts`: `clientIp` is undefined without a trusted forwarded header, and per IP sign in limits then don't apply; per email limits do (5 code sends per 10 minutes).
- `apps/api/src/env.ts`: `APP_ENV=local` is refused with `NODE_ENV=production`; `NODE_ENV` is read nowhere else in the API.
- `apps/api/Dockerfile`: one image, Node 24 running TypeScript directly, `NODE_ENV=production` baked in (the load stack overrides it).
- `packages/db/src/client.ts`: the API's pool holds 10 clients; the worker's direct pool 5.
- `docker-compose.yml`: the dev stack's ports (5433, 6432, 8000, 9000, 1025, 8025) and PgBouncer in transaction mode.
- `packages/core/src/templates/standard-v1.ts`: People, Companies and Deals with their attributes; People `company` to Companies `team`, Deals `associated_company` and `associated_people`.
- Spec 0005's follow up items for #12 (the hub clear, reading a hub's full reference value, channel split by fan out) and consequences (the outbox counter row); spec 0001's consequences (CPU, connections, lag, middleware use); spec 0010's `relay.lag` definition.
