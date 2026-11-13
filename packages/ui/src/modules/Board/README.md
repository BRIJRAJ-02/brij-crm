# Board

A board: a column per option of the grouping attribute, whose cards move between columns.

## Why it exists

New (spec 0003, the board). The board view (#21) and pipelines (#51) group records by a status or select. `Board` is a row of `KanbanColumn`s; each column is a React Aria `GridList` of `KanbanCard`s, virtualised inside, and a drop zone of the library's drag wrapper (dnd-kit, owner decision 13 October), so cards move by pointer (from anywhere on the card, which lifts and follows it), keyboard (the shared `DragHandle`) and screen reader alike (AC-21). Cards reuse `Avatar`, `StatusDot` and the field set's displays on the `card` surface; KanbanColumn and KanbanCard are its parts, not components of their own.

## Use

```tsx
<Board
  label="Deals by stage"
  columns={stages.map((stage) => ({
    id: stage.id,
    title: stage.label,
    hue: stage.hue,
    count,
    cards,
    isArchived: stage.archived,
  }))}
  cardFields={cardFields}
  onMove={({ cardId, toColumnId }) => setStage(cardId, toColumnId)}
  showEmptyColumns={showEmpty}
  onShowEmptyColumnsChange={setShowEmpty}
  onOpen={(card) => openRecord(card.record)}
/>
```

- Each column takes its cards as a `ListSource<BoardCard>`, and its `count` from the screen, since it may hold more cards than are loaded. `isCountAtLeast` marks a count that is a floor (a filtered count past the server's cap, spec 0021): it shows as "10,000+" and reads "10,000 or more cards". Why a variant: the board view's filtered columns stop counting at 10,000, as tables do, and a plain number would claim an exact total.
- `total` (a string the screen formats, "$42,300") sits right after a column's count in its heading, in the quiet caption type (cut with an ellipsis when the head is full), when the view totals a currency field (Board settings' Column total, the CRM flow pass); a collapsed strip leaves it out. Why a variant: a pipeline's worth per stage is the number a sales board is read for (Attio's and Twenty's column sums), and only the column knows where its heading ends.
- `onMove` hears `{ cardId, fromColumnId, toColumnId, beforeCardId? }`. Without `isReorderable` (the default) a card drops on a column as a whole and can't move within its own; with it, cards drop between cards, and `beforeCardId` names the card below.
- `isReadOnly` (the grouping attribute is read only) takes every handle away. A card with a `readOnlyReason` shows a `LockReason` instead of its handle (its reason on hover and keyboard focus); it can't be picked up, and no column takes it.
- An archived option's column shows only while it still has cards, never takes a drop, and says so while a card is moving. `refusesDrop: { reason }` makes any column refuse drops the same way with its own reason (a required field's "No <field>" column, spec 0021). Why a variant: the archived column already refuses drops; a second refusal with another reason needs no second column style.
- `isCollapsedWhenEmpty` (the "No <field>" column) draws an empty column as a slim strip, its title and count running down it, with no cards. It stays a strip while a card moves and takes the drop as it is (the accent ring says so), so no column shifts under the pointer; once it has held cards on this board it stays wide, so it never snaps shut after its last card leaves. Why: an empty no value column took a full column's width first on every pipeline (the owner, 22 October 2026); Linear and Attio keep it out of the way. It follows the Show empty columns setting like any other column when that hides empty ones.
- `onAddCard(columnId)` puts a ghost "+" ("Add to <column>") at the end of each column's head, for a screen to open its create dialog with that column's value set (the "No <field>" column's sets none). Leave it out where the viewer may not create. A collapsed strip, an archived column and one that refuses drops show no "+", and none shows while a card moves. Why: Attio and Twenty add a card from its column; the top bar's New alone left the value to pick again.
- `collapsedIds` with `onCollapsedChange(columnId, isCollapsed)` lets the viewer fold any column into the same slim strip as an empty "No <field>" column (its title and count down it, its total left out) from a collapse button in its head, and open it again from the strip's expand button. The head's button stays quiet until the column is hovered or the button is focused, for a pointer that can hover, so the "+" stays the head's one visible action; touch and keyboard always reach it. A folded strip still takes a dropped card as it is. The screen keeps the set (per view, in the viewer's own browser). Why: a pipeline's Lost or Won columns crowd the stages people work in (Attio and Twenty fold a column; the CRM flow pass, 31 October 2026).
- `addColumn: { label, onAdd }` puts "+ <label>" ("Add stage") after the last column, in a column's width: pressed, it becomes a name field in place; Enter calls `onAdd(name)`, which answers undefined once the column is made (the field clears for the next name, keeping focus: it is read only, never disabled, while it waits) or why it was refused, which the field shows under the name it keeps; Esc puts the button back with focus, as does leaving it empty. Hidden while a card moves. A board with no columns yet shows it instead of the empty state. A stage made here shows while it is empty, even with empty columns hidden, so it never vanishes as it is made. Why: a new stage was made in Settings only, away from the board it shapes (Attio's and Twenty's "+ Add stage"; the CRM flow pass, 31 October 2026).
- `activeId` marks the card whose record is open in the panel beside the board: it takes the selected surface and its content `aria-current` (React Aria keeps the row from passing it), and scrolls into view when the open record changes (if its column draws it and it is out of view). Why a prop: only the board knows which cards its columns have drawn.
- A card's `openThreads` draws a comment mark and the count after its name (Badge's `icon` form, read as "2 open comment threads"); nothing for 0 or absent. The CRM flow pass, 31 October 2026.
- `onMovingChange` hears a card picked up (true) and dropped or put back (false), so the screen can hold its columns still while a card moves (spec 0021).
- Empty columns hide while `showEmptyColumns` is false, behind an "N hidden columns" button; "Hide empty columns" puts them away again. While a card is moving, hidden empty columns come back, so there is always somewhere to drop it.
- `status`: `loading` (skeleton columns after the loading delay), `error` (with Try again from `onRetry`), or `no-access`. No columns at all (an attribute with no options yet) shows an empty state.
- Cards are keyed by their own key, so after a move focus follows the card to its new column.
- Give it a slot with a height: columns scroll inside it, and the board scrolls sideways.

## States

Default, add to a column (`onAddCard`), a folded column (`collapsedIds`), "+ Add stage" (its button, its field, pending, refused), loading (skeleton columns after the loading delay), failed, no access, no columns, empty column ("No cards"), hidden columns, read only, a locked card, an archived column. Hover on a card (pointer only: the stronger edge and `shadow-sm`), focus (the outline ring), a card being dragged (a dashed slot where it was, its lifted copy at `shadow-md`), a column taking a drop (an `accent-text` ring), the spot between cards (an accent line).

## Keyboard

Tab enters the first column; the up and down arrows move between cards, and Tab moves to the next column. Right arrow reaches a card's grip; Space or Enter picks the card up, the left and right arrows move it between columns (and on a reorderable board up and down between cards), Space or Enter drops it, and Esc puts it back, each step announced; focus comes back to the card where it landed. Enter on a card opens it. After the last column, "+ Add stage" takes Enter or Space; in its field Enter makes the column and Esc puts the button back. While lifted by keyboard, the column (or card) the moved card overlaps is the drop target, so the column it shows over is the one it drops in, an empty one too.

## Differences from the artifact

The artifact's board is a static picture; this one moves cards and takes them from a source.

## Timefix prototype (spec 0072)

Takes its look from the prototype's Board. **Differences**: the column taking a drop draws an `accent-text` ring, 3:1 and more against its shell in both themes (the prototype's `accent-border` was about 1.3:1 in light and 1.8:1 in dark; the coordinator's call, 13 Nov; MoveByKeyboard checks it). A column is a grey `surface-shell` shell with a `space-6` inset and `radius-xl`, 272px full (`size-board-column` less `space-8`); folding eases its width over `duration-fast` on `ease-smooth-out` (transitions.dev 01 card resize) to the prototype's rail (opening is at once, so the cards' list is measured once at its width rather than on every frame), `space-24` plus `space-12` wide (36 full). Its head is `size-control` tall: the option's dot and title in `text-body-strong`, the count in the quiet `text-label` it had (the prototype's Count is Badge, which the head would have to draw: owed to the board's screen phase), the total after it in `text-caption` and `text-tertiary`. Cards are `surface` with a `border-subtle` hairline, `radius-lg`, `shadow-xs` and a `space-12` inset; under the pointer the edge turns `border` and the shadow `shadow-sm` (over `duration-quick`). The name is `text-body-strong`, the card fields under it `text-body-sm` in `text-secondary`. An empty column is the prototype's dashed slot, a row and a half tall, "No cards" in `text-body-sm` and `text-tertiary`. The board sets body type.

**Use it for** board views and pipelines grouped by a status or single select. **Don't use it for** more than about eight columns (the table grouped) or ordering a short list (`SortableList`).

**The consumer provides** `label`, `columns` (each a `ListSource` of cards with its `count`), `cardFields`, `onMove` (applied optimistically by the data layer), and optionally `onOpen`, `onAddCard`, `collapsedIds` with `onCollapsedChange`, `addColumn` and `activeId`.

**States**: a column with cards (Default), an empty column (EmptyColumns), a folded rail (CollapseColumn, Folded, CollapsedNoValue), card hover (CSS only, no story asserts pixels), focused (FocusedCard), lifted (LiftedCard, MoveByKeyboard: the slot it left is dashed `border-strong` on `surface-subtle`, its copy rides at `shadow-md`), a column taking the drop (MoveByKeyboard, `data-over`: the `accent-text` ring, its contrast checked in both themes), reordering (Reorder), plus the library's loading, failed, no access, no columns, read only, locked, archived and refusing states.

**Interaction**: a pointer drags from anywhere on a card after a few pixels, so a press still opens it; by keyboard, the grip lifts with Space or Enter, the arrows move it, Space or Enter drops and Esc puts it back, each step announced, focus returning to the card. Reduced motion keeps the colour fades and drops the fold's width ease (and the drag wrapper drops the slide).

**Differences from the prototype**

- Props differ: the library's `columns[].hue` draws a `StatusDot`, not a status shape; `count`, `isCountAtLeast` and `total` stand for the prototype's count and `meta`; `onAddCard`, `onCollapsedChange` (with `collapsedIds`) and `onOpen(card)` for `onAdd`, `onToggleCollapse` and `onOpen(id)`; there is no `noun` (the copy lives in `strings.ts`). A card is a record with `cardFields` drawn through the field set, not tags, a title, a description, people and a date.
- The cards are a virtualised React Aria `GridList` per column (arrow keys between cards, Enter opens), so the ring is drawn just inside the card's edge (`outline-offset` of minus `border-width-focus`): the column scrolls and would clip a ring outside it. The gap between cards stays the Virtualizer's `space-8` (the prototype's is `space-6`), since it is a layout option in code, not CSS.
- The drag wrapper moves a card between columns on drop, not live: the dashed slot stays where the card came from (on a reorderable board, the cards of its own column slide aside). The lifted copy does not scale to 1.02 and does not settle back (no press or lift scale in the app); the slide is the drag wrapper's `duration-fast`.
- Not built (each needs logic, owed to the board screen's phase): the "Lead → Qualified" header crossfade while a card from another column is over one, counts that roll, a new card dropping in at the top, and the grip that appears only on hover (the library's `DragHandle` always shows; a hidden grip would be one more thing to find by touch).
- The head's "+" stays visible (the prototype fades both head actions in on hover); only the collapse button is quiet until the column is hovered or focused, so the "+" stays the head's one action.
- Kept beyond the prototype: `isReorderable`, `isReadOnly`, a card's `readOnlyReason` lock, archived and `refusesDrop` columns with their reason, `isCollapsedWhenEmpty`, hidden empty columns, `addColumn` ("+ Add stage"), `activeId` (the open card on `surface-selected`), a card's open threads, `onMovingChange` and the `status` states.
