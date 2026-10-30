/** Home's copy (spec 0041): the workspace's landing page, ported from timefix's dashboard. */
export const strings = {
  home: 'Home',

  // The greeting
  greeting: {
    morning: (name: string | undefined) => (name === undefined ? 'Good morning' : `Good morning, ${name}`),
    afternoon: (name: string | undefined) => (name === undefined ? 'Good afternoon' : `Good afternoon, ${name}`),
    evening: (name: string | undefined) => (name === undefined ? 'Good evening' : `Good evening, ${name}`),
  },

  // Putting a section away
  hidden: 'Hidden from Home. Bring it back from Preferences in Settings.',
  undo: 'Undo',

  // Finish setting up
  setupTitle: 'Finish setting up',
  steps: {
    calendar: { title: 'Connect your calendar', action: 'Connect' },
    bookingPage: { title: 'Create a booking page', action: 'Create' },
    form: { title: 'Create a form', action: 'Create' },
    contacts: { title: 'Import your contacts', action: 'Import' },
    invite: { title: 'Invite your team', action: 'Invite' },
  },
  notConnected: 'Not connected',
  noneYet: 'None yet',
  pages: (count: number) => (count === 1 ? '1 page' : `${count.toLocaleString('en')} pages`),
  forms: (count: number) => (count === 1 ? '1 form' : `${count.toLocaleString('en')} forms`),
  justYou: 'Just you',
  contacts: (count: number) => (count === 1 ? '1 person' : `${count.toLocaleString('en')} people`),
  people: (count: number) => `${count.toLocaleString('en')} people`,
  invited: (count: number) => `${count.toLocaleString('en')} invited`,

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
  noMeetings: 'No meetings today',
  noMeetingsText: 'Meetings you host and your calendar’s events show here.',

  // My tasks
  myTasks: 'My tasks',
  allTasks: 'All tasks',
  noTasksDue: 'Nothing due',
  noTasksDueText: 'Tasks due today or overdue show here.',
  moreDue: (count: number) => (count === 1 ? '1 more due' : `${count.toLocaleString('en')} more due`),
  moreInTasks: 'More in My tasks',
  seeAll: 'See all',

  // Recently viewed
  recent: 'Recently viewed',
  noRecent: 'Nothing viewed yet',
  noRecentText: 'Records you open show here.',

  // New captures
  captures: 'New captures',
  allForms: 'Forms',
  noCaptures: 'No submissions yet',
  noCapturesText: 'Forms that take a submission show here, newest first.',
  capturesFailed: 'Forms didn’t load',
  captureLine: (count: number, when: string) =>
    count === 0 ? `Last submission ${when}` : `${count.toLocaleString('en')} this month, last on ${when}`,

  // Team today
  teamToday: 'Team today',
  teamFailed: 'Team today didn’t load',
  you: (name: string) => `${name} (you)`,
  inMeeting: 'In a meeting',
  busy: 'Busy',
  freeNow: 'Free now',
  teamDescription: 'Times in your time zone',
  aTeammate: 'A teammate',
  until: (time: string) => `Until ${time}`,
  titleUntil: (title: string, time: string) => `${title} until ${time}`,
  next: (title: string, time: string) => `Next: ${title}, ${time}`,
  busyFrom: (time: string) => `Busy from ${time}`,
  nothingElse: 'Nothing else today',
  moreTeam: (count: number) => (count === 1 ? '1 more person' : `${count.toLocaleString('en')} more people`),

  // The metrics row
  thisWeek: 'This week',
  againstLastWeek: 'Since Monday, compared with all of last week',
  metricsFailed: 'This week’s figures didn’t load',
  quietWeek: 'Nothing new this week yet',
  quietWeekText: 'Meetings booked, new people and deals, and form submissions show here.',
  metricLabels: {
    meetings: 'Meetings booked',
    people: 'New people',
    deals: 'New deals',
    won: 'Deals won',
    submissions: 'Form submissions',
  },
  lastWeek: (value: string) => `${value} last week`,
  otherCurrencies: 'Deals won in other currencies aren’t counted.',

  // The page
  failedText: 'Check your connection and try again.',
} as const;
