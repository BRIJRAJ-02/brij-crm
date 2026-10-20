/** VisitorBar's built in copy. */
export const strings = {
  label: 'Your calendar',
  invite: 'See when you’re both free',
  readsOnly: 'Only free or busy is read, never what’s on it.',
  connect: 'Connect calendar',
  connectAgain: 'Connect again',
  bothFree: 'Showing times you’re both free',
  showingAll: 'Showing all times, yours that clash marked busy',
  unreachable: 'Couldn’t read your calendar. Showing all times.',
  reconnect: 'Reconnect your calendar in Timefix to see when you’re both free.',
  bookingAs: (name: string) => `Booking as ${name}`,
  showAll: 'Show all times',
  notYou: 'Not you?',
} as const;
