/** Home's copy (spec 0041): the workspace's landing page, ported from timefix's dashboard. */
export const strings = {
  home: 'Home',

  // Finish setting up
  setupTitle: 'Finish setting up',
  setupLeft: (count: number) => `${String(count)} left`,
  done: 'Done',
  steps: {
    calendar: { title: 'Connect your calendar', action: 'Connect' },
    bookingPage: { title: 'Create a booking page', action: 'Create' },
    form: { title: 'Create a form', action: 'Create' },
    invite: { title: 'Invite your team', action: 'Invite' },
  },
  notConnected: 'Not connected',
  noneYet: 'None yet',
  pages: (count: number) => (count === 1 ? '1 page' : `${String(count)} pages`),
  forms: (count: number) => (count === 1 ? '1 form' : `${String(count)} forms`),
  justYou: 'Just you',
  people: (count: number) => `${String(count)} people`,

  // Today
  today: 'Today',
  allBookings: 'All bookings',
  earlier: 'Earlier',
  comingUp: 'Coming up',
  allDay: 'All day',
  minutes: (count: number) => `${String(count)} min`,
  hours: (hours: number, minutes: number) =>
    minutes === 0 ? `${String(hours)} hr` : `${String(hours)} hr ${String(minutes)} min`,
  todayFailed: 'Today’s meetings didn’t load',

  // Tasks due
  tasksDue: 'Tasks due',
  allTasks: 'All tasks',

  // Needs attention
  needsAttention: 'Needs attention',
  allDeals: 'All deals',
  attentionText: 'Open deals you own, unchanged for 14 days or more.',
  attentionFailed: 'Deals didn’t load',
  changed: (when: string) => `Changed ${when}`,
  more: (count: number) => (count === 1 ? '1 more deal' : `${count.toLocaleString('en')} more deals`),

  // The page
  quietTitle: 'Nothing needs you right now',
  quietText: 'Meetings today, tasks due and deals going quiet show up here.',
  failedText: 'Check your connection and try again.',
} as const;
