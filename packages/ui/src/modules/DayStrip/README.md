# DayStrip

A booking page's List view (spec 0025, AC-666): only the days with times, in a row that scrolls sideways, each its weekday over its date, on a grey bar. The chosen one is a white pill, and slides into view; a day holding a Best time (spec 0028) carries an accent dot.

## Why it exists

New. ChoiceChips and SegmentedControl hold a few labelled choices that fit on one line; this runs to two months of days and scrolls.

## Use

```tsx
<DayStrip days={openDays} value={day} onChange={setDay} />
```

`today` (5 November 2026, a reservation's three weeks after checklabs) adds a third line under each date: its month, or Today on today, so "Tue 1" after "Mon 30" reads as a new month. Left out, nothing changes. Story: WithMonths.

- The days past either end fade there (a `mask-image` linear gradient over `space-32`), the start once it has scrolled, so the strip shows it scrolls both ways (the Bookings redesign, 9 November 2026).

## States

Default, chosen, Best, hover, focus, pressed, loading.

`isLoading` draws a week of day tiles in their own size while the days are still coming, so the times under them never move when they arrive. They hold still under reduced motion.

## Motion

A day's wash comes and goes over `duration-quick` on `ease-out`; the chosen day's pill takes its place with it.

## Keyboard

One day is in the tab order; the arrows, Home and End move along the days; Enter or Space chooses.

## Differences from the artifact

Not in the artifact.

## Bookings fix pass (5 November 2026)

The strip fades out at its far edge, so days running past the card read as more to scroll rather than the last day (critic A4).

The booking page loads it with the details step (`@crm/ui/public-booking/details`), beside the first paint rather than in it (5 November 2026): most pages open on Month, and its styles were 0.9 kB of the page's first load CSS budget. The guest page's Move still takes it from the main entry.

## Timefix prototype (spec 0072)

Takes its look from the prototype's DayStrip: a `surface-subtle` bar at `radius-lg`, `space-4` in, its days `space-2` apart at `radius-md`, each `space-6` over `space-4` padding, sharing the width when they fit and scrolling when they don't. The weekday is `text-label` and the date `text-body-lg-strong` with tabular figures, both `text-secondary` at rest and `text` under the pointer and on the chosen day. Under a pointer a day washes `surface-hover`; the chosen day is a `surface` pill with `shadow-xs` and a `control-border` hairline ring (the prototype's pill has no edge; alone it is about 1.1:1 on the bar, and the ring holds 3:1 and more in both themes, so the chosen day reads without its text colour). A Best time's dot stays `accent` on the pill. Keyboard focus is the outline ring just inside the day, since the strip scrolls and clips. With no days and not loading the bar is not drawn (`:empty`). In forced colours each day keeps a `ButtonText` hairline edge, the chosen day fills `Highlight` with `HighlightText`, and the outline is focus's alone. The loading tiles pulse in `border` (opacity only, held still under reduced motion). A guest page that sets `--scale-press` still eases a pressed day to it.

**Use it for** a booking page's List view of days, the reserve page and the guest's Move on the manage pages. **Don't use it for** picking a date far away (MonthTiles, DatePicker) or tabs that are not days.

**The consumer provides** `days` (`YYYY-MM-DD`), `value` and `onChange`, `bestDays`, `today`, `focusesValue` and `isLoading`.

**States** (stories): rest and chosen (Default), hover (HoverDay), a Best time (BestDay), today and the month (WithMonths), focus and the arrows (Default), loading (Loading).

**Differences from the prototype**

- The pill does not slide between days: measuring and moving it needs the prototype's indicator script, which would grow the booking page's first load; the chosen day's pill fades in over `duration-quick` instead.
- Today says so in words under the date (`today`'s month line) rather than turning the weekday and date blue; the prototype's blue today needs a `data-today` on each day, which the booking page's script would carry (owed to the booking page's screen phase).
- No meeting count dots and no week arrows (`count`, `onPrevious`, `onNext`): the library's strip shows only the days with times, scrolls instead of paging, and marks Best time days with one dot.
- The weekday is not upper case any more (the prototype's), and the chosen day is no longer the page's accent fill.
