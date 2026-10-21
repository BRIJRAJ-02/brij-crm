# SlotList

The times of one day on a booking page (spec 0025, AC-666 to AC-669): the day, the 12h or 24h switch, then the times as outlined buttons. Picking a time never moves on: the picked one fills, and the page's Book bar (BookingFrame's `footer`) names it and moves on. With the visitor's calendar on (spec 0028), a Best time carries a tag, and a time the visitor is busy for (shown only when they ask to see every time) reads quieter with a dashed edge, and can still be picked.

## Why it exists

New. ChoiceChips hold a few labelled choices in a row; a day's times run long, scroll inside their pane in the Month view, and stagger in as a day changes.

## Use

```tsx
<SlotList
  heading="Tue Oct 20"
  slots={slots}
  value={picked}
  onChange={setPicked}
  hour12={hour12}
  onHour12Change={setHour12}
/>
```

`variant="offers"` (the booking chat, spec 0041) makes each time an action rather than a choice: no picked state and no `aria-pressed`, the day as a small label rather than a heading, and no clock switch. Why a variant: the chat offers the same times as the picker, so they must look the same; only what pressing one means differs. The clock switch shows only when `onHour12Change` is given.

`layout="column"` (the default) is one time a row, scrolling in its pane with a fade at the foot; `grid` runs two to four across as its container allows (the List view, phones). `isLoading` draws a skeleton; `empty` takes the list's place when a day has nothing to show. `drawKey` changes with the day, zone or view so the times stagger in again.

## States

Default, picked (picker only), Best, busy, hover, focus, pressed, loading, empty.

## Keyboard

Tab reaches each time; Enter or Space picks. The clock switch is a SegmentedControl (the arrows move).

## Differences from the artifact

Not in the artifact.
