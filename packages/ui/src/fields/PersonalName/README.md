# PersonalName

A person's name: first, last and the full name made from them.

## Why it exists

The field set gives every attribute type exactly one display and one editor (spec 0003, house rule 3). This folder is the personalname type's: the grid cell, the record panel, a form, a board card, a filter value and the import preview all draw it through `AttributeDisplay` and edit it through `AttributeEditor`, never directly.

## Use

Screens never import it; they render values through `AttributeDisplay` and `AttributeEditor` with a `FieldAttribute` of this type.

- **Display**: the full name on one line (the record header adds the avatar beside it).
- **Editor**: first and last name Fields side by side; the full name is made from them. Focus leaving the group commits. The grid edits it in a popover.
- **Text out / in** (copy, paste, CSV, the import preview): the full name / "Last, First", or split at the first space.
- **Filter operators**: contains, first name is, last name is, then is empty and is not empty.

## States

Empty (nothing in a cell, a dash elsewhere, "Empty" for screen readers), a value, and in the editor its own states (see the component it uses).

## Keyboard

Tab moves between the two names; Enter or blur commits.

## Differences from the artifact

The artifact's Field card table names this pairing; the code follows it exactly.
