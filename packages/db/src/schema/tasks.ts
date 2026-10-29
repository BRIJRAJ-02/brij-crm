// Tasks (spec 0019, milestone 1): their own tables beside the records engine,
// not records. A task has a title, a due date, a done state, one assignee and
// 0 to 20 linked records (`task_records`). A link's foreign key to its record
// has no `on delete` action, so a record removed for good while a task still
// links it fails, unless the purge registry (spec 0022) deleted the links
// first, in the same transaction. A task removed by the daily cleanup takes
// its links (`on delete cascade`). Every list reads a partial index made for
// it: open and done, by assignee, by creator and over the workspace.
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  pgTable,
  primaryKey,
  smallint,
  text,
  uuid,
} from 'drizzle-orm/pg-core';
import { actorColumns, auditColumns, timestamptz, workspaceId } from './common.ts';
import { records } from './records.ts';
import { actorConstraints, members } from './workspaces.ts';

const doneBy = actorColumns('done_by');
const deletedBy = actorColumns('deleted_by');

/** One task. A deleted task stays here, hidden, for 30 days (milestone 4's cleanup removes it). */
export const tasks = pgTable(
  'tasks',
  {
    workspaceId: workspaceId(),
    /** A UUID v7 the browser mints when the dialog or quick add opens. */
    id: uuid('id').notNull(),
    /** 1 to 2,000 characters, trimmed at its ends by the service. */
    title: text('title').notNull(),
    isDone: boolean('is_done').notNull().default(false),
    doneAt: timestamptz('done_at'),
    doneByType: doneBy.type,
    doneById: doneBy.id,
    doneByMemberId: doneBy.memberId,
    dueOn: date('due_on'),
    /** At most one assignee; a removed member keeps their tasks (owner decision). */
    assigneeMemberId: uuid('assignee_member_id'),
    /**
     * A link of the task's went with its record, removed for good (migration 0125): with none left it stays its
     * creator's and assignee's, never everyone's as a task made with no links is (late trap #79).
     */
    linksPurged: boolean('links_purged').notNull().default(false),
    ...auditColumns(),
    deletedAt: timestamptz('deleted_at'),
    deletedByType: deletedBy.type,
    deletedById: deletedBy.id,
    deletedByMemberId: deletedBy.memberId,
  },
  (t) => [
    primaryKey({ name: 'tasks_pkey', columns: [t.workspaceId, t.id] }),
    foreignKey({
      name: 'tasks_assignee',
      columns: [t.workspaceId, t.assigneeMemberId],
      foreignColumns: [members.workspaceId, members.id],
    }),
    check('tasks_title', sql`char_length(${t.title}) between 1 and 2000`),
    check('tasks_done', sql`${t.isDone} = (${t.doneAt} is not null)`),
    check('tasks_done_actor', sql`(${t.doneAt} is null) = (${t.doneByType} is null)`),
    check('tasks_deleted', sql`(${t.deletedAt} is null) = (${t.deletedByType} is null)`),
    // My tasks (milestone 2) and every open or done list, each on its own partial index.
    index('tasks_assigned_open')
      .on(t.workspaceId, t.assigneeMemberId, t.dueOn.asc().nullsLast(), t.createdAt, t.id)
      .where(sql`${t.deletedAt} is null and not ${t.isDone}`),
    index('tasks_created_open')
      .on(t.workspaceId, t.createdByMemberId, t.dueOn.asc().nullsLast(), t.createdAt, t.id)
      .where(sql`${t.deletedAt} is null and not ${t.isDone}`),
    index('tasks_all_open')
      .on(t.workspaceId, t.dueOn.asc().nullsLast(), t.createdAt, t.id)
      .where(sql`${t.deletedAt} is null and not ${t.isDone}`),
    index('tasks_assigned_done')
      .on(t.workspaceId, t.assigneeMemberId, t.doneAt.desc(), t.id)
      .where(sql`${t.deletedAt} is null and ${t.isDone}`),
    index('tasks_created_done')
      .on(t.workspaceId, t.createdByMemberId, t.doneAt.desc(), t.id)
      .where(sql`${t.deletedAt} is null and ${t.isDone}`),
    index('tasks_all_done')
      .on(t.workspaceId, t.doneAt.desc(), t.id)
      .where(sql`${t.deletedAt} is null and ${t.isDone}`),
    index('tasks_trashed')
      .on(t.workspaceId, t.deletedAt)
      .where(sql`${t.deletedAt} is not null`),
    ...actorConstraints('tasks', 'created_by', t.workspaceId, {
      type: t.createdByType,
      id: t.createdById,
      memberId: t.createdByMemberId,
    }),
    ...actorConstraints('tasks', 'updated_by', t.workspaceId, {
      type: t.updatedByType,
      id: t.updatedById,
      memberId: t.updatedByMemberId,
    }),
    ...actorConstraints('tasks', 'done_by', t.workspaceId, {
      type: t.doneByType,
      id: t.doneById,
      memberId: t.doneByMemberId,
    }),
    ...actorConstraints('tasks', 'deleted_by', t.workspaceId, {
      type: t.deletedByType,
      id: t.deletedById,
      memberId: t.deletedByMemberId,
    }),
  ],
);

const linkedBy = actorColumns('created_by');

/** One record a task links, in the task's order. At most 20 per task, checked by the service under the task's lock. */
export const taskRecords = pgTable(
  'task_records',
  {
    workspaceId: workspaceId(),
    taskId: uuid('task_id').notNull(),
    recordId: uuid('record_id').notNull(),
    position: smallint('position').notNull(),
    /** When the link was made: the record's timeline shows "added a task" at this moment. */
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    createdByType: linkedBy.type.notNull(),
    createdById: linkedBy.id,
    createdByMemberId: linkedBy.memberId,
  },
  (t) => [
    primaryKey({ name: 'task_records_pkey', columns: [t.workspaceId, t.taskId, t.recordId] }),
    foreignKey({
      name: 'task_records_task',
      columns: [t.workspaceId, t.taskId],
      foreignColumns: [tasks.workspaceId, tasks.id],
    }).onDelete('cascade'),
    // No `on delete` action: a record removed for good with a link left fails (spec 0022's purge registry deletes them).
    foreignKey({
      name: 'task_records_record',
      columns: [t.workspaceId, t.recordId],
      foreignColumns: [records.workspaceId, records.id],
    }),
    // A record's Tasks tab and timeline, the registry's delete and the foreign key's check.
    index('task_records_by_record').on(t.workspaceId, t.recordId, t.createdAt.desc(), t.taskId),
    check('task_records_position', sql`${t.position} >= 0`),
    ...actorConstraints('task_records', 'created_by', t.workspaceId, {
      type: t.createdByType,
      id: t.createdById,
      memberId: t.createdByMemberId,
    }),
  ],
);
