# Status

Where a record stands, one status at a time: a deal stage, a ticket's state.

## Why it exists

The field set gives every attribute type exactly one display and one editor (spec 0003, house rule 3). This folder is the status type's: the grid cell, the record panel, a form, a board card, a filter value and the import preview all draw it through `AttributeDisplay` and edit it through `AttributeEditor`, never directly.

## Use

Screens never import it; they render values through `AttributeDisplay` and `AttributeEditor` with a `FieldAttribute` of this type.

- **Display**: a StatusDot in the status's hue, with its label; archived statuses show muted.
- **Editor**: a Select with dot options; archived statuses can't be chosen; "Clear" when not required. The grid edits it in a popover.
- **Text out / in** (copy, paste, CSV, the import preview): the label / the label, matched ignoring case.
- **Filter operators**: is, is not, is any of, then is empty and is not empty.

## States

Empty (nothing in a cell, a dash elsewhere, "Empty" for screen readers), a value, and in the editor its own states (see the component it uses).

## Keyboard

The Select's: the arrows open and move, Enter chooses, Esc closes.

## Differences from the artifact

The artifact's Field card table names this pairing; the code follows it exactly.
