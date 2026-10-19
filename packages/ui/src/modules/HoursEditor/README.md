# HoursEditor

Weekly hours for a booking page: several windows a day, All days start and end, Copy times to (spec 0025, AC-624, AC-680).

## Why it exists

New. A booking page needs several windows a day (split shifts), a day turned off, every day's start or end set at once, and one day's hours copied to others. The library has the parts (Switch, Select, Button, Checkbox, Popover) but no row that joins a day to a run of windows, and building it in a screen would mean screen CSS, which the house rules refuse.

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

- **All days start** and **All days end** set the first window's start and the last window's end of every day that is on; each reads "Mixed" while the days differ.
- The switch turns a day on (09:00 to 17:00) or off; a day with no window is off and reads "Unavailable".
- Each window is a pair of time Selects every `stepMinutes` (30 by default), the last end "Midnight". **+** on the first window adds the hour after the last (at most 6 a day); **−** on any other removes it.
- **Copy times to** opens a Popover of the other days with Select all and **Apply**, and calls `onChange` for each day chosen with this day's windows.
- `error` on a row shows under its windows as an alert (overlapping windows, an end before its start: the caller checks).

## States

On, off, several windows, Mixed, a row's error, disabled; the controls' own hover, focus and pressed states.

## Keyboard

Tab moves through All days start and end, then each row's switch, its Selects and buttons in order. Every control is labelled with its day ("Monday from", "Remove 13:00 to 17:00 on Monday", "Copy Friday's times to"). The Popover closes on Esc and returns focus to its button.

## Differences from the artifact

Not in the artifact.
