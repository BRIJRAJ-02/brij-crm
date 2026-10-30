# Location

An address in parts: a company's office, a person's city.

## Why it exists

The field set gives every attribute type exactly one display and one editor (spec 0003, house rule 3). This folder is the location type's: the grid cell, the record panel, a form, a board card, a filter value and the import preview all draw it through `AttributeDisplay` and edit it through `AttributeEditor`, never directly.

## Use

Screens never import it; they render values through `AttributeDisplay` and `AttributeEditor` with a `FieldAttribute` of this type.

- **Display**: "London, United Kingdom" in cells and on cards (the country's name from `Intl.DisplayNames` in the language); the whole address, a line per part, in the panel and forms.
- **Editor**: a Field per part (address lines, city, region, postcode) and the design system's one `CountryPicker` (`list="all"`) for the country: every country and territory with its flag, named in the provider's language, sorted by name, searchable, handing back the ISO code. Focus leaving the parts commits the address once, which needs at least one part. The grid edits it in a popover. A filter's "country is" uses the same picker.
- **Text out / in** (copy, paste, CSV, the import preview): the parts joined by ", " / one line read into its parts ("London, UK" is London in the United Kingdom).
- **Polish (30 October 2026)**: The editor shows the address line, the city and the country; the second line, region and postcode wait behind More (open when one holds something). A whole address pasted into the first line ("10 Downing St, London SW1A 2AA, UK") fills every part (`locationFromText` in `parse.ts`), and paste and imports read one line the same way instead of refusing it. The country list leads with the workspace's country.
- **Filter operators**: country is, city is, region is, then is empty and is not empty.

## States

Empty (nothing in a cell, a dash elsewhere, "Empty" for screen readers), a value, and in the editor its own states (see the component it uses).

## Keyboard

Tab moves between the parts; each blur commits.

## Differences from the artifact

The artifact's Field card table names this pairing; the code follows it exactly.
