// Tasks (spec 0019): the work next to the data. A task has a title, a due
// date, a done state, at most one assignee and 0 to 20 linked records of any
// objects. They live in their own tables, not as records, and are read and
// written through `tasks.*`. Milestone 1 lists a record's tasks; milestone 2
// adds My tasks (`scope: { mine }`).
import { oc } from '@orpc/contract';
import * as z from 'zod';
import { ActorReferenceValue, DateValue, Timestamp } from './values/attribute-values.ts';
import { RecordRefDisplay } from './values/options.ts';
import { WorkspaceScoped } from './workspaces.ts';

/** The longest task title, in characters, after trimming its ends. */
export const TASK_TITLE_MAX = 2_000;

/** The most records one task links, hidden ones included. */
export const TASK_RECORDS_MAX = 20;

/** A page of tasks when the caller names no limit. */
export const TASK_PAGE = 50;

/** The most tasks one page answers. */
export const TASK_PAGE_MAX = 100;

/** The most tasks one `tasks.get` reads. */
export const TASK_GET_MAX = 100;

/** How far a list's count goes before it says "at least" (shown as "10,000+"). */
export const TASK_COUNT_CAP = 10_000;

/** The longest cursor `tasks.list` takes. */
export const MAX_TASK_CURSOR = 256;

/** The message for a title that is empty once trimmed. */
const TITLE_REQUIRED = 'Give the task a title.';

/** The message for a title over `TASK_TITLE_MAX`. */
const TITLE_TOO_LONG = `A task title holds at most ${TASK_TITLE_MAX.toLocaleString('en')} characters.`;

/** A task's title: trimmed at its ends, then 1 to 2,000 characters. */
export const TaskTitle = z.string().trim().min(1, TITLE_REQUIRED).max(TASK_TITLE_MAX, TITLE_TOO_LONG);
/** A task's title. */
export type TaskTitle = z.infer<typeof TaskTitle>;

/** Record ids, each once, at most `TASK_RECORDS_MAX`. */
const RecordIds = z
  .array(z.uuid())
  .max(TASK_RECORDS_MAX, `A task links at most ${String(TASK_RECORDS_MAX)} records.`)
  .refine((ids) => new Set(ids).size === ids.length, { error: 'Name each record once.' });

/**
 * A task as one member sees it. `records` holds only the linked records the
 * reader may see and that are live, in link order, and `recordCount` counts
 * them. `canChange` says whether the reader may change the task (its
 * assignee, its creator, anyone when it links no records at all, or anyone
 * who may write a linked record they can see; spec 0019, AC-447).
 */
export const TaskView = z.object({
  id: z.uuid(),
  title: z.string(),
  isDone: z.boolean(),
  doneAt: Timestamp.optional(),
  doneBy: ActorReferenceValue.optional(),
  dueOn: DateValue.optional(),
  assigneeMemberId: z.uuid().optional(),
  records: z.array(RecordRefDisplay),
  recordCount: z.number().int().min(0),
  canChange: z.boolean(),
  createdAt: Timestamp,
  createdBy: ActorReferenceValue,
  updatedAt: Timestamp,
});
/** A task as one member sees it. */
export type TaskView = z.infer<typeof TaskView>;

/**
 * A new task. `id` is a UUID v7 the browser mints when the dialog or quick
 * add opens, and the retry key: the same call again returns the same task.
 * No `assigneeMemberId` means unassigned (the browser sends the member
 * creating it, the default). Linking a record needs `write` on its object.
 */
export const CreateTaskInput = WorkspaceScoped.extend({
  id: z.uuid({ version: 'v7', message: 'The task id must be a UUID v7.' }),
  title: TaskTitle,
  dueOn: DateValue.optional(),
  assigneeMemberId: z.uuid().optional(),
  recordIds: RecordIds.optional(),
  mutationId: z.uuid(),
});
/** A new task. */
export type CreateTaskInput = z.infer<typeof CreateTaskInput>;

/**
 * A change to one task: only the fields given. `null` clears the due date or
 * the assignee. Links change only by adding and removing, never by sending a
 * whole list, so a link the writer can't see is never removed.
 */
export const UpdateTaskInput = WorkspaceScoped.extend({
  taskId: z.uuid(),
  title: TaskTitle.optional(),
  dueOn: DateValue.nullable().optional(),
  assigneeMemberId: z.uuid().nullable().optional(),
  isDone: z.boolean().optional(),
  addRecordIds: RecordIds.optional(),
  removeRecordIds: RecordIds.optional(),
  mutationId: z.uuid(),
});
/** A change to one task. */
export type UpdateTaskInput = z.infer<typeof UpdateTaskInput>;

/** Tasks by id: what a `tasks` event's ids are read back through. Missing, deleted and hidden ids are left out. */
export const GetTasksInput = WorkspaceScoped.extend({
  ids: z
    .array(z.uuid())
    .min(1)
    .max(TASK_GET_MAX, `Read at most ${String(TASK_GET_MAX)} tasks at once.`),
});
/** Tasks by id. */
export type GetTasksInput = z.infer<typeof GetTasksInput>;

/** Open tasks, or done ones. */
export const TaskStatus = z.enum(['open', 'done']);
/** Open tasks, or done ones. */
export type TaskStatus = z.infer<typeof TaskStatus>;

/** Which tasks a list reads: those linked to one record (milestone 2 adds `{ mine }`). */
export const TaskListScope = z.strictObject({ recordId: z.uuid() });
/** Which tasks a list reads. */
export type TaskListScope = z.infer<typeof TaskListScope>;

/**
 * One page of a task list. Open tasks by due date (earliest first, no date
 * last, then oldest first); done ones newest done first. `cursor` is the last
 * page's `nextCursor`; a cursor the server didn't make is refused 400
 * `INPUT_INVALID` naming `cursor`.
 */
export const ListTasksInput = WorkspaceScoped.extend({
  scope: TaskListScope,
  status: TaskStatus,
  cursor: z.string().min(1).max(MAX_TASK_CURSOR).optional(),
  limit: z
    .number()
    .int()
    .min(1)
    .max(TASK_PAGE_MAX, `Ask for at most ${String(TASK_PAGE_MAX)} tasks.`)
    .optional(),
});
/** One page of a task list. */
export type ListTasksInput = z.infer<typeof ListTasksInput>;

/** How many tasks a list holds, counted up to `TASK_COUNT_CAP` (`atLeast` past it). */
export const TaskTotal = z.object({
  count: z.number().int().min(0),
  atLeast: z.boolean(),
});
/** How many tasks a list holds. */
export type TaskTotal = z.infer<typeof TaskTotal>;

/** A page of tasks, the cursor for the next when there are more, and the list's total on the first page. */
export const TaskPage = z.object({
  items: z.array(TaskView),
  nextCursor: z.string().optional(),
  total: TaskTotal.optional(),
});
/** A page of tasks. */
export type TaskPage = z.infer<typeof TaskPage>;

/**
 * Where a page of tasks ends, inside the opaque cursor (base64url JSON): the
 * last task's sort values and id. Strict: anything else is refused.
 */
export const TaskCursor = z.union([
  z.strictObject({
    status: z.literal('open'),
    dueOn: DateValue.nullable(),
    createdAt: z.string().max(40),
    id: z.uuid(),
  }),
  z.strictObject({ status: z.literal('done'), doneAt: z.string().max(40), id: z.uuid() }),
]);
/** Where a page of tasks ends. */
export type TaskCursor = z.infer<typeof TaskCursor>;

/** The tasks procedures (spec 0019). Every one takes `WorkspaceScoped` input and is served behind the member door. */
export const tasksContract = {
  create: oc.input(CreateTaskInput).output(TaskView),
  update: oc.input(UpdateTaskInput).output(TaskView),
  get: oc.input(GetTasksInput).output(z.array(TaskView)),
  list: oc.input(ListTasksInput).output(TaskPage),
};
