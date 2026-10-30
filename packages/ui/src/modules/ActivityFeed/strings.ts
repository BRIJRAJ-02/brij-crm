/** ActivityFeed's built in copy. */
export const strings = {
  loading: 'Loading activity',
  empty: 'No activity yet',
  emptyBody: 'Changes, notes, tasks, comments and meetings show here as they happen.',
  /** A run of changes at one moment: open each, and fold them again. */
  showAll: 'Show all',
  showLess: 'Show less',
  /** Between the names of the attributes a run of changes touched. */
  nameSeparator: ', ',
  failed: 'Activity didn’t load',
  noAccess: 'You can’t see this activity',
  noAccessBody: 'Ask a workspace admin for access.',
  /** An entry still loading, for screen readers. */
  loadingEntry: 'Loading',
  /** Above meetings still to come (spec 0024). */
  upcoming: 'Upcoming',
  today: 'Today',
  yesterday: 'Yesterday',
  week: 'Earlier this week',
  /** The verb after the actor's name. */
  verbs: {
    changed: 'changed',
    set: 'set',
    cleared: 'cleared',
    /** A checkbox's change says itself in the verb: "checked Email opt out", no boxes under it. */
    checked: 'checked',
    unchecked: 'unchecked',
    created: 'created this record',
    deleted: 'moved this record to the trash',
    /** One actor's changes at one moment, counted. */
    changedMany: (count: number) => `changed ${String(count)} attributes`,
    note: 'added a note',
    task: 'added a task',
    taskDone: 'completed a task',
    comment: 'commented',
    email: 'sent an email',
    meeting: 'had a meeting',
    /** A form's submission (spec 0023), the form being the actor. */
    submission: {
      created: 'created this record from a submission',
      updated: 'updated this record from a submission',
      matched: 'received a submission for this record',
      linked: 'linked this record from a submission',
    },
    added: 'added',
    removed: 'removed',
  },
  /** Where linked records went: "added Jane Doe to Team", "removed Jane Doe from Team". */
  linkedTo: 'to',
  linkedFrom: 'from',
  /** Between names: "Jane Doe, Ada Lovelace and Alan Turing". */
  listSeparator: ',',
  listLast: 'and',
  /** The records a link entry doesn't name, the count already formatted: "and 97 others". */
  others: (count: string, isOne: boolean) => (isOne ? `${count} other` : `${count} others`),
  /** A link entry none of whose records could be named. */
  records: (count: string, isOne: boolean) => (isOne ? `${count} record` : `${count} records`),
  /** Between an entry's added and removed records. */
  clauseSeparator: ', and',
  /** Between a change's old and new value, for screen readers. */
  to: 'to',
  /** A meeting entry's line, before its title (spec 0024). */
  meeting: 'Meeting:',
  /** Before a meeting's attendees, for screen readers. */
  attendees: 'With',
  /** An attendee's answer, beside their name, when it isn't yes. */
  responses: { declined: 'declined', tentative: 'maybe', needs_action: 'no reply' },
  /** A meeting's video link. */
  joinVideo: 'Join video call',
  /** One of a booked meeting's answers (spec 0057): "Budget: Under 5k". */
  answerLine: (label: string, text: string) => `${label}: ${text}`,
  /** Past the first three: "2 more answers on the booking". */
  moreAnswers: (count: number) =>
    count === 1 ? '1 more answer on the booking' : `${String(count)} more answers on the booking`,
  /** An attendee the CRM doesn't know (spec 0024, AC-609). */
  addPerson: 'Add as person',
  addingPerson: 'Adding',
  /** Several people hold the attendee's address, so none is linked. */
  ambiguous: 'several people match',
  /** A private meeting the reader doesn't hold: its time only. */
  privateMeeting: 'Only the people it belongs to see its details.',
} as const;
