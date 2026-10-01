# Interaction

The last email or meeting with a record, and who had it.

## Why it exists

The field set gives every attribute type exactly one display and one editor (spec 0003, house rule 3). This folder is the interaction type's: the grid cell, the record panel, a form, a board card, a filter value and the import preview all draw it through `AttributeDisplay` and edit it through `AttributeEditor`, never directly.

## Use

Screens never import it; they render values through `AttributeDisplay` and `AttributeEditor` with a `FieldAttribute` of this type.

- **Display**: a mail or calendar icon (named "Email" or "Meeting"), the relative time ("3 hours ago", exact in a tooltip) and "by" who, from the data layer's `ActorDisplay`.
- **Editor**: read only: the system records interactions (#43, #44).
- **Text out / in** (copy, paste, CSV, the import preview): ISO time and kind / refused.
- **Filter operators**: before, after, within the last, kind is, then is empty and is not empty.

## States

Empty (nothing in a cell, a dash elsewhere, "Empty" for screen readers), a value, and in the editor its own states.

## Keyboard

It takes no focus to edit; the time's tooltip shows on hover.

## Differences from the artifact

The artifact's Field card table names this pairing; the code follows it exactly.
