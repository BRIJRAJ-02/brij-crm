/** TeamDay's built in copy. */
export const strings = {
  laneLabel: (count: number) => (count === 1 ? 'Needs a host, 1 booking' : `Needs a host, ${String(count)} bookings`),
  laneTitle: (count: number) => `Needs a host · ${String(count)}`,
  viewOnly: 'view only',
  details: 'Details',
} as const;
