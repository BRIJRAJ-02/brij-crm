# DragHandle

The grip a row or a card is moved by.

## Why it exists

New. Sorts, view fields and board cards each drew their own grip button with its own styles, three copies of one control (spec 0003's design review). React Aria's drag and drop asks each draggable row for a button in its `drag` slot, so keyboard and screen reader users can pick the row up; this is that button, once.

## Use

```tsx
<GridListItem id={field.id} textValue={field.name}>
  <DragHandle label={`Move ${field.name}`} isDisabled={field.isLocked} />
  …
</GridListItem>
```

- Use it only inside a React Aria `GridList` (or `Table`) with `dragAndDropHooks`.
- `label` names the move for screen readers: "Move Stage".
- `isDisabled` keeps the slot React Aria asks for, hidden and out of the tab order, for a row that can't move. Say why somewhere the person can reach (a tooltip on a lock).

## States

Default (text tertiary), hover (pointer only, text secondary), focus (the ring), pressed (the grabbing cursor), disabled (hidden).

## Keyboard

The right arrow reaches it from its row. Enter picks the row up; the arrows, or Tab between lists, choose where; Enter drops it and Esc puts it back.

## Differences from the artifact

Not in the artifact.
