/** DatePicker's built in copy. */
export const strings = {
  calendar: 'Calendar',
  openCalendar: 'Open calendar',
  previousMonth: 'Previous month',
  nextMonth: 'Next month',
  previousYear: 'Previous year',
  nextYear: 'Next year',
  /** The title's name: it opens the year's months. */
  chooseMonth: (month: string) => `${month}, choose a month`,
  today: 'Today',
  tomorrow: 'Tomorrow',
  nextWeek: 'Next week',
  endOfMonth: 'End of month',
  quickPicks: 'Quick picks',
  /** The last quick pick: the date goes. */
  noDate: 'No date',
  typeDate: 'Type a date',
  typeDatePlaceholder: 'Type a date…',
  /** At the typed row's end while what is typed names no day. */
  noDateFound: 'No match',
  presets: 'Presets',
  lastSevenDays: 'Last 7 days',
  thisMonth: 'This month',
  lastMonth: 'Last month',
  thisQuarter: 'This quarter',
  readOnly: 'Read only',
} as const;
