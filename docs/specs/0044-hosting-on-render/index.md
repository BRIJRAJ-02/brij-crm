# 0044. Move api, worker and Centrifugo from Railway to Render

**Date**: 2026-10-22
**Status**: Proposed
**Numbering**: 0036 to 0043 are taken on lane branches; the coordinator may renumber this one when it lands.

## Summary

Railway had a security incident ([status.railway.com/incident/QH8L8B3E](https://status.railway.com/incident/QH8L8B3E)). Since 21 October 2026 its builds are paused and every API token was revoked, so production's api is stuck at `ef6efa82` and no fix can ship. The owner decided to leave Railway. The api, the worker and Centrifugo move to Render, in its Singapore region beside the Neon database (aws ap-southeast-1). The web app stays on Vercel, Postgres stays on Neon, and nothing about the product changes.

Reasoning and options: see [rationale.md](rationale.md). The owner's steps: [docs/runbooks/render-cutover.md](../../runbooks/render-cutover.md).

## What changes

| Piece | On Railway | On Render |
|---|---|---|
| Config | `.railway/railway.ts` (kept until Railway is deleted) | `render.yaml`, a Blueprint applied once from the dashboard |
| api | service `api`, public domain, healthcheck `/api/health/ready`, preDeploy migrate | web service `brij-crm-api`, the same Dockerfile, start command, health check and `preDeployCommand` |
| worker | service `worker`, private host `worker.railway.internal:8080` | private service `brij-crm-worker` on port 8080. Not a background worker: those take no inbound traffic, and the api's wake call must reach it |
| Centrifugo | public 8000, private 9000 | web service `brij-crm-centrifugo`: Render routes public traffic to `PORT=8000`; the private network reaches any port the service opens, so the worker still calls 9000. `config.json` is unchanged |
| Deploys | after CI passes, on watch paths | `autoDeployTrigger: checksPass`, `buildFilter` with the same paths |
| Release | `RAILWAY_GIT_COMMIT_SHA` | `RENDER_GIT_COMMIT` (either one, through `releaseOf` in `apps/api/src/env.ts`) |
| Secrets | Railway variables | `sync: false` (typed in once), `generateValue: true` for our own random secrets, `fromService` references for shared ones |
| Previews | one Railway environment per pull request | off for now (`PREVIEW_BACKEND` gate in `preview.yml`) |

## Code changes

- `releaseOf(env)` names the release for `/api/health` and Sentry: `RENDER_GIT_COMMIT`, else `RAILWAY_GIT_COMMIT_SHA`, else `local`. Both are validated in `ApiEnv` and `MonitoringEnv`, so `deploy-web.yml` keeps waiting on `.release` unchanged.
- Render's private addresses are one label hosts (`brij-crm-worker-a1b2:8080`). `WORKER_INTERNAL_URL` and `CENTRIFUGO_API_URL` already took a one label host over plain http with `APP_ENV=local`; they now also take it when `RENDER=true`, which Render sets on every service. Elsewhere it is still refused.
- A bare `host:port` (what the Blueprint's `hostport` reference gives) reads as `http://host:port`, so the api's `WORKER_INTERNAL_URL` is wired by the Blueprint, not by hand.
- `apps/web/vercel.json`'s `connect-src` lists `wss://brij-crm-centrifugo.onrender.com` beside Railway's socket, so either can serve live updates during the move. `csp.test.ts` allows both hosts and at most two sockets.

## Acceptance criteria

- **AC-1001**: `GET /api/health` on Render answers `{ status: 'ok', release: <main's sha> }`, and `deploy-web.yml` finds it.
- **AC-1002**: The first Render deploy runs migrations 0044 to 0051 in its pre deploy step, and a failed migration leaves the running version up.
- **AC-1003**: Signing in works through `https://brij-crm-phi.vercel.app`, with the api reached only through Vercel (the edge secret checked).
- **AC-1004**: A change in one browser shows in a second browser within a second (the worker's relay publishes to Centrifugo over the private network).
- **AC-1005**: No secret is committed: every secret in `render.yaml` is `sync: false`, `generateValue` or a reference.
- **AC-1006**: Railway stays stopped, not deleted, for a week; rolling back is pointing Vercel's `API_ORIGIN_INTERNAL` and `VITE_REALTIME_URL` back.

## Cutover and rollback

Cutover, in short (the runbook has every step): apply the Blueprint, type the secrets, let the first deploy migrate Neon, check `/api/health/ready` on the onrender.com address, then switch Vercel's `API_ORIGIN_INTERNAL`, `EDGE_SECRET` and `VITE_REALTIME_URL` and redeploy the web app. Downtime is the web redeploy, about two minutes, plus everyone signs in again because `BETTER_AUTH_SECRET` is rotated.

Rollback, during the first week: start Railway's three services again (they are stopped, not deleted), set Vercel's three variables back to Railway's values and redeploy the web app. Migrations 0044 to 0051 only add, so Railway's older api runs against the newer schema, as during every past deploy. One catch: once the Neon passwords are rotated, Railway's stored database URLs stop working, so a rollback also means pasting the new URLs into Railway's variables in its dashboard. After the week, delete the Railway project and the Railway host from `vercel.json`.

## Follow up

- When this is Accepted, add an **Amended** line to spec 0001 (this repo records host changes there as amendments, not as a status change) and change the root `AGENTS.md` Hosts line from Railway to Render.
- After Railway is deleted: remove `.railway/railway.ts`, the `railway` package, the `use-railway` skill, Railway's socket from `vercel.json` and `csp.test.ts`, and the `*.railway.internal` rule in `env.ts`.
- Previews: decide between Render preview environments (the Pro workspace, $25 a month plus each preview's compute) and no backend previews (see the runbook).
