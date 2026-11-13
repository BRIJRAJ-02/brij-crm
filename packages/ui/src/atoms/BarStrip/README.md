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

Row and chart sizes (a chart under 480px wide drops its gaps). Loading (`isLoading`: stubs, no tooltips, busy, and only the label read out). Bars, empty periods (a hairline stub on the baseline), all empty (only stubs). Hover (pointer only: its tooltip opens and the other bars dim; the HoverBar story).

## Keyboard

It takes no focus; the numbers reach keyboard and screen reader users through the hidden list and the table view beside it.

## Differences from the artifact

Not in the artifact.

## Timefix prototype (spec 0072)

Takes its look from Chart (spec 0072): the prototype folds BarStrip into Chart's BarChart. Its own module draws the BarChart's marks at a strip's scale (decision 14): bars in `dot-blue` with rounded data ends (`radius-xs`) and square feet, on a hairline `border` base with no gridlines; an empty period a `border-strong` stub on the base; under the pointer the other bars dim to `opacity-disabled` over `duration-quick` (the prototype's `is-dim`, 0.4, snapped to the 0.45 token), in CSS only; the chart size's axis in `text-caption` and `text-secondary`, tabular.

**Use it for** a trend beside a name (a member's last 12 weeks) or a page's daily figures (`size="chart"`). **Don't use it for** a report with an axis of values, a line or two series (Chart), or progress toward a limit (ProgressBar or Meter).

**States**: bars, empty periods, all empty, loading (stubs), hover (tooltip, others dim).

**Interaction**: hovering a bar opens its tooltip (Tooltip's own motion) and dims the others; reduced motion keeps the dim, a fade. The bars take no focus, as before.

**Differences from the prototype**

- The bars are 6px (`space-6`) in a row's height, not up to 24px: a strip, not a chart. No value axis, no ghost bars while loading (stubs instead), no dot columns and no period morph.
- The tooltip is the library's Tooltip (React Aria, with its delay), not the chart's own pointer tip.
- Kept beyond the prototype: `max` (a scale shared across strips), the `chart` size with `axis`, the narrow chart's dropped gaps and the hidden list screen readers hear.

**Repeats from its replacer** (AC-4): the bar fill (`dot-blue`), the hairline base, the hover dim (`opacity-disabled` over `duration-quick`) and the axis's caption type; they leave with this export.
