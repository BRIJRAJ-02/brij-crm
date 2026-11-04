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

`variant="offers"` (the booking chat, spec 0042) makes each time an action rather than a choice: no picked state and no `aria-pressed`, the day as a small label rather than a heading, and no clock switch. Why a variant: the chat offers the same times as the picker, so they must look the same; only what pressing one means differs. The clock switch shows only when `onHour12Change` is given.

`layout="column"` (the default) is one time a row, scrolling in its pane with a fade at the foot; `grid` runs two to four across as its container allows (the List view, phones), and takes the rest of a column it sits in, rows from the top. `isLoading` draws a skeleton; `empty` takes the list's place when a day has nothing to show. `drawKey` changes with the day or zone so the times stagger in again. At its end a column's scroll goes on to the page's, so a swipe on a phone never stops in the times.

A slot's `detail` is a quieter second line under its time: the same time on another clock (4 November 2026, B-05: a host's Reschedule shows the guest's own time, "03:30 London", so a move is never made blind to their night). It is hidden from screen readers, so the screen says it in the slot's `name` too. Story: GuestClock.

## States

Default, picked (picker only), Best, busy, hover, focus, pressed, loading, empty.

Loading draws the times' own grid with a time's box in each place, at a time's own height, rather than one block: the list is then already the shape and the height it will be, so the times land in the places that were drawn for them instead of pushing the page around (24 October 2026). It holds a nine to five day at half hour steps, which is what a page offers until its owner says otherwise, and is deliberately a little too tall rather than a little too short: inside a site's frame the page is only as tall as the height it last reported, so a list that grows when the times land leaves the frame scrolling until the new height reaches the host, while one that shrinks never does (`apps/web/e2e/embed.flow.ts`). The boxes have no entrance of their own, since a placeholder arrives with the page rather than after it.

## Motion

`answered` (offers only): the time picked from these stays marked with a fill and a check, the rest go quiet and take no press, so the chat keeps its answer as a record (stageshow's AI cards) and nothing below moves. A pressed time eases to `--scale-press` (1 in the app, 0.97 where the public booking page sets it). Times resolve out of their placeholders with a 2px blur. A picked time's fill settles in at the movement pace and lets go at the hover pace; nothing moves or scales (the owner's no press shrink, 20 Oct 2026). When the clock switches 12h and 24h each time keeps its box and only its words resolve out of a soft blur, and a new day's name does the same, so the list never redraws under the visitor. Reduced motion keeps a fade. A fast second tap picks the time tapped last, and a refresh that lands with a pick keeps it and a refresh that drops the picked time (taken meanwhile) leaves nothing picked rather than landing on another (stories FastSecondTap, PickDuringRefresh, PickedTimeGone, ClockSwitchInPlace).

## Keyboard

Tab reaches each time; Enter or Space picks. The clock switch is a SegmentedControl (the arrows move).

## Differences from the artifact

Not in the artifact.

Every time keeps one height (a row and a step, about 40px) whatever the count: the list's rows size to their buttons and sit at the top, so a day with one or two times never stretches them to fill the pane (the owner, 22 October 2026; story TwoSlots).
