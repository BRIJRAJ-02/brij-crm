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

- Its hint reads "Drag a file here, or browse" when it takes one file and "Drag files here, or browse" with `allowsMultiple` (QA, 22 October 2026).

Idle, with a preview, drag over (accent), focus, refused (the error under it), disabled.

`preview` (26 October 2026) draws the picture that is there already in the upload icon's place, for a single file
picker that replaces one: a page's share image, and later an avatar or a logo. Somebody should see what they are
about to replace. It goes through `safeImageSrc` as every image in the library does, so only our own origin, a
`data:` or a `blob:` is ever drawn, and it falls back to the icon without a word if the image won't load, since a
broken picture inside a drop box reads as a broken control.

## Keyboard

Tab reaches the box and the browse button; Enter on browse opens the file picker. Pasting files into the focused box drops them.

## Differences from the artifact

Not in the artifact.
