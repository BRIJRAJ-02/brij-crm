/** Menu's built in copy. */
export const strings = {
  noResults: 'No matches',
  /** A row still loading, for screen readers. */
  loadingItem: 'Loading',
  searchPlaceholder: (label: string) => `${label}…`,
  /** The check on an item that is in effect now (`isChecked`), for screen readers. */
  current: 'Current',
} as const;
