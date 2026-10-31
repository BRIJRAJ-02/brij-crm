# ViewSettings

What a view shows: a table's columns or a board card's fields, each shown or hidden, in order.

## Why it exists

New. The view bar's View settings (#20, #21) opens it. It is React Aria `GridList`s whose Shown rows sort through the library's drag wrapper (dnd-kit), with the type's `Icon` and a ghost icon `Button` (Hide or Show) per row; nothing else is new.

Since 31 October 2026 (owner items 27 to 35) it splits Shown from Hidden, Attio style, instead of a switch per row: a wall of switches read off louder than on, and mixed the two lists into one. System fields (`attribute.isSystem`: Record ID, Created at, Updated by) sit apart under System.

## Use

```tsx
<ViewSettings label="Columns" fields={columns} onChange={setColumns} />
```

- `fields` is every attribute the view can show, in order, each `isShown` or not. A field with `isLocked` (the record's name) leads Shown with a lock ("Always shown" in its tooltip and name), has no handle, and nothing drops above it.
- Shown lists the locked name, then the shown fields in order, each with Hide (an eye) and a grip that appears on hover or focus, only when there are two or more to order. Hidden lists the rest, each added by Show (a plus), Enter, or a press on the row; System holds hidden system fields the same way.
- Focus stays in a list's place after Hide or Show (the row now there), so several go in a row from the keyboard.
- `isReadOnly` shows the lists with no Show, Hide or handles: a view you can't edit.
- `onChange` hands back the whole list after a Show, a Hide or a move.
- Past eight attributes, a search field ("Find a field", pinned at the top) narrows every list; Esc clears it. Moving waits until the search is cleared, so you always see where things land.
- Each section heading counts its rows; Shown counts what is shown.
- `maxShown` caps the shown rows, the locked one aside: Shown counts against it ("3 of 6"), and at the limit Show is disabled until one is hidden. Why a variant: a board card holds at most six fields (spec 0021), and a control that looks free but is refused misleads.
- On a board the same list holds the card's fields (label "Card fields", `maxShown` 6): the name locked first, then the shown fields in the card's order.
- `footer` is pinned at the popover's foot after a hairline, so it never scrolls out of reach: "Add attribute", on a table and on a board, since a new attribute is one more column or card field (it moved here from the view bar when the bar was simplified, the owner's call on 21 October 2026). Why a slot: what to add, and who may, is the screen's to say.

- `header` sits above the list after a hairline: a table's Group by, a `Select` of None and the object's status and single select attributes (13 Oct reference batch 4).

## States

Default, with a locked row, system fields, at the limit (`maxShown`), read only, searching, no matches, with a footer. Hover (pointer only, which also shows the grip), focus (the inset ring), a row being dragged (lifted, the others sliding out of its way).

## Keyboard

Tab moves between the lists; the up and down arrows move between rows, the left and right arrows between a row's handle and its Hide or Show. Enter on a hidden row shows it. On a handle, Space or Enter lifts the row, the arrows move it while the others slide out of its way, Space or Enter drops it and Esc puts it back, each step announced.

## Differences from the artifact

Not in the artifact.
