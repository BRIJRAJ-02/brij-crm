# 0045. The api as a Vercel Function, beside the web app

**Date**: 2026-10-22
**Status**: Proposed
**Numbering**: 0036 to 0043 are taken on lane branches; the coordinator may renumber this one when it lands.

## Summary

Railway's incident (spec 0044) left production's api stuck at `ef6efa82`. The owner wants production running now with no new hosting service and no card: the api runs as a Vercel Function inside the existing Vercel project `brij-crm` (Hobby plan), in Singapore (`sin1`) beside Neon (aws ap-southeast-1). Postgres stays on Neon. There is no worker process and no Centrifugo: background jobs run in short bounded turns inside the function, and live updates are off until a long running host is back.

One variable chooses the host. With `API_ORIGIN_INTERNAL` set in Vercel's Production environment, the middleware proxies `/api` to that API (Railway, or Render from spec 0044), exactly as before. Unset, `/api` goes to the function. Switching back is: set `API_ORIGIN_INTERNAL`, redeploy the web app.

Reasoning and options: [rationale.md](rationale.md). The owner's steps: [docs/runbooks/api-on-vercel.md](../../runbooks/api-on-vercel.md). Checks: [verify.md](verify.md).

## What runs where

| Piece | Behind a proxy (Railway or Render) | On Vercel (this spec) |
|---|---|---|
| Routing | `middleware.ts` rewrites `/api/*` to `API_ORIGIN_INTERNAL` | `middleware.ts` sends `/api/*` on (`next()`); `vercel.json` routes it to `apps/web/api/index.mjs` |
| api | `server.ts` on its host | `apps/api/src/vercel/entry.ts` (re-exported by `apps/web/api/index.mjs`), the same `createApp`, built by `createFunctionApi` from the validated env (`ApiEnv` plus `FunctionEnv`) |
| Function settings | | Node 24, region `sin1`, fluid compute, `maxDuration` 60 seconds (`vercel.json`) |
| Database pools | api: 10 tenant, 5 identity | per instance: 3 tenant, 2 identity, 1 cancel, all on Neon's pooler, idle clients closed after 5 seconds and handed to Vercel's `attachDatabasePool` |
| Jobs | the worker's Graphile runners, awake while there is work | the job drain (`jobs/drain.ts`): the same runners (`jobs/compose.ts`, shared with `worker.ts`), one slice per lane, in bounded turns |
| Outbox relay, live updates | the worker publishes to Centrifugo | off: no relay runs, `VITE_REALTIME_URL` is unset, the `realtime.*` procedures answer 503 |
| Migrations | the api's pre deploy step | a step in `deploy-web.yml` before the deploy, with the `DATABASE_URL_OWNER` repository secret |
| Release in `/api/health` | `RENDER_GIT_COMMIT` or `RAILWAY_GIT_COMMIT_SHA` | `VERCEL_GIT_COMMIT_SHA` (`releaseOf` reads all three) |

## The edge guard in function mode

The guard stays on. The middleware runs for every `/api` request before the function, so it sets `x-crm-edge` from `EDGE_SECRET`, the vouched origin and the caller's address in both modes, replacing any copy a client sent. The function keeps `createEdgeGuard` and refuses a request without the secret (`EDGE_REQUIRED`), as the proxied API does. Skipping it was possible, since the function is same origin, but keeping it costs nothing, keeps one code path, and means a deployment URL reached some other way still gets no forwarded headers believed. The secret never leaves Vercel in this mode, so the https check on `API_ORIGIN_INTERNAL` applies only when proxying. `EDGE_SECRET` stays required in Production in both modes.

## Jobs without a worker

- **After a request.** Where a write would poke the worker, the function starts a drain turn after the response, inside `waitUntil`. A turn opens a small queue pool on the worker's direct login (`DATABASE_URL_DIRECT`, never the pooler), checks whether any row of its tasks is due, and if so starts the runners until two checks in a row find nothing busy or due, or its budget (15 seconds) is spent; the slices in hand then finish their batch and hand their jobs back. In one instance turns start at most every 5 seconds (a wake sooner waits), a burst of wakes is one turn plus at most one more, and both share the 15 second budget, so a wake stays inside the 60 second limit.
- **On a schedule.** `POST /api/internal/jobs/run`, with the `x-crm-jobs-secret` header equal to `JOBS_RUN_SECRET` (compared over sha256 digests in constant time) and through the edge, runs one turn. `.github/workflows/jobs.yml` calls it once an hour (at minute 7) and on demand. In the 03:00 UTC hour the turn runs at least 3 seconds even with nothing due, so Graphile's cron line backfills the daily cleanup; in other hours a turn with nothing due ends after one check.
- **The relay** does not run. A stored change event waits in the outbox.
- Calendar sync and booking emails run through these turns, as tasks of the same runners.

## Trade offs

- **No live updates.** Other people's changes show on reload or the next fetch, not at once.
- **Job delay.** A job queued by a request usually runs within seconds of that request. A job due later (the 15 minute calendar poll, a retry after backoff, a booking reminder) waits for the next request that wakes the drain or the next scheduled run: up to about an hour when nobody uses the app, longer if GitHub starts its scheduled run late or skips one.
- **The outbox grows.** With no relay, no row is ever published, and the prune deletes only published rows. Rows stay until a relay runs again, which then publishes the backlog (to nobody listening) and prunes it.
- **Cold starts.** A new instance loads the api (about 41 MB of code) and opens its pools; the first request after idle takes longer.
- **Neon compute.** Every scheduled run opens a connection and wakes the database, which then stays up about 5 minutes. Hourly, that is about 2 hours a day with no users, well inside the free plan's allowance; every 10 minutes would have been about half of every month, so the schedule is hourly (decided 22 Oct) and jobs queued by requests still run within seconds.
- **Hobby limits.** 60 seconds per invocation as set (fluid compute allows up to 300 on Hobby), 4 hours of active CPU a month, 1 million invocations, 1 region, cron jobs only daily (hence GitHub's schedule), and the Hobby plan is for non commercial use.

## Switching back to Railway (or Render)

1. Bring the api, worker and Centrifugo up there with the same `EDGE_SECRET` as Vercel's Production.
2. Set `API_ORIGIN_INTERNAL` (and `VITE_REALTIME_URL`, for live updates) in Vercel's Production environment.
3. Redeploy the web app (rerun the last Deploy web run, or push).

The deploy reads the mode from the pulled environment: it then waits for the API's release instead of migrating, the middleware proxies, the function is never reached, and `jobs.yml` sees no endpoint and does nothing. The worker's relay publishes the outbox backlog.

## Rollback

Production's previous deployment is one click in Vercel (Deployments, the last good one, Promote), or `vercel rollback`. Migrations only expand (packages/db conventions), so the previous code runs against the migrated database. To leave function mode entirely, switch back as above.
