/** Table's built in copy. */
export const strings = {
  loading: 'Loading…',
  /** The drag handle column, read by screen readers. */
  reorder: 'Reorder',
  /** A row's drag handle: "Move Projects". */
  move: (row: string) => `Move ${row}`,
  /** The selection column's header checkbox. */
  selectAll: 'Select all rows',
  /** A row's checkbox: "Select Ada Lovelace". */
  select: (row: string) => `Select ${row}`,
  /** The selection column, read by screen readers. */
  selection: 'Selection',
} as const;
