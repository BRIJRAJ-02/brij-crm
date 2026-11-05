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
  /** Tasks of theirs due today (migration 0135). */
  dueToday: 'Due today',
  submissions: 'Form submissions',
  bookings: 'Bookings',
  /** A booking whose guest's name didn't come with it. */
  someGuest: 'A guest',
  /** A booked time that has since been cancelled: "Thu 5 Nov, 10:00 · Cancelled". */
  bookingCancelled: (when: string) => `${when} · Cancelled`,
  /** A submission's form whose name didn't come with it. */
  someForm: 'A form',
  unreadOnly: 'Unread only',
  markAllDone: 'Mark all done',
  /** The toasts a move between Inbox and Done raises, each with Undo. */
  markedDone: 'Marked done',
  movedToInbox: 'Moved to inbox',
  markedAllDone: 'Inbox cleared',
  undo: 'Undo',
  /** The list's name: "Inbox", or "Inbox, Mentions" under a kind. */
  listLabel: (tab: string, kind: string | undefined) => (kind === undefined ? tab : `${tab}, ${kind}`),
  emptyDone: 'Nothing done yet.',
  emptyFiltered: 'No notifications match.',
  clearFilters: 'Clear filters',
  /** The empty inbox's way to Settings › Account › Notifications. */
  notificationSettings: 'Notification settings',
  formerMember: 'Former member',
  failedTitle: 'The inbox didn’t load',
} as const;
