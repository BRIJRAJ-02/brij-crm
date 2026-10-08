# RecordReference

Links to other records: a person's company, a deal's contacts.

## Why it exists

The field set gives every attribute type exactly one display and one editor (spec 0003, house rule 3). This folder is the recordreference type's: the grid cell, the record panel, a form, a board card, a filter value and the import preview all draw it through `AttributeDisplay` and edit it through `AttributeEditor`, never directly.

## Use

Screens never import it; they render values through `AttributeDisplay` and `AttributeEditor` with a `FieldAttribute` of this type.

- **Display**: a RecordChip (people as circles, companies as squares, names from the data layer's `RecordRefDisplay`); several are a row with "+N".
- **Editor**: "Choose record": a searchable, virtualised Menu whose results come from `onSearch` as a ListSource, so records never all load. A relation that holds many adds; one replaces. The chosen ones are chips with remove. In a grid cell it edits in the cell's popover, with the search and its results in the panel itself under the chosen chips, never a menu over the panel. (The command palette, milestone 3, gives this picker its full look.)
- **Text out / in** (copy, paste, CSV, the import preview): names / refused (choose the records).
- **Filter operators**: is, is any of, and through the relation (Company › Country), then is empty and is not empty.

## States

Empty (nothing in a cell, a dash elsewhere, "Empty" for screen readers), a value, and in the editor its own states.

## Keyboard

The button opens the menu (in a grid cell the search is focused at once, starting from the typed key); typing searches; the arrows move; Enter chooses; Esc closes.

## Differences from the artifact

The artifact's Field card table names this pairing; the code follows it exactly.
