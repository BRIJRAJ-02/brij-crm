# Rating

One to five stars: fit, priority, interest.

## Why it exists

The field set gives every attribute type exactly one display and one editor (spec 0003, house rule 3). This folder is the rating type's: the grid cell, the record panel, a form, a board card, a filter value and the import preview all draw it through `AttributeDisplay` and edit it through `AttributeEditor`, never directly.

## Use

Screens never import it; they render values through `AttributeDisplay` and `AttributeEditor` with a `FieldAttribute` of this type.

- **Display**: the Rating atom, read only, as one image named "Fit: 4 out of 5 stars".
- **Editor**: the Rating atom. Choosing the chosen star again, or Delete, clears it to `null`, unless the attribute is required. In a grid cell the arrows and a typed digit (1 to 5) choose a draft: Enter commits it, Esc drops it, and a click commits at once.
- **Text out / in** (copy, paste, CSV, the import preview): `4` / 1 to 5, or stars (★★★).
- **Filter operators**: at least, at most, then is empty and is not empty.

## States

Empty (nothing in a cell, a dash elsewhere, "Empty" for screen readers), a value, and in the editor its own states (see the component it uses).

## Keyboard

The arrow keys change the rating; Delete clears it.

## Differences from the artifact

The artifact's Field card table names this pairing; the code follows it exactly.
