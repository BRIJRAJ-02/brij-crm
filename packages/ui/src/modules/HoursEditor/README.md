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
- Each window is a pair of time Selects (`variant="time"` at the default `size-control` height, one fixed width with tabular figures) every `stepMinutes` (30 by default), on the 12 hour clock by default ("9:30 AM", the owner's call, F12), in the provider's language; `hourClock="locale"` follows the reader's own clock instead ("09:30" where the day runs to 24 hours). The day's end is "Midnight" on a 12 hour clock, where "12:00 AM" would read as its start, and "24:00" on a 24 hour one. Values stay `HH:MM`. "to" sits at one width between them, so start, "to", end and the + or − line up across every row and never move when a time changes.
- **+** on the first window adds the hour after the last (at most 6 a day, and only while an hour and a half is left before midnight, so it never adds a window over the last); **−** on any other removes it. Each has a tooltip ("Add hours", "Remove these hours") beside its name; with no room left (the day runs to its end) there is no + at all, never one left off with no reason (the owner, 22 October 2026).
- A day of 12:00 AM to Midnight reads "All day", with Set hours (back to 9 to 5) beside it.
- The rows share the week's columns (CSS subgrid), so the windows and Copy sit at one place down the week whatever a row holds.
- **Copy** follows the first window, with the tooltip "Copy to other days": a Popover of the other days with Select all and **Apply**, which calls `onChange` for each day chosen with this day's windows.
- The days are rows `space-12` tall above and below their controls, parted by full width `border-subtle` hairlines (the Timefix prototype's, spec 0072; before it they parted by rhythm alone).
- In a narrow card (under 480px) the day and Copy share a line and the windows sit under them at the card's start, and a day off says Unavailable on its own line in the times' column, right after the day, as on a wide card.
- `isSingleDay` edits one date's hours, not a week (the Team week's cell, spec 0037): a Working switch on its own line, then each window on a line of its own (start, "to", end, then + on the first and − on the others), with no Copy times to and no Set all days, since there is no other day. An end is offered only after its start, and a start moved past its end takes the end an hour on. Its `isLoading` still draws the week's shape (no caller loads a single day: the Roster opens its editor on a day it already holds). It sizes itself by its content, not as a container, so it opens whole in a Popover (it collapsed to a sliver in one and cut its end time off, 31 October 2026). Why a variant: the cell's Popover needs exactly a row's switch, windows, + and −, and a second copy of that row would have duplicated its Selects, steps and labels.
- `pastMidnightUntil` (`HH:MM`, spec 0065) lets a window run into the next morning, for a restaurant's or a bar's late hours: the end times go on past Midnight to that time, shown as the time with "next day" beside it in the list (the field itself keeps its width) and read "2:00 AM next day" as text, and are stored past `24:00` (`26:00`), so a range stays one window of the day it starts on. The caller checks that only the day's last window does so. Why a variant: the late hours are this editor's rows with a longer list of ends; a second editor would repeat every row, Select and label.
- `isReadOnly` shows the week as text, each day's windows or "Unavailable", with no controls: hours that come from elsewhere, such as a page that follows its member's hours.
- `error` on a row shows under its windows, at their start and no wider than them, as an alert (overlapping windows, an end before its start: the caller checks).

## States

On, off, several windows, a window past midnight (`PastMidnight`), a row's error, disabled, read only, loading (`isLoading`: each day's row and Set all days in place, a skeleton where the times go); the controls' own hover, focus and pressed states.

## Keyboard

Tab moves through each row's switch, its Selects and buttons in order, then Set all days. Every control is labelled with its day ("Monday from", "Add more hours on Monday", "Remove 1:00 PM to 5:00 PM on Monday", "Copy Friday's times to other days"). Each Popover (Copy times to, Set all days) closes on Esc and returns focus to its button.

## Differences from the artifact

Not in the artifact.

## Timefix prototype (spec 0072)

Takes its look from the prototype's HoursEditor: a row per day, `space-12` / `space-8` of room, parted by full width `border-subtle` hairlines (no cards). The day's switch sits in a column three fifths of `size-menu` wide, `space-16` from its windows; each window is two `size-control` time Selects with "to" in `text-tertiary` between, then + (on the first) or − (on the others), `space-8` apart, a second window `space-12` under the first. A day off reads "Unavailable" in `text-tertiary`. A row's message is `text-body-sm` in `danger` under its windows. Copy times to and Set all days open at least `size-menu` wide with `space-12` inside, their title `text-label` in `text-secondary`. Read only keeps text lines (`size-control-sm`, windows `space-4` apart) in the same rows and hairlines. Nothing moves of its own.

**Use it for** a booking page's or a member's weekly hours, a place's opening hours, one date's hours (`isSingleDay`). **Don't use it for** one-off date overrides or a meeting's own time.

**The consumer provides** `label`, `rows` (`{ id, label, ranges, error? }`, ranges as `HH:MM` pairs), `onChange(id, ranges)`, and optionally `stepMinutes`, `hourClock`, `pastMidnightUntil`, `isSingleDay`, `isDisabled`, `isReadOnly`, `isLoading`. The screen checks the windows and passes the row's `error`.

**States**: on, off ("Unavailable"), several windows, all day, past midnight, a row's error (a new one announced), disabled, read only, loading, one date; the controls' own hover, focus and pressed.

**Interaction**: the switch turns a day on or off; the times are Selects on `stepMinutes`; + adds the hour after the last window, − removes one; Copy times to opens a Popover of day checkboxes with Select all and Apply; Set all days sets every day's start and end; everything by keyboard (stories `Keyboard`, `AddHours`, `NewProblem`, `CopyTimes`, `SetAllDays`).

**Differences from the prototype**
- The day's name is Switch's own label (`text-body`, in `text` when off); the prototype's 500 weight and its secondary colour on a day off are Switch's to give, which no prop asks for.
- The times keep a red edge to themselves: the row's message carries the problem. Select's red edge comes with its own `error` message, which would say it twice.
- No motion of its own yet, owed to the hours screen phase: a window added or removed appears and leaves at once (the prototype's 0fr to 1fr open and close need the windows keyed by an id; they are keyed by place and start, so a changed start would replay it), and so do the on and off swap's rise and the wash on the days Copy times changed. The error shake (CSS only, as the message appears: `.ranges:has(> .error)`) and the message's fade were built and measured at about 165 B gzipped on the module, more than the look itself grew, so they wait for that phase's load budget.
- "to" stays a word, at one width, where the prototype draws an en dash; a removing window shows − (the library's `minus`), not the prototype's bin.
- The narrow layout (under 480px, the library's) keeps the day and Copy on one line with the windows under them, rather than the prototype's single column under 28rem; its column gap is the prototype's `space-8`.
- Kept beyond the prototype: Set all days, All day with Set hours, `pastMidnightUntil`, `isSingleDay`, `isReadOnly`, `isLoading`, `hourClock`, `stepMinutes`, at most six windows a day; ranges are `HH:MM` pairs (the prototype's minutes with an id), `rows` its `value`, `isOn` the presence of a window.
