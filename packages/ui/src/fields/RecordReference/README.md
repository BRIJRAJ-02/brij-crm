# RecordReference

Links to other records: a person's company, a deal's contacts.

## Why it exists

The field set gives every attribute type exactly one display and one editor (spec 0003, house rule 3). This folder is the recordreference type's: the grid cell, the record panel, a form, a board card, a filter value and the import preview all draw it through `AttributeDisplay` and edit it through `AttributeEditor`, never directly.

## Use

Screens never import it; they render values through `AttributeDisplay` and `AttributeEditor` with a `FieldAttribute` of this type.

- **Display**: a RecordChip (people as circles, companies as squares, names from the data layer's `RecordRefDisplay`); several are a row with "+N".
- **Editor**: "Choose record": a searchable, virtualised Menu whose results come from `onSearch` as a ListSource, so records never all load. A relation that holds many adds; one replaces. The chosen ones are chips with remove. In a grid cell it edits in the cell's popover, with the search and its results in the panel itself under the chosen chips, never a menu over the panel. (The command palette, milestone 3, gives this picker its full look.)
- **Object switcher** (spec 0019): a reference that may hold records of any object (a task's linked records) passes `objectSwitcher` (`{ objects: [{ id, label, icon, hue }], objectId, onObjectChange }`) through `AttributeEditor`, and ReferencePicker draws a small Select, "Search in", before the button that opens the search; `onSearch` then searches the object chosen. Without it nothing changes. It sits beside the trigger rather than inside the menu's popover, so the Menu molecule needs no new slot.
- **Result notes** (spec 0014): a screen passes `describeResult` (`(display) => { note?, isLinked? }`) through `AttributeEditor`, and each result says what it is beside its name: the note ("At Acme" for a record held on a far side that holds one, "Linked elsewhere" when the reader can't see who holds it) is the item's second line, read by screen readers with the item (its description), and a record already linked shows the item's check. Picking a linked one again on a side that holds many changes nothing, so a record linked past the 20 chips a cell shows is never sent twice. One picker, no new component: the editor passes it to ReferencePicker.
- **Text out / in** (copy, paste, CSV, the import preview): names / refused (choose the records).
- **Filter operators**: is, is any of, and through the relation (Company › Country), then is empty and is not empty.

- **In a form** the picker draws the attribute's name as its visible label (a group named by it), as Field does; a cell and a panel row name it already. A pick with the pointer hands focus back to the button on the next frame, before the menu has faded, so a key pressed meanwhile (Escape in a dialog) reaches the dialog. Chosen records follow the value when it changes from outside (live, or a screen refusing a pick).

## States

Empty (nothing in a cell, a dash elsewhere, "Empty" for screen readers), a value, and in the editor its own states. A linked record whose display has no name yet (the data layer reads the names of linked records by id) draws a skeleton chip, read as "Loading"; one with no display at all says "Unknown".

## Keyboard

The button opens the menu (in a grid cell the search is focused at once, starting from the typed key); typing searches; the arrows move; Enter chooses; Esc closes.

## Differences from the artifact

The artifact's Field card table names this pairing; the code follows it exactly.
