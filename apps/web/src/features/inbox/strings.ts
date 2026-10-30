/** The inbox's copy (spec 0038). */
export const strings = {
  inbox: 'Inbox',
  done: 'Done',
  /** The Inbox and Done switch's name. */
  whichNotifications: 'Inbox or done',
  /** The kind filter's name and its segments (AC-1170). */
  kindLabel: 'Kind of notification',
  /** The kind menu's first choice, standing alone in the bar. */
  allKinds: 'All kinds',
  mentions: 'Mentions',
  replies: 'Replies',
  assignments: 'Assignments',
  /** Tasks of theirs due today (migration 0136). */
  dueToday: 'Due today',
  submissions: 'Form submissions',
  /** A submission's form whose name didn't come with it. */
  someForm: 'A form',
  unreadOnly: 'Unread only',
  markAllRead: 'Mark all as read',
  markAllDone: 'Mark all done',
  /** The list's name: "Inbox", or "Inbox, Mentions" under a kind. */
  listLabel: (tab: string, kind: string | undefined) => (kind === undefined ? tab : `${tab}, ${kind}`),
  /** Under "You’re all caught up.": what lands in the inbox, so an empty one says what it is for. */
  emptyBody:
    'Mentions, replies to your threads, tasks assigned to you or due today and new form submissions show here.',
  emptyDone: 'Nothing done yet.',
  emptyFiltered: 'No notifications match.',
  clearFilters: 'Clear filters',
  /** The empty inbox's way to Settings › Account › Notifications. */
  notificationSettings: 'Notification settings',
  formerMember: 'Former member',
  failedTitle: 'The inbox didn’t load',
} as const;
