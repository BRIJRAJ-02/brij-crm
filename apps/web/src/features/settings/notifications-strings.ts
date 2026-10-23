// Settings › Account › Notifications: the page's copy (spec 0038), apart from the other settings pages' own.

/** Settings › Account › Notifications: the page's copy (AC-1179). Short labels; the help sits in InfoTips. */
export const strings = {
  title: 'Notifications',
  email: 'Email',
  /** Under the Email heading: the inbox is always on (AC-1179), said where it's seen. */
  emailDescription: 'Everything shows in your Inbox. Pick what also comes by email.',
  /** The Email section's InfoTip: when an email goes, and what it holds. */
  emailInfo: 'Emails wait a few minutes, then send everything still unread in one.',
  mentions: 'Mentions',
  mentionsInfo: 'When someone @mentions you in a comment or a note.',
  replies: 'Replies',
  repliesInfo: 'When someone replies in a comment thread you wrote in.',
  assignments: 'Task assignments',
  assignmentsInfo: 'When someone gives you a task.',
  digest: 'Daily digest',
  /** Says truthfully which zone it uses today: the browser's when it was turned on, not Preferences' (SA28). */
  digestInfo:
    'One email at 8 in the morning with everything still unread, even kinds switched off above. It uses the time zone your browser had when you turned it on.',
  /** After a switch lands: the toast and its Undo. A refusal is put back with the data layer's own toast. */
  saved: 'Notifications saved',
  undo: 'Undo',
  undone: 'Change undone',
  loadFailed: 'Your notification settings didn’t load.',
} as const;
