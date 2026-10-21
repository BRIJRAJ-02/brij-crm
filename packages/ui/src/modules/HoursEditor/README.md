# HoursEditor

Weekly hours for a booking page: several windows a day, Copy times to, Set all days (spec 0025, AC-624, AC-680).

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

- **Set all days** is a quiet ghost button under the week (the owner's call, 22 October 2026: no permanent All days row reading "Mixed"): it opens a Popover with one start and one end, filled with the days' shared times (else 9 to 5), and Apply sets the first window's start and the last window's end of every day that is on. It waits while no day is on.
- The switch turns a day on (9:00 AM to 5:00 PM, stored as `09:00` to `17:00`) or off; a day with no window is off and reads "Unavailable".
- Each window is a pair of time Selects (`variant="time"`, one fixed width with tabular figures) every `stepMinutes` (30 by default), on the 12 hour clock by default ("9:30 AM", the owner's call, F12), in the provider's language; `hourClock="locale"` follows the reader's own clock instead ("09:30" where the day runs to 24 hours). The day's end is "Midnight" on a 12 hour clock, where "12:00 AM" would read as its start, and "24:00" on a 24 hour one. Values stay `HH:MM`. "to" sits at one width between them, so start, "to", end and the + or − line up across every row and never move when a time changes.
- **+** on the first window adds the hour after the last (at most 6 a day, and only while an hour and a half is left before midnight, so it never adds a window over the last); **−** on any other removes it. Each has a tooltip ("Add hours", "Remove these hours") beside its name; a + that waits says why ("No room for more hours this day").
- **Copy** follows the first window, with the tooltip "Copy to other days": a Popover of the other days with Select all and **Apply**, which calls `onChange` for each day chosen with this day's windows.
- The days part by their rhythm (each row a control's height with `space-4` above and below), with no rules between them, so no line competes with the fields.
- In a narrow card (under 480px) the day and Copy share a line and the windows sit under them at the card's start, and a day off says Unavailable at the end of its own line.
- `isReadOnly` shows the week as text, each day's windows or "Unavailable", with no controls: hours that come from elsewhere, such as a page that follows its member's hours.
- `error` on a row shows under its windows, at their start and no wider than them, as an alert (overlapping windows, an end before its start: the caller checks).

## States

On, off, several windows, a row's error, disabled, read only, loading (`isLoading`: each day's row and Set all days in place, a skeleton where the times go); the controls' own hover, focus and pressed states.

## Keyboard

Tab moves through each row's switch, its Selects and buttons in order, then Set all days. Every control is labelled with its day ("Monday from", "Add more hours on Monday", "Remove 1:00 PM to 5:00 PM on Monday", "Copy Friday's times to other days"). Each Popover (Copy times to, Set all days) closes on Esc and returns focus to its button.

## Differences from the artifact

Not in the artifact.
