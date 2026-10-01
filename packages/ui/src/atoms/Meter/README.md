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

## States

Room, near the limit, over the limit.

## Keyboard

It takes no focus.

## Differences from the artifact

Not in the artifact.
