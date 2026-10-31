/** Home's copy (spec 0041): the workspace's landing page, ported from timefix's dashboard. */
export const strings = {
  home: 'Home',
  /** The link in the bar to the charts page (the reports lane). */
  reports: 'Reports',

  // The greeting
  greeting: {
    morning: (name: string | undefined) => (name === undefined ? 'Good morning' : `Good morning, ${name}`),
    afternoon: (name: string | undefined) => (name === undefined ? 'Good afternoon' : `Good afternoon, ${name}`),
    evening: (name: string | undefined) => (name === undefined ? 'Good evening' : `Good evening, ${name}`),
  },

  // Putting a section away
  hidden: 'Hidden from Home. Bring it back from Preferences in Settings.',
  undo: 'Undo',

  // Today
  today: 'Today',
  bookings: 'Bookings',
  earlier: 'Earlier',
  comingUp: 'Coming up',
  allDay: 'All day',
  minutes: (count: number) => `${String(count)} min`,
  hours: (hours: number, minutes: number) =>
    minutes === 0 ? `${String(hours)} hr` : `${String(hours)} hr ${String(minutes)} min`,
  todayFailed: 'Today’s meetings didn’t load',
  /** Today's title when the day holds no meetings and the card shows the week's next ones. */
  nextUp: 'Next up',
  noMeetingsWeek: 'No meetings this week',

  // The page
  myTasks: 'My tasks',
  failedText: 'Check your connection and try again.',
} as const;
