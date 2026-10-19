/** Pagination's built in copy. */
export const strings = {
  navigation: (label: string) => `${label} pages`,
  rowsPerPage: 'Rows per page',
  range: (first: number, last: number, total: number) => `${String(first)}–${String(last)} of ${String(total)}`,
  previous: 'Previous page',
  next: 'Next page',
} as const;
