# BarStrip

A small bar chart in a row's height: one thin bar per period, on one shared scale.

## Why it exists

New. A round robin rotation's Distribution tab showed each member's last 12 weeks as a table of twelve numbers, too wide for a phone and hard to read as a trend (the owner's polish list, 22 October 2026). Nothing in the library draws data as bars: Meter and ProgressBar are one value against a limit, so a variant of either would have been a second component inside it. This is the smallest chart that answers "how did this go week by week", built to the dataviz method: one data hue (`dot-blue`) for one series, thin marks with rounded data ends on a hairline baseline, a space-2 gap between bars, and a tooltip on every bar.

## Use

```tsx
<BarStrip
  label="Sam Lee, meetings per week"
  bars={weeks.map((week) => ({ id: week.start, label: `Week of ${week.name}: ${week.count}`, value: week.count }))}
  max={largestAcrossMembers}
/>
```

- `label` names the strip for screen readers; each bar's `label` is what its tooltip says and what screen readers hear, as a list.
- `max` sets the full height. Strips that sit together (one per table row) share one `max` so their bars compare.
- `size="chart"` (spec 0047, the operator console's daily figures) fills its container's width at four rows' height, the bars sharing it, with `axis` naming the first and last period under it. Why a variant: the console needs the same bars at a page's scale, one series a chart, and a second chart component would draw the same marks again.
- Pair it with a table view of the same numbers where the exact counts matter (the Distribution tab's Chart and Table switch).

## States

Row and chart sizes (a chart under 480px wide drops its gaps). Loading (`isLoading`: stubs, no tooltips, busy, and only the label read out). Bars, empty periods (a hairline stub on the baseline), all empty (only stubs).

## Keyboard

It takes no focus; the numbers reach keyboard and screen reader users through the hidden list and the table view beside it.

## Differences from the artifact

Not in the artifact.
