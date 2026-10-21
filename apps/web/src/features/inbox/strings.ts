/** The inbox's copy (spec 0038). */
export const strings = {
  inbox: 'Inbox',
  done: 'Done',
  /** The Inbox and Done switch's name. */
  whichNotifications: 'Inbox or done',
  /** The kind filter's name and its segments (AC-1170). */
  kindLabel: 'Kind of notification',
  all: 'All',
  mentions: 'Mentions',
  replies: 'Replies',
  assignments: 'Assignments',
  unreadOnly: 'Unread only',
  markAllRead: 'Mark all as read',
  /** The list's name: "Inbox, Mentions". */
  listLabel: (tab: string, kind: string) => (kind === 'All' ? tab : `${tab}, ${kind}`),
  emptyDone: 'Nothing done yet.',
  emptyFiltered: 'No notifications match.',
  clearFilters: 'Clear filters',
  formerMember: 'Former member',
  failedTitle: 'The inbox didn’t load',
} as const;
