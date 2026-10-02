/** SortBuilder's built in copy. */
export const strings = {
  label: 'Sorts',
  sortBy: 'Sort by',
  thenBy: 'then by',
  ascending: 'Ascending',
  descending: 'Descending',
  direction: (name: string) => `${name} direction`,
  attributes: 'Attributes',
  searchAttributes: 'Search attributes',
  addSort: 'Add sort',
  remove: (name: string) => `Remove the sort by ${name}`,
  move: (name: string) => `Move the sort by ${name}`,
  noSorts: 'No sorts yet',
  noSortsText: 'Records show in the order they were added.',
} as const;
