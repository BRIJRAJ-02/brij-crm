// Settings › Account › Notifications: the page's copy (spec 0038), apart from the other settings pages' own.

/** Settings › Account › Notifications: the page's copy (AC-1179). Short labels; the help sits in InfoTips. */
export const strings = {
  title: 'Notifications',
  /** The Inbox card (collaboration): which in app notices come, beside the ones that always do. */
  inbox: 'Inbox',
  /** Under the Inbox heading: what always arrives (AC-1179), beside the one switch. */
  inboxDescription: 'Mentions, replies and tasks always arrive here.',
  followed: 'Records you follow',
  /** The switch's InfoTip: what it covers, in one line. */
  followedInfo: 'You follow records you create or own. Changes others make show here.',
  email: 'Email',
  /** Under the Email heading: the inbox is always on (AC-1179), said where it's seen. */
  emailDescription: 'Choose what is also emailed.',
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
