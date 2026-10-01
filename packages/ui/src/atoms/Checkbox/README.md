# Checkbox

A real checkbox with a label, a description, and an indeterminate state.

## Why it exists

Ported from the artifact's Checkbox card (version 8). Forms, settings, table selection ("select all") and the checkbox attribute all use it. It wraps React Aria's `Checkbox`, so a real input sits under the box.

## Use

```tsx
<Checkbox label="Send a weekly digest" description="Every Monday at 9:00." />
<Checkbox label="Select all" isLabelHidden isIndeterminate />
```

- `label` is required; `isLabelHidden` keeps it for screen readers only (table headers and rows).
- `isIndeterminate` shows a dash when some but not all are checked.
- `error` marks it invalid and says how to fix it, under the box.
- As the checkbox attribute's editor, it toggles in place and never clears: unchecked is `false`.

## States

Unchecked, checked, indeterminate, hover (pointer only), focus, pressed (scales to `scale-press-sm`), invalid, read only, disabled.

## Keyboard

Space toggles it. Tab moves on.

## Differences from the artifact

- React Aria's props replace the input attributes: `isSelected`, `onChange(isSelected)`, `isDisabled`, `isReadOnly`.
- `error` (a sentence) replaces `invalid`. The tick is Lucide's `check` through the Icon atom.
