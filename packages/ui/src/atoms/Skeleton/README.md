# Skeleton

Grey placeholders in the shape of content still loading.

## Why it exists

Ported from the artifact's Skeleton card. Lists, panels, cells and cards show their loading state with it, combined with EmptyState for empty and error (house rule: reach for these two before inventing a state).

## Use

```tsx
const showSkeleton = useDelayedLoading(isLoading);
<div aria-busy={isLoading}>{showSkeleton ? <Skeleton lines={3} /> : content}</div>;
```

- `shape`: `line` (the default) for text, `circle` for an avatar, `tile` for an icon tile (`size-tile`, square, like a record object's tile), `block` for a card or chart. Why `tile`: the folded sidebar's rail is icon tiles only, so a loading Records section there needs a mark in the tile's shape, not a line or an avatar's circle.
- `width`: `full`, `long`, `medium` or `short`, so a column of lines looks like text.
- `lines`: several lines, the last one shorter. `align="center"` centres them, the shorter last line in the middle, under centred text (EmptyState's loading title and text). Why a variant: the lines start at the start, under left aligned text, so a centred state's last line hung to one side; restyling Skeleton's insides from EmptyState would break the house rule that a component styles only itself.
- Show it through `useDelayedLoading` (200 ms delay, 300 ms minimum), so a fast load never flashes it. It is hidden from screen readers; mark the region `aria-busy` instead.

## States

It is the loading state. It pulses once per `duration-pulse`, and holds still under reduced motion.

## Keyboard

It takes no focus.

## Differences from the artifact

- `width` takes a named share of the slot rather than a number, and `circle` and `block` are `shape` values, so no inline sizes are needed.
