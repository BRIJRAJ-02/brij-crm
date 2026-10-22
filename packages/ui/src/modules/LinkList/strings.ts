/** LinkList's built in copy. */
export const strings = {
  search: 'Search',
  /** Read while the rows load: "Loading Booking pages". */
  loading: (label: string) => `Loading ${label}`,
  failed: 'This list didn’t load',
  failedBody: 'Check your connection and try again.',
  noAccess: 'You can’t see this list',
  noAccessBody: 'Ask a workspace admin for access.',
  noMatches: (query: string) => `Nothing matches “${query}”`,
  noMatchesBody: 'Search by title, or by the address.',
  clearSearch: 'Clear search',
} as const;
