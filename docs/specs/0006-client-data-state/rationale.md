# 0006. Client data and state: decision record

## Context

Spec 0005 built the thin data layer one path needed: one unfiltered, unsorted People table read in id order by position, optimistic edits with rollback, and live patches by refetching the ids an event names. The scope's #6 asks for much more: no screen ever fetching on its own, every view (filtered, sorted, a million records) windowed with flat memory, a clear winner and a notice when two people save one field, an undo, and every open view patched in place. Features #15 to #22 (relations, the record page, views, the board, bulk actions) all assume this layer exists.

The forces: ordering and filtering can only happen on the server, because the stored sort keys (spec 0004) and the access door live there, and row level security makes the client's guesses unsafe anyway. Filtered views can only page by cursor; only unfiltered single sort views can jump. Counts over 10,000 are capped. The engine already versions every value and reports the version a save replaced (spec 0004, AC-12), but reads don't carry versions, and `updated_at` is a transaction start time that can run backwards across two writes. Events carry ids only, so the client refetches. The store itself (TanStack DB or a plain store) is being chosen by spec 0005's prototype gate right now and must not be decided again here.

Owner constraints: visible product first, built carefully; Neon stays free, so scale proofs run on the capped local Docker Postgres. 100 people online, a million records per workspace.

## Options considered

### Option 1: extend spec 0005's layer in place (chosen)

Keep the interface, store and layering rule; add query keyed windows with two modes, versions and a record revision in reads, a server checked undo, and our own event pipeline with batching and coalescing.

**Pros**: no screen changes shape; every behaviour is our code, so the store choice stays open; each part ships end to end in three milestones.
**Cons**: we own a fair amount of window and event code instead of a library's.

### Option 2: lean on TanStack DB's live queries for windows and ordering

Load query results into collections and let live queries filter, sort and paginate in the browser, with server queries only to fill them.

**Pros**: less code of our own; incremental view maintenance for free.
**Cons**: the browser can't reproduce the server's sort keys, collation or access rules; a million record object can't be held in memory, so the local result is always partial and wrong at its edges; it ties #6 to the store choice the gate hasn't made.

### Option 3: a sync engine (a local replica that syncs by row)

Replicate each workspace's rows to the browser (Electric, Zero, PowerSync style) and query locally.

**Pros**: instant local queries and offline for free.
**Cons**: a million records per workspace don't fit in a tab; replicating rows bypasses the access door the API enforces; a new service to run on Railway; contradicts spec 0001's server run queries.

## Rationale

Option 1 is the only one that respects where order and access live (the server) and leaves the store gate's result untouched. Option 2 fails on ordering and scale for the views that matter most; Option 3 fails on scale, access and operations. The extra code in Option 1 is bounded: windows are ids plus checkpoints, versions are two columns, and undo is a list of confirmed writes replayed with a precondition.

Per decision:
- **Who sees the replaced notice**: the person whose value was replaced (the house rule and the scope say "the other sees a notice"). Runner up: both. The winner's value is the one showing, so a notice there is noise.
- **How the loser's tab learns**: the event carries the replaced version id, and the tab matches it against versions it wrote. Runner up: per member channels addressed by the server, which #7 doesn't have and which would need the server to track tabs.
- **A record revision for read order**: one bigint bumped where the record row is already updated. Runners up: per attribute version times (bigger payload) and `updated_at` (can run backwards).
- **Version ids in reads, despite the size**: they are the precise base the engine compares; reading only visible attributes keeps the cost down.
- **Undo checked on the server** (`ifVersionId`): the only way an undo can't overwrite a teammate's newer value. Runner up: a client side check only, which races.
- **Undo scope**: value changes now; create, delete and restore join with #22, which owns delete and the trash. No redo in v1: rare, and it doubles the precondition cases.
- **Undo trigger**: Cmd+Z outside text fields, plus an "Undo" toast after multi cell changes, so mouse users can undo the change most worth undoing. Runner up: a toast after every edit, which is noise.
- **Settle on idle at 1.5 seconds** for order and membership: values stay instant, rows don't jump under the cursor, and the member's own rows hold their place. Runner up: predicting order in the browser, impossible without the server's keys.
- **Checkpointed cursor chains**: the engine can't jump in filtered views, so checkpoints are the only way to drop blocks and still come back cheaply. Runner up: keep every loaded block, which breaks flat memory.
- **Only visible attributes**: payload and spec 0004's whole call cost both scale with columns read.
- **No offline queue**: scope lists offline use as its own later idea; a 30 second retry covers short drops honestly. Runner up: a persistent queue, which needs merge rules and storage of record data on the device.
- **An unsaved column sort on People now**: proves cursor windows visibly before #20. Runner up: tests only, which hides the hardest part from the owner's review.
- **Batch writes in #6**: paste and undo need them; #22 reuses the same call for inline bulk edits.

## Evidence

Read for this spec (3 October 2026): `packages/data/src/index.ts` (oRPC client, per app load caches, 401 handling), `packages/core/src/engine/query/page.ts` (`checkPage` allows a position only with no filter and at most one sort; `nextCursor` from the last row's keys; `COUNT_CAP` 10,000), `packages/core/src/engine/values.ts` (one `version_id` per write for all items, `replaced` from `baseVersionId`, `touchOwner` with `now()`), `packages/core/src/engine/records.ts` (`RecordView` without versions; `readRecords` takes `attributeIds`; `setValuesBatch` up to 500 with a savepoint per record), `packages/ui` `ListSource` and `DataGrid` (`count`, `getItem`, `onRangeChange`, `onSort`, `onCellsChange`, `cellErrors`). The brief file for #11 to #22 has no #6 section; #20 and #22 there assume filtered windows, coarse coalescing at one a second, and a settle on idle at 1.5 seconds with a sticky row, which this spec adopts.
