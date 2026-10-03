# packages/data

## Overview

The one client data layer. Every screen reads and writes CRM data through it and never calls the network itself. Today it's a thin typed oRPC client. The record store, optimistic writes, live patches and undo arrive behind the same interface in Client data and state (#6). Tagged `client`.

## Key files

| File | Owns |
|---|---|
| `src/index.ts` | `createDataLayer({ origin, notify, mintId, onSignedOut, currentPath })`, the `DataLayer` type, and the contract types screens may use. `me.get()` and `objects.list()` are cached per app load; a 401 from any call but `me.get` runs `onSignedOut` once |
| `src/errors.ts` | `DataError`: every failure as `{ code, message, data? }`, from oRPC, Better Auth or the network. No Zod here (first load): codes come from `@crm/contracts/codes` |
| `src/auth/` | Sign in. `client.ts` is Better Auth's browser client, its one wrapper (lint lets only `src/auth/` import `better-auth/client`), loaded with a dynamic import by `auth.ts` |
| `src/ids.ts` | `createIdMinter()`: UUID v7 from the clock and browser crypto |
| `src/data.test.ts` | The layer against a fake API: the real oRPC handler over the contract, and Better Auth's routes by hand |

## Conventions

- The interface is shaped by what screens need, grouped per feature (`data.system.status()`), not by how the API is laid out.
- `apps/web` imports types from here, never from `@crm/contracts`. Export the types a screen needs from here.
- The API sits at `/api/rpc` on the app's own origin, in every environment.
- This package is the backbone of the app: follow `crm-frontend-state` for every change.
- It is in the first load: keep Zod, the Better Auth client and anything heavy out of its static imports (load them with `import()`).

## Gotchas

- TanStack DB isn't added yet. #6 starts with a prototype of a windowed, server filtered query over a million rows. If it struggles, the implementation switches to a normalised store on TanStack Query, and the interface stays the same.

## Agent skills

- [tanstack-query](../../.claude/skills/tanstack-query/): `tanstack-skills/tanstack-skills`, server state and caching (TanStack DB's query collections sit on it)

## Related specs

- [0001 Stack and architecture](../../docs/specs/0001-stack-architecture/index.md)

_Drafted by /audit from the repo, worth a quick human pass. Edit freely: once a line stops matching this draft, later runs treat it as curated and will flag rather than overwrite it._
