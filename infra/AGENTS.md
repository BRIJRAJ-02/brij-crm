# infra

## Overview

Configuration for the services that aren't our own code: Centrifugo (realtime) and the local Postgres setup. The Railway services themselves are defined in `.railway/railway.ts`, and the local stack in `docker-compose.yml`.

## Key files

| File | Owns |
|---|---|
| `centrifugo/config.json` | Ports, the memory engine, admin and health |
| `centrifugo/Dockerfile` | The pinned Centrifugo image with that config |
| `postgres/init/01-roles.sql` | Local only: the owner role and the `crm` database, mirroring Neon |
| `../.railway/railway.ts` | The `api`, `worker` and `centrifugo` services, applied per environment with `railway config plan`, then `apply` |

## Conventions

- Secrets never go in these files. Centrifugo reads them from the environment, and `preserve()` in `.railway/railway.ts` keeps each environment's own values.
- Centrifugo runs as one node on the memory engine. Moving to more than one node (a Redis compatible broker) is a config change, made only when the load harness (#12) asks for it.

## Gotchas

- Centrifugo's public port 8000 takes client connections only. Its HTTP API (which the relay publishes to), the admin UI and `/health` are on internal port 9000. On Railway, point the public domain at 8000.
- Centrifugo's real variable names differ from the list in spec 0001: `CENTRIFUGO_HTTP_API_KEY`, `CENTRIFUGO_CLIENT_TOKEN_HMAC_SECRET_KEY`, `CENTRIFUGO_ADMIN_PASSWORD`, `CENTRIFUGO_ADMIN_SECRET` and `CENTRIFUGO_CLIENT_ALLOWED_ORIGINS`.
- History is lost when Centrifugo restarts, so a client that reconnects then falls back to refetching.
- The passwords in `01-roles.sql` and `.env.example` are for local use only.
- The Railway project is `brij-crm`, deploying from `BRIJRAJ-02/brij-crm` (`REPO` in `.railway/railway.ts`), with services in Singapore. Production addresses: api `https://api-production-69e1.up.railway.app`, Centrifugo `https://centrifugo-production-68df.up.railway.app` (port 8000). `preview-base` has no database variables on purpose, so its services can't start until a pull request copies it. A push to `main` redeploys only the services whose watch patterns match the change.
- Neon is project `long-silence-55194255` (Singapore, Postgres 18), provisioned through Vercel. Production uses database `crm`, the owner role `neondb_owner`, and the app login `crm_app_user`.

## Related specs

- [0001 Stack and architecture](../docs/specs/0001-stack-architecture/index.md)

_Drafted by /audit from the repo, worth a quick human pass. Edit freely: once a line stops matching this draft, later runs treat it as curated and will flag rather than overwrite it._
