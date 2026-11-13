# Chart

A report's chart: bars per group, a line over periods, or one big number, with every state and a table of the same figures.

## Why it exists

New, for Reports (#52, the reports lane). Spec 0003 planned charts from visx's pieces; this draws its own SVG instead: bar, line and a number need about 300 lines, visx would have added packages to eight lanes' lockfile, and the theme still needed our CSS. The marks follow the dataviz skill: one series in the first data colour (`dot-blue`), bars at most 24px thick with 4px rounded ends and square feet, a 2px line, a 10% area wash, a hollow 8px end dot (the surface inside a 2px ring of the data colour), a hairline base and no gridlines, ticks in secondary text, and the largest bar labelled (never a number on every point). Text never wears the data colour.

Reused, not rebuilt: `EmptyState` for loading, empty, error and no access, `SegmentedControl` for the chart or table switch, `Table` for the table view, and `Stats` (its `large` size) for the big number.

## Use

```tsx
import { Chart } from '@crm/ui/charts';

<Chart
  kind="bar"
  label="Pipeline by stage"
  pointLabel="Stage"
  valueLabel="Value"
  points={[{ id: 'lead', label: 'Lead', value: 48200, valueText: '$48,200' }]}
  formatTick={(value) => `$${String(value / 1000)}K`}
  status={state}
  onRetry={retry}
/>;
```

- The chart formats nothing: the screen hands every label and value already as words (`axisLabel`, `valueText`, `formatTick`), so money, dates and time zones stay with the provider's settings.
- `kind="number"` draws the first point as one big number, and its zero is a number, not an empty chart.
- Import it from `@crm/ui/charts`, a lazy entry. It is never in the first load, and a route's loader must not import it.
- Values below zero draw as zero; the table keeps the true figure.
- Long category names cut with an ellipsis, and the x labels thin to the room there is: each label is measured in its own font (a canvas, read from a hidden label; an estimate before then), and the axis draws every n-th one, the least n that leaves 8px of air between any two (4 November 2026, "numbers are overlapping" over a 90 day range). The tooltip and the table hold every name.
- Two series (Insights, spec 0067): give a bar chart `compareLabel` and each point `compare` and `compareText`. Each pair draws side by side with a 2px surface gap, the second in the next data colour (`dot-orange`, checked with the dataviz validator against blue: CVD ΔE 33), on the same axis, with a legend naming both at the head's start and a column each in the table. A variant, not a new chart: a second y axis is never drawn, so a rate goes in a chart of its own.

- An axis of counts (every value a whole number: visits, people) ticks in whole numbers only, never 0.5 or 2.5 between two visitors (`niceTicks`' `isWhole`, critique c of the forms, 5 November 2026).

## States

Loading (the chart's frame, held at its height), empty (every value zero: "No data yet", not flat bars), error with Try again, no access, refreshing (`isRefreshing`: the figures stay, a step dimmer, the frame does not move), the table view, and hover (the other bars dim and a tooltip shows value then label).

## Keyboard

The marks take no focus. The View switch (Chart or Table) is a radio group, and the Table view is the keyboard and screen reader path to every value; the drawing itself is one image named with every point and its value ("Pipeline by stage. Lead $48,200, Qualified $91,000"). In forced colours the marks take `Highlight`.

## Differences from the artifact

Not in the artifact.

## Timefix prototype (spec 0072)

Takes its look from the prototype's Chart (its `BarChart`, bars and `look="line"`). Bars in `dot-blue` (the second series `dot-orange`), at most 24px with rounded ends and square feet, on a hairline `border` base with no gridlines; ticks and x labels in `text-caption` and `text-secondary`, tabular; the line 2px (`border-width-thick`) with hollow points (`surface` inside a `dot-blue` ring). Under the pointer the other bars dim to `opacity-disabled` over `duration-quick` on `ease-out` (the prototype's `is-dim`, 0.4, snapped to the 0.45 token), in CSS from the hovered slot's `data-hovered`; the tooltip is the prototype's ink label: `surface-inverse` and `on-inverse`, `radius-sm`, a `space-4` by `space-8` inset, `shadow-md`, the value in `text-label`, its name in `text-caption` at `opacity-busy` (the prototype's 0.7), rising `distance-micro` into place over `duration-quick` (transitions.dev 17). The legend names each series in `text-body-sm-strong` beside a round 8px dot; the head is `size-control-sm` tall, `space-12` over the drawing. Reduced motion keeps the tooltip's fade and the dim, and drops the rise.

**Use it for** a report's figures: bars per group, a line over periods, two series on one axis, or one big number. **Don't use it for** a trend beside a name (BarStrip), dense multi series analysis, or progress toward a limit (ProgressBar or Meter).

**The consumer provides** words, not raw formats: `label`, `pointLabel`, `valueLabel`, `points` (each `label`, `value`, `valueText`, optional `axisLabel`, `compare` and `compareText`), `formatTick`, `compareLabel` for two series, `status` and `onRetry`.

**States**: loaded (Bars, Line, Paired, BigNumber), loading (Loading: the frame held at its height), empty (Empty), error (Failed), no access (NoAccess), refreshing (Refreshing), the table view (AsTable), hover (no story: a story driving the pointer over the drawing did not reach its handler in Chromium, so the hover dim is covered by BarStrip's HoverBar, which draws it the same way; owed).

**Interaction**: hovering or touching the drawing marks the nearest slot, dims the other bars and shows the tooltip; the View switch (Chart or Table) is the keyboard path to every value.

**Differences from the prototype**

- The marks take no focus: the drawing is one image named with every value, and the Table view is the keyboard and screen reader path (the prototype tabs to each bar and shows its tooltip). Its ChartCard frame, Stat, PeriodSwitch, Sparkline, DonutChart and BarList are not this part: the card around a chart is the screen's Card, its figures Stats and its period switch SegmentedControl.
- Kept: a y axis with ticks (the prototype draws none), the largest bar's value written over it, the area wash and crosshair on a line, and a dot only at the line's end and under the pointer (the prototype dots every point). No loading ghost bars (the frame holds its place with EmptyState's loading), no period morph and no dot columns (`look="dots"`): owed to the reports screen phase if it wants them.
- Props differ: `kind` (`bar`, `line`, `number`) for the prototype's `BarChart look`, and `points[].valueText` and `axisLabel` for its `valueText` and label.

**Repeats Tooltip** (rule 4, noted for removal): the hovered point's label is drawn as Tooltip draws its bubble (the inverse ink, its inset and the `distance-micro` rise), because Tooltip opens from a trigger and this one sits at a point in a drawing. A "placed at a point" variant of Tooltip would remove the copy; it is owed to the reports screen phase.
