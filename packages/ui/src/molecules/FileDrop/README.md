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
- `typesText` names the accepted types as people say them ("PNG, JPG or WebP") in the hint and the refusal, where the raw `acceptedTypes` would read `image/png, image/jpeg`.
- `wrongTypeText(fileName)` lets the screen say something better than "Choose .csv" for a type it can name (the import page: an Excel file, and how to save it as CSV); answering undefined keeps the built in sentence.

- `variant="button"` (27 October 2026) is the browse button alone, `label` its words, with `isPending` while what was picked is on its way: for a picker beside the thing it changes, first run's avatar, where a drop area would draw the picture a second time. Same type and size checks, same refusal line under it. Why a variant, not a new component: it is FileDrop's own FileTrigger and checks with the drop area taken away; a second file picker would have checked files a second way.

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
