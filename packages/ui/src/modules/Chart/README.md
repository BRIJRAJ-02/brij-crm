# Chart

A report's chart: bars per group, a line over periods, or one big number, with every state and a table of the same figures.

## Why it exists

New, for Reports (#52, the reports lane). Spec 0003 planned charts from visx's pieces; this draws its own SVG instead: bar, line and a number need about 300 lines, visx would have added packages to eight lanes' lockfile, and the theme still needed our CSS. The marks follow the dataviz skill: one series in the first data colour (`dot-blue`), bars at most 24px thick with 4px rounded ends and square feet, a 2px line, a 10% area wash, an 8px end dot with a surface ring, hairline recessive grid, ticks in secondary text, and the largest bar labelled (never a number on every point). Text never wears the data colour.

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
/>
```

- The chart formats nothing: the screen hands every label and value already as words (`axisLabel`, `valueText`, `formatTick`), so money, dates and time zones stay with the provider's settings.
- `kind="number"` draws the first point as one big number, and its zero is a number, not an empty chart.
- Import it from `@crm/ui/charts`, a lazy entry. It is never in the first load, and a route's loader must not import it.
- Values below zero draw as zero; the table keeps the true figure.
- Past 12 bars the labels thin or cut with an ellipsis; the tooltip and the table hold the whole name.

## States

Loading (the chart's frame, held at its height), empty (every value zero: "No data yet", not flat bars), error with Try again, no access, refreshing (`isRefreshing`: the figures stay, a step dimmer, the frame does not move), the table view, and hover (the slot under the pointer is washed and a tooltip shows value then label).

## Keyboard

The marks take no focus. The View switch (Chart or Table) is a radio group, and the Table view is the keyboard and screen reader path to every value; the drawing itself is one image named with every point and its value ("Pipeline by stage. Lead $48,200, Qualified $91,000"). In forced colours the marks take `Highlight`.

## Differences from the artifact

Not in the artifact.
