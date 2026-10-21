# SortBuilder

A view's sorts: a reorderable list, the first deciding first, each an attribute and a direction.

## Why it exists

New. Every view (#20) sorts by up to five attributes, and the SortChip in the toolbar opens this. It holds contracts' `SortRule` list (`SortRules`, at most five, each attribute once), so the view saves what the builder shows. It is a React Aria `GridList` with drag and drop; its controls are Button and Menu.

## Use

```tsx
<SortBuilder attributes={sortable} value={sorts} onChange={setSorts} />
```

- The first row reads "Sort by", the rest "then by".
- Each row picks its attribute (from those not sorted by yet) and its direction, and has Remove. A row is laid out as FilterBuilder's: the lead in FilterBuilder's lead width, then the attribute (a secondary Button with the type's icon, `10 × size-chip` wide) and the direction (a secondary Button with the arrow, `7 × size-chip` wide, opening a single choice Menu, as a filter's operator does), so the rows line up as columns whatever the names; both shrink together in a narrow slot. A long attribute name is cut, and shows whole in a tooltip on hover or focus (Button's `tooltipWhenCut`). Why: the owner's feedback on spec 0020's milestone 1 (rows that didn't line up, and sorts that looked unlike filters).
- A row drags by its handle (the library's drag wrapper, dnd-kit): the handle shows the grab cursor, the lifted row rises above the others (`shadow-md`) and they slide out of its way.
- Add sort offers the attributes not sorted by yet, until there are five.
- `isReadOnly` shows each sort in the same columns, as FilterBuilder's read only rows do: the type's icon and the attribute, then the direction in secondary text.

## States

Empty ("No sorts yet", with Add sort), filled, a long name cut (whole in a tooltip), at five (no Add sort), read only. Loading and error don't apply: a view opens the builder once its attributes are in. Read only stands for disabled. A row being dragged fades; the drop target takes the inset ring. Focus is the inset ring on a row, the halo on a handle.

## Keyboard

Tab enters the list; the up and down arrows move between rows and the left and right arrows between a row's controls. On a handle, Space or Enter lifts the sort, the arrows move it while the others slide out of its way, Space or Enter drops it and Esc puts it back, each step announced.

## Differences from the artifact

Not in the artifact.
