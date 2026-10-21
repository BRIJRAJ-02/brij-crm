# DragHandle

The grip a row or a card is moved by.

## Why it exists

New. Sorts, view fields and board cards each drew their own grip button with its own styles, three copies of one control (spec 0003's design review). React Aria's drag and drop asks each draggable row for a button in its `drag` slot, so keyboard and screen reader users can pick the row up; this is that button, once.

## Use

```tsx
<GridListItem id={field.id} textValue={field.name}>
  <DragHandle label={`Move ${field.name}`} isDisabled={field.isLocked} />…
</GridListItem>
```

- Use it only inside a React Aria `GridList` (or `Table`) with `dragAndDropHooks`.
- `label` names the move for screen readers: "Move Stage".
- `manual` (spec 0034): outside a GridList, a list that isn't a grid (the sidebar's sections) drives the handle itself: it passes `isLifted`, `onKeyDown` (Space or Enter lifts and drops, the arrows move, Esc puts it back), `onPointerDown` (a pointer drag) and `onBlur` (put back). It is then a plain button, since React Aria's press handling would swallow the pointer down a drag starts with; the list owns the order and the announcements. Why a variant rather than a new grip: it is the same control, moved by the same keys, in a list React Aria's drag and drop doesn't cover (links in a navigation landmark).
- `isDisabled` keeps the slot React Aria asks for, hidden and out of the tab order, for a row that can't move. Say why somewhere the person can reach (a tooltip on a lock).

## States

Default (text tertiary), hover (pointer only, text secondary), focus (the ring), pressed (the grabbing cursor), lifted (`manual` only: accent, grabbing), disabled (hidden).

## Keyboard

The right arrow reaches it from its row. Enter picks the row up; the arrows, or Tab between lists, choose where; Enter drops it and Esc puts it back.

## Differences from the artifact

Not in the artifact.
