# packages/core

## Overview

The domain services the api and the worker share, and (from Access model, #9) the one access door every read and write passes. No HTTP lives here. Tagged `server`.

## Key files

| File | Owns |
|---|---|
| `src/index.ts` | The package's public services |
| `src/system/status.ts` | The pattern to copy: a deps interface plus one service function |

## Conventions

- A service is a function that takes its dependencies (`{ db, environment }`) and its input, and returns a type from `packages/contracts`.
- One folder per feature (`src/<feature>/`), exported through `src/index.ts`.
- Never import Hono, `@orpc/server` or `process.env`. The api and the worker pass in everything a service needs.
- Tenant data is read and written only through `db.withWorkspace()`, and (from #9) only with a scope the access door produced. See `crm-data-model-access`.

_Drafted by /audit from the repo, worth a quick human pass. Edit freely: once a line stops matching this draft, later runs treat it as curated and will flag rather than overwrite it._
