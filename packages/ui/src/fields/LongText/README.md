# LongText

Plain text with its line breaks: a description, notes from a call.

## Why it exists

The field set gives every attribute type exactly one display and one editor (spec 0003, house rule 3). This folder is the longtext type's: the grid cell, the record panel, a form, a board card, a filter value and the import preview all draw it through `AttributeDisplay` and edit it through `AttributeEditor`, never directly.

## Use

Screens never import it; they render values through `AttributeDisplay` and `AttributeEditor` with a `FieldAttribute` of this type.

- **Display**: clipped to one line in cells and on cards; the whole text with its line breaks in the panel, forms and previews.
- **Editor**: a Field `multiline` that grows with its content, with a counter up to 10,000 characters. The grid edits it in a popover.
- **Text out / in** (copy, paste, CSV, the import preview): as it is / as it is.
- **Filter operators**: contains, does not contain, is empty, is not empty.

## States

Empty (nothing in a cell, a dash elsewhere, "Empty" for screen readers), a value, and in the editor: typing, invalid (the Field's error says how to fix it, and nothing is committed), required.

## Keyboard

The editor is a Field: Enter commits in a cell, blur commits elsewhere, Esc cancels.

## Differences from the artifact

The artifact's Field card table names this pairing; the code follows it exactly.
