/** The record page's copy (spec 0017). The side panel (milestone 4) shares `recordUnavailable`. */
export const strings = {
  /** A search result held on a far side that holds one (spec 0014): picking it moves it here. */
  linkedAt: (name: string) => `At ${name}`,
  /** The same, held by a record the person can't see: never named. */
  linkedElsewhere: 'Linked elsewhere',
  /** A record that doesn't exist and one the person may not see read the same (AC-376, AC-384). */
  recordUnavailable: 'This record isn’t available',
  /** Under it: what to do next. */
  recordUnavailableText: 'It may have been deleted, or you may not have access to it.',
  backTo: (pluralName: string) => `Back to ${pluralName}`,
  /** A record in the trash, opened read only (AC-376). */
  wasDeleted: (singularName: string) => `This ${singularName.toLowerCase()} was deleted.`,
  /** Deleted, or access lost, while the page was open (AC-376). */
  noLongerAvailable: (singularName: string) => `This ${singularName.toLowerCase()} is no longer available.`,
  loadFailed: 'Couldn’t load this record',
  loadFailedText: 'Something went wrong. Try again in a moment.',
  loading: 'Loading',
  /** What the tabs switch between, for screen readers. */
  tabs: 'Record',
  overview: 'Overview',
  activity: 'Activity',
  details: 'Details',
  recentActivity: 'Recent activity',
  /** The stat strip under the header (the tabs keep the counts): when it last changed, its next meeting, its stage. */
  lastActivity: 'Last activity',
  nextMeeting: 'Next meeting',
  enteredStage: (stage: string) => `Entered “${stage}”`,
  viewAll: 'View all',
  /** Recent activity's "View all" by its full name, apart from Open tasks' beside it. */
  viewAllActivity: 'View all activity',
  copyLink: 'Copy link',
  linkCopied: 'Link copied',
  copyFailed: 'Couldn’t copy the link. Copy it from the address bar.',
  unnamed: (singularName: string) => `Unnamed ${singularName.toLowerCase()}`,
  /** A meeting's attendee added as a person (spec 0024, AC-609). */
  addedPerson: (name: string) => `${name} added as a person`,
  /** A linked record this person can't see, or that was deleted. */
  unavailableRecord: 'Unavailable',
  /** Why a reference or member value can't be edited here yet (#15 brings the record picker). */
  referenceReadOnly: 'You can’t change this here yet.',
} as const;
