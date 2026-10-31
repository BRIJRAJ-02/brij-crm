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
- The `href` link always opens in a new tab: it answers a file (an image the browser shows, or a download), never an app page, so the app's router must not take the click (before 31 Oct 2026 it did, and a file chip's click went to the app's not found page).
- `detail` (any node) follows the size on the same line ("2.4 MB · Ada Lovelace, 2 days ago"): a record's Files tab says who added each file and when, its time a RelativeTime.

## States

Done, uploading (progress), failed (danger edge and message).

## Keyboard

The name link and the remove button take focus.

## Differences from the artifact

Not in the artifact.
