# packages/db

## Overview

The database layer: the Drizzle schema, committed SQL migrations, the roles and row level security, and the one helper every tenant query runs through, `withWorkspace()`. Used by the api and the worker. Tagged `server`.

## Key files

| File | Owns |
|---|---|
| `src/client.ts` | `createDatabase()`: `withWorkspace()`, `checkHealth()` and `assertAppRole()` on the pooled connection |
| `src/direct.ts` | `assertDirectUrl()` and `openDirectConnection()` for LISTEN, the relay and jobs |
| `src/outbox.ts` | `createOutboxReader()`: the relay's lock, LISTEN, the definer function `crm_outbox_workspaces` (ids only), and reading and marking rows inside `withWorkspace` |
| `src/schema/index.ts` | The Drizzle schema |
| `migrations/` | Committed SQL. drizzle-kit generates the table changes; roles, grants and policies are hand written |
| `scripts/migrate.ts` | Applies migrations as the owner role (also Railway's pre deploy step) |
| `scripts/app-login.ts` | Creates this environment's app login role inside the `crm_app` group |
| `scripts/identity-login.ts` | Creates this environment's identity login role inside the `crm_identity` group (both through `scripts/login.ts`) |
| `src/identity/` | The identity store: the only code that reads or writes schema `auth`, on the identity login |
| `drizzle.config.ts` | drizzle-kit settings (generate only, strict) |

## Commands

```bash
pnpm db:generate    # SQL from the schema; review it and commit it
pnpm db:migrate     # needs DATABASE_URL_OWNER
pnpm db:app-login   # creates crm_app_user (or the configured login) in crm_app
pnpm db:identity-login  # creates crm_identity_user (IDENTITY_DATABASE_URL) in crm_identity
pnpm db:setup       # all three, in order
```

## Conventions

- Every tenant table has `workspace_id`, `FORCE ROW LEVEL SECURITY`, and a policy that is a plain comparison, `workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid`. Every index on it leads with `workspace_id`.
- Tenant queries run only inside `withWorkspace(workspaceId, fn)`. Nothing else may touch the pool. See `crm-data-model-access`.
- The app never owns a table. Grants reach `crm_app` through default privileges, so a new table needs no grant of its own.
- Migrations expand first and contract later: a destructive step ships only once no running code needs the old shape. Hand written SQL separates statements with `--> statement-breakpoint`.
- Seeds stay separate from migrations, and never run in production.
- On Neon, run `app-login` and `identity-login` with `--plain-password`: Neon's control plane refuses a precomputed SCRAM verifier (seen on production, 3 October 2026). Postgres still stores only its own hash.

## Gotchas

- Outside `withWorkspace()`, a tenant query returns no rows rather than an error. The policies fail closed, which is safe but can look like a bug.
- `withWorkspace()` throws a `TypeError` unless the id is a uuid.
- `DATABASE_URL` is pooled (PgBouncer in transaction mode): no named prepared statements, and no LISTEN. LISTEN is accepted there but never delivers, so it only runs on `DATABASE_URL_DIRECT`.
- Better Auth's tables are global identity in schema `auth`, outside row level security. Only `crm_identity` reads and writes them; `crm_app` may only insert the two directory rows inside the workspace transaction. Membership is always checked explicitly, in the tenant `members` row.
- Tests get `appUrl`, `identityUrl`, `ownerUrl` and `adminUrl` (a superuser, for `pg_authid` and built in roles) from `prepareTestDatabase`. A test that commits a role the migrations' checks would refuse runs inside `withSetupLock()`. Outside this package, use `testQuery()` from `@crm/db/testing` instead of opening a connection.

## Agent skills

- [drizzle](../../.claude/skills/drizzle/): `lobehub/lobehub`, schemas, indexes, relations and typed queries
- [neon-postgres](../../.claude/skills/neon-postgres/): `neondatabase/agent-skills`, pooled versus direct connections, branches, scale to zero

## Related specs

- [0001 Stack and architecture](../../docs/specs/0001-stack-architecture/index.md)

_Drafted by /audit from the repo, worth a quick human pass. Edit freely: once a line stops matching this draft, later runs treat it as curated and will flag rather than overwrite it._
