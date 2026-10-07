# packages/data

## Overview

The one client data layer. Every screen reads and writes CRM data through it and never calls the network itself. Today it's a thin typed oRPC client. The record store, optimistic writes, live patches and undo arrive behind the same interface in Client data and state (#6). Tagged `client`.

## Key files

| File | Owns |
|---|---|
| `src/index.ts` | `createDataLayer({ origin, notify, mintId, onSignedOut, currentPath, onSessionChange })`, the `DataLayer` type, and the contract types screens may use. `me.get()` and `objects.list()` are cached per app load (an objects `NOT_FOUND` drops the cached `me`); a 401 from any call but `me.get` runs `onSignedOut` once (until `me.get` answers a person again), then `onSessionChange`, which sign in and sign out run too |
| `src/errors.ts` | `DataError`: every failure as `{ code, message, data?, retryAfterSeconds? }`, from oRPC, Better Auth or the network; `retryAfterSeconds` comes from the answer's `Retry-After` (`parseRetryAfter`). No Zod here (first load): codes come from `@crm/contracts/codes` |
| `src/auth/` | Sign in. `client.ts` is Better Auth's browser client, its one wrapper (lint lets only `src/auth/` import `better-auth/client`), loaded with a dynamic import by `auth.ts` |
| `src/ids.ts` | `createIdMinter()`: UUID v7 from the clock and browser crypto |
| `src/data.test.ts` | The layer against a fake API: the real oRPC handler over the contract, and Better Auth's routes by hand |
| `src/records/` | The record store (spec 0005, task 9's gate): `store.ts` (the `RecordStore` interface and the layering rule, `composeRecord` and `remainingLayers`), `plain-store.ts` (a Map of base plus layers per record), `windows.ts` (a view's ordered ids in blocks of 100: load, abort, evict past 5 blocks), `view.ts` (windows plus store as the grid's RowSource, for useSyncExternalStore). `index.ts` is the `@crm/data/records` entry for the gate tool (`tools/data-gate`) until the layer serves them itself; screens never import it. Not wired into `createDataLayer` yet (task 11) |

## Conventions

- The interface is shaped by what screens need, grouped per feature (`data.system.status()`), not by how the API is laid out.
- `apps/web` imports types from here, never from `@crm/contracts`. Export the types a screen needs from here.
- The API sits at `/api/rpc` on the app's own origin, in every environment.
- This package is the backbone of the app: follow `crm-frontend-state` for every change.
- It is in the first load: keep Zod, the Better Auth client and anything heavy out of its static imports (load them with `import()`).
- Change events (spec 0005; task 17 builds this): each event on `workspace:<id>` carries the workspace's `seq`, numbered with no gaps in commit order, and names what changed by id (`ChangeEvent` in `@crm/contracts`). The layer keeps the highest `seq` it has applied per workspace, and:
  - a `seq` at or below the highest seen is ignored (a repeat, or one a refetch already covered);
  - `highest + 1` is applied (refetch the named records, or the object's attributes for `definitions`, or everything held of the object when `coarse`), and becomes the highest;
  - a jump past `highest + 1` is a gap: refetch everything it holds for the workspace, then move the highest forward to that `seq`;
  - so a lower `seq` arriving late is dropped. The relay can deliver out of order: Centrifugo runs every command in a batch, so a row after a refused one may land before it, and the refused one comes again later.
  - An event whose `mutationId` is one this browser sent is its own write's echo: move the highest forward, refetch nothing. A subscription that comes back without recovery (history gone after 5 minutes or 1,000 messages, or a Centrifugo restart) is a gap too.

## Gotchas

- The record store is the plain store, not TanStack DB. AC-40's gate (verify.md) found that TanStack DB's own optimistic transactions break the layering rule. A refusal rolls back later edits to the same record. A later edit carries an earlier edit's value as a whole-row snapshot. A new base doesn't show through under a pending edit. An in-flight transaction defers sync writes. So the TanStack store had to keep its own layers anyway, and then cost more memory and time for nothing. It was removed after the gate. To rerun the comparison, check out 4bac1a0 (`packages/data/prototype/`).
- The store keeps every body it has loaded; only the id windows are evicted. 100,000 records were about 70 MB of heap in the gate, and scrolling with them all loaded missed more frames than the grid alone. Task 11 should evict bodies no window or pending layer refers to, so memory stays flat while you scroll.

## Agent skills

- [tanstack-query](../../.claude/skills/tanstack-query/): `tanstack-skills/tanstack-skills`, server state and caching (TanStack DB's query collections sit on it)

## Related specs

- [0001 Stack and architecture](../../docs/specs/0001-stack-architecture/index.md)

_Drafted by /audit from the repo, worth a quick human pass. Edit freely: once a line stops matching this draft, later runs treat it as curated and will flag rather than overwrite it._
