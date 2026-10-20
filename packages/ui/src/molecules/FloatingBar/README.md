# FloatingBar

The floating bar's shell: a raised, rounded bar with the popover shadow, one row of content, that rises in and sinks out. BulkActionBar and SaveBar are built on it.

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
- It rises `space-8` as it mounts (`duration-popover`, `ease-out`). `isLeaving` sinks it out in `duration-exit`, inert meanwhile, then calls `onLeft` so the owner can unmount it. Reduced motion keeps the fade and drops the movement.
- Content too long for one line wraps onto a second (a save that failed, with its reason, on a phone).
- On a narrow view (under 480px) it spans the width, inside the gutter.
- `frameProps` puts handlers on the whole bar (BulkActionBar's Esc).

## States

Shown, leaving; inline and in a footer (stories), floating (BulkActionBar's and DataGrid's stories); wide and narrow (SaveBar's narrow story).

## Keyboard

None of its own: its content takes focus.

## Differences from the artifact

Not in the artifact.
