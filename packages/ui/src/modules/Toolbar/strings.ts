/** The view bars' built in copy. */
export const strings = {
  views: 'Views',
  chooseView: (name: string) => `${name}, choose a view`,
  createView: 'Create view',
  /** The switcher's search field, once it lists many views. */
  searchViews: 'Search views',
  /** The heading over the current view's own actions in the switcher's menu. */
  thisView: 'This view',
  loadingViews: 'Loading views',
  viewSettings: 'View settings',
  locked: 'Locked',
  /** A sort chip's name: "Sort: Funding raised, descending, and 1 more". */
  sortName: (attribute: string, direction: 'ascending' | 'descending', more: number) =>
    `Sort: ${attribute}, ${direction}${more === 0 ? '' : more === 1 ? ', and 1 more' : `, and ${String(more)} more`}`,
  /** The default order's chip: "Sorted by Created at". */
  sortedBy: (attribute: string) => `Sorted by ${attribute}`,
  /** The default order's chip, named in full: "Sort: Created at, descending, the default order". */
  defaultSortName: (attribute: string, direction: 'ascending' | 'descending') =>
    `Sort: ${attribute}, ${direction}, the default order`,
  removeSorts: (count: number) => (count === 1 ? 'Remove sort' : 'Remove sorts'),
  more: (count: number) => `+${String(count)}`,
} as const;
