# DatePicker and DateRangePicker

A calendar day, typed or picked from a calendar with quick picks; and a range of days for filters.

## Why it exists

Ported from the artifact's DatePicker card. It is the date attribute's editor (cells, the record panel, forms) and, as a range, the filter and dashboard period picker. It wraps React Aria's `DatePicker`, `DateRangePicker`, `Calendar` and `RangeCalendar`, so dates are typed in the language's order, the week starts on the language's first day, and every part works by keyboard.

## Use

```tsx
<DatePicker label="Projected close" value={close} onChange={setClose} />
<DateRangePicker label="Period" value={{ start: '2026-10-01', end: '2026-10-31' }} onChange={setPeriod} />
```

- Values are calendar days as the value shapes store them, `YYYY-MM-DD`, with no time zone; `null` is none.
- The quick picks are Today, Tomorrow, Next week (the next first day of the week) and End of month, resolved in the provider's time zone (`quickPicks()`); "today" has a dot in the grid. Clear sits with them unless the field is required.
- The range picker has no quick picks (relative ranges are the filter's own).
- `isReadOnly` shows the date with a lock and `readOnlyReason`; `error` says how to fix it.

### MonthCalendar

`<MonthCalendar label="Go to date" value={day} onChange={setDay} />` is the same calendar inline and compact: no field and no popover, shorter days, as wide as its column up to a menu's width. Why a variant: Bookings' calendars panel keeps a small month for jumping to a date, as Google Calendar does; it is DatePicker's month, so it reuses its grid, keys and look rather than adding a calendar. `shown={{ start, end }}` tints the days the view beside it shows (Bookings' week) as one band in `surface-selected`, its ends rounded (at the month's edge too), the chosen day still accent and no hover inside it (the hover surface is lighter than the band, so a hovered day would seem to leave the week), as Google Calendar's small month marks its week. `autoFocus` puts focus on the chosen day as it mounts, for a month opened in a popover (Bookings' Go to date), so the arrows work at once; inline beside a view it stays off.

## States

Empty (placeholder segments), chosen, focus (accent border and ring), invalid, read only, disabled. In the calendar: today, chosen, in range, hover (pointer only), focus; inline, the shown week.

## Keyboard

Enter in the date submits the form around it, as in any text field (Availability's Add a day off).

Type into each segment, or use Up and Down to change it and Left and Right to move. Alt Down (or the calendar button) opens the calendar; arrows move by day, Page Up and Page Down by month; Enter chooses; Esc closes it and returns focus.

MonthCalendar with `autoFocus` (as a popover opens it, like Bookings' Go to date) starts with focus on the chosen day, so the arrows move from it at once.

## Differences from the artifact

- `value` and `onChange` keep `YYYY-MM-DD` strings; `today` comes from the provider's time zone, not a prop; `clearable` is on unless `isRequired`.
- The range variant is new.
