/** VisitorBar's built in copy. */
export const strings = {
  label: 'Your calendar',
  invite: 'See when you’re both free',
  readsOnly: 'Only free or busy is read, never what’s on it.',
  connect: 'Connect calendar',
  connectAgain: 'Connect again',
  bothFree: 'Showing times you’re both free',
  showingAll: 'Showing all times. Busy ones are marked.',
  unreachable: 'Couldn’t read your calendar. Showing all times.',
  reconnect: 'Your calendar needs reconnecting. In Timefix, open Settings, then Calendar.',
  bookingAs: (name: string) => `Booking as ${name}`,
  showAll: 'Show all times',
  notYou: 'Not you?',
} as const;
