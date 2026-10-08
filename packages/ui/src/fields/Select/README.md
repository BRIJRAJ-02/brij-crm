# Select

One option from a list, or several: a stage, a segment, tags.

## Why it exists

The field set gives every attribute type exactly one display and one editor (spec 0003, house rule 3). This folder is the select type's: the grid cell, the record panel, a form, a board card, a filter value and the import preview all draw it through `AttributeDisplay` and edit it through `AttributeEditor`, never directly.

## Use

Screens never import it; they render values through `AttributeDisplay` and `AttributeEditor` with a `FieldAttribute` of this type.

- **Display**: a Tag in the option's hue; several values are a TagList with "+N" (cards show 3). Archived options show muted, with "(archived)" for screen readers. An option that was deleted shows as a muted "Deleted option".
- **Editor**: a Select of tags for up to 15 options; past that, a Menu with search; and a Menu with checks when the attribute holds several. Archived options can't be chosen. "Clear" shows when the attribute isn't required. In a grid cell a short single select is its list, open at once from the cell (Select's `cell` variant, the trigger filling the cell); a long or multiple one searches and checks in the cell's popover, with the search and options in the panel itself. Each option draws its label once, as its Tag.
- **Text out / in** (copy, paste, CSV, the import preview): labels joined by ", " / labels matched ignoring case; an unknown label is refused ("No option called 'Hot'"), and so is an archived one.
- **Filter operators**: one value: is, is not, is any of; several: contains any of, contains all of, contains none of; then is empty and is not empty.

## States

Empty (nothing in a cell, a dash elsewhere, "Empty" for screen readers), a value, and in the editor its own states (see the component it uses).

## Keyboard

The Select or the Menu's: the arrows move, typing searches, Enter chooses, Esc closes.

## Differences from the artifact

The artifact's Field card table names this pairing; the code follows it exactly.
