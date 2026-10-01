# ProgressBar

How far a long task has got.

## Why it exists

New. Imports, exports, bulk edits and merges (#14, #22, #30, #55) report progress the same way. It wraps React Aria's `ProgressBar`, so screen readers hear the label and the percentage. (Spinner is for short waits with no measure.)

## Use

```tsx
<ProgressBar label="Importing 2,400 people" value={42} showValue />
<ProgressBar label="Preparing the export" />
```

- `value` from 0 to `maxValue` (100); leave it out for an indeterminate bar.
- `showValue` prints the percentage after the label.
- `isLabelHidden` keeps the label for screen readers when the text beside it already says.

## States

Determinate, indeterminate. The fill eases to each new value; the indeterminate fill slides, and pulses under reduced motion.

## Keyboard

It takes no focus.

## Differences from the artifact

Not in the artifact.
