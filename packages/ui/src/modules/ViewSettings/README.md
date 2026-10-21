# ViewSettings

What a view shows: a table's columns or a board card's fields, each shown or hidden, in order.

## Why it exists

New. The view bar's View settings (#20, #21) opens it. It is a React Aria `GridList` whose rows sort through the library's drag wrapper (dnd-kit), with a `Switch` per row and the type's `Icon`; nothing else is new.

## Use

```tsx
<ViewSettings label="Columns" fields={columns} onChange={setColumns} />
```

- `fields` is every attribute the view can show, in order, each `isShown` or not. A field with `isLocked` (the record's name) reads "Always shown", has no handle, and nothing drops above it.
- `isReadOnly` shows the view's fields with read only switches and no handles: a view you can't edit.
- `onChange` hands back the whole list after a switch or a move.
- Past eight attributes, a search field narrows the list; moving waits until the search is cleared, so you always see where things land.
- The head counts what is shown: "4 of 5 shown".
- `maxShown` caps the shown rows, the locked one aside: the head counts against it ("3 of 6 shown"), and at the limit the hidden rows' switches are disabled until one is hidden. Why a variant: a board card holds at most six fields (spec 0021), and a switch that looks free but is refused misleads.
- On a board the same list holds the card's fields (label "Card fields", `maxShown` 6): the name locked first, then the shown fields in the card's order.
- `footer` sits under the list after a hairline: "Add attribute", on a table and on a board, since a new attribute is one more column or card field (it moved here from the view bar when the bar was simplified, the owner's call on 21 October 2026). Why a slot: what to add, and who may, is the screen's to say.

## States

Default, with a locked row, at the limit (`maxShown`), read only, searching, no matches, with a footer. Hover (pointer only), focus (the inset ring), a row being dragged (lifted, the others sliding out of its way).

## Keyboard

Tab enters the list; the up and down arrows move between rows, the left and right arrows between a row's handle and switch. Space flips a switch. On a handle, Space or Enter lifts the row, the arrows move it while the others slide out of its way, Space or Enter drops it and Esc puts it back, each step announced.

## Differences from the artifact

Not in the artifact.
