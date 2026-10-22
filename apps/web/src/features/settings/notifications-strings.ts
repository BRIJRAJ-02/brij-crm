// Settings › Account › Notifications: the page's copy (spec 0038), apart from the other settings pages' own.

/** Settings › Account › Notifications: the page's copy (AC-1179). Short labels; the help sits in InfoTips. */
export const strings = {
  title: 'Notifications',
  email: 'Email',
  /** Under the Email heading: the inbox is always on (AC-1179), said where it's seen. */
  emailDescription: 'Your inbox always gets every notification.',
  /** The Email section's InfoTip: what an email holds, and that the inbox is always on. */
  emailInfo: 'An email a few minutes after something new, holding everything still unread.',
  mentions: 'Mentions',
  replies: 'Replies',
  assignments: 'Task assignments',
  digest: 'Daily digest',
  digestInfo: 'One email at 8 in the morning, your time, of what is still unread.',
  loadFailed: 'Your notification settings didn’t load.',
} as const;
