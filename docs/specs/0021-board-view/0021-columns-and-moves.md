# 0021. Columns and moves

## Summary

A board is a row of windows, one per column, each asking the server for "this view's filter, and this option", in the view's sort order. The first 25 cards of up to 12 columns come back in one call; after that each column pages on its own. When you drop a card it jumps to the top of its new column at once and the value is saved; when someone else moves one, the card hops columns as soon as its new value arrives and slides into sort order when the column settles.

## The board store (`packages/data/src/records/board.ts`, new)

```ts
records.board(workspace, objectId, {
  groupBy: string,
  filter?: FilterGroup,          // the view's effective filter (spec 0020)
  sorts?: SortRules,
  attributeIds: readonly string[], // card fields plus the primary and groupBy
}) → BoardStore
// BoardStore: { subscribe, getSnapshot, status: 'loading' | 'ready' | 'error' | 'too-many' | 'no-columns', retry,
//               columns: [{ id: optionId | null, window: ViewStore, count: { value, atLeast }, isArchived, refusesDrop? }],
//               move(recordId, toColumnId), notes: Map<recordId, 'new' | 'no-longer-matches'> }
```

- `@crm/data/react` adds `useBoard(store)`; the screen maps each column's window to the Board's `ListSource<BoardCard>` and each body to a `BoardCard`.
- The store holds ids only; bodies stay in the one record store (spec 0006).
- Keyed like a window: (object, filter, sorts, groupBy). Two screens on the same board share it; changing the filter, sorts or grouping opens a new one and drops the old after 30 seconds unheld (spec 0006).

## Loading

1. Build the column list from the definitions store: `null`, then live options by position, then archived options by position (placed at their position among the live ones once known to hold records).
2. If more than 50 live options: status `too-many`, no request. If no options at all: `no-columns`.
3. Send `records.groups` for columns 1 to 12 with `probeArchived: true`; when it answers, columns 13 to 24 (archived ones not in `archivedHolding` are dropped from the list before batching), and so on, one call at a time, so a board never holds more than one of the workspace's 6 query slots in flight for its first load (spec 0006's cap on `records.query` and `records.count`, which `records.groups` shares; a 429 `TOO_MANY_REQUESTS` waits for its `Retry-After` and sends again). Each call is aborted when the store is dropped.
4. Each group entry seeds its column's window: block 0 = the records, its checkpoint chain starts with `nextCursor`, `count` and `atLeast` from the entry. The window is in cursor mode with blocks of 25 (`BOARD_BLOCK`); scrolling a column loads further blocks with `records.query` as spec 0006's cursor mode does.
5. A failed call (a 503 `QUERY_CANCELLED` past the call's 10 second deadline, or any other refusal) sets status `error` (the Board's failed state, "Try again" retries from the call that failed, keeping the columns already seeded). `records.groups` answers all of its groups or none, never part of them. `QUERY_CANCELLED` on a column's later block shows that column's block error through the window, not the whole board.
6. A view of kind `board` with no `config.board` (saved while the object had nothing to group by) opens no store: the screen shows AC-493's EmptyState, or fills the defaults when a groupable attribute now exists (AC-492).

## Placing cards

- **Own move** (`move(recordId, toColumnId)`):
  1. Refuse locally (no request) when the target is archived, is the null column of a required attribute, or equals the current column.
  2. Remove the id from its column's window, insert it at index 0 of the target column's placed list, adjust both counts by one, and apply the optimistic value layer (spec 0005's layering) for `groupBy` on the body.
  3. Send `records.setValues` with `{ [groupBy]: { value: optionId | null, baseVersionId } }` and a new `mutationId`.
  4. Confirmed: the response's body becomes the base; the card stays at the top of the target column (marked as the member's own row) until the member leaves the board or, after a settle, scrolls it out of view (spec 0006's own row rule). The undo entry is pushed as for any value change. If it no longer matches the filter, its note is `no-longer-matches`.
  5. Refused: drop the layer, put the id back at its old index in the old column, restore both counts, and raise the toast with the message and "Retry" (which repeats the move).
- **Others' moves**: a `records` event whose `attributeIds` include `groupBy` refetches the held body (spec 0006's batching, frame gathered). When the refetched value's column differs from the column holding the id, the id moves to index 0 of its new column at once, both counts change by one, and both columns are marked dirty. A value that points to a column not shown (an archived option not in the list) removes the card and adds that column after the next settle.
- **Creates and deletes by others**: a created record's id (from the event) is fetched with the store's attribute set; it joins the column of its value at the next settle of that column only. A delete names the record with no `attributeIds`, which by spec 0006's rule alone would fetch nothing, so the board refetches every held card an event names with no `attributeIds` (`records.get`, `groupBy` only); a read that leaves it out removes the card at once (spec 0006: a record a read leaves out is gone), drops its column's count by one and marks the column dirty. A restored record comes back the same way, at its column's settle.
- **Records the board doesn't hold**: a `records` event naming ids the board doesn't hold, whose `attributeIds` include `groupBy` or any attribute of the view's filter or sorts, may move a record into a column (from an unloaded part of another column, or into the filter). The board fetches those ids with `records.get` and `attributeIds: [groupBy]`, gathered per frame and 500 ids a call; each record returned marks the column of its value dirty. Its old column isn't known, so the next settle also rereads every column's count (one `records.groups` count call per 12 columns). A record a read leaves out is skipped.
- **Own creates** (TopBar "New <singular>" while on a board): the new card is placed first in the column of its grouping value with the note `new`, as spec 0006 places own creates in a table.

## Settling a column

- A column is dirty when a card entered or left it, a held card in it changed a value used by the filter or a sort, a record of its option was created, deleted or restored, or a record the board didn't hold was read with its option. Events that touch none of that leave every column clean, unlike a table window (which marks every window of the object dirty): the board decides per column from the refetched bodies.
- 1.5 seconds after the last change that dirtied a column (`SETTLE_MS`), while no card drag is in progress on the board and no card editor is open, the column rereads its loaded blocks from its first checkpoint with `records.query` (as a spec 0006 window does) and its count with `records.groups({ groupIds: [column], limit: 1 })`, taking only the count from the answer, so an unfiltered column keeps its exact grouped count and a filtered one its capped count.
- Coarse events for the object (spec 0006) reread every column's loaded blocks and counts, at most once a second.

## Dragging

- The Board module handles pointer, keyboard and screen reader drags (React Aria drag and drop) and calls `onMove({ cardId, fromColumnId, toColumnId })`; the screen calls `store.move`.
- While a drag is in progress the screen passes `showEmptyColumns` as the Board expects (hidden empty columns come back), and holds settles (`holdSettle(true)` on every column window) and definition changes until the drop or cancel: a `definitions` event that adds, reorders, renames or archives options of `groupBy` updates the definitions store at once, but the board keeps the column list it had when the drag began and applies the new one right after the drop or cancel. A move onto an option archived meanwhile is refused by the server (`OPTION_ARCHIVED`) and rolls back as AC-501 says.
- `isReadOnly` on the Board when the grouping attribute carries `readOnly` for this member, or the object is at `read`; the reason shows on each card through `readOnlyReason`.
- `refusesDrop` on archived columns ("Archived. Cards can't move here.", the library's existing string) and on the null column of a required attribute ("<Title> is required, so cards can't move here.").
- After a drop, the Board keeps focus on the moved card (its key is the record id) and the screen announces "Moved <Name> to <Column title>." through the toast region's polite live region.

## The engine's `queryGroups` (`packages/core/src/engine/query/groups.ts`)

Inside one `inWorkspace`, under one deadline of 10 seconds for the whole call (`GROUPS_DEADLINE_MS`): before each statement the engine sets `set local statement_timeout` to the milliseconds left (at least 1), so the statements together can't pass 10 seconds; a statement cancelled by it ends the call with 503 `QUERY_CANCELLED` and no partial answer:
1. Load the attribute; refuse unless it is status, or select with `isMulti` false; count live options and refuse past 50; refuse a group id that isn't an option of it.
2. When `probeArchived`: `select key from sort_keys where attribute_id = $1 and live and key = any($archivedOptionIds) group by key` (index only on `sort_keys`).
3. Counts: with no effective filter conditions, one `select key, count(*) from sort_keys where attribute_id = $1 and live group by key` gives every option's exact count, uncapped, and the null column is the object's live count (`records_live`) minus their sum. With a filter, `countMatches` per requested group with the column filter, capped at 10,000 (`atLeast` past it).
4. Pages: `queryPage` per requested group with the column filter, the sorts, `limit`, the clock and `attributeIds`; the access policy applies as in every page.
5. Answer the groups in the order asked.

The compiled SQL is the engine's existing `queryPage` and `countMatches` (no new compiler path); only step 2 and the unfiltered count in step 3 are new statements, both on `sort_keys` with existing indexes.

## Tests

- Engine on real Postgres: `queryGroups` against the reference evaluator for status and select, filtered and unfiltered, with archived options, empties, mixed sort directions; the 51st option refusal; another attribute's option refused; counts capped.
- Engine: the deadline covers the whole call (a slow fake column after fast ones still ends at 10 seconds with `QUERY_CANCELLED`); unfiltered counts above 10,000 are exact.
- Data layer with the fake API: batching by 12 and abort; seeding windows; a failed call keeps the seeded columns; own move and rollback with counts; others' move placement and column scoped dirtying; created and deleted records (a delete removes the card at once); an unheld record read for `groupBy` only, its column dirtied and every count reread; settle per column, and settles and definition changes held during a drag; coarse rereads; a board view with no `config.board`.
- Playwright: drag by pointer and by keyboard; two browsers; refused drops.

## Rationale (short)

Making each column a window reuses everything spec 0006 proved at a million records (cursor paging, checkpoints, memory limits, settle) instead of inventing board paging. One batched first call keeps the first paint to one round trip for ordinary pipelines. Placing a card by its option id is the one place the browser decides membership, and it is safe because the column's own condition is an exact match on a value the store already holds; everything else still settles from the server.
