/** The guest menu page's own words (spec 0065, H1): the tab's title and what shows when there is no menu. */
export const strings = {
  title: (business: string) => `${business} · Menu`,
  loading: 'Loading the menu',
  missing: 'This menu isn’t here',
  missingLine: 'The link may be old. Ask a member of staff for the menu.',
  offline: 'The menu didn’t load',
  offlineLine: 'Check your connection and try again.',
} as const;
