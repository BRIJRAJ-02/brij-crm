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
  unreadOnly: 'Unread only',
  markAllRead: 'Mark all as read',
  nothingUnread: 'Nothing here is unread.',
  /** The list's name: "Inbox", or "Inbox, Mentions" under a kind. */
  listLabel: (tab: string, kind: string | undefined) => (kind === undefined ? tab : `${tab}, ${kind}`),
  /** Under "You’re all caught up.": what lands in the inbox, so an empty one says what it is for. */
  emptyBody: 'Mentions, replies to your threads and tasks assigned to you show here.',
  emptyDone: 'Nothing done yet.',
  emptyFiltered: 'No notifications match.',
  clearFilters: 'Clear filters',
  formerMember: 'Former member',
  failedTitle: 'The inbox didn’t load',
} as const;
