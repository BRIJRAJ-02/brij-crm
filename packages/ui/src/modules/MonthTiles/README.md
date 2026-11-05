# MonthTiles

A booking page's month (spec 0025, AC-665): every day a square tile that fills its column, open days tinted in the accent (`accent-soft`) with bold link coloured numbers so bookable reads as an action, as Calendly's (30 October 2026; they were a grey fill), closed days quiet, the chosen day in the accent (the owner, 20 October 2026). One dot only ever means Best: with the visitor’s calendar on (spec 0028), a day holding a Best time carries it. Today takes the calendars' one today mark, a hairline `accent-line` ring, and is said to screen readers too (decided 30 October 2026; until then it was said, not marked). Look only: what a tile does is unchanged. Contrast: `link` on `accent-soft` holds 4.5:1 in both themes (a guarded pair); under a pointer the tile's text steps to `text`, since `link` on `accent-border` is under 4.5:1 in dark.

## Why it exists

New. DatePicker's calendar picks any date in a small popover; a booking page's month is the page's main surface, shows which days have times, and moves only between those. Neither a variant of DatePicker nor of WeekCalendar fits: the first is a field, the second a week of hours.

## Use

```tsx
<MonthTiles
  month="2026-10"
  today="2026-10-08"
  openDays={openDays}
  value={day}
  onChange={setDay}
  onMonthChange={showMonth}
  canPrevious={month > thisMonth}
  canNext={month < lastMonth}
/>
```

Every month holds six weeks, so paging, or the page jumping to the month of its first time, never moves what stands beside or under it. The days before and after the month fill those weeks with the neighbouring months' dates, at a closed day's size but in `border-strong`'s grey, plainly fainter than a closed day's `text-tertiary` so a run of them never reads as closed days (drawn as generated content from `data-date`, so they are decoration rather than text: no contrast floor, nothing for a screen reader), never controls, so a five week month never leaves an empty row over the times on a phone (spec 0058; hiding the row instead moved the card as it loaded).

`tone="plain"` (5 November 2026, a restaurant's reservation page after checklabs' calendar) draws the same month as plain numbers in 36px rows on a two pixel gap: an open day is the text colour and fills (`surface-hover`) under the pointer, a closed day is `text-tertiary`, today keeps its hairline ring in `border-strong` with its number in the strong weight, and the chosen day fills with the accent. Why a variant: the reservation page needs the same month, keys and states in checklabs' calmer look; only the drawing differs. The default (`tiles`) is unchanged. Story: Plain.

Weekday names, the first day of the week and every label come from the provider's language. `focusesValue` focuses the chosen day once drawn, for Back from the details step.

## States

Open, closed, chosen, today, Best, hover, focus, pressed, loading; the first and last bookable month turn the arrows off.

`isLoading` is the month drawn before any day's times are known: the tiles stand in their places quietly, the grid is `aria-busy`, and no day's label says it has no times, which while the times are still coming would not be true. The booking page draws it that way from its first paint, so the month never arrives, it only fills in.

## Motion

The chosen day's fill settles in at the movement pace, a press eases the day to `--scale-press` (1 in the app, 0.97 on the public booking page), and a new month slides in out of a 3px blur. When the times arrive, the days settle from their loading shade a week's row at a time from the top, once for that month (`data-settle`); moving to another month shows its days as they are. Reduced motion keeps the fade and drops the stagger.

## Keyboard

One day is in the tab order. The arrows move between open days, Up and Down a week (to the nearest open day), Home and End to the first and last. Enter or Space chooses. A swipe turns the month on touch.

## Differences from the artifact

Not in the artifact.
