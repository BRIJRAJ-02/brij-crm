FileDrop takes files by drag and drop or a Choose button, and FileRow shows each one as it uploads, lands or fails.

**Use it for**: attachments on a record, a form's file question, logos and imports. `zone` for a page or form, `compact` for a record panel. **Don't use it for** a single image that needs cropping (use the photo picker) or a link to a file elsewhere (use a URL field).

**The consumer provides**: FileDrop takes `label`, `description` (the types and size in plain words), `acceptedFileTypes`, `allowsMultiple`, `onFiles` (check type and size there and add error rows), `isDisabled`, `variant`. FileRow takes `name`, `size`, `type`, `progress` (0–100 while in flight), `error` (a sentence that says what to do), `onRemove`, `onRetry`, `detail`. `FileList` wraps the rows; `FileIcon` is exported; sizes read through `formatBytes` in `lib/format.ts`.

**States**: zone at rest (dashed `border-strong`), files over it (dashed accent, `accent-soft` wash, the icon lifts 4px), focus-visible ring, disabled. Rows: uploading (accent bar and tabular percent), done (size), failed (red icon tile, red sentence, Retry).

**Interaction**: drop anywhere on the zone, or Tab to Choose files and press Enter. New rows drop in at the top (250ms, rows open from 0fr with a 12px rise); Remove or Cancel collapses the row out the same way before it leaves the list. Retry restarts the upload in place.

**Replaces**: FileDrop, FileItem, FileIcon.
