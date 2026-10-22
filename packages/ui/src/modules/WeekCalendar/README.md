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

- An hour is `--size-toolbar` tall; the body shows twelve hours at a time and scrolls. Each hour's label sits centred on its line. It opens with `scrollToMinute` a quarter hour below its top, so that hour's label shows whole (the screen passes the hour before now, or the start of the member's day, always on the hour).
- Each day's head is its weekday over its date. Today's date is a small accent circle and its weekday is in the link colour, as Google Calendar marks today; its column is not tinted (the owner, 22 October 2026). The picked day's date has the selected surface.
- `allDay` items sit in a row of their own over the hours, labelled All day, shown only when there are some: each a chip in its calendar's hue, one per day it covers, that opens its card like a block (its name says "all day" and the day). On one day (narrow) the row shows that day alone. The row is capped at three chips' height (`ALL_DAY_CAP`): a day with more shows two and a quiet "+N more" chip, which opens the rest as a list (a Menu in a Popover, under the chip, as the grid's "+N" does), and choosing one opens its card on the chip. Why a list rather than growing the row: a busy week would push the hours off screen, and the grid's own folded blocks already open this way, so one pattern does both.
- `openHours(dayKey)` gives the member's open hours; the hours outside them are shaded `--surface-subtle`, the hour lines carrying on through, under everything drawn on the grid. Undefined shades nothing that day; an empty list shades the whole day (a day off). Why a prop: only the screen knows the member's availability.
- `emptyHint` ("No meetings this week") is one quiet line in the middle of the grid while the week has no blocks and nothing all day; it never takes the pointer, so drawing still works under it. Why: an empty week is not an error or a first run, so it gets a hint, not an EmptyState.
- A short block (under 45 minutes) puts its title and time on one line; from 75 minutes it shows `detail` (the guest) on a third. A quarter hour (under 30 minutes) is shorter than a label's line, so its one line is centred in the block and clipped at its edge, with no brand mark and tighter corners, the way Google Calendar draws a 15 minute event: its words never run over its border (the owner, 21 October 2026).
- Overlaps are laid out like Google Calendar (`placeBlocks.ts`). Blocks that start within 45 minutes of one they overlap sit side by side, each in the first lane free at its start, and widen into lanes to their right that stay free for their whole time. A block that starts later than that sits over the latest block it overlaps, indented a step (`space-12`) inside that block's lane, at most three steps (`MAX_INDENT`) however long a chain of overlaps runs, with a hairline ring in the column's own surface, so the earlier title still shows. Seven days across, a block under half its day wide leaves out its brand mark (`data-narrow`), so its title has the room. Nothing is hidden: when a region holds more lanes than fit at a third of the column (`MIN_LANE`), the last lane that fits becomes a quiet "+N" chip, named by its count and start ("3 more items at 9:30 AM", from `minuteLabel`, else the first block's time); a folded block starting past the chip's half hour gets a chip of its own where it starts. A chip opens a list of its blocks (a Menu in a Popover, focused on its first item), and choosing one opens its card on the chip, which shows as open meanwhile; closing the card puts focus back on the chip. Up and Down reach the chips among the blocks, in start order, then left to right.
- `kind: 'booking'` is accent; `kind: 'event'` is quieter, in the tag colours of its `hue` (one per connected calendar). `isCancelled` is struck through.
- `kind: 'blocked'` and `kind: 'held'` are time the member closed (spec 0027): hatched on the subtle surface in secondary text, a solid edge for a block and a dashed one for a hold. They open a card like any block.
- `kind: 'busy'` is the member's own calendar time with nobody else invited (spec 0024, the owner's call on 20 October 2026): titled Busy by the screen, plain on the subtle surface in secondary text with a hairline edge, never hatched, so it reads apart from time the member closed. Like closed time it sits under bookings and events, full width, and opens a card.
- `provider` draws that brand's small ProviderMark before the title: `timefix` on a booking, the calendar's brand (`google-calendar`, `outlook`, `apple-calendar`) on an event, so where a block came from reads at a glance. The mark is decoration; the title and the block's popover name it in words.
- The now line shows in today's column only.
- The open block's card is a Popover anchored to the block: it sits beside it and flips when there's no room. Escape, or pressing outside, closes it and puts focus back on the block.
- On a week narrower than `bp-container-md`, where one day takes the width, the card opens under its block rather than beside it, so it stays on screen.
- `focusDay` (a new `{ dayKey, blockId? }` each time) puts focus on that block while it is still on the week, else on that day's column, once any closing overlay has gone and only when focus fell to the page. Why a prop: the week owns its columns and blocks, and nothing outside could focus one without reaching into its DOM; a screen needs it after a change made through a dialog outside the block's card (a block removed, a booking cancelled). A card closed with Escape after the screen opened it again goes back to its block the same way.
- Below 480px of its container, the header stays as seven day buttons and the grid shows the selected day alone.

- `isFill` makes the grid take the height its parent gives, the hours scrolling inside, never fewer than six on screen, and draws it flush, with no card edge or corners, since it is then the page itself (the owner, 22 October 2026). Without it the hours show twelve at a time, in a card. Why a variant: Bookings › Calendar is the page itself and should reach the view's foot (the owner, 22 October 2026); a grid among other content keeps its twelve hours.

## States

Blocks (bookings, events, closed and busy time) of every length, a quarter hour one compact centred line, none (an empty grid with `emptyHint` in its middle), all day items, shaded hours outside the member's own, an open block (ringed, its card open), focused day and block rings, and loading (`isLoading`: the grid itself, busy, with no blocks, so the week arrives in place; each day reads "loading" rather than "nothing on"). Failure belongs to the screen.

## Keyboard

- One day column is in the tab order.
- Left and Right move to the previous or next day (and select it).
- Up and Down move between that day's all day chips (top to bottom, "+N more" last), then its blocks and "+N" chips by start: the order they read down the screen. The chips are not tab stops; Left and Right on a chip move to the day before or after it, as on its column.
- Enter or Space on a day (not on a block) draws a span there, when drawing is on.
- Enter or Space opens the focused block.
- Escape closes its card.
- The day header buttons select a day.

## Differences from the artifact

Not in the artifact. Dragging on the grid to make a meeting comes with the new meeting dialog.

## Drawing (spec 0027)

A drawn span shows its start at its top and, from an hour, its end at its foot; a quarter hour shows its start on one line centred in the span, clipped, never over its border. With `onDraw` set, empty time draws a span: a mouse or pen drags across one day (snapped to 15 minutes, never leaving the day, the cursor a crosshair), a click or a span under 15 minutes draws `drawMinutes`, a finger taps (a drag would fight scrolling), and Enter or Space on a day draws `drawMinutes` from `drawStartMinute(day)`. The screen gets the span from `onDraw`, sets it as `draft`, and passes `draftCard` (a SpanCard), which opens in a Popover beside the solid ghost; Escape or a press outside calls `onDraftClose`. `minuteLabel` names the ghost's start and end corners. Blocks keep their own presses, so a drag can only start on empty time.
