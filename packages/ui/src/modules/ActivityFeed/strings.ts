/** ActivityFeed's built in copy. */
export const strings = {
  loading: 'Loading activity',
  empty: 'No activity yet',
  emptyBody: 'Changes, notes, tasks and emails show here as they happen.',
  failed: 'Activity didn’t load',
  noAccess: 'You can’t see this activity',
  noAccessBody: 'Ask a workspace admin for access.',
  /** An entry still loading, for screen readers. */
  loadingEntry: 'Loading',
  today: 'Today',
  yesterday: 'Yesterday',
  week: 'Earlier this week',
  /** The verb after the actor's name. */
  verbs: {
    changed: 'changed',
    set: 'set',
    cleared: 'cleared',
    created: 'created this record',
    note: 'added a note',
    task: 'added a task',
    taskDone: 'completed a task',
    comment: 'commented',
    email: 'sent an email',
    meeting: 'had a meeting',
  },
  /** Between a change's old and new value, for screen readers. */
  to: 'to',
} as const;
