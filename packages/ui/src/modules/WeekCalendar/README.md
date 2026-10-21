# WeekCalendar

A week of days as columns of hours, with bookings and the member's own calendar events as blocks placed by time: the Bookings page's calendar (spec 0025, laid out after the reference product's bookings week).

## Why it exists

New. Nothing in the library places things on a time axis. Board and DataGrid are rows and columns of records; DatePicker is a month of days with no hours.

## Use

```tsx
<WeekCalendar
  label="Bookings, 19 – 25 October 2026"
  days={days}            // seven { key, weekday, dayNumber, label, isToday, isPast }
  blocks={blocks}        // { id, dayKey, startMinute, endMinute, title, time, detail?, kind, hue?, isCancelled?, provider? }
  selectedDay={day}
  onSelectDay={setDay}
  hourLabel={(hour) => format(hour)}
  now={{ dayKey: today, minute: 15 * 60 + 20 }}
  scrollToMinute={14 * 60}
  openId={openId}
  detail={<BookingCard … />}
  onOpen={setOpenId}
  onClose={() => setOpenId(undefined)}
/>
```

- An hour is `--size-toolbar` tall; the body shows twelve hours at a time and scrolls. It opens with `scrollToMinute` a quarter hour below its top (the screen passes an hour before now, or 8 AM).
- Today's column is tinted all the way down (`--surface-column`) and its date is solid accent; on another week nothing is.
- A short block (under 45 minutes) puts its title and time on one line; from 75 minutes it shows `detail` (the guest) on a third.
- Blocks that overlap share their cluster's width side by side (`placeBlocks`: sorted by start, each in the first lane free at its start).
- `kind: 'booking'` is accent; `kind: 'event'` is quieter, in the tag colours of its `hue` (one per connected calendar). `isCancelled` is struck through.
- `kind: 'blocked'` and `kind: 'held'` are time the member closed (spec 0027): hatched on the subtle surface in secondary text, a solid edge for a block and a dashed one for a hold. They open a card like any block.
- `kind: 'busy'` is the member's own calendar time with nobody else invited (spec 0024, the owner's call on 20 October 2026): titled Busy by the screen, plain on the subtle surface in secondary text with a hairline edge, never hatched, so it reads apart from time the member closed. Like closed time it sits under bookings and events, full width, and opens a card.
- `provider` draws that brand's small ProviderMark before the title: `timefix` on a booking, the calendar's brand (`google-calendar`, `outlook`, `apple-calendar`) on an event, so where a block came from reads at a glance. The mark is decoration; the title and the block's popover name it in words.
- The now line shows in today's column only.
- The open block's card is a Popover anchored to the block: it sits beside it and flips when there's no room. Escape, or pressing outside, closes it and puts focus back on the block.
- On a week narrower than `bp-container-md`, where one day takes the width, the card opens under its block rather than beside it, so it stays on screen.
- `focusDay` (a new `{ dayKey, blockId? }` each time) puts focus on that block while it is still on the week, else on that day's column, once any closing overlay has gone and only when focus fell to the page. Why a prop: the week owns its columns and blocks, and nothing outside could focus one without reaching into its DOM; a screen needs it after a change made through a dialog outside the block's card (a block removed, a booking cancelled). A card closed with Escape after the screen opened it again goes back to its block the same way.
- Below 480px of its container, the header stays as seven day buttons and the grid shows the selected day alone.

## States

Blocks (bookings, events, closed and busy time), none (an empty grid: the caller says "Nothing booked this week" under it), an open block (ringed, its card open), focused day and block rings, and loading (`isLoading`: the grid itself, busy, with no blocks, so the week arrives in place; each day reads "loading" rather than "nothing on"). Failure belongs to the screen.

## Keyboard

- One day column is in the tab order.
- Left and Right move to the previous or next day (and select it).
- Up and Down move between that day's blocks.
- Enter or Space on a day (not on a block) draws a span there, when drawing is on.
- Enter or Space opens the focused block.
- Escape closes its card.
- The day header buttons select a day.

## Differences from the artifact

Not in the artifact. Dragging on the grid to make a meeting comes with the new meeting dialog.

## Drawing (spec 0027)

With `onDraw` set, empty time draws a span: a mouse or pen drags across one day (snapped to 15 minutes, never leaving the day, the cursor a crosshair), a click or a span under 15 minutes draws `drawMinutes`, a finger taps (a drag would fight scrolling), and Enter or Space on a day draws `drawMinutes` from `drawStartMinute(day)`. The screen gets the span from `onDraw`, sets it as `draft`, and passes `draftCard` (a SpanCard), which opens in a Popover beside the solid ghost; Escape or a press outside calls `onDraftClose`. `minuteLabel` names the ghost's start and end corners. Blocks keep their own presses, so a drag can only start on empty time.
