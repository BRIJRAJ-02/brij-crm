// Every word the business page's parts say by themselves (spec 0066, B4 lite). What the business wrote (its name,
// About, menu, addresses) comes in through props.

export const strings = {
  /** The section tabs' landmark. */
  sections: 'Sections',
  menu: 'Menu',
  about: 'About',
  hours: 'Opening hours',
  location: 'Location',
  places: 'Places',
  amenities: 'Amenities',
  /** Open status. */
  openNow: 'Open now',
  closed: 'Closed',
  closesAt: (time: string) => `Closes at ${time}`,
  opensAt: (when: string) => `Opens ${when}`,
  opensToday: (time: string) => `at ${time}`,
  opensTomorrow: (time: string) => `tomorrow at ${time}`,
  opensOn: (day: string, time: string) => `${day} at ${time}`,
  /** The hours list. */
  today: 'Today',
  closedAllDay: 'Closed',
  timesIn: (zone: string) => `Times in ${zone} time`,
  /** Location. */
  directions: 'Directions',
  googleMaps: 'Google Maps',
  appleMaps: 'Apple Maps',
  directionsNewTab: (app: string) => `Directions in ${app} (opens in a new tab)`,
  call: (phone: string) => `Call ${phone}`,
  website: 'Website',
  websiteNewTab: 'Website (opens in a new tab)',
  /** Reserve a table. */
  reserve: 'Reserve a table',
  comingSoon: 'Coming soon',
  reserveSoon: 'Online reservations are coming soon. Call to book a table.',
  /** The gallery. */
  photos: 'Photos',
  seeAllPhotos: (count: number) => `See all ${String(count)} photos`,
  photoOf: (index: number, count: number) => `Photo ${String(index)} of ${String(count)}`,
  openPhoto: (index: number, count: number) => `Open photo ${String(index)} of ${String(count)}`,
  previousPhoto: 'Previous photo',
  nextPhoto: 'Next photo',
  noPhotos: 'No photos yet',
  /** The places picker. */
  otherPlaces: 'Other places',
  viewPlace: (name: string) => `View ${name}`,
  /** The logo beside the name, which the name already says: decorative. */
  logoAlt: '',
  /** Loading. */
  loading: 'Loading the page',
} as const;
