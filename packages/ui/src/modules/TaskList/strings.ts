/** TaskList's built in copy. */
export const strings = {
  loading: 'Loading tasks',
  empty: 'No tasks',
  emptyBody: 'Tasks you add show here, with who has them and when they’re due.',
  failed: 'Tasks didn’t load',
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
} as const;
