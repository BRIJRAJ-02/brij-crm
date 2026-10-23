/** RelatedRecords' built in copy. */
export const strings = {
  loading: 'Loading related records',
  /** A side with nothing linked yet: "No people yet". */
  empty: (noun: string) => `No ${noun} yet`,
  failed: 'These records didn’t load',
  failedBody: 'Check your connection and try again.',
  noAccess: 'You can’t see these records',
  showMore: 'Show more',
  moreFailed: 'More didn’t load. Try again.',
  add: 'Add',
  /** The Add button and its search by the side's name: "Add to Team". */
  addTo: (title: string) => `Add to ${title}`,
  search: (noun: string) => `Search ${noun}`,
  /** A row's Remove by its record and side: "Remove Ada Lovelace from Team". */
  remove: (name: string, title: string) => `Remove ${name} from ${title}`,
  /** The short form's footer: "View all 12". */
  viewAll: (count: string) => `View all ${count}`,
  /** The same, said in full: "View all 12 people in Team". */
  viewAllLabel: (count: string, noun: string, title: string) => `View all ${count} ${noun} in ${title}`,
  unnamed: 'Unnamed',
} as const;
