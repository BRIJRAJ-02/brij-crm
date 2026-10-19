/** LinkList's built in copy. */
export const strings = {
  search: 'Search',
  /** Read while the rows load: "Loading Booking pages". */
  loading: (label: string) => `Loading ${label}`,
  failed: 'This list didn’t load',
  noAccess: 'You can’t see this list',
  noAccessBody: 'Ask a workspace admin for access.',
  noMatches: (query: string) => `Nothing matches “${query}”`,
  noMatchesBody: 'Try another word from its title or address.',
} as const;
