# Rating

One to five stars: the rating attribute's display and editor.

## Why it exists

Ported from the artifact's Rating card. It is the rating type's one display (read only) and one editor, in cells, the record panel, cards and forms. The editor is a React Aria `RadioGroup`, so arrow keys move the rating.

## Use

```tsx
<Rating label="Fit" value={4} isReadOnly />
<Rating label="Fit" value={value} onChange={setValue} />
```

- `value` is 1 to 5, or `null` for no rating (the value shape in contracts).
- Choosing the chosen star again, or pressing Delete or Backspace, clears it to `null`. A required attribute refuses that in the field set.
- Read only, it is one image named "Fit: 4 out of 5 stars".
- A hovered star lights up (pointer only).
- `variant="cell"` is the rating a grid cell edits: the stars keep the cell's padding, where the display had them, and the focused star draws no ring, since the cell draws the one ring and the lit stars show the draft.

## States

No rating, rated, hover, focus, pressed, read only, disabled.

## Keyboard

Tab reaches the chosen star (or the first); arrow keys change the rating; Delete or Backspace clears it.

## Differences from the artifact

- `isReadOnly` replaces `readOnly`; `onChange` can be called with `null`. The maximum is fixed at 5, matching the value shape.
