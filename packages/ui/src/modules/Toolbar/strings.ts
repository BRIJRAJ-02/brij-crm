/** The view bars' built in copy. */
export const strings = {
  views: 'Views',
  chooseView: (name: string) => `${name}, choose a view`,
  createView: 'Create view',
  loadingViews: 'Loading views',
  sortedBy: 'Sorted by',
  /** A sort chip's name: "Sorted by Funding raised, descending, and 1 more". */
  sortName: (attribute: string, direction: 'ascending' | 'descending', more: number) =>
    `Sorted by ${attribute}, ${direction}${more === 0 ? '' : more === 1 ? ', and 1 more' : `, and ${String(more)} more`}`,
  more: (count: number) => `+${String(count)}`,
} as const;
