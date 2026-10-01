# Number

An exact number: a headcount, a score, a quantity.

## Why it exists

The field set gives every attribute type exactly one display and one editor (spec 0003, house rule 3). This folder is the number type's: the grid cell, the record panel, a form, a board card, a filter value and the import preview all draw it through `AttributeDisplay` and edit it through `AttributeEditor`, never directly.

## Use

Screens never import it; they render values through `AttributeDisplay` and `AttributeEditor` with a `FieldAttribute` of this type.

- **Display**: tabular figures in the language's grouping, end aligned in cells. The stored decimal string is formatted exactly, with up to 4 decimals and no float rounding.
- **Editor**: a Field with a decimal keyboard. Typing is read in the language's format (`1.234,5` in German), falling back to the canonical form, by the library's own decimal parser, never a JS number. Five decimals or a word is refused with "Enter a number like 1,234.5, with up to 4 decimals."
- **Text out / in** (copy, paste, CSV, the import preview): canonical decimal / the language's format or canonical.
- **Filter operators**: =, ≠, >, ≥, <, ≤, between, is empty, is not empty.

## States

Empty (nothing in a cell, a dash elsewhere, "Empty" for screen readers), a value, and in the editor: typing, invalid (the Field's error says how to fix it, and nothing is committed), required.

## Keyboard

The editor is a Field: Enter commits in a cell, blur commits elsewhere, Esc cancels.

## Differences from the artifact

The artifact's Field card table names this pairing; the code follows it exactly.
