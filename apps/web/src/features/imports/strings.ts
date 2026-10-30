/** The import screens' copy (spec 0040). Plain words, no dashes, short. */
const count = new Intl.NumberFormat();
/** A number as the page writes it: 4,812. */
export const n = (value: number): string => count.format(value);
/** A size as FileDrop writes its limit: decimal megabytes. */
const mb = (bytes: number) => `${String(Math.round(bytes / 1_000_000))} MB`;
/** "1 row", "2 rows". */
const rowsWord = (value: number) => `${n(value)} ${value === 1 ? 'row' : 'rows'}`;

export const strings = {
  /** The view's More menu items (AC-1111, AC-1130), and the export's first toast. */
  menuItem: 'Import CSV',
  /** The view bar's Import / Export menu (it was only under "This view"), and its two items. */
  transferMenu: 'Import / Export',
  importPlural: (pluralName: string) => `Import ${pluralName.toLowerCase()}`,
  /** The export's one toast: working, then Download, or Try again. */
  exporting: (name: string) => `Exporting ${name}…`,
  exportFailed: (name: string, why: string | undefined) =>
    why === undefined ? `Couldn’t export ${name}.` : `Couldn’t export ${name}. ${why}`,
  tryAgain: 'Try again',
  /** The Import / Export menu's export items: the shown columns, then every column, hidden ones too. */
  exportShown: (columns: number) => `Export view (${n(columns)} ${columns === 1 ? 'column' : 'columns'})`,
  exportAll: (columns: number) => `Export all columns (${n(columns)})`,
  /** Why the export items are off on a view past the limit. */
  exportTooMany: 'Narrow the filter to 100,000 or fewer',
  /** The bulk bar's export of the ticked rows, and what its toast calls them. */
  exportSelected: (count: number) => `Export ${n(count)} selected`,
  title: (pluralName: string) => `Import ${pluralName.toLowerCase()}`,
  stepsLabel: 'Import steps',
  steps: {
    upload: 'Upload',
    columns: 'Match columns',
    review: 'Review values',
    preview: 'Preview',
  },
  back: 'Back',
  continue: 'Continue',
  /** Why Continue is off on the columns step. */
  matchOneFirst: 'Choose a field for at least one column to go on.',
  // Upload (AC-1112)
  /** The upload card's picture of a file: a header row over two rows (not this object's own columns). */
  sampleLabel: 'The first row holds the column names',
  sampleCaption: 'Row 1: column names',
  sampleRows: [
    ['Name', 'Email', 'Company'],
    ['Ada Lovelace', 'ada@example.com', 'Analytical Engines'],
    ['Grace Hopper', 'grace@example.com', 'US Navy'],
  ],
  dropLabel: 'Upload a CSV file',
  reading: 'Reading the file',
  refusals: {
    type: 'Choose a .csv, .tsv or .txt file.',
    /** An Excel file dropped: how to make it a CSV. */
    excel: 'Excel file? In Excel choose File › Save as › CSV UTF-8, then drop it here.',
    bytes: (bytes: number, limit: number) => `This file is ${mb(bytes)}. Import at most ${mb(limit)} at a time.`,
    rows: (limit: number) => `This file has more than ${n(limit)} rows. Split it and import each part.`,
    columns: (columns: number, limit: number) =>
      `This file has ${n(columns)} columns. Import at most ${n(limit)}; remove the ones you don't need.`,
    empty: 'This file has no rows under its first row. Choose a file with column names and data.',
    quote: (row: number) => `A quote opened on row ${n(row)} never closes. Fix the file and choose it again.`,
    failed: 'The file could not be read. Choose it again.',
  },
  fileSummary: (name: string, rows: number) => `${name}, ${rowsWord(rows)}`,
  chooseAnother: 'Choose another file',
  // Match columns (AC-1114, AC-1115)
  columnsCount: (matched: number, total: number) => `${n(matched)} of ${n(total)} columns will be imported`,
  columnsLabel: 'Columns',
  columns: { header: 'Column', sample: 'Sample values', target: 'Imports into' },
  dontImport: "Don't import",
  namePart: (name: string, part: 'first' | 'last') => `${name}: ${part === 'first' ? 'First name' : 'Last name'}`,
  matchedTo: (header: string) => `Matched to ${header}`,
  targetLabel: (header: string) => `Where ${header} goes`,
  noSample: 'No values',
  /** A required field no column fills (guarded here, not at Start). */
  matchRequiredFirst: 'Match a column to each required field to go on.',
  requiredMissing: (title: string) => `${title} is required`,
  matchAColumn: (title: string) => `Match a column to ${title}`,
  matchAColumnShort: 'Match a column',
  updateOnly: 'Only update records I have',
  /** A date column whose values read either way round (03/04/2025). */
  datesTitle: (header: string) => `Dates in ${header}`,
  dateOrderLabel: (header: string) => `How ${header} writes dates`,
  dayFirst: 'Day first',
  monthFirst: 'Month first',
  dateReads: (sample: string, day: string) => `${sample} → ${day}`,
  dateUnread: (sample: string) => `${sample} isn’t a date this way round.`,
  /** The upload step's sample file: this object's columns as its first row. */
  sampleCsv: 'Download a sample CSV',
  sampleFile: (pluralName: string) => `${pluralName} sample.csv`,
  // Milestone 5: new attributes (AC-1116), missing options (AC-1122) and relation columns (decision 7)
  newAttribute: 'New attribute',
  newAttributeTitle: (column: number) => `Column ${n(column + 1)}`,
  saving: (header: string) => `Saving changes for the column ${header}…`,
  checkingLinks: (header: string) => `Looking up the names in ${header}…`,
  linksFailed: (header: string) =>
    `Couldn’t look up the names in ${header}. They are still linked when the import runs.`,
  linksAllFound: (header: string, far: string) => `Every name in ${header} matches a ${far.toLowerCase()}.`,
  linksCantMake: (far: string) => `You can’t add ${far.toLowerCase()}, so these links are left out.`,
  /** "Company: 3 of 40 not found": the column, then how many of its names match no record. */
  linksMissing: (missing: number, total: number, attribute: string) =>
    `${attribute}: ${n(missing)} of ${n(total)} not found`,
  linksMissingText: (names: readonly string[]) =>
    `${names.slice(0, 5).join(', ')}${names.length > 5 ? ` and ${n(names.length - 5)} more` : ''}.`,
  linksAmbiguous: (count: number) =>
    `${n(count)} ${count === 1 ? 'name matches' : 'names match'} several records, so ${count === 1 ? 'it is' : 'they are'} left out.`,
  /** The choice for a relation column's names that match no record. */
  linksChoice: (header: string) => `What happens to the names in ${header} that match no record`,
  createThem: 'Create them',
  leaveEmpty: 'Leave empty',
  // Review values (owner walk 30 Oct 2026): only when a value won't read as it is, each with a choice made already.
  review: {
    missingLabels: (count: number, attribute: string) =>
      `${n(count)} ${count === 1 ? 'value isn’t an option' : 'values aren’t options'} of ${attribute}`,
    labelChoice: (label: string) => `What ${label} becomes`,
    create: 'Create option',
    empty: 'Leave empty',
    mapTo: (label: string) => `Use ${label}`,
    cantCreate: 'Only admins add options.',
    tooMany: (attribute: string) => `${attribute} holds at most 500 options.`,
    cells: (count: number, header: string) =>
      `${n(count)} ${count === 1 ? 'cell' : 'cells'} in ${header} can’t be read`,
    cellsText: (samples: readonly string[], reason: string) => `${samples.join(', ')}. ${reason}`,
    leaveEmpty: (count: number) => `Leave ${count === 1 ? 'this cell' : `these ${n(count)} cells`} empty`,
    creating: 'Creating options…',
  },
  // Match records (AC-1117, AC-1118), on the preview since 30 Oct 2026
  findBy: 'Match existing records by',
  alwaysCreate: 'Don’t match, always add',
  /** No match attribute on an object that already has records. */
  duplicates: 'Rows are added as new. Importing again makes duplicates.',
  moreSettings: 'More settings',
  onMatch: 'When a row matches a record',
  onMatchChoices: {
    fill: 'Fill empty fields',
    overwrite: "Overwrite with the file's values",
    skip: 'Skip the row',
  },
  onNoMatch: 'When a row matches no record',
  onNoMatchChoices: { create: 'Create a record', skip: 'Skip the row' },
  // Preview (AC-1120, AC-1121)
  checking: 'Checking rows',
  totals: (ready: number, errors: number) =>
    errors === 0 ? `${n(ready)} ready` : `${n(ready)} ready, ${n(errors)} with errors`,
  filterLabel: 'Show rows',
  filters: {
    all: 'All',
    ready: (count: number) => `Ready ${n(count)}`,
    errors: (count: number) => `With errors ${n(count)}`,
  },
  rowsLabel: 'Rows to import',
  rowColumn: 'Row',
  reasonColumn: 'Reason',
  /** The preview's status column: "Ready", or what is wrong with the row. */
  statusColumn: 'Status',
  readyRow: 'Ready',
  noRows: 'No rows here',
  downloadErrors: 'Download rows with errors',
  errorHeader: 'Error',
  errorsFile: (fileName: string) => `${fileName.replace(/\.[^.]+$/u, '')} errors.csv`,
  nothingReady: 'No rows are ready. Fix the file and choose it again.',
  start: 'Start import',
  /** Beside Start: what the rows will do (one lookup of the match column), and the undo window. */
  plan: (created: number, updated: number, skipped: number) =>
    [
      created > 0 ? `${n(created)} new` : '',
      updated > 0 ? `${n(updated)} update` : '',
      skipped > 0 ? `${n(skipped)} skip` : '',
    ]
      .filter((part) => part !== '')
      .join(' · '),
  planChecking: 'Checking which rows match records…',
  undoNote: 'Undo for 7 days.',
  sent: (sent: number, total: number) => `Sending rows: ${n(sent)} of ${n(total)}`,
  stopSending: 'Stop',
  stopTitle: 'Stop this import?',
  /** The body of Stop and Leave: both end with nothing imported. */
  nothingImported: 'Nothing is imported.',
  keepGoing: 'Keep going',
  stopped: 'The import was stopped before it started.',
  leaveTitle: 'Leave the import?',
  stay: 'Stay',
  leave: 'Leave',
  // Summary (AC-1125, AC-1127)
  summaryTitle: (fileName: string) => `Import of ${fileName}`,
  progress: (done: number, total: number) => `${n(done)} of ${n(total)} rows`,
  running: 'Importing',
  queued: 'Waiting to start',
  cancel: 'Cancel import',
  cancelTitle: 'Cancel this import?',
  cancelText: 'Imported rows stay.',
  dontCancel: 'Keep importing',
  counts: {
    created: 'Created',
    updated: 'Updated',
    refused: 'Not imported',
    undone: 'Undone',
  },
  finished: 'Import finished',
  failed: 'Import failed',
  cancelled: 'Import cancelled',
  undone: 'Import undone',
  undoing: 'Undoing the import',
  /** An undo that failed or was cancelled before it took every row back; Undo finishes it. */
  undoStopped: 'Undo stopped part way',
  notStarted: 'Import not started',
  refusedTitle: 'Rows not imported',
  refusedLabel: 'Rows not imported',
  showMore: 'Show more',
  downloadRefused: 'Download',
  refusedFile: (fileName: string) => `${fileName.replace(/\.[^.]+$/u, '')} not imported.csv`,
  viewRecords: (pluralName: string) => `View ${pluralName.toLowerCase()}`,
  undo: 'Undo import',
  undoTitle: 'Undo this import?',
  /** What Undo import does, in two short lines: "12 to the trash. 3 reverted, unless edited since." */
  undoText: (created: number, updated: number) =>
    [
      created > 0 ? `${n(created)} to the trash.` : '',
      updated > 0 ? `${n(updated)} reverted, unless edited since.` : '',
    ]
      .filter((line) => line !== '')
      .join(' '),
  undoCloses: 'Undo closes',
  keepImport: 'Keep it',
  /** The upload step's list of the member's last imports into this object. */
  recent: {
    title: 'Recent imports',
    file: 'File',
    by: 'By',
    when: 'Started',
    rows: 'Rows',
    undo: 'Undo closes',
    counts: (done: number, refused: number) =>
      refused === 0 ? `${n(done)} imported` : `${n(done)} imported, ${n(refused)} not`,
    closed: 'Closed',
    undone: 'Undone',
    formerMember: 'Former member',
  },
  /** A member who may read the object but not add to it, on the import page. */
  noAccess: (pluralName: string) => `You can view ${pluralName.toLowerCase()} but not add to them`,
  noAccessText: 'Ask a workspace admin for edit access to import.',
  viewPlural: (pluralName: string) => `View ${pluralName.toLowerCase()}`,
  missingTitle: 'Import not found',
  missingText: "That import doesn't exist, or you can't see it.",
  failedTitle: "The import didn't load",
} as const;
