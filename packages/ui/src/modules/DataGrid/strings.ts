/** DataGrid's built in copy. */
export const strings = {
  selectRow: (name: string) => `Select ${name}`,
  selectOnScreen: 'Select the rows on screen',
  untitled: 'Untitled',
  columnOptions: (name: string) => `${name} options`,
  moveLeft: 'Move left',
  moveRight: 'Move right',
  pin: 'Pin',
  unpin: 'Unpin',
  hide: 'Hide',
  sortAscending: 'Sort ascending',
  sortDescending: 'Sort descending',
  filter: 'Filter',
  resize: 'Resize',
  /** Shown on the header while resizing, and announced as the width changes. */
  resizeHint: 'Left and Right change the width. Enter or Esc to finish.',
  resizing: (name: string, width: string) => `${name}, ${width} pixels wide.`,
  computedColumn: 'Worked out by the system',
  aiColumn: 'Filled by AI',
  loading: 'Loading rows',
  loadingRow: 'Loading',
  /** A row's note (spec 0006, AC-56): a record just made here, and an edited row that left the view's filter. */
  rowNew: 'New',
  rowNoLongerMatches: 'Doesn’t match this view',
  empty: 'No records yet',
  emptyText: 'Records you add or import show here.',
  failed: 'Couldn’t load these records',
  failedText: 'Check your connection, then try again.',
  noAccess: 'You don’t have access to this view',
  noAccessText: 'Ask a workspace admin to share it with you.',
  notLoaded: 'Scroll to load these rows first.',
  copied: (count: string) => (count === '1' ? 'Copied 1 cell' : `Copied ${count} cells`),
  pasted: (count: string) => (count === '1' ? 'Pasted 1 cell' : `Pasted ${count} cells`),
  /** A paste that left some cells: how many, then each cause. */
  notPasted: (count: string, causes: string) =>
    count === '1' ? `1 cell wasn’t pasted. ${causes}` : `${count} cells weren’t pasted. ${causes}`,
  refusedCause: (count: string, reason: string) =>
    count === '1' ? `1 was refused: ${reason}` : `${count} were refused, such as: ${reason}`,
  clippedCause: (count: string) => (count === '1' ? '1 fell outside the table.' : `${count} fell outside the table.`),
  readOnlyCause: (count: string) => (count === '1' ? '1 is read only.' : `${count} are read only.`),
  notCleared: (count: string, reason: string) =>
    count === '1' ? `1 cell wasn’t cleared: ${reason}` : `${count} cells weren’t cleared: ${reason}`,
  leftOut: (count: string) =>
    count === '1'
      ? 'Selected the loaded rows. 1 not loaded yet was left out.'
      : `Selected the loaded rows. ${count} not loaded yet were left out.`,
  notResolved: 'Couldn’t select those rows. Try again.',
  rowsSelected: (count: string) => (count === '1' ? '1 row selected' : `${count} rows selected`),
  rangeSize: (rows: string, columns: string) => `${rows} by ${columns} cells`,
} as const;
