# Checkbox

Yes or no: a flag on a record.

## Why it exists

The field set gives every attribute type exactly one display and one editor (spec 0003, house rule 3). This folder is the checkbox type's: the grid cell, the record panel, a form, a board card, a filter value and the import preview all draw it through `AttributeDisplay` and edit it through `AttributeEditor`, never directly.

## Use

Screens never import it; they render values through `AttributeDisplay` and `AttributeEditor` with a `FieldAttribute` of this type.

- **Display**: the Checkbox's mark (`CheckboxMark`), with no control of its own, since a display never edits. It is never empty: unchecked is `false`. In the grid the cell is the control: Space or a click on the mark toggles it.
- **Editor**: the same Checkbox, toggling in place; each toggle commits. Clearing it makes it `false`.
- **Text out / in** (copy, paste, CSV, the import preview): `TRUE` or `FALSE` / true, false, yes, no, 1, 0 or x.
- **Filter operators**: is checked, is not checked (it is never empty, so it has no empty operators).

## States

Empty (nothing in a cell, a dash elsewhere, "Empty" for screen readers), a value, and in the editor its own states (see the component it uses).

## Keyboard

Space toggles it.

## Differences from the artifact

The artifact's Field card table names this pairing; the code follows it exactly.
