# SlotPicker

A week of days and the chosen day's open times, for a public booking page (spec 0025, AC-630).

## Why it exists

New. A visitor booking a meeting picks a day, then a time, in their own zone. Nothing in the library draws a row of seven day tiles with a weekday over a date, and a run of time buttons under them: SegmentedControl switches views (one label each, no disabled day), DatePicker opens a month in a popover (a booking page shows its week open, with days that have no time greyed out), and a list of ToggleButtons can't stack two lines. The time buttons are the library's own Button.

## Use

```tsx
<SlotPicker
  weekLabel="2 to 8 November 2026"
  days={days}
  selectedDayId="2026-11-02"
  onSelectDay={setDay}
  slots={[{ id: '2026-11-02T09:00:00.000Z', label: '09:00' }]}
  onPickSlot={choose}
  onPreviousWeek={back}
  onNextWeek={forward}
  canGoBack={false}
  canGoForward
  status="ready"
/>
```

- Days are a single choice toggle group: a day without open time is disabled and says so to screen readers.
- A time is a button: pressing it moves on (the page shows the visitor's details next).
- The week's label is a live heading, so moving a week is announced.
- The times grid takes two columns, three from 480px of its container.

## States

Ready, loading (skeleton tiles and lines, busy), error (EmptyState with a retry), an empty week (EmptyState offering the next week), a chosen day with no time, disabled days, and the hover, pressed, focus and selected tiles.

## Keyboard

Tab reaches the week arrows, then the day group (arrow keys move between days, Space or Enter chooses), then each time.

## Differences from the artifact

Not in the artifact.
