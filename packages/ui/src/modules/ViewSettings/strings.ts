/** ViewSettings' built in copy. */
export const strings = {
  show: (name: string) => `Show ${name}`,
  move: (name: string) => `Move ${name}`,
  locked: 'Always shown',
  shown: (count: string, total: string) => `${count} of ${total} shown`,
  searchFields: 'Search attributes',
  noMatches: 'No attributes match',
} as const;
