# packages/db

## Overview

The database layer: the Drizzle schema, committed SQL migrations, the roles and row level security, and the one helper every tenant query runs through, `withWorkspace()`. Used by the api and the worker. Tagged `server`.

## Key files

| File | Owns |
|---|---|
| `src/client.ts` | `createDatabase()`: `withWorkspace()`, `checkHealth()` and `assertAppRole()` on the pooled connection |
| `src/direct.ts` | `assertDirectUrl()` and `openDirectConnection()` for LISTEN, the relay and jobs |
| `src/schema/index.ts` | The Drizzle schema |
| `migrations/` | Committed SQL. drizzle-kit generates the table changes; roles, grants and policies are hand written |
| `scripts/migrate.ts` | Applies migrations as the owner role (also Railway's pre deploy step) |
| `scripts/app-login.ts` | Creates this environment's app login role inside the `crm_app` group |
| `drizzle.config.ts` | drizzle-kit settings (generate only, strict) |

## Commands

```bash
pnpm db:generate    # SQL from the schema; review it and commit it
pnpm db:migrate     # needs DATABASE_URL_OWNER
pnpm db:app-login   # creates crm_app_user (or the configured login) in crm_app
pnpm db:setup       # both, in order
```

## Conventions

- Every tenant table has `workspace_id`, `FORCE ROW LEVEL SECURITY`, and a policy that is a plain comparison, `workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid`. Every index on it leads with `workspace_id`.
- Tenant queries run only inside `withWorkspace(workspaceId, fn)`. Nothing else may touch the pool. See `crm-data-model-access`.
- The app never owns a table. Grants reach `crm_app` through default privileges, so a new table needs no grant of its own.
- Migrations expand first and contract later: a destructive step ships only once no running code needs the old shape. Hand written SQL separates statements with `--> statement-breakpoint`.
- Seeds stay separate from migrations, and never run in production.

## Gotchas

- Outside `withWorkspace()`, a tenant query returns no rows rather than an error. The policies fail closed, which is safe but can look like a bug.
- `withWorkspace()` throws a `TypeError` unless the id is a uuid.
- `DATABASE_URL` is pooled (PgBouncer in transaction mode): no named prepared statements, and no LISTEN. LISTEN is accepted there but never delivers, so it only runs on `DATABASE_URL_DIRECT`.
- Better Auth's tables (from #10) are global identity and sit outside row level security. Membership is always checked explicitly.

## Agent skills

- [drizzle](../../.claude/skills/drizzle/): `lobehub/lobehub`, schemas, indexes, relations and typed queries
- [neon-postgres](../../.claude/skills/neon-postgres/): `neondatabase/agent-skills`, pooled versus direct connections, branches, scale to zero

## Related specs

- [0001 Stack and architecture](../../docs/specs/0001-stack-architecture/index.md)

_Drafted by /audit from the repo, worth a quick human pass. Edit freely: once a line stops matching this draft, later runs treat it as curated and will flag rather than overwrite it._
