/** The Reports page's copy (the reports lane, spec 0050 reserved). */
export const strings = {
  reports: 'Reports',
  /** The tab that starts a report, and the Home section's link. */
  newReport: 'New report',
  /** The tab strip's name. */
  tabsLabel: 'Reports',
  /** The toolbar's name. */
  builderLabel: 'Report settings',
  object: 'Object',
  measure: 'Measure',
  count: 'Count',
  sumOf: (title: string) => `Sum of ${title}`,
  avgOf: (title: string) => `Average of ${title}`,
  groupBy: 'Group by',
  /** The word between the measure and the group, so the bar reads "Count by Stage". */
  by: 'by',
  /** The group select's choices read on from the measure: "by stage", "by month", "by close date, week". */
  groupedBy: (what: string) => `by ${what}`,
  groupedByPeriod: (title: string, period: string) => `by ${title}, ${period}`,
  filter: 'Filter',
  allRecords: 'All records',
  /** The filter a saved report keeps when the view it came from isn't listed any more. */
  savedFilter: 'Saved filter',
  chartType: 'Chart type',
  bars: 'Bars',
  line: 'Line',
  number: 'Number',
  name: 'Name',
  namePlaceholder: 'Name this report',
  save: 'Save',
  saveFailed: 'Couldn’t save this report.',
  saved: 'Report saved.',
  deleteReport: 'Delete report',
  deleted: 'Report deleted.',
  undo: 'Undo',
  restoreFailed: 'Couldn’t bring it back.',
  /** A group with no value: "No stage". */
  noValue: (title: string) => `No ${title.toLowerCase()}`,
  checked: 'Checked',
  unchecked: 'Not checked',
  /** The table's first column for a date group. */
  month: 'Month',
  week: 'Week',
  /** A chart's name when it is of one number. */
  total: 'Total',
  /** A count past the engine's cap: "10,000+". */
  atLeast: (value: string) => `${value}+`,
  /** Under the chart. */
  othersLeftOut: (codes: readonly string[]) => `Not included: ${codes.join(', ')}.`,
  truncated: 'Showing the first 12.',
  tooMany: 'Too many records to add up. Narrow the filter.',
  /** The forecast. */
  openPipeline: 'Open pipeline',
  wonTotal: 'Won',
  forecast: 'Weighted forecast',
  winChances: 'Win chances',
  winChance: (stage: string) => `${stage} win chance`,
  percent: '%',
  /** A view the filter select picked, that couldn't be read. */
  viewFailed: 'Couldn’t read that view.',
  /** The page while it loads or fails. */
  failedTitle: 'Reports didn’t load',
  noObjectsTitle: 'Nothing to report on yet',
  noObjectsText: 'Add an object first.',
} as const;
