# Timestamp

Date and time: a moment people set (a meeting, a follow up), and the system's Created at and Updated at.

## Why it exists

The field set gives every attribute type exactly one display and one editor (spec 0003, house rule 3). This folder is the timestamp type's: the grid cell, the record panel, a form, a board card, a filter value and the import preview all draw it through `AttributeDisplay` and edit it through `AttributeEditor`, never directly.

## Use

Screens never import it; they render values through `AttributeDisplay` and `AttributeEditor` with a `FieldAttribute` of this type.

- **Display** (the field types pass, 31 October 2026): RelativeTime's `moment` variant, "Today 14:30" (or Yesterday, Tomorrow) near today, else the exact day and time in the provider's language, time zone and date format ("8 Oct 2026, 14:30"), with the exact time and its zone in a tooltip. Created at and Updated at read the same way: one display per type. Until this pass it read "3 hours ago", which hides the time someone set.
- **Editor**: the DatePicker for the day (typed or picked, with **Now** first among its quick picks, which sets the day and the time together) and a time Select (`variant="time"`, named after the field, "Follow up time", so two such fields never read alike; searchable; a quarter of an hour apart, plus the value's own time when it falls between them), both in the provider's time zone. Each change commits at once, so a cell's popover stays open for the other half; the time waits for a day, showing its placeholder. A system attribute (Created at, Updated at) is read only, with its lock.
- **Text out / in** (copy, paste, CSV, the import preview): ISO 8601 in UTC / an ISO moment with its zone, a day and a time ("2026-10-08 14:30") in the time zone, or a day alone ("8 Oct 2026", "tomorrow") at its start; anything else is refused with an example.
- **Filter operators**: before, after, within the last, more than ago, then is empty and is not empty. Their operand is a day (the DatePicker), as the engine compares moments by day.

## States

Empty (nothing in a cell, a dash elsewhere, "Empty" for screen readers), a value, refused (the day's field says why), disabled (the time waits for a day), and read only for the system's own.

## Keyboard

The day as the DatePicker's (segments, Alt Down for the calendar, Type a date, the quick picks); Tab moves to the time, which opens with Enter, Space or the arrows and filters as you type.

## Differences from the artifact

The artifact's Field card table names this pairing as read only; the code makes it editable for attributes people make (the field types pass), and keeps the system's read only.
