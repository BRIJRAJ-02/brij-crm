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
  exportItem: 'Export CSV',
  exportStarted: 'Exporting this view. You can download it when it’s ready.',
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
  /** Why Continue is off on the columns step. */
  matchOneFirst: 'Choose a field for at least one column to go on.',
  // Upload (AC-1112)
  uploadText: 'The first row holds the column names. Nothing changes until you start the import.',
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
  needOneColumn: 'Match at least one column to continue.',
  // Milestone 5: new attributes (AC-1116), missing options (AC-1122) and relation columns (decision 7)
  newAttribute: 'New attribute',
  newAttributeHint: (type: string) => `Creates ${type} attribute from this column`,
  /** The types a new attribute may take from its column (AC-1116), as a type picker names them. */
  suggestedTypes: {
    text: 'a text',
    email: 'an email',
    url: 'a URL',
    number: 'a number',
    checkbox: 'a checkbox',
    date: 'a date',
  } as Readonly<Record<string, string>>,
  newAttributeTitle: (column: number) => `Column ${n(column + 1)}`,
  saving: (header: string) => `Saving changes for the column ${header}…`,
  missingOptions: (count: number, attribute: string) =>
    `${n(count)} ${count === 1 ? 'value isn’t an option' : 'values aren’t options'} of ${attribute}`,
  missingOptionsText: (labels: readonly string[]) =>
    `${labels.slice(0, 5).join(', ')}${labels.length > 5 ? ` and ${n(labels.length - 5)} more` : ''}. Rows holding them show as errors until they are options.`,
  missingOptionsNoManage: 'Ask an admin to add them in Settings, or those rows show as errors.',
  createOptions: (count: number) => `Create ${n(count)} ${count === 1 ? 'option' : 'options'}`,
  checkingLinks: (header: string) => `Looking up the names in ${header}…`,
  linksFailed: (header: string) =>
    `Couldn’t look up the names in ${header}. They are still linked when the import runs.`,
  linksAllFound: (header: string, far: string) => `Every name in ${header} matches a ${far.toLowerCase()}.`,
  linksCantMake: (far: string) => `You can’t add ${far.toLowerCase()}, so these links are left out.`,
  tooManyOptions: (attribute: string) =>
    `${attribute} holds at most 500 options, so these can’t all be added here. Fix the file, or match the column elsewhere.`,
  linksMissing: (missing: number, total: number, attribute: string) =>
    `${n(missing)} of ${n(total)} ${total === 1 ? 'name' : 'names'} in ${attribute} match no record`,
  linksMissingText: (names: readonly string[]) =>
    `${names.slice(0, 5).join(', ')}${names.length > 5 ? ` and ${n(names.length - 5)} more` : ''}.`,
  linksLeftOut: 'Those links are left out, and each row says so in the summary.',
  linksAmbiguous: (count: number) =>
    `${n(count)} ${count === 1 ? 'name matches' : 'names match'} several records, so ${count === 1 ? 'it is' : 'they are'} left out.`,
  createMissing: (count: number, far: string) => `Create the ${n(count)} missing ${far.toLowerCase()}`,
  createMissingHint: 'Each is made once, named as in the file, and goes to the trash if you undo the import.',
  // Match records (AC-1117, AC-1118)
  findBy: 'Find existing records by',
  findByInfo:
    'A row whose value matches a record updates that record instead of adding a new one. An empty cell never clears a value.',
  findByExample: 'With Email addresses, a row with ada@example.com updates Ada.',
  alwaysCreate: 'Always create new records',
  noKeyHint: 'Match a column to a unique attribute, such as Email addresses, to update records you have.',
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
  rowInfo: 'Row numbers match your file. The column names are row 1.',
  reasonColumn: 'Reason',
  /** The preview's status column: "Ready", or what is wrong with the row. */
  statusColumn: 'Status',
  readyRow: 'Ready',
  noRows: 'No rows here',
  noRowsText: 'Choose another filter to see the rest.',
  downloadErrors: 'Download rows with errors',
  errorHeader: 'Error',
  errorsFile: (fileName: string) => `${fileName.replace(/\.[^.]+$/u, '')} errors.csv`,
  nothingReady: 'No row is ready. Download the rows with errors, fix them and choose the file again.',
  start: 'Start import',
  // Running (AC-1123)
  confirmTitle: (rows: number, pluralName: string) => `Import ${rowsWord(rows)} into ${pluralName}?`,
  confirmText: (errors: number) =>
    errors === 0
      ? 'It runs in the background, and you can undo it for 7 days.'
      : `${rowsWord(errors)} with errors ${errors === 1 ? 'stays' : 'stay'} out. It runs in the background, and you can undo it for 7 days.`,
  notYet: 'Not yet',
  sent: (sent: number, total: number) => `Sending rows: ${n(sent)} of ${n(total)}`,
  stopSending: 'Stop',
  stopTitle: 'Stop this import?',
  stopText: 'Nothing has been imported yet. The rows sent so far are dropped.',
  keepGoing: 'Keep going',
  stopped: 'The import was stopped before it started.',
  leaveTitle: 'Leave the import?',
  leaveText: 'Your file and choices are dropped, and nothing is imported.',
  leaveSendingText: 'The import stops, and nothing is imported.',
  stay: 'Stay',
  leave: 'Leave',
  somethingWrong: 'Something went wrong. Try again.',
  // Summary (AC-1125, AC-1127)
  summaryTitle: (fileName: string) => `Import of ${fileName}`,
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
    refused: 'Not imported',
    errorRows: 'Left out for errors',
    undone: 'Undone',
  },
  countsInfo:
    'Skipped rows matched a record and had nothing new for it, or you chose to skip them. Rows with errors were left out in the preview. Rows not imported were turned down while importing, for example by a rule or a value another record holds.',
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
  undoText: (created: number, updated: number, plural: string, singular: string) =>
    [
      created > 0
        ? `${n(created)} created ${created === 1 ? singular.toLowerCase() : plural.toLowerCase()} move to the trash.`
        : '',
      updated > 0
        ? `${n(updated)} changed ${updated === 1 ? 'record goes' : 'records go'} back, unless edited since.`
        : '',
    ]
      .filter((line) => line !== '')
      .join(' '),
  undoCloses: 'Undo closes',
  undoInfo: 'Created records go to the trash. Changed records go back, unless someone edited them since.',
  keepImport: 'Keep it',
  missingTitle: 'Import not found',
  missingText: "That import doesn't exist, or you can't see it.",
  failedTitle: "The import didn't load",
} as const;
