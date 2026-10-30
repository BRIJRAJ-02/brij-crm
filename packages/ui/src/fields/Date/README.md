# Date

A calendar day with no time zone: a close date, a birthday.

## Why it exists

The field set gives every attribute type exactly one display and one editor (spec 0003, house rule 3). This folder is the date type's: the grid cell, the record panel, a form, a board card, a filter value and the import preview all draw it through `AttributeDisplay` and edit it through `AttributeEditor`, never directly.

## Use

Screens never import it; they render values through `AttributeDisplay` and `AttributeEditor` with a `FieldAttribute` of this type.

- **Display**: "Oct 8, 2026" in the language, never shifted by a time zone.
- **Editor**: the DatePicker: typed in the language's order or picked from the calendar, with Today, Tomorrow, Next week and End of month resolved in the provider's time zone. The grid edits it in a popover. Outside a cell a hint says the date can be typed or picked from the calendar.
- **Text out / in** (copy, paste, CSV, the import preview): `2026-10-08` / ISO, or the language's numeric order (`08.10.2026` in German).
- **Polish (30 October 2026)**: Today, tomorrow and yesterday read as the word on every surface (a cell, the panel, a card, a form's display, a filter chip, the import preview), with the exact date in a tooltip and read after it; any other day is the exact date, never "In 6 days". The display reads today through `useToday()`, so a grid of dates re-renders only at midnight, not on each clock tick. A day pasted into the editor's box ("8 Oct 2026", "tomorrow", an ISO instant) fills it whole, and a key typed in a grid cell opens Type a date with it. Paste and imports read the same words (`parseDateInput`, today from `TextContext.today`).
- **Filter operators**: is, before, after, within, then is empty and is not empty.

## States

Empty (nothing in a cell, a dash elsewhere, "Empty" for screen readers), a value, and in the editor its own states (see the component it uses).

## Keyboard

The DatePicker's: type each segment, or Alt Down for the calendar; Esc closes it.

## Differences from the artifact

The artifact's Field card table names this pairing; the code follows it exactly.
