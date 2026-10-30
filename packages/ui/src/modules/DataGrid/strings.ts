/** DataGrid's built in copy. */
export const strings = {
  selectRow: (name: string) => `Select ${name}`,
  selectOnScreen: 'Select the rows on screen',
  /** The "+" header after the last column (spec 0012), when the screen gives none of its own. */
  addColumn: 'Add attribute',
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
  /** Shown on the header while resizing, and announced as the width changes. */
  resizeHint: 'Left and Right change the width. Enter or Esc to finish.',
  /** A column's footer calculation (the CRM flow pass). */
  calculate: 'Calculate',
  calculateColumn: (name: string) => `Calculate ${name}`,
  calcs: {
    count: 'Count',
    count_empty: 'Empty',
    sum: 'Sum',
    avg: 'Average',
    min: 'Min',
    max: 'Max',
  },
  calcNone: 'None',
  /** While a calculation is worked out. */
  calcPending: '…',
  /** A filtered view too large to add up. */
  calcTooMany: 'too many rows',
  /** What a group header's count counts, read after the number. */
  groupRows: 'records',
  /** What a screen reader hears as a column moves by pointer. */
  columnLifted: (name: string) => `${name} column picked up.`,
  columnOver: (name: string, over: string) => `${name} column, over ${over}.`,
  columnDropped: (name: string) => `${name} column moved.`,
  columnPutBack: (name: string) => `${name} column, put back.`,
  resizing: (name: string, width: string) => `${name}, ${width} pixels wide.`,
  computedColumn: 'Worked out by the system',
  aiColumn: 'Filled by AI',
  /** On the header of a column whose cells can't be changed here. */
  readOnlyColumn: 'Read only',
  loading: 'Loading rows',
  loadingRow: 'Loading',
  /** A row's note (spec 0006, AC-56): a record just made here, and an edited row that left the view's filter. */
  rowNew: 'New',
  /** Between a row header's value and its note, for screen readers. */
  noteSeparator: ', ',
  rowNoLongerMatches: 'Doesn’t match this view',
  empty: 'No records yet',
  emptyText: 'Records you add or import show here.',
  failed: 'Couldn’t load these records',
  failedText: 'Something went wrong. Try again in a moment.',
  noAccess: 'You don’t have access to this view',
  noAccessText: 'Ask a workspace admin to share it with you.',
  notLoaded: 'Scroll to load these rows first.',
  copied: (count: string) => (count === '1' ? 'Copied 1 cell.' : `Copied ${count} cells.`),
  pasted: (count: string) => (count === '1' ? 'Pasted 1 cell.' : `Pasted ${count} cells.`),
  /** A paste that left some cells: how many, then each cause. */
  notPasted: (count: string, causes: string) =>
    count === '1' ? `1 cell wasn’t pasted. ${causes}` : `${count} cells weren’t pasted. ${causes}`,
  refusedCause: (count: string, reason: string) =>
    count === '1' ? `1 was refused: ${reason}` : `${count} were refused, such as: ${reason}`,
  clippedCause: (count: string) => (count === '1' ? '1 fell outside the table.' : `${count} fell outside the table.`),
  readOnlyCause: (count: string) => (count === '1' ? '1 is read only.' : `${count} are read only.`),
  /** Cells whose values weren't read yet (a column just shown): never written over. */
  unreadCause: (count: string) => (count === '1' ? '1 isn’t loaded yet.' : `${count} aren’t loaded yet.`),
  notCleared: (count: string, reason: string) =>
    count === '1' ? `1 cell wasn’t cleared: ${reason}` : `${count} cells weren’t cleared: ${reason}`,
  leftOut: (count: string) =>
    count === '1'
      ? 'Selected the loaded rows. 1 not loaded yet was left out.'
      : `Selected the loaded rows. ${count} not loaded yet were left out.`,
  notResolved: 'Couldn’t select those rows. Try again.',
  rowsSelected: (count: string) => (count === '1' ? '1 row selected' : `${count} rows selected`),
  rangeSize: (rows: string, columns: string) => `${rows} by ${columns} cells`,
  /** The grid's keys in the shortcut list (`GRID_SHORTCUTS`). */
  shortcutsTitle: 'In the table',
  shortcutMove: 'Move between cells',
  shortcutEdit: 'Edit the cell, or save and move down',
  shortcutCancel: 'Cancel the edit',
  shortcutClear: 'Clear the cell or range',
  shortcutTick: 'Select the row (on its checkbox)',
  shortcutRange: 'Select a range of cells',
  shortcutAll: 'Select the rows on screen',
  shortcutCopy: 'Copy',
  shortcutPaste: 'Paste',
  shortcutLink: 'Follow the link in the cell',
  shortcutMenu: 'Open the column menu (on a header)',
  shortcutResize: 'Resize the column (on a header)',
} as const;
