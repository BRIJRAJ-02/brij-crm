# motion

The small shared motion the whole app borrows, as hooks rather than components, because the element that moves belongs to the caller: a table row, a list item, a feed.

## Why it exists

The owner asked for the details that make a change feel answered (1 November 2026): a row that just changed washing once, a new line dropping in, a row closing up as it leaves, a value fading in place. Each of those is one behaviour shared by every list in the CRM, and none of them could be a component: a `<tr>` cannot be wrapped, and a CSS module may only style its own component. So they run through the Web Animations API, with every duration and curve read from a token (`lib/token-values.ts`), and reduced motion handled in one place.

## Use

```tsx
const row = useRowWash(record.updatedAt); //  <tr ref={row}>
const list = useDropIn(items[0]?.id); //      <ul ref={list}>
const value = useValueFade(status.label); //  <span ref={value}>
collapseAway(rowElement, () => remove(id)); // a row leaving a list
const isStill = useReducedMotion(); //        when a component has to branch itself
```

- `useRowWash(stamp)` washes the row once, from `accent-soft` back to the row's own background, whenever the stamp changes after the row is first drawn: an edit made here, or a patch arriving over realtime. Pass `updatedAt`, not a counter, so the same change washes once. It never runs on the first draw, so a list that has just loaded stays quiet.
- `useDropIn(topKey)` goes on the list, not the row: when the key of the top item becomes one the list hasn't seen, the row marked `data-drop-in` drops in (the first child, in a plain list with no such mark). A virtual list draws a window, so its first child is whatever is in view: mark the row for index 0 and nothing else moves. The first key a list learns, as it loads, is never an arrival.
- `collapseAway(element, remove)` fades the row and closes its height, then clears everything it set and calls `remove`. `remove` always runs, even with no element and in a browser that can't animate, and a removal that is refused leaves the row exactly as it was rather than an invisible strip in the tab order. The caller guards a second press and moves focus on (`FileItem` does both). Use it wherever a row leaves a list: a task done, a record removed, a file deleted, a list entry removed.
- `useValueFade(value)` fades the new value in where the old one stood. Tag and StatusDot use it on their label, so every select and status display crossfades rather than swapping.
- The wash lasts four times `duration-move` (800ms). That multiplier is **owed a `duration-wash` token**: the artifact has no long one-shot duration yet, so it is derived here until the owner adds one. Everything else uses `duration-move`, `duration-popover` or `space-2`, straight from the tokens.

## Not a substitute for words

The wash is the only sign a row changed, and it is visual. Where a change arrives from someone else, the screen still has to say so in words (a feed line, a presence note): nothing here announces anything.

## Reduced motion

`useRowWash` keeps its fade, since the wash is the only sign a row changed. `useDropIn` and `useValueFade` fade without moving. `collapseAway` removes the row at once.

## Tests

The pure parts are checked in `motion.test.ts`; the behaviour is in `Motion.stories.tsx`, which runs in all three engines.
