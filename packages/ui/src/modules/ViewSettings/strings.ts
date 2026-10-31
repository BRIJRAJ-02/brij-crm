/** ViewSettings' built in copy. */
export const strings = {
  show: (name: string) => `Show ${name}`,
  hide: (name: string) => `Hide ${name}`,
  move: (name: string) => `Move ${name}`,
  locked: 'Always shown',
  shown: 'Shown',
  hidden: 'Hidden',
  system: 'System',
  /** Shown against a board card's limit: "3 of 6". */
  shownOf: (count: string, total: string) => `${count} of ${total}`,
  /** A list's name for screen readers: "Columns, shown". */
  list: (label: string, section: string) => `${label}, ${section.toLocaleLowerCase()}`,
  /** Over Hidden while Shown is at its limit (a board card's six): why Show is off. */
  atLimit: 'Hide one to add another',
  searchFields: 'Search attributes',
  findField: 'Find a field',
  noMatches: 'No attributes match',
} as const;
