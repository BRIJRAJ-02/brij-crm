Stats and small charts for reports and dashboards: figures, bars, a sparkline, a donut and breakdown rows, drawn in SVG with one data hue.

**Use it for**: Insights pages, report cards and the stat row above a list. **Don't use it for** dense multi-series analysis (a dedicated report view) or for progress toward a limit (ProgressBar or Meter).

**The consumer provides**: words, not raw formats: `Stat` takes `label`, `value`, `delta`, `trend`; `BarChart` and `BarList` take points with `label`, `value`, `valueText`; `DonutChart` takes segments with a `hue` from the nine data hues (or `track` for a grey "Remaining" share of a limit, such as plan usage), in a fixed order, plus `total` and `totalLabel`; `Sparkline` takes numbers; `PeriodSwitch` takes options. `ChartCard` frames any of them.

**States**: loaded, loading (undefined data: Mercury's dotted placeholder bars, ring, line and "—" values, in the final layout so nothing shifts), empty (`emptyText`), hover or focus (tooltip, others dim).

**Interaction**: switching the period morphs every bar, line and donut segment from the old values to the new (35 donut morph, 400ms smooth-out) while the figures swap softly (34 text swap soft: the old value blurs out as the new blurs in and the width eases). Bars are focusable with Tab and show their tooltip (17 tooltip motion). A legend row dims the other segments.

**Replaces**: Chart, BarStrip.
