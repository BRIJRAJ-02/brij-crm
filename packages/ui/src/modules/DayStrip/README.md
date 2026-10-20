# DayStrip

A booking page's List view (spec 0025, AC-666): only the days with times, in a row that scrolls sideways, each its weekday over its date. The chosen one is solid accent, like MonthTiles, and slides into view; a day holding a Best time (spec 0028) carries the same mark.

## Why it exists

New. ChoiceChips and SegmentedControl hold a few labelled choices that fit on one line; this runs to two months of days and scrolls.

## Use

```tsx
<DayStrip days={openDays} value={day} onChange={setDay} />
```

## States

Default, chosen, Best, hover, focus, pressed.

## Keyboard

One day is in the tab order; the arrows, Home and End move along the days; Enter or Space chooses.

## Differences from the artifact

Not in the artifact.
