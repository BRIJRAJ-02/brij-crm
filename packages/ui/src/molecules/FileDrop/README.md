# FileDrop

Drop files here or browse for them.

## Why it exists

New. Imports (#30) and file attributes (#32) take files the same way, and say up front which types and sizes they accept. It wraps React Aria's `DropZone` and `FileTrigger`, so dropping works by keyboard and screen reader too (paste or the browse button).

## Use

```tsx
<FileDrop label="Upload a CSV" acceptedTypes={['text/csv', '.xlsx']} maxSize={50_000_000} onFiles={start} />
```

- `acceptedTypes` takes MIME types or extensions; `maxSize` is in bytes and shows as "up to 50 MB".
- A file of the wrong type or over the size is refused with a sentence on what to do; `onFiles` only gets files that pass.
- `allowsMultiple` takes several at once; otherwise the first.

## States

Idle, drag over (accent), focus, refused (the error under it), disabled.

## Keyboard

Tab reaches the box and the browse button; Enter on browse opens the file picker. Pasting files into the focused box drops them.

## Differences from the artifact

Not in the artifact.
