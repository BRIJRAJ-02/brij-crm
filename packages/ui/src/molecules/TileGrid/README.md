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
- Tiles keep their own height (except with `columns="two"`, where a pair side by side shares one) (`align-items: start`), so a short card's frame ends at its last row.
- A tile that renders nothing (`null`) takes no cell, so the rest close up.
- `fill="fill"` keeps the empty tracks, so every tile has one width however many there are (SettingsGrid: one card per calendar). `fit`, the default, shares the width among the tiles there are.
- The tiles keep their order: reading and Tab order follow the DOM, left to right, then down.

## Choice variant

```tsx
<TileGrid variant="choice" label="Look" tiles={looks} value={look} onChange={setLook} />
<TileGrid variant="choice" mode="action" label="Block kind" tiles={kinds} onAction={add} />
```

- Equal size tiles to pick from by sight (spec 0058): a picture slot (a Lucide mark through `icon`, or a `thumbnail` of the real thing) over a short `name`, both on one left edge. Every track is at least `size-column-narrow` and the tracks share the width, so every tile has one width and the rows share one height.
- `mode="select"` (the default) is a radio group: Tab lands on the chosen tile (or the first), arrows move and pick, and the chosen tile has the accent line as its border, a soft fill and a tick in its corner that eases in on opacity and scale. `mode="action"` makes each tile a button that calls `onAction(id)` (Add block).
- `description` is a tooltip on hover and focus, and the tile's accessible description, so the words stay out of the way. The `name` is the accessible name; the picture is hidden from screen readers.
- In `select` mode the tile is the radio's label and the radio a real input laid unseen over the tick's corner, so a plain click on the tile, its name or the radio picks it, with no forced click in tests.
- A disabled tile takes no focus, so its tooltip is out of a keyboard's reach: give it a `disabledReason` ("At the limit"), a few words shown on the tile under its name and read as its description.
- A tile with a description is wrapped by its tooltip's trigger; the wrapper fills the grid cell, so every tile is one size with or without one (`ChoiceDisabled` checks it with the alignment probe).
- Why a variant, not a new component: it is the same grid of equal cells, with tiles that are pickable rather than Cards. The block kind grid, preset thumbnails and embed tiles all use it; the radio group (`Radio variant="cards"`) is a list of sentences, which is what this replaces.
- `hue` tints an `icon` tile's picture slot in a data hue (its tag colours) with the mark drawn `lg` in the hue's text colour, so a grid of kinds (Add block) reads at a glance instead of as grey boxes. A `thumbnail` keeps its own colours.
- Focus is the library's ring, as on a primary Button: the accent line just outside the tile past a hairline gap, plus the soft halo, so a focused chosen tile differs from a chosen one (spec 0058, AC-4).
- The tracks are `auto-fit`: a short run (three embed tiles in a wide card) shares the whole row and ends on the container's right edge.
- Motion: hover colour, selection ring and tick only; nothing moves on first paint; under reduced motion the tick is there at once, with no fade or scale (spec 0058, AC-2).

## States

None of its own: the tiles carry theirs (a Card with a Skeleton while loading, an EmptyState on failure).

## Keyboard

None of its own.

## Differences from the artifact

Not in the artifact.

## Entering

`isEntering` (cards only) eases each tile in on mount: a fade and a `space-8` rise over `duration-modal` on `ease-out`, the second tile one `duration-press` later and the rest two. Only translate and opacity move, reduced motion keeps the fade alone, and the tiles take input from the first frame. It is for a moment worth marking (first run's Done, spec 0058 AC-21), never for grids that load or refresh.
