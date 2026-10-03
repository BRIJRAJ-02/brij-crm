# 0010. Monitoring and product analytics: decision record

## Context

The core loop (#10) is going into production, and sign up is open to everyone. Today the only window into production is Railway's JSON log lines: an unexpected error is written to stdout with its request id and nothing else happens. Nobody is told, nothing groups repeats, and a browser error is invisible. The scope wants a production error visible with its request within a minute, request time, live update delay and job backlog charted, and signups, workspaces created and first records created counted, from the first slice on.

Forces:
- **Privacy.** The CRM holds other people's contact data. Emails, names and attribute values must never reach a third party tool. Error messages can quote values (a Postgres `detail` names the duplicate, a refusal can quote another record), URLs carry sign in codes and Google's `code` and `state`, and modern SDKs capture request bodies by default.
- **Cost.** The owner stays on free plans (Neon, and here Sentry and PostHog). Free quotas are small, some features (metric alerts, extra monitors) may not exist on them, and Neon's free compute is billed by the hours it is awake.
- **The first load budget** is 250 kB, and the browser already ships React, the router and the library.
- **Security headers.** The CSP allows only our own origin today, and `vite.config.ts` publishes source maps beside the bundle.
- **House rules.** A vendor SDK is imported in one wrapper only (the lint rule already lists `@sentry/*` and `posthog-*`), the core stays pure, and every app validates its environment.
- **Timing.** The relay (0005 milestone 3) and background jobs (#8) don't exist yet, so the live delay and backlog parts land after them or build a thin slice.
- **Accounts.** The owner creates them, on their own email, in the EU region (owner decision, 3 October 2026). The region can't change later.

## Options considered

### Option 1: Sentry for errors, traces and metrics; PostHog for server side events only (chosen)

Sentry in the browser (errors only), the API and the worker (errors, traces, custom metrics, a cron heartbeat, an uptime monitor). PostHog receives a small closed catalog of product events from the API after commit, backed by a milestones table in our database.

**Pros**: the tools spec 0001 already chose; errors, request time and metrics in one place, linked by request id; nothing tracks the browser for analytics, so no cookie banner and nothing personal in click streams; the counts survive a vendor loss.
**Cons**: two vendors and two dashboards; no click funnels or replay; free plan quotas force sampling.

### Option 2: Sentry, plus PostHog's browser SDK with autocapture and session replay

The same Sentry setup, and PostHog in the browser recording clicks, page views and sessions.

**Pros**: rich funnels and replays with no event code to write.
**Cons**: autocapture and replay record what is on screen, which is other people's contact data, so every screen needs masking forever; adds a large script to the first load and a third party origin to the CSP; a cookie and consent question; quota burns fast.

### Option 3: OpenTelemetry to a free hosted Grafana stack, and counts from Postgres

Export traces and metrics with OpenTelemetry to a free hosted Grafana, Loki and Tempo, keep logs in Railway, and count signups and milestones with SQL.

**Pros**: one open standard, no lock in, counts never leave our database.
**Cons**: no error grouping, release tracking or browser stacks without building them; more pieces to run and wire; spec 0001 chose Sentry and PostHog and the installed skills assume them.

## Rationale

Privacy and the first load budget rule out option 2: a CRM's screens are full of other people's data, and masking every screen is a promise that breaks on the first new component. Option 3 meets the charts but not "a production error visible with its request", which needs grouping, releases and readable browser stacks, the part Sentry does well. Option 1 meets every Done item with the stack spec 0001 already chose, on free plans, and keeps the analytics surface to three events we write on purpose.

Per decision (the brief's recommendations taken, unless noted):
- **EU region, the owner's own accounts**: the owner's decision; the region is fixed at creation.
- **Two Sentry projects, the server one tagged by service**: browser and server errors have different noise, quotas and settings; the api and worker share code and a release.
- **Server side events only**: no consent banner, nothing on screen recorded, and an event fires only after the change commits, so counts are true.
- **A `workspace_milestones` table**: "first record created" needs to know it is the first, safely under concurrent creates; a primary key with `on conflict do nothing` gives exactly once, and the table is a durable copy of the counts.
- **A fixed event id per milestone**: a resend after a crash is deduplicated by PostHog.
- **One `scrub` in contracts, shared by both SDKs**: one tested place for the rule, pure and vendor free.
- **Request bodies, local variables and default PII off**: today's Node SDK captures incoming bodies by default; a body here is contact data.
- **Hidden source maps, uploaded then deleted**: readable stacks in Sentry without publishing our source, which is what happens today.
- **Span names are the oRPC procedure**: one chart per thing the app does; the HTTP path alone is `/api/rpc/...` with no meaning.
- **Sampling 0 for health, 0.2 in production, 1.0 in previews**: health checks would drown the quota; previews are low traffic and worth seeing in full.
- **Custom metrics for relay lag and backlog**: the scope's two charts that no auto instrumentation gives; database clock on both ends of the lag, so no clock skew.
- **A probe list in the worker's sampler**: the thin slice of #8 that monitoring needs, so #8 adds its jobs probe without new plumbing.
- **The CSP gains the Sentry ingest host** (the brief's pick) rather than tunnelling browser events through the API: a tunnel would keep the CSP at `'self'` and dodge ad blockers, but it adds an unauthenticated forwarding route to the API, which sits in Singapore while the user may not.
- **Errors only in the browser** (a departure from a full browser setup): tracing and replay would cost first load weight; the SDK loads in its own chunk with a small buffer for early errors.
- **Uptime on `/api/health`, not `/api/health/ready`** (a departure from the brief): a ready probe touches the database every few minutes and keeps Neon's free compute awake; the worker's heartbeat checks in only after a successful database read, so a dead database is still caught.
- **The worker raises `RELAY_LAGGING` itself**: issue alerts email on the free plan; metric alerts may not be available there.
- **A switchable test fault**: the Done item is about production, and waiting for a real error to prove it is not a test.
- **Analytics wherever a key is set, with `environment` on every event**: lets the build prove events locally without polluting the production dashboard, which filters by it.

## Evidence

What the code shows today (3 October 2026):
- `apps/web/vite.config.ts` builds with `sourcemap: true`, so every `.map` file is published beside the bundle.
- `apps/web/vercel.json`'s CSP has `connect-src 'self'`.
- `packages/config/eslint.js`'s vendor rule already lists `@sentry/*`, `posthog-js` and `posthog-node`, with the one wrapper exception pattern written out for `src/monitoring/sentry.ts`.
- `apps/api/src/log.ts` writes one JSON line per event to stdout. Unexpected errors are logged in two places: the RPC interceptors in `rpc.ts` (with `requestId` and procedure) and `app.onError` in `app.ts` (with `requestId` and path). These are where `captureFault` goes.
- `app.ts` mints a request id per request and returns it as `x-request-id`; `edge.ts` lets `/api/health` and `/api/health/ready` through without the edge secret.
- The api and worker run `.ts` directly on Node 24; type stripping keeps line and column positions, so server stacks need no source maps.
- Railway starts the api with `node apps/api/src/server.ts` and the worker with `node apps/api/src/worker.ts` (`.railway/railway.ts`, the Dockerfile `CMD`); both need `--import` for the Sentry instrumentation.
- `apps/api/src/auth/auth.ts` already has `databaseHooks.user.create.before` for the allowlist; the `after` hook is the one place every new account passes.
- `packages/core`'s `startWorkspace` runs `createUserWorkspace` in one transaction, where the `workspace_created` milestone insert belongs.
- Spec 0001 named `SENTRY_DSN_WEB`, `SENTRY_DSN_SERVER`, `SENTRY_AUTH_TOKEN`, `SENTRY_RELEASE`, `POSTHOG_KEY` and `POSTHOG_HOST`, and said the CSP gains Sentry and PostHog with #11.
- Spec 0005's relay polls every second and reads pending workspaces through `crm_outbox_workspaces`; `outbox` has `created_at`, `published_at` and a partial index on unpublished rows.
- The installed `sentry-node-sdk` skill documents the stable `Sentry.metrics.count`, `gauge` and `distribution` API from `@sentry/node` 10.25, and `captureCheckIn` with a monitor upsert for heartbeats.

Assumptions to confirm when the accounts exist: Sentry's free plan includes one uptime monitor, one cron monitor, custom metrics and issue alerts by email; PostHog's free plan deduplicates events sent with the same id.
