/** The words TeamWeek shows by itself. */
export const strings = {
  /** The person column's heading when the screen names none. */
  person: 'Team member',
  /** Today's column, as a screen reader hears its heading ("Mon 3, today"). */
  today: (day: string) => `${day}, today`,
  /** Between the week's hours and the zone's offset under a name ("38 h · UTC+5:30"). */
  separator: ' · ',
  /** The legend's list, for a screen reader. */
  legend: 'Key',
} as const;
