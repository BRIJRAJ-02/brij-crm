# ViewSettings

What a view shows: a table's columns or a board card's fields, each shown or hidden, in order.

## Why it exists

New. The view bar's View settings (#20, #21) opens it. It is a React Aria `GridList` with drag and drop, with a `Switch` per row and the type's `Icon`; nothing else is new.

## Use

```tsx
<ViewSettings label="Columns" fields={columns} onChange={setColumns} />
```

- `fields` is every attribute the view can show, in order, each `isShown` or not. A field with `isLocked` (the record's name) is always shown, can't move, and has no handle.
- `onChange` hands back the whole list after a switch or a move.
- Past eight attributes, a search field narrows the list; moving waits until the search is cleared, so you always see where things land.
- The head counts what is shown: "4 of 5 shown".

## States

Default, with a locked row, searching, no matches. Hover (pointer only), focus (the inset ring), a row being dragged (faded), the drop target (the inset ring).

## Keyboard

Tab enters the list; the up and down arrows move between rows, the left and right arrows between a row's handle and switch. Space flips a switch. On a handle, Enter picks the row up, the arrows choose where, Enter drops it and Esc cancels.

## Differences from the artifact

Not in the artifact.
