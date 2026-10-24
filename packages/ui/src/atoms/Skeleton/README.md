# Skeleton

Grey placeholders in the shape of content still loading.

## Why it exists

Ported from the artifact's Skeleton card. Lists, panels, cells and cards show their loading state with it, combined with EmptyState for empty and error (house rule: reach for these two before inventing a state).

## Use

```tsx
const showSkeleton = useDelayedLoading(isLoading);
<div aria-busy={isLoading}>{showSkeleton ? <Skeleton lines={3} /> : content}</div>;
```

- `shape`: `line` (the default) for text, `text` for text that holds its own line box, `circle` for an avatar, `tile` for an icon tile (`size-tile`, square, like a record object's tile), `block` for a card or chart, `field` for a field or Select at a settings row's end (`size-input` tall, `size-menu` wide, or `width="full"` for a field across its Card), `fill` for a placeholder that takes the whole slot it sits in. Why `field`: a row's control slot sizes to its content, so a line's share of it is nothing; a settings page loading shows each row's title with the box its control will fill. Why `tile`: the folded sidebar's rail is icon tiles only, so a loading Records section there needs a mark in the tile's shape, not a line or an avatar's circle.
- Why `text`: a `line` is 8 px tall whatever text it stands in for, so a loading heading left its block shorter than the heading, and the page moved when the words arrived. A `text` row is `1lh` of the font it sits in, with the same 8 px bar centred in it, so the block is exactly as tall as the text will be and nothing shifts. Put it inside an element carrying the font it should take, and never inside a real heading: a heading with only a placeholder in it is an empty heading, which axe fails and a screen reader reads as a heading with no name. Use a paragraph with the heading's own class (`<p className={styles.headline}><Skeleton shape="text" width="medium" /></p>`), and let the heading itself arrive with its words. Rows of `text` stack with no gap, since each already carries its line's leading.
- Why `fill`: a pane, a card's body or a grid cell the layout has already sized needs a placeholder of exactly that size; `block` is `size-toolbar` tall whatever it sits in, so the shape it held was not the shape that arrived.
- `width`: `full`, `long`, `medium` or `short`, so a column of lines looks like text.
- `size` (`circle` only): `xs`, `sm`, `md`, `lg`, `title` or `xl`, the same scale Avatar takes, so a loading face is the size the face will be. A chip when left out. Why a variant: a page whose avatar is `xl` moved by 50 px when the picture arrived.
- `lines`: several rows, the last one shorter, for `line` and `text`. `align="center"` centres them, the shorter last line in the middle, under centred text (EmptyState's loading title and text). Why a variant: the lines start at the start, under left aligned text, so a centred state's last line hung to one side; restyling Skeleton's insides from EmptyState would break the house rule that a component styles only itself.
- `isStill` draws the shape without the pulse, for a sketch of content rather than content on its way: first run's workspace preview (spec 0036) draws the app from these bars, and a pulsing sketch read as loading. Why a variant: the same shapes and fill; only the pulse goes, and a second set of grey bars would be a second placeholder style.
- Its fill is `border`, not `surface-hover`, which is 1.1:1 on `surface` and all but vanishes.
- Show it through `useDelayedLoading` (200 ms delay, 300 ms minimum), so a fast load never flashes it. It is hidden from screen readers; mark the region `aria-busy` instead.

## States

It is the loading state. It pulses once per `duration-pulse`, and holds still under reduced motion, or always with `isStill`.

## Keyboard

It takes no focus.

## Differences from the artifact

- `width` takes a named share of the slot rather than a number, and `circle` and `block` are `shape` values, so no inline sizes are needed.
