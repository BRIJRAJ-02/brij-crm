# SlotList

The times of one day on a booking page (spec 0025, AC-666 to AC-669): the day, the 12h or 24h switch, then the times as outlined buttons. Picking a time never moves on: the picked one fills and splits in two, the time and Next, as calendars' booking pages do, so the commit sits where the eye already is. With the visitor's calendar on (spec 0028), a Best time carries a tag, and a time the visitor is busy for (shown only when they ask to see every time) reads quieter with a dashed edge, and can still be picked.

## Why it exists

New. ChoiceChips hold a few labelled choices in a row; a day's times run long, scroll inside their pane in the Month view, stagger in as a day changes, and need the inline Next.

## Use

```tsx
<SlotList
  heading="Tue Oct 20"
  slots={slots}
  value={picked}
  onChange={setPicked}
  onConfirm={toDetails}
  hour12={hour12}
  onHour12Change={setHour12}
/>
```

`layout="column"` (the default) is one time a row, scrolling in its pane with a fade at the foot; `grid` runs two to four across as its container allows (the List view, phones). `isLoading` draws a skeleton; `empty` takes the list's place when a day has nothing to show. `drawKey` changes with the day, zone or view so the times stagger in again.

## States

Default, picked with Next, Best, busy, hover, focus, pressed, loading, empty.

## Keyboard

Tab reaches each time and then Next; Enter or Space picks. The clock switch is a SegmentedControl (the arrows move).

## Differences from the artifact

Not in the artifact.
