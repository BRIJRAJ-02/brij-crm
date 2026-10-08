# Url

A web link, or several.

## Why it exists

The field set gives every attribute type exactly one display and one editor (spec 0003, house rule 3). This folder is the url type's: the grid cell, the record panel, a form, a board card, a filter value and the import preview all draw it through `AttributeDisplay` and edit it through `AttributeEditor`, never directly.

## Use

Screens never import it; they render values through `AttributeDisplay` and `AttributeEditor` with a `FieldAttribute` of this type.

- **Display**: a LinkChip to the URL itself; several values are a row of chips with "+N".
- **Editor**: a Field checked on blur. Text without a protocol gets `https://`; only `http` and `https` links are taken, up to 2,048 characters; the scheme and host are lowercased and the path keeps its case.
- **Text out / in** (copy, paste, CSV, the import preview): the URL / the same check.
- **Filter operators**: is, contains, is empty, is not empty.

## States

Empty (nothing in a cell, a dash elsewhere, "Empty" for screen readers), a value, and in the editor: typing, invalid (the Field's error says how to fix it, and nothing is committed), required.

## Keyboard

The editor is a Field: Enter commits in a cell, blur commits elsewhere, Esc cancels. In a grid cell one value is typed in the cell itself; several edit in a popover under the cell, the list with an add field ("Set <Attribute>…", then "Add another…").

## Differences from the artifact

The artifact's Field card table names this pairing; the code follows it exactly.
