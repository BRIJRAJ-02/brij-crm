# FileItem

One file in a list: its type, name and size, upload progress or its error, and remove.

## Why it exists

New. File attributes (#32) and email attachments (#45) list files the same way, during upload and after. It is also the file type's display in the field set.

## Use

```tsx
<FileItem name="Q4 deck.pdf" size={2_400_000} contentType="application/pdf" href={file.href} onRemove={remove} />
<FileItem name="Logo.png" size={84_000} contentType="image/png" progress={40} />
```

- The size formats in the provider's language in the largest whole unit ("2.4 MB").
- While `progress` is under 100 it shows a ProgressBar; `error` replaces it with what failed and what to do.
- `variant="chip"` is a 20px chip with the icon and the name, for cells and cards (the file type's display).
- `href` makes the name a link (#32 serves it); `onRemove` adds the remove button.

## States

Done, uploading (progress), failed (danger edge and message).

## Keyboard

The name link and the remove button take focus.

## Differences from the artifact

Not in the artifact.
