/** RecordStats' built in copy. */
export const strings = {
  /** A stat with no value yet: no activity, say. */
  none: 'None',
  /** What an empty stat shows to sight: a quiet dash, its words for screen readers. */
  dash: '—',
  /** A count that is a floor: "10,000+". */
  atLeast: (count: string) => `${count}+`,
} as const;
