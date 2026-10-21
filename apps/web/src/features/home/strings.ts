/** Home's copy (spec 0041): the workspace's landing page, ported from timefix's dashboard. */
export const strings = {
  home: 'Home',

  // Finish setting up
  setupTitle: 'Finish setting up',
  setupLeft: (count: number) => `${count.toLocaleString('en')} left`,
  done: 'Done',
  steps: {
    calendar: { title: 'Connect your calendar', action: 'Connect' },
    bookingPage: { title: 'Create a booking page', action: 'Create' },
    form: { title: 'Create a form', action: 'Create' },
    invite: { title: 'Invite your team', action: 'Invite' },
  },
  notConnected: 'Not connected',
  noneYet: 'None yet',
  pages: (count: number) => (count === 1 ? '1 page' : `${count.toLocaleString('en')} pages`),
  forms: (count: number) => (count === 1 ? '1 form' : `${count.toLocaleString('en')} forms`),
  justYou: 'Just you',
  people: (count: number) => `${count.toLocaleString('en')} people`,
  invited: (count: number) => `${count.toLocaleString('en')} invited`,

  // Today
  today: 'Today',
  calendar: 'Calendar',
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
  noTasksDue: 'No tasks due',
  moreTasks: (count: number) => (count === 1 ? '1 more task' : `${count.toLocaleString('en')} more tasks`),
  moreInTasks: 'More in My tasks',

  // The page
  quietTitle: 'Nothing needs you right now',
  quietText: 'Meetings today and tasks due show up here.',
  failedText: 'Check your connection and try again.',
} as const;
