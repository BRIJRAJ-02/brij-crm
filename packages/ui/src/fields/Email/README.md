# Email

An email address, or several.

## Why it exists

The field set gives every attribute type exactly one display and one editor (spec 0003, house rule 3). This folder is the email type's: the grid cell, the record panel, a form, a board card, a filter value and the import preview all draw it through `AttributeDisplay` and edit it through `AttributeEditor`, never directly.

## Use

Screens never import it; they render values through `AttributeDisplay` and `AttributeEditor` with a `FieldAttribute` of this type.

- **Display**: a LinkChip to `mailto:`; several values are a row of chips with "+N" (cells measure, cards show 3).
- **Editor**: a Field checked on blur: trimmed and lowercased; "ada@example" is refused with "Enter an email address with a name and a domain, such as ada@example.com." Several values are removable chips and a field to add one.
- **Text out / in** (copy, paste, CSV, the import preview): the address / parsed and lowercased.
- **Filter operators**: is, contains, is empty, is not empty.

## States

Empty (nothing in a cell, a dash elsewhere, "Empty" for screen readers), a value, and in the editor: typing, invalid (the Field's error says how to fix it, and nothing is committed), required.

## Keyboard

The editor is a Field: Enter commits in a cell, blur commits elsewhere, Esc cancels.

## Differences from the artifact

The artifact's Field card table names this pairing; the code follows it exactly.
