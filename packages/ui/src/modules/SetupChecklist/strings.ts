/** SetupChecklist's built in copy. */
export const strings = {
  /** The progress line: "3 of 4 done". */
  progress: (done: number, total: number) => `${done.toLocaleString('en')} of ${total.toLocaleString('en')} done`,
  /** The fold that holds the done steps: "3 done". */
  doneCount: (done: number) => `${done.toLocaleString('en')} done`,
  /** Read after a done step's title. */
  isDone: 'Done',
  /** Read after an open step's title. */
  isOpen: 'Not done yet',
  /** An open step's button, named with its step (it starts with the visible verb): "Connect, Connect your calendar". */
  actionName: (action: string, title: string) => `${action}, ${title}`,
  /** The one row left when a single step is open: "One setup step left: Invite your team". */
  oneLeft: (title: string) => `One setup step left: ${title}`,
  more: 'More setup actions',
  hide: 'Hide setup',
  allSet: 'You’re all set. Every setup step is done.',
  dismiss: 'Dismiss',
  loading: 'Loading setup',
  failed: 'Setup didn’t load',
  noAccess: 'You can’t see setup for this workspace',
  failedBody: 'Check your connection and try again.',
} as const;
