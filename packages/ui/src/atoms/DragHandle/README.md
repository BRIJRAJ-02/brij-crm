# DragHandle

The grip a row or a card is moved by.

## Why it exists

New. Sorts, view fields and board cards each drew their own grip button with its own styles, three copies of one control (spec 0003's design review). Every list that sorts now moves through the library's one drag wrapper (`lib/drag`, around dnd-kit, owner decision 13 October 2026), and this is the button its keyboard and screen reader users pick an item up with, once.

## Use

```tsx
// A React Aria row inside a SortableList: SortableRowGrip binds the row and draws this handle.
<GridListItem id={field.id} textValue={field.name}>
  <SortableRowGrip id={field.id} label={`Move ${field.name}`} isDisabled={field.isLocked} />…
</GridListItem>;

// Any other sortable item: the grip from useSortableItem.
const item = useSortableItem(id);
<div ref={item.bind}>
  <DragHandle label={`Move ${name}`} drag={item.grip} />…
</div>;
```

- `label` names the move for screen readers: "Move Stage".
- `drag` is the grip of a sortable item (`useSortableItem(...).grip`). The handle is a plain button: it keeps its pointer press and its Space and Enter to itself, so the row around it never presses (opens) when a drag starts. A grip whose item can't move draws nothing; say why somewhere the person can reach (a tooltip on a lock).
- `manual` (spec 0034): a list outside the wrapper (the sidebar's sections, which no single list holds) drives the handle itself: it passes `isLifted`, `onKeyDown` (Space or Enter lifts and drops, the arrows move, Esc puts it back), `onPointerDown` (a pointer drag) and `onBlur` (put back). Why a variant rather than a new grip: it is the same control, moved by the same keys.

## States

Default (text tertiary), hover (pointer only, text secondary), focus (the ring), pressed (the grabbing cursor), lifted (accent, grabbing), none (an item that can't move).

## Keyboard

Space or Enter lifts the item. While it is lifted, focus waits on the move itself (outside any grid, so the arrows never move focus between rows, and Esc never closes the popover around the list); the arrows move it, Space or Enter drops it and Esc puts it back, each step announced, and focus comes back to the grip.

## Differences from the artifact

Not in the artifact.
