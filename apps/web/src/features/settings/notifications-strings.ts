// Settings › Account › Notifications: the page's copy (spec 0038), apart from the other settings pages' own.

/** Settings › Account › Notifications: the page's copy (AC-1179). */
export const strings = {
  title: 'Notifications',
  description: 'What reaches you by email from this workspace. Each switch saves at once.',
  inbox: 'Inbox',
  inboxRow: 'In app inbox',
  inboxRowDescription: 'Mentions, replies in your threads and tasks given to you.',
  inboxAlways: 'Always on',
  email: 'Email',
  emailDescription: 'An email a few minutes after something new, holding everything still unread.',
  mentions: 'Mentions',
  mentionsDescription: 'Someone mentions you in a comment.',
  replies: 'Replies',
  repliesDescription: 'Someone replies in a thread you wrote in.',
  assignments: 'Task assignments',
  assignmentsDescription: 'Someone gives you a task.',
  digest: 'Daily digest',
  digestDescription: 'One email at 8 in the morning, your time, of what is still unread.',
  loadFailed: 'Your notification settings didn’t load.',
} as const;
