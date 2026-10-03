# apps/api

## Overview

The one modular API (Hono + oRPC) that every read and write goes through, and the `worker` process for jobs and the outbox relay. Both run from one Docker image as two Railway services. Node 24 runs the TypeScript sources directly. Tagged `server`.

## Key files

| File | Owns |
|---|---|
| `src/server.ts` | The api entrypoint: parse env, connect, refuse a role that can bypass row level security, serve, shut down on SIGTERM |
| `src/worker.ts` | The worker entrypoint: the direct connection for jobs (#8) and the relay (#7), plus its own `/health` |
| `src/app.ts` | The Hono app: request ids, the edge guard, health checks, the `Origin` check on writes, the 1 MB body limit and `/api/rpc/*`, the 404 and 500 shapes |
| `src/edge.ts` | The edge guard: refuses `/api/*` (health checks aside) without `x-crm-edge` when `EDGE_SECRET` is set outside local, and `clientIp()` for trusted requests only |
| `src/rpc.ts` | The RPC handler and its error interceptors: every error leaves with a code from `ERROR_MAP` in `@crm/contracts` |
| `src/errors.ts` | `toApiError()`: refusals keep their code and list every refusal, bad input is `INPUT_INVALID`, anything else `INTERNAL` |
| `src/router.ts` | Joins the module routers into the one router the contract describes |
| `src/modules/<feature>/router.ts` | Thin handlers for one feature, each calling a service in `packages/core` |
| `src/orpc.ts` | `RequestContext` and the three procedure bases: `pub`, `authed` (a session) and `member` (a session plus the access door, `context.scope`) |
| `src/auth/` | Better Auth's one wrapper: email codes, Google, sessions, the sign up allowlist, rate limits, and its refusals in the shared error shape. Mounted on `/api/auth/*` |
| `src/mail/` | The `Mailer` interface, Resend (deployed) and Mailpit (local), and the one React Email template |
| `src/env.ts` | Zod schemas for the api and worker environments, and `loadEnv()` |
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
- A new procedure is built on `member` and takes `WorkspaceScoped` input, unless it belongs on the bootstrap list in `src/door.test.ts` (`system.*`, `me.get`, `workspaces.create`, `realtime.connectionToken`). Never build an `EngineScope` here; `context.scope` comes from the door.
- The tests need Postgres on 5433 and Mailpit on 8025 (`docker compose up -d postgres mailpit`): the sign in tests read the codes back from Mailpit.
- The worker refuses a Neon `-pooler` host for `DATABASE_URL_DIRECT`, and proves a NOTIFY arrives before it starts. If its direct connection drops, it exits so Railway restarts it.
- Locally the api owns `PORT` and the worker uses `WORKER_PORT` (default 3001). On Railway, each service gets its own `PORT`.
- Turbo runs tasks in strict env mode, so shell variables don't reach `dev`. The scripts read the root `.env` themselves (`--env-file-if-exists`).
- Railway runs migrations as the api's pre deploy step, on the owner role.
- Forwarded headers (`x-forwarded-for` and the rest) are trusted only when the edge guard admitted the request by its secret (or locally). Read the IP from `context.clientIp`, never from the header. While `EDGE_SECRET` is unset in a deployed environment the guard is off and `clientIp` stays undefined. #57 makes the secret required.
- A procedure throws an engine refusal or `apiError(code, message)`; never a hand made `ORPCError` with a status. Anything else is logged and answered as `INTERNAL`.

## Agent skills

- [better-auth-best-practices](../../.claude/skills/better-auth-best-practices/): `better-auth/skills`, sign in, sessions and the organization plugin (from #10)
- [sentry-node-sdk](../../.claude/skills/sentry-node-sdk/): `getsentry/sentry-for-ai`, server error tracking and tracing (from #11)
- [resend](../../.claude/skills/resend/): `resend/resend-skills`, sending email behind the mailer interface
- [react-email](../../.claude/skills/react-email/): `resend/react-email`, email templates (until `packages/emails` exists)

## Related specs

- [0001 Stack and architecture](../../docs/specs/0001-stack-architecture/index.md)

_Drafted by /audit from the repo, worth a quick human pass. Edit freely: once a line stops matching this draft, later runs treat it as curated and will flag rather than overwrite it._
