# Phone

A phone number, or several, with its country.

## Why it exists

The field set gives every attribute type exactly one display and one editor (spec 0003, house rule 3). This folder is the phone type's: the grid cell, the record panel, a form, a board card, a filter value and the import preview all draw it through `AttributeDisplay` and edit it through `AttributeEditor`, never directly.

## Use

Screens never import it; they render values through `AttributeDisplay` and `AttributeEditor` with a `FieldAttribute` of this type.

- **Display**: a LinkChip to `tel:`, written the international way (+44 20 7123 4567); several are a row with "+N".
- **Editor**: a Field read by libphonenumber-js (the full metadata, loaded on demand when a phone field shows, so it is never in the first load) in the language's region (`en-GB` gives GB), else the attribute's `defaultCountry`, and checked for that country: "a phone that isn't a number" or one that can't exist is refused with how to fix it. Several numbers are removable chips with a field to add one.
- **Text out / in**: E.164 / parsed with the attribute's or the viewer's country. Paste and imports load the library first and pass it as `TextContext.phone` (`createPhoneParser`).
- **Filter operators**: is, contains, country is, then is empty and is not empty.

## States

Empty, a value, loading (the number shows as stored until the library loads), and in the editor: typing, invalid, required.

## Keyboard

The editor is a Field: Enter commits in a cell, blur commits elsewhere, Esc cancels.

## Differences from the artifact

The artifact's Field card table names this pairing; the code follows it exactly. The schema in contracts checks the shape only; full validity is this editor's (and #30's on import).
