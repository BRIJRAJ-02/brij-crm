# RemoteCursor

Where another person is typing in a shared note.

## Why it exists

Ported from the artifact's RemoteCursor card. Live notes (#27) show each collaborator's caret and name; the editor's collaboration cursor renders this.

## Use

```tsx
<RemoteCursor name="Maya" hue="purple" />
```

- `hue` is the person's presence hue, the same as their avatar's.
- The flag uses the hue's tag colours, so the name holds 4.5:1 in every hue.

## Pointer

`variant="pointer"` (spec 0073, AC-7309, the prototype's RemoteCursor) is another person's pointer on a shared surface (a board, a form builder): an arrow in their dot colour with their name on a pill in their tag colours, at `x` and `y` px inside the nearest positioned ancestor.

```tsx
<RemoteCursor variant="pointer" name="Maya" hue="purple" x={point.x} y={point.y} isIdle={isIdle} />
```

- Each new point glides from the last over `duration-quick` on `ease-smooth-out`, so updates every 100 to 150 ms read as motion. It moves by `translate` only, so a stream of points costs no layout (AC-7324).
- `isIdle` folds the name away and dims the arrow. Reduced motion jumps to each point.
- The arrow is a shape cut by `clip-path`, not a Lucide icon, so the icon registry every page carries does not grow.
- Draw only people the access door lets the viewer see (the screen's job). The caret (the default) is unchanged.

## States

Caret; pointer moving; pointer idle.

## Keyboard

It takes no focus and can't be selected. Both kinds are hidden from screen readers: the page's PresenceGroup says who is here.

## Differences from the artifact

- The flag takes the hue's tag colours rather than the dot colour, so yellow and lime names stay readable.
