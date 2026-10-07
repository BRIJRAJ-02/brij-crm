# 0006. Windows: views over any number of records

## Summary

A view is a question (this object, this filter, these sorts) and a window is the part of its answer the screen needs right now. The window holds record ids in blocks of 100; the bodies live once in the store. A simple view jumps straight to any row; any other view pages forward by cursor and remembers where each block started, so a block dropped to save memory comes back from the same place. Live changes update values at once and reorder the view shortly after things go quiet.

## Interface

```ts
records.view(workspace, objectId, {
  filter?: FilterGroup,
  sorts?: SortRules,
  attributeIds: readonly string[],        // the visible columns; the primary attribute is always added
}) → ViewStore
// ViewStore: { subscribe, getSnapshot, source: RowSource<RecordView>, count: { value, atLeast },
//              mode: 'position' | 'cursor', status, retry, cellErrors, rowNotes, holdSettle(held) }
```

- `@crm/data/react`'s `useView(store)` stays the only way a screen reads it.
- The screen passes `attributeIds` on every render; a change in the list never opens a new window (see Visible attributes).
- `rowNotes` maps a record id to `'new'` or `'no-longer-matches'`; the grid draws them through its row note variant.
- `holdSettle(true)` while a cell editor is open in the view; `false` when it closes.

## The window key and its life

- Key: `objectId` plus the canonical JSON of `filter` and `sorts` (keys sorted, no whitespace). One window per key per workspace.
- **The window's clock**: one `now` (`Date.now()`) taken when the window opens and refreshed at each settle; every block and count of the window is read with it, so relative dates ("in the last 7 days") never shift between two blocks of one view.
- Reference counted by its readers. When the last reader goes, the window waits 30 seconds (back navigation stays instant), then drops its blocks and releases its bodies.
- The router loader warms a window (count and the first block) as spec 0005 does; it never hands rows to the screen.

## Two modes

`canJump(filter, sorts, attributes)` in `@crm/contracts` decides, and the engine's `checkPage` uses the same function:
- **Position mode**: no filter conditions, and no sort or one sort on a stored key kind (spec 0004's `sort_keys`), created at, updated at or record id. Sorts by created by, updated by (member names) and by a record reference page by cursor.
- **Cursor mode**: everything else.

**Position mode**: blocks are addressed by index (`block × 100`). `onRangeChange` loads the blocks in view plus overscan, one `AbortController` each, newest request first. The scrollbar is sized from the exact count (an unfiltered count is always exact, spec 0004 AC-23). A drag far away aborts blocks no longer wanted.

**Cursor mode**: blocks form a chain. Block 0 has no checkpoint; every later block's checkpoint is the `nextCursor` that ended the block before it.
- Loading the block after the last loaded one reads 100 rows from its checkpoint.
- A jump ahead of the chain (a scrollbar drag) reads forward in calls of 200 rows from the last checkpoint it has, showing skeletons, until it reaches the rows in view. Each call is aborted if the view moves back. At most 50 calls cover 10,000 rows. A call of 200 fills two blocks, so the second of them has no checkpoint of its own: dropped, it reloads from the first one's.
- The scroll height is `count`, or, when `atLeast`, 10,000 plus the rows loaded past it, so the bar grows as the end comes into reach. When a block comes back short (no `nextCursor`), the count is the rows loaded and `atLeast` turns false.
- A dropped block keeps its checkpoint, so scrolling back reloads it with one call. Its rows can differ from before only if something changed, which settle handles anyway.

**Both modes**:
- Blocks hold ids. The visible blocks plus 5 on each side stay; the rest are dropped (ids released, checkpoint kept).
- A record a read leaves out is gone for this viewer: removed from every window and subscription.
- A `QUERY_CANCELLED` block shows the grid's error state for that range with Retry. A `TOO_MANY_REQUESTS` block (spec 0005's cap of 6 reads in flight per workspace) waits its `Retry-After` and tries once more, then shows the same error state.
- **A refused cursor**: spec 0005 binds a cursor to its object, filter and sorts and answers 400 `INPUT_INVALID` naming the field `cursor` when it doesn't fit. Only that answer, on a request that carried a cursor, restarts the chain from block 0, once. If the restart fails as well, or any other refusal arrives (`FILTER_INVALID` included), the view shows its error state with Retry. A window never restarts twice without a successful read in between, so it can't loop.

## Visible attributes

- A window's attribute set is the union of its readers' `attributeIds` plus the primary attribute. Blocks are read with that set.
- A newly shown attribute is fetched for the loaded blocks only (`records.get` with `attributeIds: [it]`, 500 ids a call) and joins the set for later blocks. A hidden column leaves the set when no reader shows it; held values of it stay until their body is dropped.
- A body merges what each read returns; an attribute never read is unknown, and its cell draws a skeleton, never an empty value.
- Events: the record is refetched only for `event.attributeIds ∩ attributes held`, plus `updated_at` and `updated_by` when a shown column needs them. An empty intersection fetches nothing. A coarse event refetches the held set.

## Live changes in a window

- **Values** patch at once in every window, because bodies are shared.
- **Order and membership** can change when a value used by the filter or a sort changes, or when a record is created, deleted or restored. Rather than guess on the client (ordering lives on the server), a window that saw any such change is marked dirty.
- **Settle**: 1.5 seconds after the last change that dirtied it, and only while not held by an open editor, the window takes a fresh `now`, then rereads its loaded blocks (position mode by index; cursor mode from the first loaded block's checkpoint, as many rows as it had) and its count with it. Settles are at most one per window at a time; changes during a settle mark it dirty again.
- A window with no filter and no sort other than record id order is never dirty from value changes, only from creates and deletes.
- **The member's own rows**: a record the member edited in this view since the last settle keeps its index after the settle if it has moved away or left the view, until it scrolls out of sight or the member leaves the view; at its new place it is hidden meanwhile so it never shows twice. If it no longer matches the filter its note is `no-longer-matches` ("Doesn't match this view").
- **Own creates**: a record created from this view is placed first, noted `new`, until the member leaves the view; settle never moves it. If it doesn't match the filter, its note is `no-longer-matches` instead.
- **Others' creates and deletes** appear or vanish at the next settle; the count moves then too.

## The store's memory

- Each body has a hold count: window blocks holding its id, `records.one` subscriptions, pending writes, open editors.
- A body with no hold for 30 seconds is dropped; if more than 2,000 bodies have no hold, the oldest go first. Undo entries hold the values they need themselves, not bodies.
- With the gate's store (TanStack DB), a drop is a sync `delete` from our own sync layer; with the plain store, a `Map` delete. Either way no screen sees a difference.

## People in this spec

- Default sorts: `created_at` descending (position mode, so newest first and still jumpable).
- The grid's column menu Sort ascending and descending (its existing `onSort`) set the sorts in the screen's own state for this visit. It replaces, not adds, a sort. Saved views and drafts are #20.
- The TopBar count reads "10,000+" when `atLeast`.

## Tests

- Vitest with the fake API: window keys and sharing; one `now` per window, refreshed at settle; both modes against the engine's reference evaluator through a fake served from a sample; eviction and checkpoint reload; jump ahead and abort; short final block; a refused cursor restarts once and then shows the error state; a `FILTER_INVALID` never restarts; visible attribute union and fetch on show; event intersection; settle timing, hold, own rows kept and hidden at their new place, own creates first; hold counts and the 30 second drop.
- Real API (Vitest against Postgres): `records.query` with `attributeIds` returns only those attributes plus the primary; `canJump` agrees between contracts and `checkPage`.
- Playwright on the local scale seed: 20 jumps timed, a full scroll with heap samples every 50,000 rows (Chrome's `performance.measureUserAgentSpecificMemory` or a CDP heap snapshot after collection), frame times from a performance trace at the grid story's scroll speed, judged by their p95 against 16.7 ms.

## Rationale (short)

Ordering can't move to the browser (only the server holds the stored sort keys), so membership and order changes are settled by rereading rather than predicted. Checkpoints make cursor windows droppable without losing the way back. Reading only visible attributes is where most of the payload and the whole call cost go. Rows the member is working on never jump out from under them.
