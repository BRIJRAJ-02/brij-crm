/** Tag and TagList's built in copy. */
export const strings = {
  archived: '(archived)',
  allTags: 'All tags',
  more: (count: number) => `+${String(count)}`,
  showMore: (count: number) => `Show ${String(count)} more`,
} as const;
