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
  /** The Activity tab's filter: its name, and its choices. */
  activityFilter: 'Filter',
  filterAll: 'All activity',
  filterChanges: 'Changes',
  filterNotes: 'Notes',
  filterTasks: 'Tasks',
  filterComments: 'Comments',
  filterMeetings: 'Meetings',
  details: 'Details',
  /** The ⋯ at the foot of Details, for schema managers (flow pass, 30 October 2026). */
  detailsActions: 'Attribute actions',
  addAttribute: 'Add attribute',
  manageAttributes: 'Manage attributes',
  attributeAdded: (title: string) => `${title} added.`,
  recentActivity: 'Recent activity',
  /** The stat strip under the header (the tabs keep the counts): when it last changed, its next meeting, its stage. */
  lastActivity: 'Last activity',
  nextMeeting: 'Next meeting',
  enteredStage: (stage: string) => `Entered “${stage}”`,
  viewAll: 'View all',
  /** Recent activity's "View all" by its full name, apart from Open tasks' beside it. */
  viewAllActivity: 'View all activity',
  /** The trashed banner's action, for someone who may change the object (the Trash screen's rule). */
  restore: 'Restore',
  restoring: 'Restoring…',
  restored: (name: string) => `Restored ${name}.`,
  restoreFailed: 'Couldn’t restore it. Try again in a moment.',
  /** The header's More menu: Copy link, and Delete for someone who may change the object. */
  more: 'More actions',
  deleteRecord: (singularName: string) => `Delete ${singularName.toLowerCase()}`,
  /** Delete's confirm: the question, what happens, and the verb. */
  /** A record on an object the person may only read: a Badge in the header, and why on its lock. */
  viewOnly: 'View only',
  viewOnlyReason: (pluralName: string) => `You can view ${pluralName} but not edit them. Ask an admin.`,
  copyLink: 'Copy link',
  linkCopied: 'Link copied',
  copyFailed: 'Couldn’t copy the link. Copy it from the address bar.',
  unnamed: (singularName: string) => `Unnamed ${singularName.toLowerCase()}`,
  /** A meeting's attendee added as a person (spec 0024, AC-609). */
  addedPerson: (name: string) => `${name} added as a person`,
  /** Related sections and cards (spec 0017, milestone 3): the far object's plural as their noun ("people"). */
  relatedNoun: (pluralName: string) => pluralName.toLowerCase(),
  /** The Related card Overview holds while the page loads, before its sides are known. */
  relatedPending: 'Related records',
  /** The toasts once a Remove or an Add lands, each with Undo. */
  removed: (name: string, side: string) => `Removed ${name} from ${side}.`,
  added: (name: string, side: string) => `Added ${name} to ${side}.`,
  /** An Add that took the record from the one holding it on a side of one ("At Acme"). */
  moved: (name: string, side: string, from: string) => `Moved ${name} to ${side} from ${from}.`,
  undo: 'Undo',
  /** A picker's "Create …" once the record is made and linked (its chip already shows where), with Undo. */
  createdLinked: (name: string) => `Created ${name}.`,
  /** A picker's "Create …" refused: nothing was made or linked. */
  notCreated: (name: string, reason: string) => `Couldn’t create ${name}. ${reason}`,
  tryAgain: 'Try again in a moment.',
  /** A Related card's "View all" with the side's total, and said in full. */
  viewAllRelated: (count: string) => `View all ${count}`,
  viewAllRelatedLabel: (count: string, noun: string, side: string) => `View all ${count} ${noun} in ${side}`,
  /** A linked record this person can't see, or that was deleted. */
  unavailableRecord: 'Unavailable',
  /** Why a reference that can't link (one way, or its far object hidden) can't be edited here. */
  referenceReadOnly: 'You can’t change this here yet.',
} as const;
