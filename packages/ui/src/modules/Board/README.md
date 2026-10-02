# Board

A board: a column per option of the grouping attribute, whose cards move between columns.

## Why it exists

New (spec 0003, the board). The board view (#21) and pipelines (#51) group records by a status or select. `Board` is a row of `KanbanColumn`s; each column is a React Aria `GridList` of `KanbanCard`s (each moved by the shared `DragHandle`), virtualised inside, with React Aria drag and drop, so cards move by pointer, keyboard and screen reader alike (AC-21). Cards reuse `Avatar`, `StatusDot` and the field set's displays on the `card` surface; KanbanColumn and KanbanCard are its parts, not components of their own.

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

- Each column takes its cards as a `ListSource<BoardCard>`, and its `count` from the screen, since it may hold more cards than are loaded.
- `onMove` hears `{ cardId, fromColumnId, toColumnId, beforeCardId? }`. Without `isReorderable` (the default) a card drops on a column as a whole and can't move within its own; with it, cards drop between cards, and `beforeCardId` names the card below.
- `isReadOnly` (the grouping attribute is read only) takes every handle away. A card with a `readOnlyReason` shows a `LockReason` instead of its handle (its reason on hover and keyboard focus); it can't be picked up, and no column takes it.
- An archived option's column shows only while it still has cards, never takes a drop, and says so while a card is moving.
- Empty columns hide while `showEmptyColumns` is false, behind an "N hidden columns" button; "Hide empty columns" puts them away again. While a card is moving, hidden empty columns come back, so there is always somewhere to drop it.
- `status`: `loading` (skeleton columns after the loading delay), `error` (with Try again from `onRetry`), or `no-access`. No columns at all (an attribute with no options yet) shows an empty state.
- Cards are keyed by their own key, so after a move focus follows the card to its new column.
- Give it a slot with a height: columns scroll inside it, and the board scrolls sideways.

## States

Default, loading (skeleton columns after the loading delay), failed, no access, no columns, empty column ("No cards"), hidden columns, read only, a locked card, an archived column. Hover on a card (pointer only; its handle shows), focus (the inset ring), a card being dragged (faded), a column taking a drop (the inset ring on accent soft), the spot between cards (an accent line).

## Keyboard

Tab enters the first column; the up and down arrows move between cards, and Tab moves to the next column. Right arrow reaches a card's handle; Enter picks the card up, and focus lands on the first column that takes it. Tab and Shift Tab move between columns (and on a reorderable board the arrows move between the gaps), Enter drops, and Esc puts it back. Enter on a card opens it.

## Differences from the artifact

The artifact's board is a static picture; this one moves cards and takes them from a source.
