/** SlotPicker's built in copy. */
export const strings = {
  region: 'Pick a time',
  days: 'Days',
  previousWeek: 'Previous week',
  nextWeek: 'Next week',
  nextWeekAction: 'Next week',
  loading: 'Loading open times',
  noTimes: 'no open times',
  emptyWeekTitle: 'No open times this week',
  emptyWeekText: 'Try the next week.',
  failedTitle: 'Open times didn’t load',
  failedText: 'Check your connection and try again.',
  times: (day: string) => `Open times on ${day}`,
} as const;
