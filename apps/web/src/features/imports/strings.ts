/** The import screens' copy (spec 0040). Plain words, no dashes. */
const count = new Intl.NumberFormat();
/** A number as the page writes it: 4,812. */
export const n = (value: number): string => count.format(value);
const mb = (bytes: number) => `${String(Math.round(bytes / (1024 * 1024)))} MB`;

export const strings = {
  /** The view's More menu item (AC-1111). */
  menuItem: 'Import CSV',
  title: (pluralName: string) => `Import ${pluralName.toLowerCase()}`,
  stepsLabel: 'Import steps',
  steps: {
    upload: 'Upload',
    columns: 'Match columns',
    records: 'Match records',
    preview: 'Preview',
  },
  back: 'Back',
  continue: 'Continue',
  // Upload (AC-1112)
  uploadTitle: 'Choose a CSV file',
  uploadText: 'The first row holds the column names. Nothing is imported until you start the import.',
  dropLabel: 'Upload a CSV file',
  reading: 'Reading the file',
  refusals: {
    type: 'Choose a .csv, .tsv or .txt file.',
    bytes: (bytes: number, limit: number) => `This file is ${mb(bytes)}. Import at most ${mb(limit)} at a time.`,
    rows: (limit: number) => `This file has more than ${n(limit)} rows. Split it and import each part.`,
    columns: (columns: number, limit: number) =>
      `This file has ${n(columns)} columns. Import at most ${n(limit)}; remove the ones you don't need.`,
    empty: 'This file has no rows under its first row. Choose a file with column names and data.',
    quote: (row: number) => `A quote opened on row ${n(row)} never closes. Fix the file and choose it again.`,
    failed: 'The file could not be read. Choose it again.',
  },
  fileSummary: (name: string, rows: number, columns: number) =>
    `${name}: ${n(rows)} ${rows === 1 ? 'row' : 'rows'}, ${n(columns)} ${columns === 1 ? 'column' : 'columns'}`,
  chooseAnother: 'Choose another file',
  // Match columns (AC-1114, AC-1115)
  columnsTitle: 'Match columns to attributes',
  columnsCount: (matched: number, total: number) => `${n(matched)} of ${n(total)} columns will be imported`,
  columns: { header: 'Column', sample: 'Sample values', target: 'Imports into' },
  dontImport: "Don't import",
  namePart: (name: string, part: 'first' | 'last') => `${name}: ${part === 'first' ? 'First name' : 'Last name'}`,
  matchedTo: (header: string) => `Matched to ${header}`,
  targetLabel: (header: string) => `Where ${header} goes`,
  noSample: 'No values',
  needOneColumn: 'Match at least one column to continue.',
  // Match records (AC-1117, AC-1118)
  recordsTitle: 'Match records',
  recordsText: 'Rows that match an existing record update it instead of making a new one.',
  findBy: 'Find existing records by',
  alwaysCreate: 'Always create new records',
  noKeyHint: 'Match a column to a unique attribute, such as Email addresses, to find existing records.',
  onMatch: 'When a row matches a record',
  onMatchChoices: {
    fill: 'Fill empty fields',
    overwrite: "Overwrite with the file's values",
    skip: 'Skip the row',
  },
  onMatchHints: {
    fill: 'Values your team already typed stay.',
    overwrite: 'Empty cells never clear a value.',
    skip: 'The record stays as it is.',
  },
  onNoMatch: 'When a row matches no record',
  onNoMatchChoices: { create: 'Create a record', skip: 'Skip the row' },
  // Preview (AC-1120, AC-1121)
  previewTitle: 'Preview',
  totals: (ready: number, errors: number) =>
    errors === 0 ? `${n(ready)} ready` : `${n(ready)} ready, ${n(errors)} with errors`,
  filterLabel: 'Show rows',
  filters: { all: 'All', ready: 'Ready', errors: 'With errors' },
  rowsLabel: 'Rows to import',
  rowColumn: 'Row',
  problemsColumn: 'Errors',
  noRows: 'No rows here',
  noRowsText: 'Choose another filter to see the rest.',
  downloadErrors: 'Download rows with errors',
  errorHeader: 'Error',
  errorsFile: (fileName: string) => `${fileName.replace(/\.[^.]+$/u, '')} errors.csv`,
  nothingReady: 'No row is ready to import. Download the rows with errors, fix them and choose the file again.',
  start: 'Start import',
  // Running (AC-1123)
  confirmTitle: (rows: number, pluralName: string) => `Import ${n(rows)} rows into ${pluralName}?`,
  confirmText: (errors: number) =>
    errors === 0
      ? 'The import runs in the background. You can leave this page; you can undo the import for 7 days.'
      : `${n(errors)} rows with errors are left out. The import runs in the background, and you can undo it for 7 days.`,
  notYet: 'Not yet',
  sending: 'Sending rows',
  sent: (sent: number, total: number) => `${n(sent)} of ${n(total)} rows sent`,
  stopSending: 'Stop',
  stopTitle: 'Stop this import?',
  stopText: 'Nothing has been imported yet. The rows sent so far are dropped.',
  keepGoing: 'Keep going',
  stopped: 'The import was stopped before it started.',
  leaveConfirm: 'Leave the import? The file and your choices are dropped.',
  somethingWrong: 'Something went wrong. Try again.',
  // Summary (AC-1125, AC-1127)
  summaryTitle: (fileName: string) => fileName,
  progress: (done: number, total: number) => `${n(done)} of ${n(total)} rows`,
  running: 'Importing',
  queued: 'Waiting to start',
  cancel: 'Cancel import',
  cancelTitle: 'Cancel this import?',
  cancelText: 'Rows already imported stay. You can undo them afterwards.',
  dontCancel: 'Keep importing',
  counts: {
    created: 'Created',
    updated: 'Updated',
    skipped: 'Skipped',
    refused: 'Refused',
    errorRows: 'Left out with errors',
    undone: 'Taken back',
  },
  undoneSplit: (undone: number) => `${n(undone)} ${undone === 1 ? 'row' : 'rows'} taken back`,
  split: (created: number, updated: number) => `${n(created)} new, ${n(updated)} matched existing records`,
  finished: 'Import finished',
  failed: 'Import failed',
  cancelled: 'Import cancelled',
  undone: 'Import undone',
  undoing: 'Undoing the import',
  refusedTitle: 'Rows that were not imported',
  refusedLabel: 'Refused rows',
  reasonColumn: 'Why',
  showMore: 'Show more',
  downloadRefused: 'Download refused rows',
  refusedFile: (fileName: string) => `${fileName.replace(/\.[^.]+$/u, '')} refused.csv`,
  viewRecords: (pluralName: string) => `View ${pluralName.toLowerCase()}`,
  undo: 'Undo import',
  undoTitle: 'Undo this import?',
  undoText: (created: number, updated: number, plural: string, singular: string) =>
    [
      created > 0
        ? `${n(created)} created ${created === 1 ? singular.toLowerCase() : plural.toLowerCase()} move to the trash.`
        : '',
      updated > 0
        ? `${n(updated)} changed ${updated === 1 ? 'record goes' : 'records go'} back to what ${updated === 1 ? 'it' : 'they'} held, unless edited since.`
        : '',
    ]
      .filter((line) => line !== '')
      .join(' '),
  undoUntil: 'Undo open until',
  keepImport: 'Keep it',
  missingTitle: 'Import not found',
  missingText: "That import doesn't exist, or you can't see it.",
  failedTitle: "The import didn't load",
} as const;
