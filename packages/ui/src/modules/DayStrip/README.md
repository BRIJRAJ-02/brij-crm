# DayStrip

A booking page's List view (spec 0025, AC-666): only the days with times, in a row that scrolls sideways, each its weekday over its date. The chosen one is the accent, like MonthTiles, and slides into view; a day holding a Best time (spec 0028) carries the same mark.

## Why it exists

New. ChoiceChips and SegmentedControl hold a few labelled choices that fit on one line; this runs to two months of days and scrolls.

## Use

```tsx
<DayStrip days={openDays} value={day} onChange={setDay} />
```

## States

Default, chosen, Best, hover, focus, pressed, loading.

`isLoading` draws a week of day tiles in their own size while the days are still coming, so the times under them never move when they arrive. They hold still under reduced motion.

## Motion

The chosen day's fill settles in at the movement pace, as MonthTiles' does.

## Keyboard

One day is in the tab order; the arrows, Home and End move along the days; Enter or Space chooses.

## Differences from the artifact

Not in the artifact.

## Bookings fix pass (5 November 2026)

The strip fades out at its far edge, so days running past the card read as more to scroll rather than the last day (critic A4).

The booking page loads it with the details step (`@crm/ui/public-booking/details`), beside the first paint rather than in it (5 November 2026): most pages open on Month, and its styles were 0.9 kB of the page's first load CSS budget. The guest page's Move still takes it from the main entry.
