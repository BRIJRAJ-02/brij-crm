# Location

An address in parts: a company's office, a person's city.

## Why it exists

The field set gives every attribute type exactly one display and one editor (spec 0003, house rule 3). This folder is the location type's: the grid cell, the record panel, a form, a board card, a filter value and the import preview all draw it through `AttributeDisplay` and edit it through `AttributeEditor`, never directly.

## Use

Screens never import it; they render values through `AttributeDisplay` and `AttributeEditor` with a `FieldAttribute` of this type.

- **Display**: "London, United Kingdom" in cells and on cards (the country's name from `Intl.DisplayNames` in the language); the whole address, a line per part, in the panel and forms.
- **Editor**: a Field per part (address lines, city, region, postcode) and `CountryPicker` for the country: every country named in the provider's language, sorted by name, in a searchable Select that hands back the ISO code. Focus leaving the parts commits the address once, which needs at least one part. The grid edits it in a popover. A filter's "country is" uses the same picker.
- **Text out / in** (copy, paste, CSV, the import preview): the parts joined by ", " / refused (edit the parts).
- **Filter operators**: country is, city is, region is, then is empty and is not empty.

## States

Empty (nothing in a cell, a dash elsewhere, "Empty" for screen readers), a value, and in the editor its own states (see the component it uses).

## Keyboard

Tab moves between the parts; each blur commits.

## Differences from the artifact

The artifact's Field card table names this pairing; the code follows it exactly.
