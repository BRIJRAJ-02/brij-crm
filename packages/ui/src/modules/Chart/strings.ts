/** Chart's built in words. */
export const strings = {
  /** The chart or table switch's name. */
  view: 'View',
  chart: 'Chart',
  table: 'Table',
  loading: 'Loading',
  emptyTitle: 'No data yet',
  emptyText: 'Nothing matches.',
  errorTitle: 'Couldn’t load this',
  errorText: 'Check your connection.',
  noAccessTitle: 'You can’t see this',
  noAccessText: 'Ask an admin for access.',
  /** What a screen reader hears for the drawing: its name, then each point and its value. */
  summary: (label: string, parts: readonly string[]): string => `${label}. ${parts.join(', ')}`,
  /** One point in that summary. */
  part: (label: string, value: string): string => `${label} ${value}`,
} as const;
