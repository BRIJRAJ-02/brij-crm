/** The Bookings page's copy. */
export const strings = {
  title: 'Bookings',
  tabsLabel: 'Which bookings',
  tabs: { upcoming: 'Upcoming', past: 'Past', cancelled: 'Canceled' },
  listLabel: { upcoming: 'Upcoming bookings', past: 'Past bookings', cancelled: 'Canceled bookings' },
  /** Each tab's own empty state. */
  empty: {
    upcoming: {
      title: 'No upcoming bookings',
      text: 'You have no upcoming bookings. Bookings people make through your links will show up here.',
    },
    past: { title: 'No past bookings', text: 'You have no past bookings. Meetings that have ended will show up here.' },
    cancelled: {
      title: 'No canceled bookings',
      text: 'You have no canceled bookings. Bookings that are canceled will show up here.',
    },
  },
  /** The way to the booking links, under Captures. */
  openLinks: 'Go to your booking links',
  /** The way to the member's own weekly hours and days off. */
  openAvailability: 'Set your availability',
  failedTitle: 'Bookings didn’t load',
  failedText: 'Check your connection and try again.',
  today: 'Today',
  tomorrow: 'Tomorrow',
  cancelled: 'Canceled',
  /** Who provides a meeting link, by its host. */
  providers: { google: 'Google Meet', microsoft: 'Microsoft Teams', zoom: 'Zoom', other: 'the call' },
  /** The details panel. */
  details: 'Booking',
  when: 'When',
  page: 'Booking page',
  guest: 'Guest',
  email: 'Email',
  guests: 'Also invited',
  timeZone: 'Their time zone',
  where: 'Where',
  note: 'Their note',
  status: 'Status',
  confirmed: 'Confirmed',
  cancelReason: 'Why it was canceled',
  person: 'Person',
  openPerson: 'Open their page',
  eventFailed: 'This booking isn’t on your calendar: the event couldn’t be made. Add it by hand.',
  video: 'Video call',
  phone: 'Phone call to their number',
} as const;
