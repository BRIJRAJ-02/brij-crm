# Reports

The reports lane (parity item #52, spec 0050 reserved; the design note is the lane's, `/architect` writes the spec). A chart over any object, saved for the workspace. The server keeps the definition only (`reports`, migration 0138); every number is read through `records.aggregate` and `records.aggregateGroups` when the page opens, so a member sees the figures of what they can see.

## Reports (ReportsScreen, `/w/$slug/reports`)

- **Purpose**: how the workspace is doing, as charts over any object: a saved report per tab, and one more tab to make a new one.
- **Main task**: pick an object, a measure, a group and a filter, see the chart at once, and save it for the team.
- **Leaves out**: a dashboard of several charts on one page, currency conversion, drilling into the records, a date range (a date group draws the last twelve months or weeks), sharing links, and private reports.

## Notes

- `?r=` names the report open (`?r=new` for a draft); with none, the first saved report opens, else a new one. The page links from Home's bar and ⌘K; it has no sidebar item (the sidebar was just trimmed).
- A first visit is already drawn: the first object with a stage and a value shows its pipeline by stage (`startingConfig` in `builder.ts`), else the first object's first group counted, else a count. A first report is two clicks: change the measure if the default isn't it, then Save. The name follows the settings ("Deals by stage") until the person types one.
- The toolbar reads left to right as a sentence: object, measure, "by stage", the filter, and the chart (bars, a line, a number). A chart an object can't draw is not offered (a line needs a date, bars a field to group by). Changing the group picks the chart that fits it; changing the object starts that object's own first report.
- **The filter is a snapshot** of a saved view's filter taken when it is picked (`PickedFilter`, which reads the view and goes), labelled with the view's name. The report keeps what the view ran then.
- Counts per group are one `records.aggregate` per group (at most 13: the first 12 stages or members, and "No stage"); a sum or average per group is one `records.aggregateGroups`; a date group is one `records.aggregate` per period. All of it through the records layer's calculations store (`data.reports.figures`), which reads again 1.5 seconds after a record that may move them changes, in this tab or another.
- Money in several currencies: the chart draws in the currency most groups hold and a Callout names the rest (`mainCurrency` in `@crm/contracts/reports`). Nothing is converted.
- **Pipeline by stage** (a sum of a value field per status): `Forecast` shows Open pipeline, Won, and the weighted forecast once an open stage has a win chance. Chances are set in the Win chances fold and stored in the report (`weights` by stage option id): the options editor has no place for a chance on the stage itself yet. Won counts in full and lost not at all.
- The report is shared with the workspace: whoever can read its object and every field it names sees it (a report naming a hidden field is absent, never locked). Its maker, or a holder of `views.manage`, changes or deletes it; anyone else may explore it but not save.
- Delete is one click and a toast with Undo, which makes the report again under the same id.
- Writes store no outbox row: another tab reads the list when it opens the page again (the held list refreshes on return), while the numbers are live.
- Every word is in `strings.ts`. The chart is `@crm/ui/charts`, imported only by this screen's chunk; the route's loader imports no chart.
