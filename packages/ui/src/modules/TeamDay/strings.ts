/** TeamDay's built in copy. */
export const strings = {
  lane: 'Needs a host',
  laneLabel: (count: number) => (count === 1 ? 'Needs a host, 1 booking' : `Needs a host, ${String(count)} bookings`),
  separator: ' · ',
  details: 'Details',
} as const;
