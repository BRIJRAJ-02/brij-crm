# packages/data

## Overview

The one client data layer. Every screen reads and writes CRM data through it and never calls the network itself. It is a typed oRPC client plus the record store with windows and optimistic writes (spec 0005); live patches arrive with milestone 3, undo and saved views with Client data and state (#6). Tagged `client`.

## Key files

| File | Owns |
|---|---|
| `src/index.ts` | `createDataLayer({ origin, notify, mintId, onSignedOut, currentPath, onSessionChange })`, the `DataLayer` type, and the contract types screens may use. `me.get()`, `objects.list()`, `members.list()` and `attributes.list()` are cached per app load (an objects `NOT_FOUND` drops the cached `me`; `attributes.create` drops its object's list); a 401 from any call but `me.get` runs `onSignedOut` once (until `me.get` answers a person again), then `onSessionChange`, which sign in and sign out run too, and clears the records. `records.*` loads `src/records/layer.ts` with a dynamic import on first use |
| `src/react.ts` | `@crm/data/react`: `useView(view)`, a view's state through `useSyncExternalStore`, so screens never subscribe to the store themselves |
| `src/fields.ts` | `toFieldAttribute(definition, readOnlyReason?)` (an AttributeDefinition as the field set's attribute; references and members read only in this loop, with the screen's reason) and `toActorDisplays(members)` (the Owner column's names) |
| `src/errors.ts` | `DataError`: every failure as `{ code, message, data?, retryAfterSeconds? }`, from oRPC, Better Auth or the network; `retryAfterSeconds` comes from the answer's `Retry-After` (`parseRetryAfter`). No Zod here (first load): codes come from `@crm/contracts/codes` |
| `src/auth/` | Sign in. `client.ts` is Better Auth's browser client, its one wrapper (lint lets only `src/auth/` import `better-auth/client`), loaded with a dynamic import by `auth.ts` |
| `src/ids.ts` | `createIdMinter()`: UUID v7 from the clock and browser crypto |
| `src/data.test.ts` | The layer against a fake API: the real oRPC handler over the contract, and Better Auth's routes by hand |
| `src/records/layer.ts` | The records layer (spec 0005, task 11), loaded lazily: one store of RecordView for the app, a view per object (`view(workspace, objectId)`: windows, count, `status`, `retry`, `cellErrors`, `ready()`), optimistic `create` (a draft at the end, withdrawn on refusal, sent again with the same id when it never arrived) and `setValues` (one write per record; a refusal rolls back, marks the cell and raises one toast with Retry). Reads answered 429 `TOO_MANY_REQUESTS` wait the `Retry-After` and try again; an edit to a draft waits for its create. `layer.test.ts` drives it against a fake API answered by hand |
| `src/records/store.ts`, `plain-store.ts` | The record store: a base plus optimistic layers per record (the layering rule, `composeRecord`, `remainingLayers`), each cell ordered by `RecordView.versions` (`newerBase`: an older row never replaces a newer cell), bodies reference counted (`hold`, `release`, `receive(rows, { hold })`) and evicted at zero unless a layer waits, and an unchanged row kept as the same object |
| `src/records/windows.ts` | A view's ordered ids in blocks of 100: loads around the range on screen (one `AbortController` per block; a newer request supersedes), drops blocks past 5 away and lets go of their ids, `add`/`withdraw` for a record made here, `drop` empties a gone row and reloads its block and the later ones, `setCount` trims |
| `src/records/view.ts` | Windows plus store as the grid's RowSource: a new snapshot only when a loaded id or the windows changed, at most once a frame (`nextFrame`) |
| `src/records/index.ts` | `@crm/data/records`, for the AC-40 gate tool (`tools/data-gate`) only; screens never import it |

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
- The store keeps a body only while something holds it (a window's block, later an open record page) or a layer waits on it. A loader must put its rows in with `receive(rows, { hold: true })` and the windows let go; a row received with nothing holding it is not kept. After scrolling all 100,000 records in the gate harness the heap was 12.7 MB against the bare grid's 12.5 MB (it was about 70 MB before eviction).
- A view announces at most once a frame. Whoever needs the state at once (the router loader awaiting `ready()`) gets it flushed; tests pass their own `schedule`.
- A 401 clears the records with everything else, so a pending edit leaves with its session.

## Agent skills

- [tanstack-query](../../.claude/skills/tanstack-query/): `tanstack-skills/tanstack-skills`, server state and caching (TanStack DB's query collections sit on it)

## Related specs

- [0001 Stack and architecture](../../docs/specs/0001-stack-architecture/index.md)

_Drafted by /audit from the repo, worth a quick human pass. Edit freely: once a line stops matching this draft, later runs treat it as curated and will flag rather than overwrite it._
