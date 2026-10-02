# SortBuilder

A view's sorts: a reorderable list, the first deciding first, each an attribute and a direction.

## Why it exists

New. Every view (#20) sorts by up to five attributes, and the SortChip in the toolbar opens this. It holds contracts' `SortRule` list (`SortRules`, at most five, each attribute once), so the view saves what the builder shows. It is a React Aria `GridList` with drag and drop; its controls are Button, Menu and Select.

## Use

```tsx
<SortBuilder attributes={sortable} value={sorts} onChange={setSorts} />
```

- The first row reads "Sort by", the rest "then by".
- Each row picks its attribute (from those not sorted by yet) and its direction, and has Remove.
- Add sort offers the attributes not sorted by yet, until there are five.
- `isReadOnly` shows the sorts as words, with nothing to change.

## States

Empty ("No sorts yet", with Add sort), filled, at five (no Add sort), read only. A row being dragged fades; the drop target takes the inset ring. Focus is the inset ring on a row, the halo on a handle.

## Keyboard

Tab enters the list; the up and down arrows move between rows and the left and right arrows between a row's controls. On a handle, Enter picks the sort up, the up and down arrows choose where it goes, Enter drops it and Esc cancels.

## Differences from the artifact

Not in the artifact.
