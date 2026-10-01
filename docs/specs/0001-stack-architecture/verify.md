# Verify: Stack & architecture · spec 0001 · updated 2026-10-01
_Steps derived from the feature's **Done when** in `docs/scope/foundations.md` (spec 0001 is a decision spec with no numbered acceptance criteria, so each step names the Done when part it proves: DW-1 to DW-4). `/check verify` runs these; `/test` locks the durable ones._

- **DW-1** The stack is recorded in a spec.
- **DW-2** The empty app boots locally and builds.
- **DW-3** It deploys to a preview and a production environment, each with its own database.
- **DW-4** The code is split into modules with clear edges, and screens get their UI only from the component library.

## UI / manual
- [x] With Postgres up, migrations applied and `pnpm dev:apps` running, open `http://localhost:5173` → "The API and the database are answering." with environment `local` and a Postgres 17 version → DW-2 _(passed 2026-10-01, on a Homebrew Postgres 17 in place of Docker)_
- [x] Stop the api, reload → an alert "The API or the database did not answer" and a Try again button; start the api, press Try again → the status shows again, no page reload → DW-2 _(passed 2026-10-01)_
- [x] Build the web app and run it with `vercel dev` in `apps/web` (project linked), open the URL it prints → the page renders with no console errors under the Content Security Policy from `vercel.json`, and `/api` reaches the local API through the middleware → DW-2 _(passed 2026-10-01 on the real deployment instead: a browser on https://brij-crm-phi.vercel.app showed 0 errors and 0 warnings with the CSP from `vercel.json`, and `/api` reached the API through the middleware)_
- [x] Open a pull request → the Vercel preview the workflow comments on the pull request shows environment `preview`, and Neon lists a branch `preview/pr-<n>` → DW-3 _(passed 2026-10-01 with pull request #1: https://brij-crm-pr-1.vercel.app answered `preview` through its middleware, its Railway API read `preview/pr-1`, never the production endpoint)_
- [x] Close that pull request → the Neon branch and the Railway environment `pr-<n>` are gone → DW-3 _(passed 2026-10-01: the branch, the `pr-1` environment and the preview alias were all removed)_
- [ ] Merge to `main` → the production URL shows environment `production`, served by the Neon production branch (not `preview-base`) → DW-3 _(production itself works as of 2026-10-01: https://brij-crm-phi.vercel.app shows `production` on Neon Postgres 18.6, and a write from a foreign origin gets 403. It was deployed from a local machine, so the merge path stays open until `VERCEL_TOKEN` and Railway's GitHub app are in place)_

## Commands
- [x] `pnpm typecheck` → 6 of 6 tasks pass → DW-2 _(passed 2026-10-01)_
- [x] `pnpm build` → the web app builds to `apps/web/dist`, with `_headers` inside → DW-2 _(passed 2026-10-01)_
- [x] `pnpm boundaries` → "no issues found" → DW-4 _(passed 2026-10-01)_
- [x] Add `@crm/db` to `packages/data` and import it, run `pnpm boundaries` → 2 issues (client may not depend on server); revert → DW-4 _(passed 2026-10-01)_
- [x] `pnpm db:setup` on a fresh database, then `pnpm db:migrate` again → both succeed; `pg_trgm` is installed, `crm_app` cannot log in or bypass row level security, and the app login is a member of `crm_app` → DW-2 _(passed 2026-10-01)_
- [x] Start the api with `DATABASE_URL` as the owner role, then as `postgres` → it refuses to start both times ("can bypass row level security") → DW-2 _(passed 2026-10-01)_
- [x] Start the worker with `DATABASE_URL_DIRECT` on a `-pooler` host → it refuses to start → DW-2 _(passed 2026-10-01)_
- [x] `curl -X POST localhost:3000/api/rpc/system/status` with no `Origin`, or a foreign one → 403 `FORBIDDEN_ORIGIN`; with `Origin: http://localhost:5173` → 200 with the status → DW-2 _(passed 2026-10-01)_
- [x] Send SIGTERM to the api → it logs "Shutting down" and exits → DW-2 _(passed 2026-10-01)_
- [x] `pnpm dev` with Docker installed → Postgres, PgBouncer and Centrifugo report healthy, and the status page works through PgBouncer (port 6432) → DW-2 _(passed 2026-10-01, Docker Desktop 29.8)_
- [x] `docker build -f apps/api/Dockerfile .` and `docker build -f infra/centrifugo/Dockerfile .` → both images build → DW-3 _(passed 2026-10-01; the api image also answered `/api/health/ready` through PgBouncer)_
- [x] `railway config plan` (linked to `production`, then `preview-base`) → it plans the three services `api`, `worker` and `centrifugo` → DW-3 _(passed 2026-10-01, then applied to both)_

## Acceptance-criteria coverage
- DW-1: spec 0001 exists with its status line (`In Progress` now, `Accepted` once the feature is done).
- DW-2: the local status page steps, typecheck, build, db:setup, the guard steps, `pnpm dev` with Docker.
- DW-3: the pull request, close and merge steps, the Docker builds, `railway config plan`. Still open: the pull request steps (they need the `VERCEL_TOKEN`, `RAILWAY_TOKEN` and `NEON_API_KEY` secrets, and the `preview-base` branch) and the merge path.
- DW-4: both boundaries steps. The "screens only from the component library" half lands with Design tokens (#3) and the Component library (#4). Until then the one boot page has no styles, so it has no raw values.
