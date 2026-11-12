# FileIcon

A file's type as an icon.

## Why it exists

New. File chips, uploads, attachments and the file preview (#32, #45) show a file's kind the same way. It picks a Lucide icon from the MIME type through the Icon atom, so it needs no CSS of its own.

## Use

```tsx
<FileIcon contentType="application/pdf" />
```

- Images, video, audio, spreadsheets (and CSV), presentations, archives, code and documents each get their icon; anything else is a plain file.
- It is decorative beside a file name; give `label` only when it stands alone.

## States

None.

## Keyboard

It takes no focus.

## Differences from the artifact

Not in the artifact.

## Timefix prototype (spec 0072)

Folded into the prototype's FileDrop, which exports FileIcon as it is: the type's Lucide mark through the Icon atom, muted. It keeps no CSS of its own (it renders Icon), so there is nothing to repeat; FileItem puts it on the prototype's grey tile.
