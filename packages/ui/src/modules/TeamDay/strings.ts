/** TeamDay's built in copy. */
export const strings = {
  laneLabel: (count: number) => (count === 1 ? 'Needs a host, 1 booking' : `Needs a host, ${String(count)} bookings`),
  laneTitle: 'Needs a host',
  laneCount: (count: number) => `Needs a host · ${String(count)}`,
  laneSummary: (count: number) => (count === 1 ? '1 needs a host' : `${String(count)} need a host`),
  hintSeparator: ' · ',
  viewOnly: 'view only',
  details: 'Details',
} as const;
