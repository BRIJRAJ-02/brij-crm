# TileGrid

Cards side by side that wrap: Home's Today, Tasks due and Team today (spec 0041).

## Why it exists

New, and the one grid of cards: SettingsLayout's `SettingsGrid` drew the same grid with its own CSS and now renders TileGrid's `fill` variant. Screens can't lay out cards themselves (no styles in `apps/web`). PageColumn stacks its children in one column, and its side column is one fixed panel beside a main column, not a run of equal tiles. LinkGrid draws its own link cards, not any Card. The Dashboard module in the inventory (#52, tiles in three sizes that move by drag) is a larger thing for reports; this is only the layout, and that module can build on it.

## Use

```tsx
<PageColumn>
  <TileGrid>
    <Card title="Today">…</Card>
    <Card title="Tasks due">…</Card>
  </TileGrid>
</PageColumn>
```

- As many columns as fit with each at least `size-panel` (400px) wide, sharing the width; under that, one column at the grid's full width, so a phone never scrolls sideways.
- `columns="two"` holds at most two columns, each at least `size-panel` wide: two side by side from twice that width, one below it (Home's sections, spec 0041). Why a variant: on a wide screen `auto` put three or four narrow cards in a row, and the owner asked for two columns on wide screens and one on phones. The grid's own width decides, so it works in any slot, as a container query would; the container breakpoints (320px, 480px) are both under one panel's width, so no query could say it. Side by side, the two share one height (they stretch), so a pair of cards ends on one line.
- Tiles keep their own height (`align-items: start`), so a short card's frame ends at its last row.
- A tile that renders nothing (`null`) takes no cell, so the rest close up.
- `fill="fill"` keeps the empty tracks, so every tile has one width however many there are (SettingsGrid: one card per calendar). `fit`, the default, shares the width among the tiles there are.
- The tiles keep their order: reading and Tab order follow the DOM, left to right, then down.

## States

None of its own: the tiles carry theirs (a Card with a Skeleton while loading, an EmptyState on failure).

## Keyboard

None of its own.

## Differences from the artifact

Not in the artifact.
