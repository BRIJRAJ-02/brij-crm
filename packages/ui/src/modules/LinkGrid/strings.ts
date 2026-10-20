/** LinkGrid's built in copy. */
export const strings = {
  /** Read while the cards load: "Loading Booking pages". */
  loading: (label: string) => `Loading ${label}`,
  failed: 'These didn’t load',
  noAccess: 'You can’t see these',
  noAccessBody: 'Ask a workspace admin for access.',
  noMatches: (query: string) => `Nothing matches “${query}”`,
  noMatchesBody: 'Search by title, or by the link.',
  clearSearch: 'Clear search',
} as const;
