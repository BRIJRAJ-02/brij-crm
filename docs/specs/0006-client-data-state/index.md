# 0006. Client data and state: one store, windows, versions and undo

**Date**: 2026-10-08
**Status**: Proposed

## Summary

This turns the thin data layer from the core loop into the full backbone every screen stands on. The browser keeps one copy of each record, loads any view (filtered, sorted, a million rows) in small windows so memory stays flat, and reads only the columns on screen. Each value now carries a version, so when two people save the same field the last save wins and the person whose value was replaced is told, with a way to put theirs back. Your last changes can be undone with Cmd+Z, live changes are batched so a busy workspace never floods the screen, and a dropped connection catches up without a reload.

## Structure

- [0006-windows.md](0006-windows.md): views keyed by their query, the two window modes (jump by position, or page by cursor with checkpoints), reading only visible attributes, how live changes settle in a sorted or filtered view, and how the store drops what nothing shows.
- [0006-versions-and-undo.md](0006-versions-and-undo.md): version ids and the record revision in every read, the base version sent with every edit, the "your value was replaced" notice, batch writes, and the undo stack.
- [0006-live-and-definitions.md](0006-live-and-definitions.md): the definitions store, record subscriptions, how events are batched, coarse events coalesced, reconnects and offline handled, and what is cleared on sign out.

Reasoning and options: see [rationale.md](rationale.md).

## Dependencies

- **#10, the core loop (spec 0005)**: this spec starts after its milestone 3. It extends `packages/data` as spec 0005 left it (the interface in `0005-data-layer.md`, the layering rule, `records.*` procedures, the outbox and relay). The record store is whichever one spec 0005's prototype gate (task 9, AC-40) picked: TanStack DB or the plain store. Nothing here depends on that choice; every behaviour below lives in our own code around the store. Spec 0005's lanes in flight already ship what this spec reads: `RecordView.versions` (the current version id per attribute), `RecordView.linkTotals` (a multi link cell carries its first 20 links, and the total when there are more), cursors bound to their object, filter and sorts (a cursor from another query answers 400 `INPUT_INVALID` naming the field `cursor`), `records.query` and `records.count` cancelled on abort and capped at 6 in flight per workspace (429 `TOO_MANY_REQUESTS`), and `records.create` refusing ids minted on a clock more than 10 minutes off.
- **#5, the data model (spec 0004)**: uses `queryPage` cursors and jumps, capped counts, `version_id`, `baseVersionId` and `replaced` (AC-12), and `setValuesBatch` (AC-13) as they are. This spec adds a record revision, an exact version precondition, and passes `attributeIds` through `queryPage`.
- **#7, change events and realtime (spec 0007)**: one owner per part. This spec owns the store, the windows, the revision rule (a read never replaces a newer one), the store's resync (refetch everything held) and coarse coalescing. Spec 0007 owns the live router (which hands each event kind to its store), the watermark (the last event applied), `realtime.catchUp`, and when a resync is needed. This spec adds `replaced` (ids only) to the `records` event, which spec 0007's `ChangeEvent` union carries. Until spec 0007 milestone 1 lands, spec 0005's subscription calls the store's resync on any gap.
- **#8, background jobs (spec 0008)**: nothing needed. Coarse events from jobs (#14, #16, #22) are handled by the coalescing built here.
- **#9, the access model (spec 0009)**: nothing built here, but the store is ready for it: a read may leave out attributes or records the viewer may not see, and the store treats "absent" as "not yours to see", never as empty. Spec 0009 refuses filters and sorts on attributes the member can't read, and its `filterEvent` removes `replaced` entries a receiver may not see.
- **#13, objects and attributes**: this spec builds the definitions store and makes `attributes.list` return options inline; #13 widens the definitions events (objects, options, reorders) and adds the writes.
- **#20, table views**: this spec owns the window mechanics (modes, checkpoints, settle, the row note) and an unsaved column sort on People; #20 adds the filter and sort UI, saved views and drafts on top, and does not rebuild them.
- **#22, bulk actions**: `records.setValuesBatch` and the undo stack are built here; #22 reuses the batch call for inline bulk edits and registers create, delete and restore with the undo stack.

**Build order across specs 0006 to 0009** (the same list in all four specs; one item at a time, each landed and checked before the next):
1. Spec 0005 milestone 3: the outbox, `outboxHook` and the `writeHooks` composer, the active and dormant relay woken by the API, the `workspace` channel.
2. Spec 0006 milestones 1 to 3.
3. Spec 0007 milestone 1: catch up from the outbox, and the outbox migration that adds every event kind.
4. Spec 0009 milestone 1: roles, the sealed scope, `@crm/core/system` (`enterAsActor`, `systemScope`), the pure policy functions.
5. Spec 0007 milestone 2: every kind of change live, each row planned through spec 0009's `filterEvent`.
6. Spec 0008 milestones 1 and 2: the job runner and the `crm_worker` login.
7. Spec 0007 milestone 3: the outbox pruned.
8. Spec 0008 milestone 3: the daily cleanup and the sleeping worker.
9. Spec 0009 milestone 2: hidden means absent.
10. Spec 0009 milestone 3 with spec 0007 milestone 4, in one release: audience channels, the stub, access changes.
11. Spec 0007 milestone 5: delivery measured at 100 and 1,000 online.

## Requirements

**User stories**:
- As a member, I want a record I edit to change everywhere it shows at once, and to go back with a clear message if the server refuses it.
- As a member, I want to scroll, sort and filter an object of a million records without the app slowing down or eating memory.
- As a member, I want to know when someone else's save replaced mine, and to put mine back in one click.
- As a member, I want to undo my last changes with Cmd+Z.
- As a member, I want my screen to stay current while my team edits, and to catch up by itself after my connection drops.

**Acceptance criteria** (numbered after spec 0005's, so every ID in the plan stays unique):

*One store*
- **AC-42**: A record shown in several places at once (two windows with different sorts, a window and a record subscription) is one body in the store. An edit made in any of them shows in all of them in the same frame. A test opens three readers of one record and asserts one body and one render per reader per change.
- **AC-43**: No code in `apps/web` reaches the network or the store directly: lint fails an import of the oRPC client, `fetch`, `@tanstack/db`, `@tanstack/react-db`, `@tanstack/react-query`, `centrifuge` or any `packages/data` module other than its public entry and `@crm/data/react`. Screens read through the layer's hooks only.

*Versions, the replaced notice and undo*
- **AC-44**: Every record read (`records.query`, `records.get`, write responses) returns the record's `revision` (new here) beside spec 0005's `versions`: for each returned attribute that has a current version (a cleared value included), that version's id. A read whose revision is lower than the one the tab holds never replaces it, so a late response never shows an older value. A multi link cell keeps spec 0005's first 20 links and its `linkTotals` count together, both from the same read.
- **AC-45**: Every value edit sends, per attribute, the version id the tab's server state held when the edit began (`null` when the attribute was never set), never one from an unconfirmed edit. The store takes the new versions from the response.
- **AC-46**: When two members save the same attribute of one record from the same starting version, the later save is kept and shown everywhere, and the member whose value was replaced sees, within 1 second, a toast: "<Name> changed <Attribute> on <Record> just after you, so your value was replaced." with "Use mine", which saves their value again as a normal edit. The member whose save won sees nothing.
- **AC-47**: No replaced notice is shown for: a save made after the member's tab already showed the other value, two saves by the same member (two tabs, or two quick edits in one tab), a retry of a save whose response was lost, a save by the system, or a replace that happened while the member's tab was offline or disconnected (a catch up carries no `replaced`).
- **AC-48**: Cmd+Z (Ctrl+Z elsewhere), pressed while focus is not in a text field or editor and no dialog is open, undoes the member's most recent confirmed value change in this tab: one cell, or every cell of one paste or range clear. The old values show at once and a toast says what was undone ("Undid Email on Jane Doe"). Repeated presses walk back through the last 50 changes in this tab and workspace. ShortcutHelp lists it. A paste or range clear of more than one cell also shows a toast with an "Undo" action when it lands.
- **AC-49**: Undo never overwrites someone else's later change: each cell is undone only if its current version is still the one the member wrote, checked on the server (`VERSION_CHANGED` otherwise). Cells changed since are kept, and the toast says how many and why ("2 cells were changed since, so they were kept"; the change may be the member's own, from another tab, so the copy never says who). An undo is an ordinary write: optimistic, rolled back with a message if refused, and live to others.
- **AC-50**: A paste or range clear over up to 500 records is one `records.setValuesBatch` call with one `mutationId`. Records that land stay; refused records roll back with their cell messages and one toast with Retry. Over 500 records the grid refuses the paste with a message (bulk jobs arrive with #22).

*Windows*
- **AC-51**: A view is asked for by its object, filter and sorts. Two screens asking for the same query share one window; changing the filter or sorts opens a new window and the old one is dropped once no screen holds it. Relative date filters resolve in the browser's time zone, against one `now` per window: taken when the window opens, refreshed at each settle, and sent with every block and count of that window, so two blocks of one window never disagree about "today".
- **AC-52**: A view with no filter and at most one sort on a stored key kind, created at, updated at or record id jumps by position: the scrollbar is sized from the exact count, and dragging it to row 600,000 of 1,000,000 shows the right rows (skeletons meanwhile) within 1 second at p95 over 20 jumps, locally on the scale seed in the capped Docker Postgres.
- **AC-53**: Any other view pages by cursor. The count shows exactly up to 10,000, otherwise "10,000+", and the scrollbar covers the count, growing past 10,000 as rows load. Scrolling ahead of the loaded rows loads forward from the last checkpoint. Blocks scrolled far away are dropped and, when you scroll back, reload from their checkpoint and match the reference evaluator when nothing changed in between. A cursor the server refuses (400 `INPUT_INVALID` naming the field `cursor`) restarts the chain from block 0 once; if that read fails too, the view shows its error state with Retry, and it never restarts in a loop.
- **AC-54**: Memory stays flat: scrolling a 1,000,000 record view from top to bottom by position, and a filtered view through 10,000 rows by cursor, keeps the JavaScript heap (after garbage collection) under 200 MB, with growth after the first 50,000 rows under 30 MB. Over the recorded performance trace of each scroll, at the grid story's scroll speed, the p95 frame time is under 16.7 ms.
- **AC-55**: Reads ask only for the attributes on screen: the view's visible columns, plus the primary attribute. A test inspects the wire and finds no other attribute. Showing a hidden column fetches just that attribute for the loaded rows. An event that names only attributes the tab doesn't hold, and no shown system column, triggers no refetch.
- **AC-56**: In a filtered or sorted view, changed values patch at once, while order and membership settle 1.5 seconds after the last change in that view (held while a cell editor is open there). A row the member edited stays where they see it until they scroll it out of view or leave; if it no longer matches the filter it carries the note "Doesn't match this view". Records the member creates show first in the view, marked new, until they leave it. The count refreshes at each settle.
- **AC-57**: On People, the default order is newest first, and the column menu's Sort ascending and descending reorder the table for this visit (unsaved; saved views are #20).

*Live, definitions and reconnects*
- **AC-58**: A screen can subscribe to one record with the attributes it needs (`records.one`); it is served from the same store, fetches only the attributes it lacks, updates live, and reports `deleted` when the record goes away elsewhere.
- **AC-59**: Objects, members and each object's attributes (with options inline) load once per workspace into one definitions store that every screen reads. A `definitions` event refetches only the attributes of the object it names. An attribute added in one browser appears as a column and in the create dialog of another within 1 second, without a reload.
- **AC-60**: Incoming events are gathered for one animation frame, then fetched with at most one `records.get` per 500 ids. Under a steady 100 events a second across 50 visible records for 10 seconds, the table's p95 frame time stays under 16.7 ms. A tab skips refetching only its own echoes: a write's `mutationId` is kept from the moment it is sent until its response arrives and then until its expected echoes have come (the response's `echoes`, one per object the write touched), or 60 seconds, whichever is first, and then dropped.
- **AC-61**: A burst of coarse events for one object refetches what the tab holds of that object at most once a second: the first at once, the trailing one after a random 0 to 2 second wait, so a hundred tabs never refetch in the same instant. The rows on screen are current within 3 seconds of the burst ending (tested with a script that writes 50 coarse rows in 10 seconds).
- **AC-62**: When the live layer (spec 0007) asks for a resync (a catch up answered `reset`, or there is no watermark to catch up from), the store refetches the definitions, every loaded block, the counts and the subscribed records once, after a random 0 to 2 second wait, with no reload. Open editors keep their drafts, pending optimistic layers stay on top of the new bases, and the paused notice clears when the refetch lands. Events the live layer recovers or catches up go through the same pipeline as live ones, so a gap never refetches everything by itself.
- **AC-63**: While the browser is offline the app says "You're offline. Changes will save when you're back." Offline means `navigator.onLine` is false, or a request failed with no response for a reason other than the app aborting it; a probe of `/api/health` every 5 seconds ends it. Edits still show at once; a write that fails for lack of a network is retried for up to 30 seconds, then rolled back with "You're offline, so this change wasn't saved." and Retry. There is no offline queue beyond that.
- **AC-64**: Signing out or switching workspace clears the store, the definitions, every window, the undo stack and the live subscription; a test finds no record of the first workspace in memory after the switch.
- **AC-65**: The proof: the two browser clash and undo flows pass with Playwright locally and against production; AC-52, AC-54, AC-60 and AC-61 are measured locally and recorded in `verify.md`.

## Decision

**Chosen option**: Option 1: extend spec 0005's data layer in place, with query keyed windows over one normalised store, a version and a record revision on every read, a server checked undo, and our own event pipeline.

The store stays whichever spec 0005's gate picked; windows, versions, undo and events are our code in `packages/data`, so the choice never reaches a screen.

Calls made here (the rationale has the runner up for each):
- The person whose value was replaced gets the notice; the winner sees nothing.
- Undo covers value changes in #6; create, delete and restore join the stack with #22. No redo in v1.
- No offline queue: writes retry for 30 seconds, then roll back. Offline use stays its own later idea in the scope.
- People gets an unsaved column sort now, so windows by cursor are visible before #20.

**Implementation skills**: `db-core` (`tanstack/db`, `.claude/skills/db-core/`) · `react-db` (`tanstack/db`, `.claude/skills/react-db/`) · `tanstack-query` (`.claude/skills/tanstack-query/`) · `tanstack-virtual` (`.claude/skills/tanstack-virtual/`) · `centrifugo` (`pedronauck/skills`, community, `.claude/skills/centrifugo/`) · `zod` (`.claude/skills/zod/`) · `drizzle` (`.claude/skills/drizzle/`) · `vitest` (`antfu/skills`, `.claude/skills/vitest/`) · `playwright-cli` (`microsoft/playwright-cli`, `.claude/skills/playwright-cli/`) · `vercel-react-best-practices` (`.claude/skills/vercel-react-best-practices/`) · house skills `crm-frontend-state`, `crm-api-backend`, `crm-data-model-access`, `crm-design-system`

## Rationale

Reasoning and options: see [rationale.md](rationale.md).

## Feature design

**Data model sketch** (one migration, milestone 1):

| Table | Change | Rules |
|---|---|---|
| `records` | new `revision` bigint not null default 0 | `revision = revision + 1` in every statement that updates a records row: `touchOwner` (every value write and near side link write), delete, restore. Adding a column with a constant default rewrites nothing. Far side link changes don't move it (spec 0004, AC-7). |
| `outbox` | new `replaced` jsonb null | `{ by: { type, id }, cells: [{ recordId, attributeId, versionId }] }`: the actor who replaced the values (the write's actor, named once) and the version each cell replaced (from `Change.values[].replaced`). At most 200 cells per row; past that the column is null (no notices for a bulk overwrite). Owner decision, 8 October 2026 (see [0006-versions-and-undo.md](0006-versions-and-undo.md)). |

No new tables. The undo stack, windows and store live only in the tab's memory.

**Engine changes** (`packages/core`):
- `readRecords` returns `revision` beside spec 0005's `versions` (attribute id to the current `version_id`, cleared markers included; record references have none in v1, see #15 in Follow-up) and `linkTotals`.
- `queryPage` takes `attributeIds` and passes them, with the attributes `prepare` already loaded, into `readRecords` (the open item on whole call cost in [0004-stored-sort-keys.md](../0004-data-model/0004-stored-sort-keys.md)).
- `ValueInput` gains `ifVersionId`: under the record lock, a current version other than it refuses `VERSION_CHANGED`, naming the attribute, and nothing on that record is written. `baseVersionId: null` means "never set": a current version then reports `replaced`.
- `canJump(filter, sorts, attributes)` moves to `@crm/contracts`, and `checkPage` uses it, so the browser and the engine share one rule.

**API surface** (oRPC on `/api/rpc`; every procedure passes the member door; refusals as `{ code, message, data?: { refusals } }`):

| Procedure | Change | Key inputs | Key outputs | Key errors |
|---|---|---|---|---|
| `records.query` | filter and sorts used; attributes chosen | `workspace`, `objectId`, `filter?`, `sorts?`, `attributeIds?` (≤ 250), `position` or `cursor`, `limit` ≤ 200, `now`, `timeZone` | `{ records: RecordView[], nextCursor? }` | 422 `FILTER_INVALID` (a bad filter, or a position on a view that can't jump); 400 `INPUT_INVALID` naming `cursor` (a cursor from another object, filter or sorts, or a malformed one, spec 0005); 429 `TOO_MANY_REQUESTS` (more than 6 in flight in the workspace, spec 0005); 503 `QUERY_CANCELLED` |
| `records.count` | filter used | `workspace`, `objectId`, `filter?`, `now`, `timeZone` | `{ count, atLeast }` | 429 `TOO_MANY_REQUESTS`, 503 `QUERY_CANCELLED` |
| `records.get` | attributes chosen | `workspace`, `ids` ≤ 500, `attributeIds?` | `RecordView[]` (missing ids left out) | 404 (workspace only) |
| `records.create` | echoes | as spec 0005 | `RecordView` plus `echoes` | as spec 0005 |
| `records.setValues` | versions, echoes | `workspace`, `recordId`, `values` `{ [attributeId]: { value, baseVersionId?: string \| null, ifVersionId? } }`, `mutationId` | `RecordView` plus `echoes` | 409 `VERSION_CHANGED`, `UNIQUE_CONFLICT`, `RECORD_DELETED`; 422 per value |
| `records.setValuesBatch` | new | `workspace`, `items` ≤ 500 `[{ recordId, values }]` (values as above), `mutationId` | `{ results: [{ recordId, record?: RecordView, refusals? }], echoes }` | 422 `CONFIG_INVALID` over 500; per record refusals in the results |
| `attributes.list` | options inline | `workspace`, `objectId` | `AttributeDefinition[]` with `options?: [{ id, label, hue, position, isArchived, outcome?, targetTimeInStage? }]` for select and status | 404 |

`RecordView` (which spec 0005 already gave `versions: Record<attributeId, versionId>` and `linkTotals`) gains `revision: number`, and `values` holds only the attributes asked for (plus the primary). Write answers gain `echoes: number`: how many outbox rows the write stored (one per object or list it touched, so how many events carry its `mutationId`); an older client ignores it. The `records` event gains `replaced?: { by: { type, id }, cells: [{ recordId, attributeId, versionId }] }` (at most 200 cells, `by` once; owner decision, 8 October 2026) in spec 0007's `ChangeEvent` union; everything else in it is spec 0007's.

**Status codes**: as spec 0005, plus 409 `VERSION_CHANGED`. A batch answers 200 with per record refusals; only a malformed or oversized batch is refused whole.

**Value sourcing**:

| Action | Value produced or displayed | Source |
|---|---|---|
| any read | `revision` | `records.revision` |
| any read | `versions` | spec 0005's read: the current `values.version_id` per attribute (all items of one write share it) |
| any read | a multi link cell and its total | spec 0005's read: the first 20 links in `values`, the full count in `linkTotals` when there are more; the store never counts links itself |
| edit | `baseVersionId` | the base layer's `versions[attributeId]` for that record; `null` when the base holds the attribute with no version |
| edit | the new versions | the response's `RecordView.versions` |
| replaced notice | whether it is ours | a cell's `replaced.cells[].versionId` is in this tab's own versions (versions returned to this tab's writes, the last 500, in memory) and the event's `replaced.by` is not the current member and not the system; an event with no list (none replaced, or more than 200 cells) raises nothing |
| replaced notice | the name | `by`: a member's name from the definitions store's members; "An API key", "An automation" otherwise (`strings.ts`) |
| replaced notice | attribute and record | the attribute title from the definitions store; the record's `display.name` from the store |
| "Use mine" | the value to save | the value this tab wrote, kept beside its own version id |
| undo | the cells and old values | the undo entry: per cell the value before and the version written, taken from the confirmed write |
| undo | the precondition | `ifVersionId` = the version written by the undone change |
| undo | depth | 50 entries per tab and workspace (`UNDO_DEPTH` in `packages/data`) |
| window | its key | object id, the canonical JSON of the filter and the sorts (attribute ids leave the key: the window's attribute set is the union of its readers') |
| window | its mode | `canJump(filter, sorts, attributes)` from `@crm/contracts` with the attribute types: in milestone 2 from spec 0005's `attributes.list` cache, from milestone 3 from the definitions store that replaces it |
| window | block size | 100 rows; a jump ahead in cursor mode reads 200 per call (`MAX_PAGE`) |
| window | which blocks stay | the visible blocks plus 5 on each side; the rest are dropped, keeping their checkpoint |
| window | a checkpoint | the `nextCursor` that ended the block before (the first block has none) |
| window | the count and its label | `records.count`: `count`, and "10,000+" when `atLeast` |
| window | the scroll height | position mode: `count`; cursor mode: `count`, or 10,000 plus the rows loaded past it when `atLeast` |
| `records.query`, `records.count` | `now`, `timeZone` | `now`: one `Date.now()` per window, taken when the window opens, refreshed at each settle, and sent with every block and count of that window; `timeZone`: `Intl.DateTimeFormat().resolvedOptions().timeZone`; week start Monday until #23 adds a workspace setting |
| window | attributes to read | the screen's visible column ids plus the object's `primaryAttributeId` |
| settle | its delay | 1.5 seconds after the last change in the window (`SETTLE_MS`) |
| row note | "Doesn't match this view" | the member's own edited or created rows missing from the settled blocks |
| People | default order | `created_at` descending; the column menu sort replaces it for the visit |
| store | when a body is dropped | no window block, subscription, pending write or open editor holds it for 30 seconds, or more than 2,000 unheld bodies exist (oldest first) |
| definitions | objects, attributes, members | `objects.list`, `attributes.list` (options inline), `members.list` |
| events | the batch | ids gathered until the next animation frame (a 50 ms timer while the tab is hidden) |
| coarse events | the rate | at most one refetch per object per second (`COARSE_MS`): the leading one at once, the trailing one after a random 0 to 2,000 ms (`JITTER_MS`) |
| own echoes | which events to skip | `mutationId`s this tab sent, each kept from send until its response, then until `echoes` events with it have arrived (from the write's answer), or 60 seconds (`ECHO_TTL_MS`), whichever is first |
| resync | when | spec 0007's live layer asks for it (a `reset` catch up, or no watermark); it runs after a random 0 to 2,000 ms (`JITTER_MS`) |
| reconnect | recovered, caught up or resynced | spec 0007's live layer: Centrifugo's `recovered` flag, the watermark and `realtime.catchUp` |
| offline | the state | `navigator.onLine` with its `online` and `offline` events, and a `fetch` that fails with no response and was not aborted by the app (an `AbortError` from our own `AbortController` never counts); a `GET /api/health` probe every 5 seconds ends it (`/api/health` never touches the database) |
| undo shortcut | Apple or not | `navigator.userAgentData.platform` when the browser has it, else `navigator.platform`, matched against macOS, iOS and iPadOS: Cmd+Z there, Ctrl+Z elsewhere |
| undo shortcut | a dialog is open | the key event's target is inside the library's `Modal` (any variant renders a React Aria `role="dialog"` element, and React Aria keeps focus inside an open Modal, so a key pressed while one is open always comes from inside it): `target.closest('[role="dialog"], [role="alertdialog"]')` |
| offline write | retries | after 1, 2, 4, 8 and 15 seconds (30 in all), then rollback |

**Key invariants**:
- One body per record id; windows hold ids only; screens get bodies through selectors.
- A body's attributes are the union of what reads returned. An attribute never read is unknown, not empty, and a cell never shows it as empty.
- The base changes only by a read with a revision at least the held one; optimistic layers sit on top and are dropped only by their own response or echo (spec 0005's rule).
- `baseVersionId` always comes from the base, never from a layer.
- The undo stack holds only this tab's own confirmed writes, and every undo is checked on the server.
- Applying an event twice only refetches twice; it never changes state by itself.
- Ordering stays on the server. The browser never sorts or filters records; it only places ids the server returned.
- A record the server leaves out of a read is gone for this viewer: dropped from every window and subscription.
- A multi link cell shows the links and the total its read returned; the store never adds or counts links on its own.
- A `mutationId` is skipped only while its write is in flight or its echoes are still due, never for longer than 60 seconds.
- Every refetch many tabs may start at once (a trailing coarse refetch, a resync) waits a random 0 to 2 seconds first.

**Security model**:
- Nothing new is trusted from the client: filters and sorts compile through the engine's parameterised compiler (spec 0004, AC-14), cursors are validated by `decodeCursor`, and `attributeIds` that don't belong to the object are ignored, not refused, so they reveal nothing.
- `ifVersionId` is checked under the record lock in the write transaction; a client can't undo over another member's change.
- The `replaced` list carries ids only (record, attribute, version, actor). Today every member may read everything; spec 0009's `filterEvent` removes the entries an audience may not see, with the rest of the event (spec 0007 milestone 4).
- The store holds one workspace at a time and is cleared on sign out and workspace switch (AC-64). Nothing record related goes to `localStorage`.
- Spec 0009 refuses a filter or a sort on an attribute the member can't read, since order and membership would reveal its values.
- `security-access-reviewer` reviews milestone 1 (the precondition and the event change); `state-performance-reviewer` reviews every milestone.

**Configuration required**: none. No new environment variables or services.

**Critical test scenarios**:
- Clash: two browsers edit one cell from the same version; the later save shows in both; the earlier saver gets the toast and "Use mine" puts their value back; sequential edits, two tabs of one member and a retried save raise nothing, verifies **AC-44** to **AC-47**.
- Late response: a refetch with revision 7 arrives, then a confirmation with revision 6; the cell keeps revision 7's value; a multi link cell keeps its 20 links and total from the same read, verifies **AC-44**.
- Undo: edit, paste 40 cells, Cmd+Z twice; then another member changes 2 of the pasted cells and a third undo keeps those 2 with the toast; a refused undo rolls back, verifies **AC-48**, **AC-49**, **AC-50**.
- Windows: the reference evaluator against position jumps and cursor chains on every sort kind, with evicted blocks reloaded from checkpoints; two screens on one query share a window; every block of a window carries the same `now`; a refused cursor restarts once, then shows the error state, verifies **AC-51** to **AC-53**.
- Scale: the million record seed, scroll top to bottom and jump 20 times; heap sampled every 50,000 rows; frame times recorded, verifies **AC-52**, **AC-54**.
- Payload: the wire holds only visible attributes; a hidden column shown fetches one attribute; an event for an unheld attribute fetches nothing, verifies **AC-55**.
- Settle: another member renames a record so it sorts elsewhere; it moves 1.5 seconds later; the member's own edited row that leaves the filter stays with its note; an own create sits first, verifies **AC-56**, **AC-57**.
- Live: a record page and the table on one record; event bursts (fine and coarse, the trailing refetch jittered); own echoes skipped while due and fetched after 60 seconds; a resync asked for by the live layer refetches once with editors and layers kept, verifies **AC-42**, **AC-58** to **AC-62**.
- Offline: devtools offline, an edit, back online within 30 seconds (saved) and after (rolled back); an aborted request never turns the app offline; the probe hits `/api/health`, verifies **AC-63**.
- Isolation: sign out and switch workspace, then search the store and windows for the first workspace's ids, verifies **AC-64**.
- Lint: a fixture screen importing each banned module fails, verifies **AC-43**.

## Build plan

Tracer Bullet: each milestone ends with something you can click in production. Milestone 1 runs one version through every layer before windows change.

**Milestone 1: versions, the replaced notice and undo**
1. Migration: `records.revision`, `outbox.replaced`. Engine: revision bumped in `touchOwner`, delete and restore; `readRecords` returns `revision` beside spec 0005's `versions` and `linkTotals`; `ifVersionId` with `VERSION_CHANGED`; `baseVersionId: null`. Guard tests and engine tests on real Postgres, satisfies **AC-44**, **AC-49**
2. Contracts and procedures: `RecordView.revision`, `echoes` on write answers, the version inputs on `records.setValues`, the new `records.setValuesBatch` (one composer, one outbox row per object; a retried batch writes nothing twice, because an unchanged value writes nothing), and the outbox hook filling `replaced`, satisfies **AC-44**, **AC-45**, **AC-46**, **AC-50**
3. Data layer: the revision rule on the base (links and `linkTotals` kept together), `baseVersionId` from the base, the tab's own versions, own echoes kept only while due, the replaced notice and "Use mine", satisfies **AC-44** to **AC-47**, **AC-60**
4. The undo stack, `data.undo.run()`, the shortcut in the workspace frame, the ShortcutHelp entry, paste and range clear through `setValuesBatch` with the "Undo" toast, satisfies **AC-48**, **AC-49**, **AC-50**
5. Two browser Playwright flows (clash, undo) locally and against production; `security-access-reviewer` and `state-performance-reviewer` before it lands, satisfies **AC-46**, **AC-47**, **AC-48**, **AC-65**

**Milestone 2: windows over a million records**
6. Engine and procedures: `attributeIds` through `queryPage` and `records.get`; filter and sorts on `records.query` and `records.count`; `canJump` in contracts (fed attribute types from spec 0005's `attributes.list` cache until milestone 3); the query clock from the browser, one `now` per window, satisfies **AC-51**, **AC-52**, **AC-53**, **AC-55**
7. Windows keyed by query, both modes, checkpoints, the jump ahead, block eviction, the one time restart on a refused cursor, and the store's reference counted drop, satisfies **AC-42**, **AC-51** to **AC-54**
8. Visible attributes: the union per window, fetch on show, the event intersection, satisfies **AC-55**
9. Settle: dirty windows, the 1.5 second idle, the editor hold, own rows kept in place, own creates first, the count refresh, and the grid's row note (a DataGrid variant, `design-system-guardian` review), satisfies **AC-56**
10. People: newest first, the column menu sort, "10,000+"; the million record proof locally (jumps, heap, frames) into `verify.md`; `state-performance-reviewer` and `ux-interaction-reviewer`, satisfies **AC-52**, **AC-54**, **AC-57**, **AC-65**

**Milestone 3: live everywhere, definitions and reconnects**
11. The definitions store (objects, members, attributes with options inline) replacing spec 0005's per call caches (window modes then read their types from it), refetched by `definitions` events, satisfies **AC-59**
12. `records.one` subscriptions over the same store, satisfies **AC-42**, **AC-58**
13. The event pipeline behind spec 0005's subscription (spec 0007 later puts its live router in front): frame batching, own echoes, coarse coalescing with jitter, the store's resync (called by spec 0005's gap and unrecovered path until spec 0007 milestone 1 replaces that path with catch up), the offline notice with the `/api/health` probe and write retries, clearing on sign out and switch, satisfies **AC-60** to **AC-64**
14. Lint: the extended ban list in `packages/config` with fixture tests, satisfies **AC-43**
15. The burst script, the frame time and coalescing measurements, the production run of every flow, `verify.md`; reviewers before it lands, satisfies **AC-60**, **AC-61**, **AC-65**

## Consequences

**Positive**:
- Every later screen (record page, board, saved views, search, bulk actions) plugs into one store and one window model instead of building its own.
- Clashes are visible and recoverable without locks or merges.
- Payloads shrink to what is on screen, which also removes most of spec 0004's whole call cost.

**Negative / tradeoffs**:
- Version ids (spec 0005's `versions`) add about 40 bytes per shown cell to every read (roughly 40 kB raw for 100 rows of 10 columns before compression); #12 measures it.
- A cursor view can't jump: dragging far into a filtered view loads every block in between, up to 50 calls for 10,000 rows.
- Settling after 1.5 seconds means a sorted view is briefly out of order while others edit; the member's own rows can sit in the wrong place until they scroll away.
- Undo is per tab and in memory: a reload forgets it, and creates and deletes can't be undone until #22.
- No offline queue: a change made offline for more than 30 seconds is lost (with a message).
- The `replaced` list widens what the shared channel tells every member until spec 0009's `filterEvent` runs per audience (spec 0007 milestone 4).
- A tab that was offline when its value was replaced never hears of it: a catch up collapses events and carries no `replaced`.
- Jitter adds up to 2 seconds before a coarse view or a resync is current.
- Far side link changes don't move a record's revision, so a late read could briefly show an older link list; relation cells stay read only until #15.

**Neutral**:
- One migration (two columns). One new procedure (`records.setValuesBatch`), one new refusal code (`VERSION_CHANGED`), one new answer field (`echoes`).
- `canJump` moves from the engine to contracts.
- A new DataGrid row note variant in the library.

## Follow-up

- [ ] **#15**: version ids and the replaced notice for relation cells (links have their own versions), and a revision bump on the far record if late link reads show up in practice.
- [ ] **#20**: the filter and sort UI and saved views build on these windows; replace People's unsaved sort with the view draft.
- [ ] **#22**: register create (undo by delete), delete (undo by restore of its batch) and bulk edit jobs with the undo stack; jobs over 500 records.
- [ ] **Spec 0009**: `filterEvent` removes `replaced` entries per audience; filters and sorts on hidden attributes are refused; reads leave hidden attributes out, which the store already treats as unknown.
- [ ] **#12**: measure read payload size with versions, settle refetch cost at 100 online, and coarse refetch load during a bulk job.
- [ ] **#23**: the workspace week start for relative date filters.
- [ ] **#28**: a lasting notification for a replaced value when the member's tab was closed.
- [ ] Spec 0005's open item for #6 (version ids, filtered windows, visible attributes) is covered here; `/sync` should tick it.
- [ ] `/sync`: spec 0005's data layer says "a new record goes at the end" of the People table, in id order; AC-57 supersedes it with newest first (`created_at` descending), and own creates show first (AC-56). Record it in `0005-data-layer.md` and `packages/data/AGENTS.md`.
- [ ] `/sync`: spec 0005's gap and unrecovered refetch becomes the store's resync, called by spec 0007's live layer; record it in `packages/data/AGENTS.md`.
- [ ] `packages/data/AGENTS.md` should list `db-core`, `react-db`, `tanstack-virtual` and `centrifugo` under its agent skills (area scoped, not root).

## Owner decisions

- **8 October 2026**: the `replaced` list names `by` once per event and holds at most 200 cells; past that an event carries no list and tabs only refetch, with no notice. Recorded in [0006-versions-and-undo.md](0006-versions-and-undo.md#owner-decisions).

## Open questions for the owner

None. Every call in this spec follows the owner decisions of 3 October 2026 or a recommendation already taken in the cross check of 8 October 2026.
