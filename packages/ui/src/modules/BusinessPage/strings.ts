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
  /** Until online reservations open: the place's phone. */
  callToBook: 'Call to book',
  /** The gallery. */
  photos: 'Photos',
  seeAllPhotos: (count: number) => `See all ${String(count)} photos`,
  photoOf: (index: number, count: number) => `Photo ${String(index)} of ${String(count)}`,
  /** A gallery tile's name: its place, then what it shows when the business described it. */
  openPhoto: (index: number, count: number, description?: string) =>
    `Open photo ${String(index)} of ${String(count)}${description === undefined || description === '' ? '' : `: ${description}`}`,
  previousPhoto: 'Previous photo',
  nextPhoto: 'Next photo',
  noPhotos: 'No photos yet',
  /** The places picker. */
  otherPlaces: 'Other places',
  viewPlace: (name: string) => `View ${name}`,
  /** Loading. */
  loading: 'Loading the page',
} as const;
