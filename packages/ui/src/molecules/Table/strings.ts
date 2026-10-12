/** Table's built in copy. */
export const strings = {
  loading: 'Loading…',
  /** The drag handle column, read by screen readers. */
  reorder: 'Reorder',
  /** A row's drag handle: "Move Projects". */
  move: (row: string) => `Move ${row}`,
} as const;
