# 0021. Board view

**Date**: 2026-10-08
**Status**: Proposed

## Summary

Any view of any object can show as a board: one column per option of a status or single select attribute, plus a "No <attribute>" column, with cards you drag between columns to change that attribute. Cards are ordered by the view's sorts (there is no hand made order), each column loads 25 cards at a time, and every move shows at once for you and within a second for everyone else. A board is just a saved view with `kind: 'board'` (spec 0020), so filters, drafts, sharing and locks work the same way, and moves are ordinary value edits with undo and the "your value was replaced" notice from the client data layer (spec 0006).

## Structure

- [0021-columns-and-moves.md](0021-columns-and-moves.md): how the board loads (`records.groups`), how each column is a window, where a card goes when you or someone else moves it, how columns settle, and the drag flow from pick up to confirm or roll back.

Reasoning and options: see [rationale.md](rationale.md).

## Dependencies

| Feature | What this spec needs | Thin slice built here when it is missing |
|---|---|---|
| #20 saved views (spec 0020) | the `views` table, `ViewConfig.board`, `views.setLayout`, the draft and Save flow, the view screen and its bars | none: a hard prerequisite. Milestone 1 starts after spec 0020's milestone 2 |
| #6 client data (spec 0006) | windows in cursor mode, settle, own rows kept in place, the definitions store with options inline, the undo stack, the replaced notice, `RecordView.versions` | none: a hard prerequisite |
| #13 objects and attributes (spec 0012) | status and select attributes with options (label, hue, position, archived, target time in stage), the create attribute dialog for the empty state | if #13 hasn't landed, boards work on the template's status and select attributes (Deals' Stage) and the empty state shows no "Add attribute" |
| #9 access (spec 0009) | `readOnly: { reason }` on attributes, object levels, field `write` for a move | none: until #24, every member can move every card; the read only path is tested with injected rules |
| #15 or #17 record panel | `?record=<id>` to open a card | if neither has landed, a card's Enter and click do nothing and the card name is plain text |
| #8 jobs | none | |
| #12 load harness (spec 0011) | the `crm` seed (250,000 Deals with Stage); `SCALE_BUDGET.p95Ms.boardFirstLoad` (600 ms, added to spec 0011's budget by this spec's Follow-up) | AC-510 is measured on the local capped stack; `pnpm db:seed:scale` stands in if `packages/load` doesn't exist yet. Until spec 0011 adds the key, milestone 3 adds `boardFirstLoad` to `SCALE_BUDGET` itself, and the harness reads it from there |

## Requirements

**User stories**:
- As a member, I want to see a pipeline as columns by stage and drag a deal to its next stage, so moving work forward is one gesture.
- As a member, I want to see my teammates' moves on my board as they happen, so we never move the same deal twice.
- As a member, I want each board to choose which fields its cards show and whether empty stages show.
- As a member, I want a card I can't change to say why, instead of letting me drag it and failing.
- As a member, I want to see which deals have sat in a stage too long.

**Acceptance criteria** (this spec owns AC-492 to AC-521):

*Showing a board*
- **AC-492**: The ViewBar's Table and Board switch (SegmentedControl) changes the view's kind for everyone on it, saved at once with the layout rules of spec 0020 (on a locked view, without `views.manage`, the switch applies to this visit only). The first time a view becomes a board it groups by the object's first live status attribute by position, else its first live single select, and shows its first 3 non system, non primary attributes other than that one as card fields. When the object has no status or single select attribute, the switch still saves `kind: 'board'`, with no `config.board`, and the board shows AC-493's EmptyState; the first time that view opens as a board with a groupable attribute, it fills the defaults above (saved like any layout change by a member who may edit the view, else for this visit only). Switching a board back to Table keeps `config.board`, so switching again restores the same board.
- **AC-493**: An object with no status or single select attribute shows the EmptyState "<Plural> have no status or select field to group by." with "Add attribute" (opening spec 0012's dialog) for members with `schema.manage`, and nothing more for others.
- **AC-494**: Columns: a "No <attribute title>" column first (records with no value), then one per live option in option position order with its label, hue and card count. An archived option's column shows, muted and in its position, only while any live record holds that option, and never takes a drop. A grouping attribute with more than 50 live options shows the EmptyState "Boards show up to 50 columns. <Title> has <N> options." with "Group by another field" for members who may edit the view.
- **AC-495**: Each column shows its first 25 cards in the view's sort order (newest first when the view has no sorts; there is no manual order and no reordering within a column), and loads 25 more as it scrolls. With no filter, every column's count is exact, however large; with a filter, a count is exact up to 10,000, else "10,000+".
- **AC-496**: A card shows the record's name and the view's card fields (up to 6), each through its type's display on the card surface. View settings on a board holds "Group by" (a Select of the object's live status and single select attributes), "Show empty columns" (a Switch) and "Card fields" (ViewSettings, the name locked), each saved at once with the view.
- **AC-497**: With "Show empty columns" off, columns with no cards hide behind "N hidden columns"; while a card is being dragged, hidden empty columns show so there is always a place to drop. The setting is per view (on by default).
- **AC-498**: The view's filter, sorts, draft, Save and Save as new view (spec 0020) work on a board unchanged: the filter applies to every column and the counts follow it.
- **AC-499**: The board has every state: loading (skeleton columns after the loading delay), error with "Try again", not found (spec 0020's; an object the member can't read answers not found on the route first), no columns (an attribute with no options yet: "Nothing to group by yet. Add options to this attribute to make columns."), an empty column ("No cards").

*Moving cards*
- **AC-500**: Dragging a card to another column (pointer, keyboard or screen reader) writes the grouping attribute to that column's option, or clears it on the "No <attribute>" column. The card shows at the top of the target column at once, both counts change by one, and it stays at the top until the member leaves the board or scrolls it out of view after the column settles. A card whose new value no longer matches the view's filter stays with the note "Doesn't match this view".
- **AC-501**: A refused move puts the card back in its old column and place, restores both counts, and shows a toast with the server's message and "Retry" (for example `VALUE_REQUIRED`, `OPTION_ARCHIVED`, `RECORD_DELETED`, `ATTRIBUTE_READ_ONLY`, `FORBIDDEN`). A move made offline follows spec 0006 AC-63.
- **AC-502**: A read only grouping attribute can't be dragged: when the member can't write it (a read only field or object per spec 0009, or a read only reason from the definitions), the board shows no drag handles, and each card's LockReason shows the reason on hover and keyboard focus. A required grouping attribute's "No <attribute>" column never takes a drop and says "<Title> is required, so cards can't move here." while a card is moving.
- **AC-503**: Another member's move shows on this board within 1 second at p95: the card leaves its old column and appears at the top of its new column (placed by its new option id), and both counts change; 1.5 seconds after the last change in a column it settles into sort order. A card deleted by others leaves its column within 1 second at p95 and its count drops; cards created by others appear at the settle of their column. A record the board doesn't hold that changes into a column (its grouping value, or a value the filter or sorts use) appears there at that column's settle, within 1.5 seconds of the last change. Only the columns a change touches reload, plus every column's count when the old column of such a record isn't known.
- **AC-504**: Cmd+Z (Ctrl+Z) after a move puts the card back in its old column, as spec 0006 undoes any value change ("Undid Stage on Acme renewal"); a card moved by someone else since is kept, with spec 0006's message.
- **AC-505**: When two members move one card from the same starting stage, the later move wins on every screen, and the member whose move was replaced gets spec 0006's toast with "Use mine".
- **AC-506**: Option changes show live: an option added, renamed, recoloured, reordered or archived by an admin (spec 0012) changes the columns within 1 second without a reload. While a card is being dragged, column changes from the definitions wait until the drop or cancel, as settles do, so the drop target never moves under the pointer. If the grouping attribute is archived, the board shows a Callout "<Title> is archived. Pick another field to group by." and the "Group by" Select (for members who may edit the view); if it becomes hidden from the member, the view is absent for them (spec 0020 AC-479).

*Breadth and proof*
- **AC-507**: On a status board, a card whose record has been in its current stage longer than that stage's target time shows a warning Badge "Stuck <N>d", with the tooltip "In <Stage> for <N> days. The target is <T> days." The time in stage starts when the record's current status value was set; the badge updates as the day passes, with no request.
- **AC-508**: Boards work on every object (standard and custom) and on single select attributes the same way as on status, except that select options have no target time (no stuck badge). Multi select attributes are not offered to group by.
- **AC-509**: Enter on a card, or a click on its name, opens the record panel (`?record=<id>`) when spec 0014's or #17's panel exists. After a move, focus follows the card to its new column, and a screen reader hears "Moved <Name> to <Column>."
- **AC-510**: On the local capped stack with the `crm` seed and 100 simulated members online, a Deals board by Stage shows every column's first 25 cards and counts within 600 ms at p95 end to end (`SCALE_BUDGET.p95Ms.boardFirstLoad`, the owner's accepted target for a board's first load, twice the 300 ms read, since one call reads a page and a count for each of up to 12 columns), unfiltered and with the benchmark's select filter; each next 25 cards in a column within 300 ms; a drag's write within the 250 ms edit budget. Results in `verify.md`.
- **AC-511**: Every new screen part works by keyboard with a visible focus ring, meets contrast in light and dark, and passes `ux-interaction-reviewer`, `design-system-guardian` and `dxe quick`. The flows run with two browsers in Playwright, locally and against production: a drag seen live in the other browser, a refused drag, a read only board, undo, and Show empty columns. Results in `verify.md`.

## Decision

**Chosen option**: Option 1: a board is a view whose columns are windows, one per option, ordered by the view's sorts; the first page of every column comes from one `records.groups` call per 12 columns, moves are ordinary optimistic value writes, and other people's moves are placed by the card's new option id at once and settled by the server shortly after.

Calls made here (the rationale has the runner up for each):
- **No manual card order** (brief). Cards follow the view's sorts; a hand made rank would be a second ordering system on every record.
- **Group by status or single select** (brief). Multi select is left out: one card in several columns breaks "a move is one write".
- **At most 50 live options per board**. Beyond that a board is unreadable and its first load can't meet the budget.
- **"No <attribute>" column first**, so cards still missing a stage sit where work starts.
- **Show empty columns on by default** per view, so a pipeline shows every stage.
- **Default card fields: the first 3 eligible attributes by position**, at most 6 (brief).
- **A moved card sits at the top of its new column** until it settles (brief), the same "your rows don't jump" rule as tables.
- **Stuck is computed in the browser** from when the current stage was set and the option's target, so nothing runs on a timer.

**Implementation skills**: `react-aria` (`.claude/skills/react-aria/`) · `db-core` and `react-db` (`tanstack/db`, `.claude/skills/db-core/`, `.claude/skills/react-db/`) · `tanstack-virtual` (`.claude/skills/tanstack-virtual/`) · `zod` (`pproenca/dot-skills`, `.claude/skills/zod/`) · `drizzle` (`.claude/skills/drizzle/`) · `vitest` (`antfu/skills`, `.claude/skills/vitest/`) · `playwright-cli` (`microsoft/playwright-cli`, `.claude/skills/playwright-cli/`) · `fluid-design` and `interaction-design` (`.claude/skills/`) for the drag · house skills `crm-frontend-state`, `crm-design-system`, `crm-api-backend`, `crm-data-model-access`

## Rationale

Reasoning and options: see [rationale.md](rationale.md).

## Feature design

### Data model sketch

No migration. A board is a `views` row with `kind = 'board'` and `config.board` (spec 0020's `BoardConfig`): `{ groupByAttributeId, cardFields (≤ 6 attribute ids), showEmptyColumns }`. Config checks on write, added to spec 0020's: `groupByAttributeId` is a live status or single select (`isMulti` false) attribute of the view's object (else `CONFIG_INVALID` "Boards group by a status or single select field."); `cardFields` are attributes of the object, at most 6, each once, never the primary attribute.

`RecordView` (spec 0006) gains `since?: Record<attributeId, string>`: for each returned status attribute with a current value, the `active_from` of its current version (ISO 8601 UTC). Read in the same statement that reads the values (`readRecords`), so no extra query.

### API surface

| Procedure | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|
| `records.groups` (new) | `workspace`, `objectId`, `groupBy` (attribute id), `groupIds` (1 to 12 entries, each an option id or `null` for "no value"), `filter?`, `sorts?`, `attributeIds` (≤ 250), `limit` 1 to 50 (default 25), `probeArchived?` boolean, `now`, `timeZone` | `{ groups: [{ id: optionId \| null, records: RecordView[], nextCursor?, count, atLeast }], archivedHolding?: optionId[] }` in the order asked | member, object `read`, field `read` on `groupBy` | 404; 422 `CONFIG_INVALID` (not a status or single select, more than 50 live options, an option of another attribute), `FILTER_INVALID`; 429 `TOO_MANY_REQUESTS`; 503 `QUERY_CANCELLED` when the whole call passes its 10 second deadline (no partial answer) |
| `records.query`, `records.count` (spec 0006) | the column's filter: the view filter and the group condition | unchanged | as spec 0006 | as spec 0006 |
| `records.setValues` (spec 0006) | the grouping attribute set to an option id, or `null` to clear; `baseVersionId` | `RecordView` | member, field `write` | 409 `VERSION_CHANGED` is never sent for a move (no `ifVersionId`); 409 `RECORD_DELETED`; 422 `VALUE_REQUIRED`, `OPTION_ARCHIVED`, `ATTRIBUTE_READ_ONLY`; 403 `FORBIDDEN` |
| `records.get`, `records.query` (changed) | as before | `RecordView.since` for returned status attributes | as before | as before |

The group condition (`groupCondition(groupBy, id)` in `@crm/contracts`): `{ attributeId: groupBy, operator: 'is', value: optionId }`, or `{ attributeId: groupBy, operator: 'is_empty' }` for `null`; joined with the view's effective filter as `{ conjunction: 'and', conditions: [filter, condition] }`.

### Library changes (variants, `design-system-guardian` before they land)

| Component | Change | Why a variant |
|---|---|---|
| `BoardColumn` (Board types) | `refusesDrop?: { reason: string }` generalises `isArchived`'s "never a drop target" with its own reason | the archived column already refuses drops; a required attribute's empty column needs the same behaviour with another reason, not a second column style |
| `KanbanCard` | `note?: 'new' \| 'no-longer-matches'` drawn like the DataGrid's row note (spec 0006) | the board needs the same two notes the grid has; reusing the grid's note look keeps one design |
| `KanbanCard` | `badge?: { label, tone: 'warning', description }`, a `Badge` with its description in a Tooltip | the stuck flag; Badge already exists, the card only needs a slot for it |

Each with a story per state, README lines, and the artifact publish with the next `pnpm ui:artifact`.

### Value sourcing

| Action | Value produced or displayed | Source |
|---|---|---|
| first switch to board | `groupByAttributeId` | the first live attribute by `position` with type `status`, else type `select` and `isMulti` false, from the definitions store |
| first switch to board | `cardFields` | the first 3 live attributes by `position` that are not system, not primary and not the grouping attribute |
| first switch to board | `showEmptyColumns` | `true` |
| columns | which and in what order | `null` first, then the grouping attribute's options (definitions store, options inline) by `position`; archived ones only when in `archivedHolding` |
| columns | title and hue | the option's `label` and `hue`; the null column's title "No <attribute title>" |
| columns | "too many options" | count of live options > `BOARD_MAX_COLUMNS` (50, `@crm/contracts`) |
| first load | which columns per call | columns in order, 12 per `records.groups` call (`BOARD_GROUPS_PER_CALL`), calls sent one after another left to right, the first with `probeArchived: true` |
| first load | `archivedHolding` | one probe of `sort_keys`: archived option ids of that attribute with at least one `live` key row |
| column | first cards and `nextCursor` | `records.groups` group entry (`queryPage` with the column filter, `limit` 25) |
| column | later cards | `records.query` from the column's last checkpoint, 25 per block (`BOARD_BLOCK` in `packages/data`) |
| column | count, unfiltered | exact, uncapped: one grouped count over `sort_keys` (live rows of the attribute, by key) for option columns; the null column = the object's live record count minus the sum over every option key |
| column | count, filtered | `countMatches` with the column filter, capped at 10,000 |
| column | count after a local move | the held count minus or plus 1 until the next settle replaces it |
| `records.groups` | its deadline | 10 seconds for the whole call (`GROUPS_DEADLINE_MS` in `packages/core`): before each statement the engine sets `statement_timeout` to the time left, so a slow column can't stretch the call; past it, 503 `QUERY_CANCELLED` and the call answers nothing |
| card | name | the record's `display.name` (spec 0004 AC-19) |
| card | fields | `config.board.cardFields` minus archived and hidden ones, values from the store, displays from the field set's `card` surface |
| card | read only reason | the grouping attribute's `readOnly.reason` (spec 0009) for the whole board; per card none in v1 (the prop is wired for #24) |
| move | the value written | the target column's option id, or `null` for the no value column |
| move | `baseVersionId` | the base's `versions[groupBy]` for that record (spec 0006) |
| move | `mutationId` | uuid minted in the browser |
| move | allowed targets | live option columns, and the null column unless the attribute `isRequired`; archived columns never |
| others' move | the new column | the refetched body's value of `groupBy` (option id or empty) |
| stuck | time in stage | `now` from the UiProvider clock minus `RecordView.since[groupBy]` |
| stuck | the target | the option's `targetTimeInStage` (days) from the definitions store; no badge when unset or on a select |
| stuck | when it is shown | time in stage > target; `N` = whole days in stage (floor), `T` = target days |
| live | which columns reload | the old and new column of each moved card, and the column of each created, deleted or restored record (its option from the refetched or held body) |
| live | an unheld record that may enter | a `records` event naming ids the board doesn't hold, whose `attributeIds` include `groupBy` or an attribute of the view's filter or sorts: `records.get` of those ids with `attributeIds: [groupBy]` (gathered per frame, 500 ids a call, spec 0006); each returned record dirties the column of its value, and, since its old column isn't known, every column's count is reread at the next settle |
| live | a held card deleted by others | an event naming a held card with no `attributeIds` (a delete or restore names none) refetches it with `records.get` (`groupBy` only); a read that leaves it out removes the card at once and dirties its column |
| live | definition changes during a drag | the options of `groupBy` from a `definitions` event are applied to the columns at the drop or cancel, not during the drag |

### Key invariants

- A board writes nothing but the grouping attribute through `records.setValues`; there is no board specific write path and no stored card order.
- Ordering inside a column stays on the server. The browser decides only which column a card is in, from the one value it holds exactly (the grouping attribute); every other filter condition is decided by the server at settle.
- A card shows in exactly one column of a board at a time.
- Archived columns and a required attribute's no value column never take a drop.
- A board makes no request while nobody acts; the stuck badge ticks from the clock.

### Security model

- `records.groups` passes the member door and the same compiler checks as `records.query`: a hidden grouping attribute or filter attribute is refused `FILTER_INVALID`, and records outside a record rule are absent from pages and counts (spec 0009). `archivedHolding` reads `sort_keys` inside `withWorkspace` and only for the grouping attribute; under a record rule (#24) it is computed through the compiled predicate instead, so a hidden record never makes a column appear.
- A move is an ordinary value write with field `write` checked by the engine; the client's missing handles are only a convenience.
- `security-access-reviewer` reviews milestone 1 (`records.groups`); `state-performance-reviewer` reviews every milestone.

### Configuration required

None.

### Critical test scenarios

- No grouping field: switch a custom object with no status or select to Board; the EmptyState shows; add a status attribute and the view fills its defaults; switch back to Table and again to Board and the same board returns, verifies **AC-492**, **AC-493**.
- Live breadth: another browser deletes a held card (it leaves at once), moves a record this board never loaded into a column (it appears at that column's settle with the counts reread), and an admin reorders options during a drag (the columns change only after the drop), verifies **AC-503**, **AC-506**.
- Happy path: switch Deals' default view to Board; columns by Stage with counts; drag a card two columns; a second browser sees it move within a second and settle; Cmd+Z puts it back, verifies **AC-492**, **AC-494**, **AC-495**, **AC-500**, **AC-503**, **AC-504**.
- Refusal: move to an archived stage (no drop), to the no value column of a required Stage (no drop), and a move refused by the server (the record deleted elsewhere first); each card returns with its toast, verifies **AC-501**, **AC-502**.
- Read only (rules injected): Stage read only for a member; no handles, the reason on focus, verifies **AC-502**.
- Clash: two browsers move one card from the same stage; the later wins; the earlier mover gets "Use mine", verifies **AC-505**.
- Definitions: add, rename, reorder and archive options while the board is open; archive the grouping attribute, verifies **AC-494**, **AC-506**.
- Settings: Group by, card fields (7th refused by the list), Show empty columns hidden and shown during a drag, verifies **AC-496**, **AC-497**.
- Stuck: a deal in Proposal (target 7 days) set 12 days ago (the test seeds `active_from`) shows "Stuck 12d"; one set 3 days ago shows nothing; a select board shows none, verifies **AC-507**, **AC-508**.
- Scale: the first load and next blocks on the local capped seed with 100 members online, verifies **AC-510**.

## Build plan

Tracer Bullet: milestone 1 shows a real board from the database in production, read only; milestone 2 makes it move; milestone 3 adds the rest and proves it.

**Milestone 1: a read only board**
1. Contracts: `BoardConfig` checks, `groupCondition`, `BOARD_MAX_COLUMNS`, `BOARD_GROUPS_PER_CALL`, the `records.groups` contract, satisfies **AC-492**, **AC-494**
2. Engine: `queryGroups(scope, input)` in `packages/core/src/engine/query/groups.ts` (new): the archived probe, the grouped count over `sort_keys` for unfiltered views, `countMatches` per column for filtered ones, `queryPage` per column, all in one `inWorkspace` under one 10 second deadline for the whole call; tests against the reference evaluator; access table entry, satisfies **AC-494**, **AC-495**, **AC-498**
3. API: `records.groups` in the records router, satisfies **AC-494**
4. Data layer: `records.board(workspace, objectId, { groupBy, filter, sorts, attributeIds })` returning a `BoardStore` whose columns are spec 0006 windows (cursor mode, block 25) seeded from `records.groups`, see [0021-columns-and-moves.md](0021-columns-and-moves.md), satisfies **AC-495**, **AC-498**
5. Screen: the Table and Board switch (saving `kind`, filling `config.board` defaults, or saving `kind` alone when nothing can group, and keeping `config.board` on the way back to Table), the Board module fed by the store, card fields through the field set, the no value column, archived columns, the 50 option and no attribute empty states, every board state; `ux-interaction-reviewer`, `design-system-guardian`, `dxe quick`, satisfies **AC-492** to **AC-495**, **AC-498**, **AC-499**
6. Deploy; open a Deals board in production; `security-access-reviewer`, `state-performance-reviewer`, satisfies **AC-499**

**Milestone 2: drag, live**
7. Library: `BoardColumn.refusesDrop`, `KanbanCard.note`, stories and README; guardian review, satisfies **AC-500**, **AC-502**
8. Data layer: the optimistic move (top of target, counts), rollback, own moved card kept at top, others' moves placed by option id, others' deletes removed at once, unheld records entering through a `groupBy` only read, column scoped settle, definition changes held during a drag, the undo entry (spec 0006's value change), satisfies **AC-500**, **AC-501**, **AC-503** to **AC-506**
9. Screen: `onMove` wired; required and archived drop refusals; the read only board; focus and announcements after a move, satisfies **AC-500** to **AC-502**, **AC-509**
10. Deploy; two browser Playwright drag flows locally and in production, satisfies **AC-503**, **AC-505**, **AC-511**

**Milestone 3: breadth and proof**
11. Engine and contracts: `RecordView.since` for status attributes in `readRecords`, satisfies **AC-507**
12. Library: `KanbanCard.badge`; screen: the stuck badge from the clock, satisfies **AC-507**
13. Screen: View settings for boards (Group by, Show empty columns, Card fields with ViewSettings), the archived grouping attribute Callout, live option changes, select boards and custom objects, the card opening the record panel, satisfies **AC-496**, **AC-497**, **AC-506**, **AC-508**, **AC-509**
14. Scale on the local capped stack with 100 members (first load judged against `SCALE_BUDGET.p95Ms.boardFirstLoad`, next blocks, move write), `verify.md`; full Playwright suite locally and in production; every reviewer before it lands, satisfies **AC-510**, **AC-511**

## Consequences

**Positive**:
- A board costs no new table and no new write path: every rule for values, history, undo, clashes and access applies to moves as is.
- Saved views, drafts, sharing and locks work on boards for free.
- Columns are windows, so a stage holding 150,000 deals scrolls like a table.

**Negative / tradeoffs**:
- No hand made card order: a team that ranks deals by hand must use a number attribute and sort by it.
- A board with many columns and a slow filter loads column batches one after another; with 50 columns that is 5 calls before the right edge fills.
- Placing others' moves by option id means a card can sit at the top of a column for up to 1.5 seconds before it settles into place.
- A board's first load has its own target, 600 ms at p95, twice the 300 ms read (owner decision 4).
- A record the board never loaded that changes into a column costs one small `records.get` and a reread of every column's count at the next settle.
- One 10 second deadline covers a whole `records.groups` call, so one slow column fails the columns of its call together.
- Multi select attributes can't be boards.
- The stuck badge uses the browser's clock; a badly wrong clock shows wrong days (display only).
- `RecordView` grows by one timestamp per status cell on every read.

**Neutral**:
- No migration. One new procedure (`records.groups`), one engine module (`groups.ts`), three library variants.

## Follow-up

- [ ] **Spec 0006**: `RecordView.since` for status attributes, and the board column window (block 25, column scoped dirtying, placement by option id, deletes removed at once, unheld records read for `groupBy` only) as an extension of its windows; record both (`/sync`).
- [ ] **Spec 0011**: add `boardFirstLoad: 600` to `SCALE_BUDGET.p95Ms`, the owner's accepted p95 for a board's first load (every column's first 25 cards and counts), judged by AC-510 here (`/sync`).
- [ ] **Spec 0020**: the Table and Board switch and the board's View settings now exist; its create dialog's Board type turns on, and its "board before #21" Callout goes away (`/sync`).
- [ ] **#51 lists and pipelines**: boards over list entries grouped by an entry status.
- [ ] **#22**: selecting cards for bulk actions on a board (v1 bulk actions are table only).
- [ ] **#24**: per card read only reasons once record level write rules exist.
- [ ] **#52**: time in stage charts reuse `since` and `getTimeInStages`.
- [ ] A "New <singular>" button at the foot of each column that creates a record in that stage.
- [ ] Column collapse per member (localStorage), if boards with many stages ask for it.

## Owner decisions

**Answered by the owner on 3 October 2026 (the recommended defaults for #11 to #22) and in the cross check of 8 October 2026.**

1. **Should cards keep a hand made order inside a column?** Decided: no (the brief); order by the view's sorts, newest first when it has none. Runner up: a rank per board, which adds a write per drag and a rule for new cards.
2. **Where should the "No <attribute>" column sit?** Decided: first (leftmost), where unstaged work starts. Runner up: last.
3. **Maximum columns on a board**: decided, 50 live options. Runner up: 100, with slower first loads.
4. **A board's first load target**: decided, 600 ms at p95 end to end for every column's first 25 cards and counts, recorded as `SCALE_BUDGET.p95Ms.boardFirstLoad` in spec 0011's budget. Later pages of a column keep the 300 ms read target.
