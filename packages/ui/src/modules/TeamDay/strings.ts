/** TeamDay's built in copy. */
export const strings = {
  lane: 'Needs a host',
  laneLabel: (count: number) => (count === 1 ? 'Needs a host, 1 booking' : `Needs a host, ${String(count)} bookings`),
  laneHint: 'Reassign each one to someone free.',
  separator: ' · ',
  details: 'Details',
} as const;
