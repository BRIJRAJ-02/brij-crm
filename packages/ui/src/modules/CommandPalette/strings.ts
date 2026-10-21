/** CommandPalette's built in copy. */
export const strings = {
  title: 'Quick actions',
  search: 'Search records and actions',
  noResults: 'Nothing matches',
  /** Nothing matched what was typed, quoting it. */
  nothingMatches: (query: string) => `Nothing matches “${query}”`,
  searching: 'Searching…',
  failed: 'The search didn’t finish. Try again.',
  /** The live region's count of results showing. */
  results: (count: number) => (count === 0 ? 'No results' : count === 1 ? '1 result' : `${String(count)} results`),
  move: 'to move',
  choose: 'to choose',
  close: 'to close',
  /** The keys the footer names, written with Mac symbols. */
  keys: { move: '↑↓', choose: '↵', close: 'ESC' },
} as const;
