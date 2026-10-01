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

## States

None.

## Keyboard

It takes no focus and can't be selected.

## Differences from the artifact

- The flag takes the hue's tag colours rather than the dot colour, so yellow and lime names stay readable.
