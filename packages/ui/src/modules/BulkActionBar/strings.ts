/** BulkActionBar's built in copy. */
export const strings = {
  label: 'Selected records',
  selected: (count: string) => `${count} selected`,
  selectAllMatching: (count: string) => `Select all ${count} matching`,
  allMatching: (count: string) => `All ${count} matching selected`,
  clear: 'Clear the selection',
} as const;
