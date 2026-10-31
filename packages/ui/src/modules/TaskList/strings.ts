/** TaskList's built in copy. */
export const strings = {
  loading: 'Loading tasks',
  empty: 'No tasks',
  failed: 'Tasks didn’t load',
  failedBody: 'Check your connection and try again.',
  noAccess: 'You can’t see these tasks',
  noAccessBody: 'Ask a workspace admin for access.',
  /** The done checkbox's name: "Mark “Send the order form” as done". */
  markDone: (title: string) => `Mark “${title}” as done`,
  today: 'Today',
  tomorrow: 'Tomorrow',
  yesterday: 'Yesterday',
  overdue: 'Overdue',
  /** Read before the due day. */
  due: 'Due',
  done: 'Done',
  /** The badge on a task just made here. */
  isNew: 'New',
  /** The records' popover from "+N". */
  records: 'Records',
  /** An in place list's next page. */
  showMore: 'Show more',
} as const;
