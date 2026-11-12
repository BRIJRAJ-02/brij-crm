/** Tag and TagList's built in copy. */
export const strings = {
  archived: '(archived)',
  /** Tag's `ai` tone, after its words for screen readers: the sparkle says it to the eye. */
  filledByAi: '(filled by AI)',
  allTags: 'All tags',
  more: (count: number) => `+${String(count)}`,
  showMore: (count: number) => `Show ${String(count)} more`,
} as const;
