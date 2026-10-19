/** The Bookings page's copy. */
export const strings = {
  title: 'Bookings',
  /** The page's tab strip, as Captures has: its name, read by screen readers, and each tab. */
  pageTabsLabel: 'Bookings',
  pageTabs: { calendar: 'Calendar', list: 'List', availability: 'Availability' },
  tabsLabel: 'Which bookings',
  tabs: { upcoming: 'Upcoming', past: 'Past', cancelled: 'Canceled' },
  listLabel: { upcoming: 'Upcoming bookings', past: 'Past bookings', cancelled: 'Canceled bookings' },
  /** Each tab's own empty state. */
  empty: {
    upcoming: {
      title: 'Nothing coming up',
      text: 'Bookings made through your links will appear here.',
    },
    past: { title: 'Nothing behind you yet', text: 'Bookings move here once they have happened.' },
    cancelled: {
      title: 'Nothing has been called off',
      text: 'Bookings you or your guests cancel are kept here rather than deleted.',
    },
  },
  /** The way to the booking links, under Captures. */
  openLinks: 'Go to your booking links',
  /** The way to the member's own weekly hours and days off. */
  openAvailability: 'Set your availability',
  failedTitle: 'Bookings didn’t load',
  failedText: 'Check your connection and try again.',
  today: 'Today',
  todayOn: (day: string) => `Today · ${day}`,
  tomorrow: 'Tomorrow',
  previousWeek: 'Previous week',
  nextWeek: 'Next week',
  weekLabel: (range: string) => `Bookings, ${range}`,
  weekSummary: (count: number) =>
    count === 0
      ? 'Nothing booked this week.'
      : count === 1
        ? '1 booking this week.'
        : `${String(count)} bookings this week.`,
  weekLoading: 'Loading this week…',
  cancelled: 'Canceled',
  /** Who provides a meeting link, by its host. */
  providers: { google: 'Google Meet', microsoft: 'Microsoft Teams', zoom: 'Zoom', other: 'the call' },
  /** Filters. */
  filter: 'Filter',
  filterCount: (count: number) => `Filter (${String(count)})`,
  filterMenu: 'Filter bookings',
  links: 'Link',
  allLinks: 'All links',
  calendars: 'Calendars',
  clearFilters: 'Clear filters',
  noCalendarsTitle: 'No calendars selected',
  noCalendarsText: 'Choose at least one calendar in Filter to see its events.',
  /** Sort. */
  sortSoonest: 'Soonest first',
  sortLatest: 'Latest first',
  sortRecent: 'Most recent first',
  sortOldest: 'Oldest first',
  sortLabel: (current: string) => `Sort: ${current}. Change`,
  /** The details card. */
  details: 'Booking',
  status: { confirmed: 'Confirmed', cancelled: 'Canceled' },
  when: 'When',
  who: 'Who',
  page: 'Booking page',
  guests: 'Also invited',
  timeZone: 'Their time zone',
  where: 'Where',
  note: 'Note',
  quoted: (note: string) => `“${note}”`,
  cancelReason: 'Why it was canceled',
  openPerson: 'Open their page',
  joinCall: 'Join call',
  eventFailed: 'This booking isn’t on your calendar: the event couldn’t be made. Add it by hand.',
  video: 'Video call',
  phone: 'Phone call to their number',
  calendar: 'Calendar',
  fromCalendar: 'From your calendar. Timefix keeps the time blocked but doesn’t manage this event.',
  allDay: 'All day',
} as const;
