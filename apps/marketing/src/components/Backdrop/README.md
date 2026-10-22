# Backdrop

The fold's decoration: a field of short accent dashes in each foot of the fold, behind the window, uncovered from the foot up when the page opens and then drifting slowly.

## Why it exists

The owner pointed at Twenty's home (23 October 2026), whose fold draws a field of blue dashes behind the window with three.js, then asked to keep the element but make it quieter, with the window the main focus. The library has no decorative element, rightly, so this lives on the site, and three.js is far too much for a static page. Each side is two layers: a still SVG pattern (6 × 2 dashes on a 14 × 12 grid) under two masks that fade it out upward and toward the window, which is in the prerendered page so the field is there before any script; and a 2D canvas that takes over once hydrated and draws the field live as a random pattern (a third of the cells empty, the dashes of differing length and weight, fixed per cell so it holds still as it moves; the owner, 23 October 2026), uncovering the rows from the foot up, drifting a slow wave of brightness across them, and lighting the dashes under the pointer (the glow eases after it and drifts off when the pointer leaves). The colour is the `--accent` token read from the element, drawn at 70%. It draws at 30 frames a second only while on screen and the page is visible.

## Use

```tsx
<Backdrop side="start" />
<Backdrop side="end" />
```

Inside a positioned parent (FirstFold's main), under the content.

## States

- **Before script:** the still field, uncovered from the foot up over `duration-pulse` by CSS.
- **Live:** the canvas, same field, with the reveal, the drift, and the pointer's glow.
- **Reduced motion:** the still field with no animation; the canvas never starts.
- **Phone:** hidden; the window takes the width.
- Decorative: `aria-hidden`, no pointer events.
