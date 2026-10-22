# 0044. Move api, worker and Centrifugo from Railway to Render

**Date**: 2026-10-22
**Status**: Proposed
**Numbering**: 0036 to 0043 are taken on lane branches; the coordinator may renumber this one when it lands.
**Revised**: 2026-10-22, the owner chose Render's free plan for the test phase (no card, $0): one service, live updates off. The three service paid layout below is the upgrade path.

## Summary

Railway had a security incident ([status.railway.com/incident/QH8L8B3E](https://status.railway.com/incident/QH8L8B3E)). Since 21 October 2026 its builds are paused and every API token was revoked, so production's api is stuck at `ef6efa82` and no fix can ship. The owner decided to leave Railway for Render, in its Singapore region beside the Neon database (aws ap-southeast-1). The web app stays on Vercel and Postgres stays on Neon.

While the product is in its test phase the owner wants no hosting bill. So production runs on **one free Render web service**, `brij-crm-api`, which runs the migrations, the api and the worker in one container, with live updates off (no Centrifugo). When the product needs live updates or more memory, it moves to the paid layout below: a plan change plus two services added back.

Reasoning and options: see [rationale.md](rationale.md). The owner's steps: [docs/runbooks/render-cutover.md](../../runbooks/render-cutover.md).

## The free layout (now)

| Piece | On Railway | On Render, free |
|---|---|---|
| Config | `.railway/railway.ts` (kept until Railway is deleted) | `render.yaml`, a Blueprint applied once from the dashboard |
| Migrations | the api's pre deploy step | the first thing `apps/api/src/launch.ts` runs (the free plan has no pre deploy step), the same script, `packages/db/scripts/migrate.ts`. A failed migration means nothing starts, the new deploy never passes its health check, and the old one keeps serving |
| api | service `api` | the launcher's first child, on `PORT=8080`, heap capped at 192 MB |
| worker | service `worker`, private host | the launcher's second child, on `WORKER_PORT=8081` inside the container, heap capped at 128 MB; the api wakes it at `http://127.0.0.1:8081` |
| Centrifugo | service `centrifugo` | none. The worker runs with `LIVE_UPDATES=off` (relay off), the api without `CENTRIFUGO_TOKEN_SECRET`, the web build without `VITE_REALTIME_URL`, as previews always ran |
| Health check | `/api/health/ready`, during deploys only | `/api/health`: Render checks every few seconds, for as long as the service runs, and `/ready` queries Postgres, which would keep Neon's compute awake around the clock |
| Staying awake | always on | a free service sleeps after 15 idle minutes; `.github/workflows/keepalive.yml` asks for `/api/health` through Vercel every 10 minutes |
| Deploys | after CI passes, on watch paths | `autoDeployTrigger: checksPass`, `buildFilter` with the same paths |
| Release | `RAILWAY_GIT_COMMIT_SHA` | `RENDER_GIT_COMMIT` (either one, through `releaseOf` in `apps/api/src/env.ts`) |
| Secrets | Railway variables | `sync: false` (typed in once) or `generateValue: true` (Render makes it once). One service, so `EDGE_SECRET`, `WORKER_WAKE_SECRET` and `BOOKING_LINK_SECRET` are each one generated value both processes read |
| Previews | one Railway environment per pull request | off (`PREVIEW_BACKEND` gate in `preview.yml`) |

**Memory.** The free instance has 512 MB for everything. The launcher itself takes about 40 MB, and each Node child about 45 MB outside its heap, which leaves the api's heap 192 MB and the worker's 128 MB (`--max-old-space-size` in `PROCESSES`, `launch.ts`). The worker is light in production: its jobs are off and its relay is off. A child that runs out of memory dies, the launcher stops the other and exits 1, and Render restarts the container.

**The launcher's rules.** Migrate, then start both children. Forward SIGTERM and SIGINT to both; exit 0 when both stop cleanly, and 1 after 25 seconds if one does not. If either child exits on its own, whatever its code, stop the other and exit 1.

### Trade offs of the free plan

- **No live updates.** Another person's change shows after a reload or the next fetch, not at once. The outbox keeps every row meanwhile, since only the relay prunes it; that is small at test phase volumes and is drained by the relay once Centrifugo returns.
- **One shared 512 MB.** A memory spike in one process restarts both, with about a minute of downtime.
- **Cold starts.** If a keepalive ping is missed (GitHub can delay or drop scheduled runs), the service sleeps and the next visitor waits about a minute while it starts. Render's 750 free hours a month cover one always on service, and no more.
- **No support, and restarts.** Render may restart a free service at any time.

## The paid layout (the upgrade path)

When the test phase ends: in `render.yaml`, set the api's plan to `0.5c-512mb` (Starter, $7 a month), move migrations back to `preDeployCommand`, start the api alone (`dockerCommand` with the instrument and `server.ts`), and add back two services, about $21 a month in all:

- `brij-crm-worker`: a private service (`type: pserv`, not a background worker, which takes no inbound traffic and so can't receive the wake call), `PORT=8080`, the api's `WORKER_INTERNAL_URL` from a `fromService` `hostport` reference (a bare `host:port` reads as plain http, and `RENDER=true` lets a one label private host through).
- `brij-crm-centrifugo`: a web service from `infra/centrifugo/Dockerfile` with `PORT=8000` public; the private network reaches its port 9000, so `config.json` stays as it is. The worker's `CENTRIFUGO_API_URL` is `http://<its private host>:9000`, typed in once. Its keys are `generateValue`, and the api's `CENTRIFUGO_TOKEN_SECRET` and the worker's `CENTRIFUGO_API_KEY` reference them.
- Remove `LIVE_UPDATES=off`, set Vercel's `VITE_REALTIME_URL` to `wss://brij-crm-centrifugo.onrender.com/connection/websocket` (already in `vercel.json`'s `connect-src`), and delete `keepalive.yml`.
- Keep the health check on `/api/health`, for the same Neon reason.

Commit 5332cb46 on `main` has that layout in full in its `render.yaml`.

## Code changes

- `apps/api/src/launch.ts`: the launcher above, with `launch.test.ts`.
- `LIVE_UPDATES=off` on the worker lets a deployed worker run without Centrifugo (relay off); unset or `on`, Centrifugo's URL and key stay required outside local.
- `releaseOf(env)` names the release for `/api/health` and Sentry: `RENDER_GIT_COMMIT`, else `RAILWAY_GIT_COMMIT_SHA`, else `local`, so `deploy-web.yml` keeps waiting on `.release` unchanged.
- `RENDER=true` lets a one label private host through over plain http, and a bare `host:port` reads as plain http (for the paid layout).
- `apps/web/vercel.json`'s `connect-src` lists Render's Centrifugo address beside Railway's (unused until the paid layout).

## Acceptance criteria

- **AC-1001**: `GET /api/health` through Vercel answers `{ status: 'ok', release: <main's sha> }`, and `deploy-web.yml` finds it.
- **AC-1002**: The first Render deploy's log shows migrations 0044 to 0051 applied before the api starts; a failed migration starts nothing and leaves the running version up.
- **AC-1003**: Signing in works through `https://brij-crm-phi.vercel.app`, with the api reached only through Vercel (the edge secret checked).
- **AC-1004**: The worker logs that the relay is off and does not restart or spin; the web app shows no live updates error.
- **AC-1005**: No secret is committed: every secret in `render.yaml` is `sync: false` or `generateValue`.
- **AC-1006**: Railway stays stopped, not deleted, for a week; then it is deleted.
- **AC-1007**: The launcher exits non zero when either child dies, and starts nothing when the migration fails (`launch.test.ts`).

## Cutover and rollback

Cutover, in short (the runbook has every step): apply the Blueprint, type the secrets, let the first deploy migrate Neon, then switch Vercel's `API_ORIGIN_INTERNAL` and `EDGE_SECRET`, remove `VITE_REALTIME_URL`, and redeploy the web app. Downtime is the web redeploy, about two minutes, and everyone signs in again because `BETTER_AUTH_SECRET` is rotated.

Rollback, during the first week: start Railway's three services again (they are stopped, not deleted), set Vercel's variables back to Railway's values and redeploy the web app. Migrations 0044 to 0051 only add, so Railway's older api runs against the newer schema, as during every past deploy. One catch: once the Neon passwords are rotated, Railway's stored database URLs stop working, so a rollback also means pasting the new URLs into Railway's variables in its dashboard.

## Follow up

- When this is Accepted, add an **Amended** line to spec 0001 (this repo records host changes there as amendments, not as a status change) and change the root `AGENTS.md` Hosts line from Railway to Render.
- After Railway is deleted: remove `.railway/railway.ts`, the `railway` package, the `use-railway` skill, Railway's socket from `vercel.json` and `csp.test.ts`, and the `*.railway.internal` rule in `env.ts`.
- `apps/api/AGENTS.md` still describes the two Railway services; update it with the first Render deploy.
- Previews: decide between Render preview environments (the paid Pro workspace) and none (see the runbook).
