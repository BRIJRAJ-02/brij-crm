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
    /** The system tells the assignee on the due day (the actor isn't named: nobody did it). */
    task_due: (_actor: string) => 'Your task is due today',
    /** The actor is the person asking (the screen names them), not whoever acted. */
    join_request: (actor: string) => `${actor} asks to join`,
    /** The actor is "Automation"; the row's excerpt carries its message. */
    automation: (actor: string) => `${actor} notified you`,
    /** Someone else changed the reader's hours, time off, limits, pages or rotations (spec 0037, AC-1264). */
    scheduling_changed: (actor: string) => `${actor} changed your scheduling`,
    /** Never read: a webhook endpoint turning off leads with the endpoint, through `webhookOff` (spec 0064). */
    webhook_off: (_actor: string) => 'A webhook endpoint turned off',
    /** A guest booked one of the reader's pages, its page unknown (`booked` names it when it is). */
    booking: (actor: string) => `${actor} booked a time`,
  },
  /** A guest booked one of the reader's pages: "Ada Lovelace booked Intro call"; the excerpt is when. */
  booked: (guest: string, page: string) => `${guest} booked ${page}`,
  /**
   * A webhook endpoint turned off after 3 days of failed deliveries (spec 0064, AC-6423), its host first as a
   * submission leads with its form: nobody turned it off, so naming an actor would read as blame.
   */
  webhookOff: (endpoint: string) => `${endpoint} stopped answering, so its webhook is off`,
  /** An endpoint whose host didn't come with the notice. */
  someEndpoint: 'A webhook endpoint',
  /** A form's new submission, its form first as the other rows lead with who acted: "Contact us got a new submission". */
  submission: (form: string) => `${form} got a new submission`,
  /** A submission's form whose name didn't come with it. */
  someForm: 'A form',
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
