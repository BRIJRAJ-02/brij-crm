import { sharedStrings } from '@crm/ui';

/** The tasks screens' copy (spec 0019). */
export const strings = {
  tasks: 'Tasks',
  openTasks: 'Open tasks',
  completed: 'Completed',
  addTask: 'Add a task',
  addTaskPlaceholder: 'Add a task and press Enter',
  newTask: 'New task',
  /** The quick add's way to the full task: its due date and assignee. */
  newTaskWithDetails: 'Add with a due date and assignee',
  /** Overview's block's way to the Tasks tab: short like Recent activity's, so both fit a phone's card head. */
  viewAll: 'View all',
  /** Its accessible name, apart from Recent activity's "View all" beside it (starts with the visible words). */
  viewAllTasks: 'View all tasks',
  /** The Tasks tab and Overview's block with nothing open (New task sits under it on the tab). */
  noOpenTasksShort: 'No open tasks',
  noCompletedTasks: 'No completed tasks yet',
  /** A task linked to a removed member keeps them, by this name (owner decision 6). */
  formerMember: 'Former member',
  /** Why a task's checkbox and fields can't be changed (AC-447). */
  readOnly: 'You can only view this task.',
  // The task dialog.
  task: 'Task',
  loading: 'Loading the task',
  title: 'Title',
  description: 'Description',
  done: 'Done',
  dueDate: 'Due date',
  assignee: 'Assignee',
  records: 'Records',
  createTask: 'Create task',
  cancel: 'Cancel',
  close: 'Close',
  copyLink: 'Copy link',
  more: 'More actions',
  deleteTask: 'Delete task',
  taskDeleted: 'Task deleted',
  taskCreated: 'Task created',
  taskCompleted: 'Task completed',
  /** The created toast's action: the task's dialog. */
  openTask: 'Open',
  undo: 'Undo',
  notDeleted: 'The task wasn’t deleted.',
  notRestored: 'Couldn’t restore the task.',
  linkCopied: 'Link copied',
  copyFailed: sharedStrings.couldntCopy,
  /** The footer line's term: who made it and when. */
  created: 'Created by',
  /** A link to a record of an object the person may only read (AC-447). */
  linkForbidden: 'You can’t link a record you can’t change.',
  /** The record picker's search didn't answer. */
  searchFailed: 'Search failed. Type again.',
  /** A task that doesn't exist, was deleted, or the reader can't see. */
  missing: 'This task isn’t available.',
  loadFailed: 'This task didn’t load.',
  titleRequired: 'Give the task a title.',
  /** The cap on linked records, said under the field. */
  recordsFull: (max: number) => `Up to ${String(max)} records.`,
  unknownActor: 'Someone',
  apiKey: 'An API key',
  automation: 'An automation',
  system: 'System',
  // My tasks (milestone 2).
  myTasks: 'My tasks',
  /** The tabs' and the switch's names, for screen readers. */
  whoseTasks: 'Whose tasks',
  taskStatus: 'Task status',
  assignedToMe: 'Assigned to me',
  createdByMe: 'Created by me',
  allTasks: 'All tasks',
  open: 'Open',
  /** My tasks' list name per filter. */
  listLabel: (filter: string, status: string) => `${filter}, ${status.toLowerCase()}`,
  overdue: 'Overdue',
  today: 'Today',
  upcoming: 'Upcoming',
  noDate: 'No date',
  emptyAssigned: 'Nothing assigned to you',
  emptyCreated: 'No open tasks you created',
  emptyAll: 'No open tasks',
  failedTitle: 'Tasks didn’t load',
} as const;
