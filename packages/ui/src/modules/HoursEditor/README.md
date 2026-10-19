# HoursEditor

Weekly hours or date overrides as rows of time ranges, for a booking page's availability (spec 0025, AC-624).

## Why it exists

New. A booking page needs several ranges a day (split shifts), a day turned off, and dates with their own hours. The library has the parts (Switch, Select, Button) but no row that joins a day to a run of ranges, and building the row in a screen would mean screen CSS, which the house rules refuse. One module serves both the week and the dates, so they edit the same way.

## Use

```tsx
<HoursEditor
  label="Weekly hours"
  rows={[
    {
      id: 'mon',
      label: 'Monday',
      ranges: [
        ['09:00', '12:00'],
        ['13:00', '17:00'],
      ],
    },
    { id: 'sat', label: 'Saturday', ranges: [] },
  ]}
  onChange={(day, ranges) => save(day, ranges)}
/>
```

- The switch turns a day on (09:00 to 17:00) or off; a day with no range is off and reads "Unavailable".
- Each range is a pair of time Selects every `stepMinutes` (15 by default), the end up to 24:00, with a remove button.
- Add hours appends the hour after the last range (at most 6 a day).
- `onRemoveRow` adds a remove button per row, for date overrides.
- `error` on a row shows under its ranges as an alert (overlapping ranges, an end before its start: the caller checks).

## States

On, off, several ranges, a row's error, disabled; the controls' own hover, focus and pressed states.

## Keyboard

Tab moves through each row's switch, its Selects and buttons in order. Every control is labelled with its day ("Monday from", "Remove 09:00 to 12:00 on Monday").

## Differences from the artifact

Not in the artifact.
