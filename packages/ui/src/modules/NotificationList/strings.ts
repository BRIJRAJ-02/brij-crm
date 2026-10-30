/** NotificationList's built in copy. */
export const strings = {
  loading: 'Loading notifications',
  empty: 'You’re all caught up.',
  failed: 'Notifications didn’t load',
  noAccess: 'You can’t see these notifications',
  /** Why the member was notified: "Ada Lovelace mentioned you". */
  sentence: {
    mention: (actor: string) => `${actor} mentioned you`,
    reply: (actor: string) => `${actor} replied in a thread`,
    task_assigned: (actor: string) => `${actor} assigned you a task`,
    /** The actor is the person asking (the screen names them), not whoever acted. */
    join_request: (actor: string) => `${actor} asks to join`,
  },
  /** A mention in a note: "Ada Lovelace mentioned you in a note". */
  mentionInNote: (actor: string) => `${actor} mentioned you in a note`,
  /** Read before an unread row's sentence. */
  unread: 'Unread',
  moreActions: 'More actions',
  markRead: 'Mark as read',
  markUnread: 'Mark as unread',
  markDone: 'Mark done',
  moveToInbox: 'Move to inbox',
  separator: '·',
} as const;
