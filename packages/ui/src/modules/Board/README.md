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
- `total` (a string the screen formats, "$42,300") sits at the end of a column's heading after its count, in the quiet label type, when the view totals a currency field (Board settings' Column total, the CRM flow pass); a collapsed strip leaves it out. Why a variant: a pipeline's worth per stage is the number a sales board is read for (Attio's and Twenty's column sums), and only the column knows where its heading ends.
- `onMove` hears `{ cardId, fromColumnId, toColumnId, beforeCardId? }`. Without `isReorderable` (the default) a card drops on a column as a whole and can't move within its own; with it, cards drop between cards, and `beforeCardId` names the card below.
- `isReadOnly` (the grouping attribute is read only) takes every handle away. A card with a `readOnlyReason` shows a `LockReason` instead of its handle (its reason on hover and keyboard focus); it can't be picked up, and no column takes it.
- An archived option's column shows only while it still has cards, never takes a drop, and says so while a card is moving. `refusesDrop: { reason }` makes any column refuse drops the same way with its own reason (a required field's "No <field>" column, spec 0021). Why a variant: the archived column already refuses drops; a second refusal with another reason needs no second column style.
- `isCollapsedWhenEmpty` (the "No <field>" column) draws an empty column as a slim strip, its title and count running down it, with no cards. It stays a strip while a card moves and takes the drop as it is (the accent ring says so), so no column shifts under the pointer; once it has held cards on this board it stays wide, so it never snaps shut after its last card leaves. Why: an empty no value column took a full column's width first on every pipeline (the owner, 22 October 2026); Linear and Attio keep it out of the way. It follows the Show empty columns setting like any other column when that hides empty ones.
- `onAddCard(columnId)` puts a ghost "+" ("Add to <column>") at the end of each column's head, for a screen to open its create dialog with that column's value set (the "No <field>" column's sets none). Leave it out where the viewer may not create. A collapsed strip, an archived column and one that refuses drops show no "+", and none shows while a card moves. Why: Attio and Twenty add a card from its column; the top bar's New alone left the value to pick again.
- `collapsedIds` with `onCollapsedChange(columnId, isCollapsed)` lets the viewer fold any column into the same slim strip as an empty "No <field>" column (its title and count down it, its total left out) from a collapse button in its head, and open it again from the strip's expand button. The head's button stays quiet until the head is hovered or focused for a pointer that can hover, so the "+" stays the head's one visible action; touch and keyboard always reach it. A folded strip still takes a dropped card as it is. The screen keeps the set (per view, in the viewer's own browser). Why: a pipeline's Lost or Won columns crowd the stages people work in (Attio and Twenty fold a column; the CRM flow pass, 31 October 2026).
- `addColumn: { label, onAdd }` puts "+ <label>" ("Add stage") after the last column, in a column's width: pressed, it becomes a name field in place; Enter calls `onAdd(name)`, which answers undefined once the column is made (the field clears for the next name, keeping focus: it is read only, never disabled, while it waits) or why it was refused, which the field shows under the name it keeps; Esc puts the button back with focus, as does leaving it empty. Hidden while a card moves. A board with no columns yet shows it instead of the empty state. A stage made here shows while it is empty, even with empty columns hidden, so it never vanishes as it is made. Why: a new stage was made in Settings only, away from the board it shapes (Attio's and Twenty's "+ Add stage"; the CRM flow pass, 31 October 2026).
- `activeId` marks the card whose record is open in the panel beside the board: it takes the selected surface and its content `aria-current` (React Aria keeps the row from passing it), and scrolls into view when the open record changes (if its column draws it and it is out of view). Why a prop: only the board knows which cards its columns have drawn.
- A card's `openThreads` draws a comment mark and the count after its name (Badge's `icon` form, read as "2 open comment threads"); nothing for 0 or absent. The CRM flow pass, 31 October 2026.
- `onMovingChange` hears a card picked up (true) and dropped or put back (false), so the screen can hold its columns still while a card moves (spec 0021).
- Empty columns hide while `showEmptyColumns` is false, behind an "N hidden columns" button; "Hide empty columns" puts them away again. While a card is moving, hidden empty columns come back, so there is always somewhere to drop it.
- `status`: `loading` (skeleton columns after the loading delay), `error` (with Try again from `onRetry`), or `no-access`. No columns at all (an attribute with no options yet) shows an empty state.
- Cards are keyed by their own key, so after a move focus follows the card to its new column.
- Give it a slot with a height: columns scroll inside it, and the board scrolls sideways.

## States

Default, add to a column (`onAddCard`), a folded column (`collapsedIds`), "+ Add stage" (its button, its field, pending, refused), loading (skeleton columns after the loading delay), failed, no access, no columns, empty column ("No cards"), hidden columns, read only, a locked card, an archived column. Hover on a card (pointer only; its handle shows), focus (the inset ring), a card being dragged (faded), a column taking a drop (the inset ring on accent soft), the spot between cards (an accent line).

## Keyboard

Tab enters the first column; the up and down arrows move between cards, and Tab moves to the next column. Right arrow reaches a card's grip; Space or Enter picks the card up, the left and right arrows move it between columns (and on a reorderable board up and down between cards), Space or Enter drops it, and Esc puts it back, each step announced; focus comes back to the card where it landed. Enter on a card opens it. After the last column, "+ Add stage" takes Enter or Space; in its field Enter makes the column and Esc puts the button back. While lifted by keyboard, the column (or card) the moved card overlaps is the drop target, so the column it shows over is the one it drops in, an empty one too.

## Differences from the artifact

The artifact's board is a static picture; this one moves cards and takes them from a source.
