# apps/api

## Overview

The one modular API (Hono + oRPC) that every read and write goes through, and the `worker` process for jobs and the outbox relay. Both run from one Docker image as two Railway services. Node 24 runs the TypeScript sources directly. Tagged `server`.

## Key files

| File | Owns |
|---|---|
| `src/server.ts` | The api entrypoint: parse env, connect, refuse a role that can bypass row level security, serve, shut down on SIGTERM |
| `src/worker.ts` | The worker entrypoint: the direct connection for jobs (#8) and the relay (#7), plus its own `/health` |
| `src/jobs/graphile.ts` | The one `graphile-worker` import: the two lanes' runners, stale lock release, and (on the light runner only) the crontab line `crm_cron_daily` at 03:00 UTC with one day of fill, whose task runs the daily cleanup's fan out (`runDailyCleanup` from `@crm/core/system`) and queues a continuation when its time budget runs out (spec 0008, milestone 3) |
| `src/jobs/lifecycle.ts` | The worker's awake and asleep states with the jobs on (spec 0008, milestone 3): one idle clock (`WORKER_IDLE_SLEEP_SECONDS`, 180, 0 never) for the runners and the relay; asleep it holds no connection, and a wake call or its timer (next due row, the cron less 30 seconds, or a day) wakes it; a failed wake or a lost runner retries with backoff and never exits |
| `src/app.ts` | The Hono app: request ids, the edge guard, health checks, the `Origin` check on writes, the 1 MB body limit and `/api/rpc/*`, the 404 and 500 shapes |
| `src/edge.ts` | The edge guard: refuses `/api/*` (health checks aside) without `x-crm-edge` outside local, and `clientIp()` for trusted requests only |
| `src/rpc.ts` | The RPC handler and its error interceptors: every error leaves with a code from `ERROR_MAP` in `@crm/contracts` |
| `src/errors.ts` | `toApiError()`: refusals keep their code and list every refusal, bad input is `INPUT_INVALID`, anything else `INTERNAL` |
| `src/router.ts` | Joins the module routers into the one router the contract describes |
| `src/modules/<feature>/router.ts` | Thin handlers for one feature, each calling a service in `packages/core` |
| `src/orpc.ts` | `RequestContext` and the three procedure bases: `pub`, `authed` (a session) and `member` (a session plus the access door, `context.scope`) |
| `src/gate.ts` | `createReadGate()`: at most 6 `records.query` and `records.count` calls in flight per workspace per process, made once in `createApp` and handed to procedures as `context.readGate`; one more answers 429 `TOO_MANY_REQUESTS` |
| `src/hooks.ts` | `commitWrite(context, { mutationId }, (hooks) => engineCall(..., hooks))`: the one way a write procedure calls the engine, with the write's hooks (the outbox), poking the relay once the write commits; `commitCounted` is the same and also answers `echoes`, how many outbox rows the committed write stored, which every records write answers (spec 0006, AC-60). `src/writes.test.ts` fails if a write procedure goes around them |
| `src/auth/` | Better Auth's one wrapper: email codes, Google, sessions, the sign up allowlist, rate limits, and its refusals in the shared error shape. Mounted on `/api/auth/*` |
| `src/mail/` | The `Mailer` interface, Resend (deployed) and Mailpit (local), and `booking.ts`, a booking's emails as a `MailMessage` (core's words drawn by `@crm/emails`, with the calendar file). Every template lives in `@crm/emails` (`packages/emails`) |
| `src/env.ts` | Zod schemas for the api and worker environments, and `loadEnv()` |
| `src/realtime/relay.ts` | The outbox relay the worker runs: active (LISTEN plus a backing off poll) or dormant (no database call at all), one relay by advisory lock, ordered publish of every kind of `ChangeEvent` with its commit time `at` (a malformed row goes out as the stub, so `seq`s stay gap free). Each row is planned through spec 0009's `filterEvent` for the workspace's audience (`workspaceEvent` in `@crm/core`; spec 0007 milestone 2), the audiences read once per workspace while awake (the `audiences` dep, `@crm/core/system` on the pool) and again after a `members` or `access` row, which ends its batch. It prunes the outbox (spec 0007 milestone 3) only after a publish pass: one `pruneOutbox` batch a pass, a round at the first pass of each awake period and then at most every 10 minutes, carried on while batches come back full; off (`relay.prune.off` at boot) on a direct login outside `crm_worker` |
| `src/realtime/stats.ts` | The relay's delivery numbers (spec 0007, AC-77), in memory: a rolling 5 minute window of each published row's lag (Postgres answers it as it marks the row), and what is read but still unpublished. The relay logs them as `relay.stats` once a minute while it publishes; the worker's `/health` reports them with the relay's mode |
| `src/realtime/wake.ts` | The worker's wake up call: the api's coalesced poke after a write commits (`context.wakeRelay()`), the same at most once a minute per process from every signed in request but Centrifugo's token renewals (`throttleWake`, `context.wakeOnUse()` in `requireSession`, spec 0008; `WORKER_WAKE_ON_USE`, off in production until the jobs are on there), at most every 10 seconds from a read of an overdue job (`context.wakeOverdue()`), and the worker's secret check |
| `src/worker-http.ts` | The worker's one port: `/health` (with the relay's numbers, from memory) and `POST /internal/outbox-wake` |
| `src/realtime/tokens.ts` | Centrifugo's connection and subscription tokens (HS256 with `node:crypto`, an hour since spec 0008 milestone 3, `sub` the user id), the one place the API signs them; `realtime.connectionToken` (a session) and `realtime.subscriptionToken` (the member door, channel `workspace:<id>`, with the workspace's head, the browser's first watermark) hand them out; `realtime.catchUp` (the member door) answers what a browser missed since its watermark from the outbox (`catchUp` in `@crm/core`) |
| `src/realtime/centrifugo.ts` | Centrifugo's server API (`/api/batch`, sequential, one call per workspace batch), the one place the backend calls it |
| `src/monitoring/` | Sentry (spec 0010): `sentry.ts` is the one `@sentry/node` import (`startSentry`, `captureFault`, `withRequestScope`, `setRequestScope`, `nameRequest`, `flush`), `instrument.ts` starts it before anything else loads (`node --import`) when `SENTRY_DSN_SERVER` is set, `config.ts` holds its small env schema, and `tracing.ts` (no vendor) the request sampler, trace names and `keepSpan`, the scrub every span passes. PostHog (milestone 3): `posthog.ts` is the one `posthog-node` import (`createAnalytics`, a no op without `POSTHOG_KEY`), and `milestones.ts` turns the milestones a write reached into catalog events, sent only after the write resolved. Milestone 4: `stats.ts` (no vendor) is the worker's once a minute stats tick, from memory only: `worker.awake`, the relay's `outbox.pending` and `outbox.oldest_age_s` while awake, `RELAY_LAGGING` after two slow awake ticks (again every hour it lasts), the `worker-heartbeat` check in, awake or asleep, and `relay.lag` from `createLagSample` (the relay's `lag` dep: every row up to 500 a minute, a uniform sample past that) |
| `src/rules.ts` | `APP_RULES`: the one place the app's object, field and record rules come from (spec 0009; none until #24). The api's door and the worker's re-entry of a job's member both take it, so a member's job never runs with less than their rules; `rules` is required everywhere, with no default |
| `src/door.test.ts` | The contract walk: every procedure outside the bootstrap list must be built on `member`, and no file here builds an engine scope |
| `src/log.ts` | The logger: one JSON line per event |
| `Dockerfile` | `turbo prune`, a production install, Node 24 alpine |

## Commands

```bash
pnpm --filter @crm/api dev          # :3000, reads the root .env
pnpm --filter @crm/api dev:worker   # :3001 (WORKER_PORT)
pnpm --filter @crm/api typecheck
pnpm --filter @crm/api test
docker build -f apps/api/Dockerfile .   # from the repo root
```

## Conventions

- Handlers stay thin. The contract validates input, a `packages/core` service does the work, and the handler returns its result. No business logic or SQL in a router.
- A new feature gets `src/modules/<feature>/router.ts`, joined in `src/router.ts`, with its contract in `packages/contracts`.
- Log with `log.info`, `log.warn` and `log.error`, and pass errors through `errorFields()`. Never `console.log`, and never log a secret, token or cookie.
- Error bodies are `{ code, message }`: a stable upper snake case code and a plain sentence. See `crm-api-backend` for the full error shape.
- Writes (anything but GET, HEAD and OPTIONS) need an `Origin` equal to `APP_URL` or listed in `TRUSTED_ORIGINS`, or they get a 403.

## Gotchas

- The image installs production dependencies only, and runs from source. Anything imported at runtime must be in `dependencies`, not `devDependencies`.
- The api refuses to start as the owner or a superuser. `DATABASE_URL` must be the app login that `pnpm db:app-login` creates, and `IDENTITY_DATABASE_URL` the identity login `pnpm db:identity-login` creates (the only role that reads schema `auth`).
- A new procedure is built on `member` and takes `WorkspaceScoped` input, unless it belongs on the bootstrap list in `src/door.test.ts` (`system.*`, `me.get`, `workspaces.create`, `realtime.connectionToken`). Never build an `EngineScope` here; `context.scope` comes from the door. A write procedure takes a `mutationId` and calls the engine through `commitWrite(context, { mutationId }, (hooks) => ...)`, never with hooks of its own nor a poke by hand, and joins `WRITES` in `src/writes.test.ts`.
- The tests need Postgres on 5433, Mailpit on 8025 and Centrifugo on 8000 and 9000 (`docker compose up -d postgres mailpit centrifugo`): the sign in tests read the codes back from Mailpit, and `realtime/centrifugo.test.ts` checks the real workspace namespace and `/api/batch`. CI runs the same three as services; Centrifugo's namespace is written out in `ci.yml`, and a test keeps it equal to `infra/centrifugo/config.json`.
- The worker refuses a Neon `-pooler` host for `DATABASE_URL_DIRECT`, and proves a NOTIFY arrives before it starts. If a relay query fails or its connection drops, the relay reconnects with backoff (1, 2, 4 up to 30 seconds), unless the quiet spell is over, when it goes dormant until the next poke. The worker keeps running either way.
- Anything that calls the database on a timer keeps Neon's compute awake, and production is on the free plan's monthly compute hours. With the jobs off, the relay goes dormant after 3 quiet minutes and a write's poke (`commitWrite` calls `context.wakeRelay()` once the engine call resolves) wakes it. With them on, the worker's lifecycle (`src/jobs/lifecycle.ts`) closes the runners' and the relay's connections together after `WORKER_IDLE_SLEEP_SECONDS`, the relay never goes dormant on its own (`selfDormant: false`), and the poke wakes the whole worker; a jobs read that finds a queued job overdue by 5 seconds wakes it too (`wakeIfOverdue` in `hooks.ts`). Uptime monitors hit `/api/health`, never `/api/health/ready` (which queries); Railway's own health check runs only during a deploy.
- Two relay costs wait for the load harness (#12), described in `src/realtime/relay.ts`'s header: `pg_notify` serialising commits across workspaces (the fallback is to drop it and let the poke make the next poll due), and a round's barrier holding every workspace behind the slowest turn (the fix is a continuous queue).
- `WORKER_INTERNAL_URL` and `WORKER_WAKE_SECRET` are required on the api outside local, and `WORKER_WAKE_SECRET` on the worker (the same value). Locally, without `WORKER_INTERNAL_URL` the api pokes nothing.
- `WORKER_INTERNAL_URL` and `CENTRIFUGO_API_URL` take https, or plain http to a `*.railway.internal` host or localhost; with `APP_ENV=local` or on Render (`RENDER=true`) only, also to a one label host: a compose service name (`http://worker:3101`, `http://centrifugo:9000`), as the load stack (`docker-compose.load.yml`) uses, or a Render private address. A bare `host:port` (Render's Blueprint `hostport`) reads as plain http (spec 0044).
- `/api/health` and Sentry name the release from `releaseOf`: `RENDER_GIT_COMMIT`, else `RAILWAY_GIT_COMMIT_SHA`, else `local`.
- `CENTRIFUGO_TOKEN_SECRET` (the Centrifugo service's `CENTRIFUGO_CLIENT_TOKEN_HMAC_SECRET_KEY`, set on the api service as a reference to it) is optional everywhere, so the API boots without it; where it is unset both `realtime.*` procedures answer 503 `API_UNAVAILABLE`, and the web app, without `VITE_REALTIME_URL`, never asks.
- The relay needs `CENTRIFUGO_API_URL` and `CENTRIFUGO_API_KEY` outside local; locally, without them the worker boots with the relay off (it logs so).
- Locally the api owns `PORT` and the worker uses `WORKER_PORT` (default 3001). On Railway, each service gets its own `PORT`.
- Turbo runs tasks in strict env mode, so shell variables don't reach `dev`. The scripts read the root `.env` themselves (`--env-file-if-exists`).
- Railway runs migrations as the api's pre deploy step, on the owner role.
- Forwarded headers (`x-forwarded-for` and the rest) are trusted only when the edge guard admitted the request by its secret (or locally). Read the IP from `context.clientIp`, never from the header. `EDGE_SECRET` is required outside local (the API refuses to boot without it), and only a value that is an IP reaches Better Auth's limiter.
- A procedure throws an engine refusal or `apiError(code, message)`; never a hand made `ORPCError` with a status. Anything else is logged, reported to Sentry (`captureFault`) and answered as `INTERNAL`. Refusals are never reported.
- Product events (spec 0010, milestone 3) go to PostHog from the api only, and only the catalog in `@crm/contracts/events` (`user_signed_up`, `workspace_created`, `first_record_created`), ids only. A new event is a new schema there first. `user_signed_up` comes from Better Auth's user create after hook; the two milestones from `workspace_milestones` rows written in the write's own transaction (`createUserWorkspace`, and `milestoneHook` in `writeHooks`), queued only once `commitWrite` resolved. Without `POSTHOG_KEY` (local, tests, previews) nothing is sent; tests prove events against `test/posthog.ts`, a fake capture endpoint.
- Metrics are a closed list (`METRIC_UNITS` in `monitoring/sentry.ts`), and `keepMetric` strips every attribute but `service` and the SDK's environment, release and SDK name, so no metric carries a user, host or workspace. Scope attributes join a metric after that hook, so nothing may call `setAttributes` on a scope. A new metric is a new entry there. The stats tick never queries: a new source (spec 0008's queue numbers) reads memory the worker already holds, and the heartbeat runs in production only.
- Both processes start with `node --import ./apps/api/src/monitoring/instrument.ts` (the scripts, `railway.ts` and the Dockerfile's `CMD`). Without `SENTRY_DSN_SERVER` every monitoring function is a no op, so tests and laptops send nothing. Nothing personal goes: `scrub` (`@crm/contracts/monitoring`) runs in every send hook, and the SDK's `dataCollection` is all off. Sentry drops an event identical to the one just before it, so a test that sends the same error twice sees one.
- The api traces requests (spec 0010, AC-170): `rpc <procedure>` (named in `rpc.ts`) and `auth <route>` (in `app.ts`, allowed routes only), sampled by `TRACE_RATES` (production 0.2, preview 1.0, local 0), and never for a health check, another path, a path over 128 characters, a request without the edge header (outside local) or one that brings its own `sentry-trace`, `baggage` or `traceparent`. The worker has tracing off (no rate set, so no span is recorded). Database queries become child spans only because Sentry starts before `pg` loads, which Vitest can't do, so `tracing.test.ts` proves them in a child Node process (`test/traced-api.ts`). Spans stream and leave through `keepSpanOrBlank` (`keepSpan`, or a blank if it throws): texts cut to 1 KB (SQL 2 KB) and scrubbed, SQL as its shape, and no user agent, address, full URL, status message, database location, header beyond two, query or link. Trace headers go to no outgoing call. Hono's Sentry integration stays off: it renamed every trace to its route pattern and sent errors around `captureFault`.

## Agent skills

- [better-auth-best-practices](../../.claude/skills/better-auth-best-practices/): `better-auth/skills`, sign in, sessions and the organization plugin (from #10)
- [sentry-node-sdk](../../.claude/skills/sentry-node-sdk/): `getsentry/sentry-for-ai`, server error tracking and tracing (from #11)
- [resend](../../.claude/skills/resend/): `resend/resend-skills`, sending email behind the mailer interface
- [react-email](../../.claude/skills/react-email/): `resend/react-email`, email templates (they live in `packages/emails`)

## Related specs

- [0001 Stack and architecture](../../docs/specs/0001-stack-architecture/index.md)

_Drafted by /audit from the repo, worth a quick human pass. Edit freely: once a line stops matching this draft, later runs treat it as curated and will flag rather than overwrite it._
