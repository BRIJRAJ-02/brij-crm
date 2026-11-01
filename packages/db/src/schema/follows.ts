// Following a record, and sample data (migration 0158). A follow is one row per member per record:
// made when they create the record, are put in one of its member fields or are given one of its tasks, and taken
// away when they unfollow. A sample row names one record or task that "Add sample data" made, so "Remove sample
// data" takes exactly those, and its Undo brings exactly those back. Both are tenant tables under forced row level
// security (the policies are in the migration). A record's follows go with it (a cascade), its sample row before it
// in the purge (spec 0022).
import { sql } from 'drizzle-orm';
import { check, foreignKey, index, pgTable, primaryKey, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { timestamptz, workspaceId } from './common.ts';
import { records } from './records.ts';
import { tasks } from './tasks.ts';
import { members, workspaces } from './workspaces.ts';

/** Who follows which record: changes others make to it reach their inbox. */
export const recordFollows = pgTable(
  'record_follows',
  {
    workspaceId: workspaceId(),
    recordId: uuid('record_id').notNull(),
    memberId: uuid('member_id').notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'record_follows_pkey', columns: [t.workspaceId, t.recordId, t.memberId] }),
    foreignKey({
      name: 'record_follows_workspace',
      columns: [t.workspaceId],
      foreignColumns: [workspaces.id],
    }).onDelete('cascade'),
    // Cascades, unlike the purge registry's dependents: every member's create makes one, and it holds nothing.
    foreignKey({
      name: 'record_follows_record',
      columns: [t.workspaceId, t.recordId],
      foreignColumns: [records.workspaceId, records.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'record_follows_member',
      columns: [t.workspaceId, t.memberId],
      foreignColumns: [members.workspaceId, members.id],
    }).onDelete('cascade'),
    index('record_follows_by_member').on(t.workspaceId, t.memberId),
  ],
);

/** A record or task "Add sample data" made. */
export const sampleData = pgTable(
  'sample_data',
  {
    workspaceId: workspaceId(),
    id: uuid('id')
      .notNull()
      .default(sql`uuidv7()`),
    recordId: uuid('record_id'),
    taskId: uuid('task_id'),
    /** The "Remove sample data" that took it: the records' own `deleted_batch_id`, so its Undo restores exactly these. */
    removedBatchId: uuid('removed_batch_id'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'sample_data_pkey', columns: [t.workspaceId, t.id] }),
    foreignKey({ name: 'sample_data_workspace', columns: [t.workspaceId], foreignColumns: [workspaces.id] }).onDelete(
      'cascade',
    ),
    // No `on delete` action: the purge deletes a record's sample row before the record.
    foreignKey({
      name: 'sample_data_record',
      columns: [t.workspaceId, t.recordId],
      foreignColumns: [records.workspaceId, records.id],
    }),
    foreignKey({
      name: 'sample_data_task',
      columns: [t.workspaceId, t.taskId],
      foreignColumns: [tasks.workspaceId, tasks.id],
    }).onDelete('cascade'),
    check('sample_data_subject', sql`num_nonnulls(${t.recordId}, ${t.taskId}) = 1`),
    uniqueIndex('sample_data_one_per_record')
      .on(t.workspaceId, t.recordId)
      .where(sql`${t.recordId} is not null`),
    uniqueIndex('sample_data_one_per_task')
      .on(t.workspaceId, t.taskId)
      .where(sql`${t.taskId} is not null`),
  ],
);
