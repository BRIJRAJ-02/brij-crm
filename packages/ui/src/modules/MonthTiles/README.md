# MonthTiles

A booking page's month (spec 0025, AC-665): every day a square tile that fills its column, open days filled and read at full strength, closed days quiet, the chosen day solid accent, today with a dot. With the visitor's calendar on (spec 0028), a day holding a Best time carries a small accent mark.

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

Weekday names, the first day of the week and every label come from the provider's language. `focusesValue` focuses the chosen day once drawn, for Back from the details step.

## States

Open, closed, chosen, today, Best, hover, focus, pressed; the first and last bookable month turn the arrows off.

## Keyboard

One day is in the tab order. The arrows move between open days, Up and Down a week (to the nearest open day), Home and End to the first and last. Enter or Space chooses. A swipe turns the month on touch.

## Differences from the artifact

Not in the artifact.
