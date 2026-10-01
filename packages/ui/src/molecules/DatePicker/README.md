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

## States

Empty (placeholder segments), chosen, focus (accent border and ring), invalid, read only, disabled. In the calendar: today, chosen, in range, hover (pointer only), focus.

## Keyboard

Type into each segment, or use Up and Down to change it and Left and Right to move. Alt Down (or the calendar button) opens the calendar; arrows move by day, Page Up and Page Down by month; Enter chooses; Esc closes it and returns focus.

## Differences from the artifact

- `value` and `onChange` keep `YYYY-MM-DD` strings; `today` comes from the provider's time zone, not a prop; `clearable` is on unless `isRequired`.
- The range variant is new.
