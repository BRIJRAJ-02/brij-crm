// Settings › Account › Notifications: the page's copy (spec 0038), apart from the other settings pages' own.

/** Settings › Account › Notifications: the page's copy (AC-1179). Short labels; the help sits in InfoTips. */
export const strings = {
  title: 'Notifications',
  email: 'Email',
  /** Under the Email heading: the inbox is always on (AC-1179), said where it's seen. */
  emailDescription: 'Everything shows in your Inbox. Pick what also comes by email.',
  mentions: 'Mentions',
  replies: 'Replies',
  assignments: 'Task assignments',
  digest: 'Daily digest',
  /** The digest's InfoTip: what it is, in one line (30 October 2026). */
  digestInfo: 'One email at 8am with what’s unread.',
  /** After a switch lands: the toast and its Undo. A refusal is put back with the data layer's own toast. */
  saved: 'Notifications saved',
  undo: 'Undo',
  undone: 'Change undone',
  loadFailed: 'Your notification settings didn’t load.',
} as const;
