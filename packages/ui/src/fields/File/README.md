# File

Uploaded files on a record: a contract, a deck.

## Why it exists

The field set gives every attribute type exactly one display and one editor (spec 0003, house rule 3). This folder is the file type's: the grid cell, the record panel, a form, a board card, a filter value and the import preview all draw it through `AttributeDisplay` and edit it through `AttributeEditor`, never directly.

## Use

Screens never import it; they render values through `AttributeDisplay` and `AttributeEditor` with a `FieldAttribute` of this type.

- **Display**: FileItem chips with their type icons, "+N" past `maxVisible`; each name links to the download #32 serves (`FileDisplay.href`).
- **Editor**: a FileDrop that hands files to `onUpload` (#32 uploads and stores them, then commits the new value), and the attached files as FileItems with remove. The grid edits it in a popover, with focus on the panel rather than the first remove button, so the Enter that opened it is never followed by one that removes a file.
- **Text out / in** (copy, paste, CSV, the import preview): names / refused (upload them).
- **Filter operators**: name contains, then is empty and is not empty.

## States

Empty (nothing in a cell, a dash elsewhere, "Empty" for screen readers), a value, and in the editor its own states.

## Keyboard

Tab reaches each file's remove button and the drop zone's browse button.

## Differences from the artifact

The artifact's Field card table names this pairing; the code follows it exactly.
