# Meter

Usage against a plan's limit.

## Why it exists

New. Usage (#38) shows records, seats and storage against the plan. It wraps React Aria's `Meter`, so screen readers hear "1,200 of 1,500".

## Use

```tsx
<Meter label="Records" value={8200} maxValue={10000} />
```

- Accent while there's room, orange from 80% of the limit, red past it, when it also says "Over the limit" in words.
- `value` may pass `maxValue`; the bar stops full.
- `tone="share"` is a part of a whole in a row of figures: how many reached a form's question of those who started, a source's share of the views (a form's Analytics, 5 November 2026). One data hue (`dot-blue`, as BarStrip's bars) at every share, since 90% is not a warning, and the label and value read to screen readers only, because the row's own cells show them; `valueText` says the value in the row's words ("4 of 6 people"). Why a variant: it is the same track, fill and `meter` role; only the thresholds and the head go. A ProgressBar is a task's progress, and BarStrip is one series over periods.

## States

Room, near the limit, over the limit.

## Keyboard

It takes no focus.

## Differences from the artifact

Not in the artifact.
