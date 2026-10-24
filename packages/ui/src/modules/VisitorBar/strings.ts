/** VisitorBar's built in copy. */
export const strings = {
  label: 'Your calendar',
  invite: 'See when you’re both free.',
  readsOnly: 'See when you’re both free. Only free or busy is read, never what’s on it.',
  // Whose calendar it is, said outright (owner, 25 Oct 2026): a visitor read it as connecting the host's.
  connect: 'Connect your calendar',
  connectAgain: 'Connect your calendar again',
  tag: (name: string, state: string) => `${name} · ${state}`,
  tagBothFree: 'Both free',
  tagAll: 'All times',
  tagUnreachable: 'Calendar unavailable',
  tagReconnect: 'Reconnect calendar',
  bothFree: 'Showing times you’re both free.',
  showingAll: 'Showing all times. Busy ones are marked.',
  unreachable: 'Couldn’t read your calendar. Showing all times.',
  reconnect: 'Your calendar needs reconnecting. In Timefix, open Settings, then Calendar.',
  bookingAs: (name: string) => `Booking as ${name}`,
  showAll: 'Show all times',
  notYou: 'Not you?',
} as const;
