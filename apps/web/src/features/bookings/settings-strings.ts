// Bookings settings' words: its name, the groups of its navigation and each page's name there (the mock's IA,
// 9 November 2026). Apart from each screen's own words, so the navigation never loads them.

/** Bookings settings' copy. */
export const strings = {
  /** The navigation's name, and the trail's place after Bookings. */
  title: 'Bookings settings',
  /** The trail's short word for this place: Bookings › Settings › Teams. */
  settings: 'Settings',
  bookings: 'Bookings',
  groups: { connections: 'Connections', people: 'People', guestsSee: 'Guests see' },
  calendars: 'Calendars',
  /** Round robin's groups, named as the people who take turns (the mock's ruling). */
  teams: 'Teams',
  access: 'Scheduling access',
  brand: 'Brand',
  /** On a phone, where the sidebar is hidden: the chevron back to Bookings. */
  backToBookings: 'Bookings',
} as const;
