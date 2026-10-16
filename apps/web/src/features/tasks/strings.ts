/** The tasks screens' copy (spec 0019, milestone 1). */
export const strings = {
  tasks: 'Tasks',
  openTasks: 'Open tasks',
  completed: 'Completed',
  addTask: 'Add a task',
  addTaskPlaceholder: 'Add a task and press Enter',
  newTask: 'New task',
  viewAll: 'View all',
  /** The Tasks tab with nothing open. */
  noOpenTasks: 'No open tasks. Add one above.',
  /** Overview's block with nothing open. */
  noOpenTasksShort: 'No open tasks.',
  noCompletedTasks: 'No completed tasks yet.',
  /** A task linked to a removed member keeps them, by this name (owner decision 6). */
  formerMember: 'Former member',
  /** Why a task's checkbox and fields can't be changed (AC-447). */
  readOnly: 'You can view this task but not change it.',
  // The task dialog.
  task: 'Task',
  loading: 'Loading the task',
  title: 'Title',
  done: 'Done',
  dueDate: 'Due date',
  assignee: 'Assignee',
  records: 'Records',
  createTask: 'Create task',
  cancel: 'Cancel',
  close: 'Close',
  copyLink: 'Copy link',
  linkCopied: 'Link copied',
  copyFailed: 'Couldn’t copy the link. Copy it from the address bar.',
  /** The footer line's term: who made it and when. */
  created: 'Created by',
  /** A link to a record of an object the person may only read (AC-447). */
  linkForbidden: 'You can’t link a task to a record you can’t change.',
  /** A task that doesn't exist, was deleted, or the reader can't see. */
  missing: 'This task doesn’t exist or you can’t see it.',
  loadFailed: 'This task didn’t load.',
  titleRequired: 'Give the task a title.',
  titleTooLong: (max: string) => `A task title holds at most ${max} characters.`,
  /** The cap on linked records, said under the field. */
  recordsFull: (max: number) => `A task links at most ${String(max)} records.`,
  unknownActor: 'Someone',
  apiKey: 'An API key',
  automation: 'An automation',
  system: 'System',
} as const;
