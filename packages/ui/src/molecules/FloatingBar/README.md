# FloatingBar

The floating bar's shell: the Timefix prototype's white pill with the large shadow, one row of content, that rises in and drops away. BulkActionBar and SaveBar are built on it, and share its `FloatingBarGroup` (a run of actions after a hairline).

## Why it exists

New (20 October 2026). The owner asked for the save bar to be the same family as the bulk bar: the same size, corners, shadow, placement and motion. A second copy of the bulk bar's CSS would drift, and SaveBar can't style BulkActionBar's insides, so the shell moved here and both bars put their own content in it.

## Use

```tsx
<FloatingBar placement="floating">
  <span>12 selected</span>
  <Button>Delete</Button>
</FloatingBar>

<FloatingBar placement="footer" isLeaving={isLeaving} onLeft={() => setShown(false)}>
  …
</FloatingBar>
```

- `placement="inline"` (the default) leaves it where it is put. `footer` centres it in a page's sticky footer (PageColumn's, PreviewLayout's), at the view's foot and in the flow after the last card. `floating` centres it `space-16` above the bottom of its nearest positioned container (the DataGrid's frame), over the rows. Centred, only the bar takes the pointer.
- It rises with the toast motion (transitions.dev 22: from `space-16` lower at `scale-medium`, over `duration-medium` on `ease-smooth-out`). `isLeaving` drops it away the same way over `duration-fast`, inert meanwhile, then calls `onLeft` so the owner can unmount it. Reduced motion keeps the fade and drops the movement.
- `isInstant` makes it come and go at once, with no rise, sink or fade, and `onLeft` follows in the next frame: a bar opened or closed from the keyboard (BulkActionBar after a Space or Esc in the grid), as the house motion rule asks of anything opened from the keyboard.
- Content too long for one line wraps onto a second (a save that failed, with its reason, on a phone).
- On a narrow view (under 480px) it spans the width, inside the gutter.
- `frameProps` puts handlers on the whole bar (BulkActionBar's Esc).

## States

Shown, leaving, at once (opened from the keyboard); inline and in a footer (stories), floating (BulkActionBar's and DataGrid's stories); wide and narrow (SaveBar's narrow story).

## Keyboard

None of its own: its content takes focus.

## Differences from the artifact

Not in the artifact.

## Timefix prototype (spec 0072)

Takes its look from the prototype's FloatingBar in its `white` tone: `size-control-lg` tall, `space-4` around its content and `space-16` before it, a hairline `border`, `shadow-lg` on `surface-raised`, pill corners (half the one row's height, so a bar that wraps on a phone keeps round, not semicircular, ends), and the toast motion in and out. `FloatingBarGroup` (`isAlone`, `isEnd`, `ref`) is the bars' run of actions after a hairline, `space-4` apart; it lives here so the bulk bar and the save bar keep no copy of it. It is not exported from the package.

**Use it for** the actions on what someone just did (a selection, unsaved work) at the foot of a region. **Don't use it for** a message with no action (a toast), or two bars in one region.

**States**: shown, leaving (inert, dropping away), at once (opened from the keyboard, no motion), wrapped (a long failure on a phone).

**Differences from the prototype**
- One tone: the prototype draws the bulk bar and the save bar in ink with its own `BarButton`s. The library's bars hold the library's Buttons (callers pass Delete, Add to list, a Callout), whose ghost, danger and primary looks read on white only; the ink tone waits for an on ink Button look, owed to the screen phase that moves the bars' callers (phase 4).
- It still wraps to a second row when its content can't fit, where the prototype hides its buttons' words: kept, since a save's failure reason must read whole.
- No toast lift: toasts don't rise above a shown bar yet (owed with the ink tone).
- `placement` (`inline`, `footer`, `floating`), `isLeaving` with `onLeft`, `isInstant` and `frameProps` are the library's.
