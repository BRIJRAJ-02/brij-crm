// The words of a colleague's calendar health (spec 0037, AC-1307 to AC-1309, AC-1315).
export const calendarHealthStrings = {
  column: 'Calendar',
  connected: 'Connected',
  skipped: 'Some calendars skipped',
  reconnect: 'Reconnect needed',
  none: 'No calendar',
  hidden: 'Hidden',
  unavailable: 'Unavailable',
  hiddenHint: (name: string) => `Only people who can see ${name}’s scheduling see their calendar status.`,
  noneHint: 'Booked from their hours and bookings only, until they connect a calendar.',
  since: (when: string) => `Since ${when}`,
  ask: 'Ask to reconnect',
  asked: 'Asked to reconnect',
  askedToast: (name: string) => `Asked ${name} to reconnect their calendar.`,
} as const;
