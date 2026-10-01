# Timestamp

An instant the system records: created, last updated.

## Why it exists

The field set gives every attribute type exactly one display and one editor (spec 0003, house rule 3). This folder is the timestamp type's: the grid cell, the record panel, a form, a board card, a filter value and the import preview all draw it through `AttributeDisplay` and edit it through `AttributeEditor`, never directly.

## Use

Screens never import it; they render values through `AttributeDisplay` and `AttributeEditor` with a `FieldAttribute` of this type.

- **Display**: a RelativeTime ("3 hours ago"), kept current by the provider's clock, with the exact time and its zone in a tooltip.
- **Editor**: read only: the system writes it, so the editor shows the display with a lock.
- **Text out / in** (copy, paste, CSV, the import preview): ISO 8601 / refused ("The system sets this time").
- **Filter operators**: before, after, within the last, then is empty and is not empty.

## States

Empty (nothing in a cell, a dash elsewhere, "Empty" for screen readers), a value, and in the editor its own states (see the component it uses).

## Keyboard

It takes no focus to edit; the tooltip shows on hover.

## Differences from the artifact

The artifact's Field card table names this pairing; the code follows it exactly.
