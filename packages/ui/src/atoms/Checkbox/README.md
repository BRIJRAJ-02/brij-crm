# Checkbox

A real checkbox with a label, a description, and an indeterminate state, and its mark alone for displays.

## Why it exists

Ported from the artifact's Checkbox card (version 8). Forms, settings, table selection ("select all") and the checkbox attribute all use it. `Checkbox` wraps React Aria's `Checkbox`, so a real input sits under the box. `CheckboxMark` draws the same box with no input, for the checkbox attribute's display and the grid's selection column, where something else is the control.

## Use

```tsx
<Checkbox label="Send a weekly digest" description="Every Monday at 9:00." />
<Checkbox label="Select all" isLabelHidden isIndeterminate />
```

- `label` is required; `isLabelHidden` keeps it for screen readers only (table headers and rows).
- `isIndeterminate` shows a dash when some but not all are checked.
- `error` marks it invalid and says how to fix it, under the box.
- As the checkbox attribute's editor, it toggles in place and never clears: unchecked is `false`.
- `CheckboxMark` is the same look with no control. The checkbox attribute's display and the grid's selection column draw it, where the cell is the control (Space, or a click on the mark), so a scroll past hundreds of rows mounts no checkbox per row. Screen readers hear its label and state ("Is customer, checked"). It stays inside the library: screens draw a checkbox value through `AttributeDisplay`.

## States

Unchecked, checked, indeterminate, hover (pointer only), focus, pressed (scales to `scale-press-sm`), invalid, read only, disabled. The mark has unchecked, checked, indeterminate and read only; whatever holds it draws the focus.

## Keyboard

Space toggles it. Tab moves on. The mark takes no keys or focus; its owner (a grid cell) handles Space.

## Differences from the artifact

- React Aria's props replace the input attributes: `isSelected`, `onChange(isSelected)`, `isDisabled`, `isReadOnly`.
- `error` (a sentence) replaces `invalid`. The tick is Lucide's `check` through the Icon atom.
