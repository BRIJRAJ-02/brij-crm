/** BulkActionBar's built in copy. */
export const strings = {
  label: 'Selected records',
  selected: (count: string) => `${count} selected`,
  selectAllMatching: (count: string) => `Select all ${count} matching`,
  allMatching: (count: string) => `All ${count} matching selected`,
  clear: 'Clear the selection',
  cancel: 'Cancel',
  /** Cancel while the running action stops after its current batch. */
  cancelling: 'Cancelling',
  /** Opens the confirm of an action that is counted and waits for it. */
  review: 'Review',
} as const;
