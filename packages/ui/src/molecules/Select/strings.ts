/** Select's built in copy. */
export const strings = {
  choose: 'Choose…',
  none: 'None',
  clear: 'Clear',
  readOnly: 'Read only',
  search: 'Search',
  noMatches: 'No matches',
  /** The last item when what is typed is no option yet (spec 0012, AC-238). */
  create: (label: string) => `Create "${label}"`,
  /** Between the names of several chosen options in the closed field (`selectionMode="multiple"`). */
  listJoin: ', ',
} as const;
