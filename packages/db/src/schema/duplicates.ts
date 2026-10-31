// Likely duplicates (spec 0049): the pairs someone marked "Not a duplicate",
// once per pair for the whole workspace, its two record ids ordered so the
// lower is always `low_record_id` (AC-4903, AC-4908). Pairs themselves are
// never stored: they are found at read time from `values_match`.
import { sql } from 'drizzle-orm';
import { check, foreignKey, index, pgTable, primaryKey, uuid } from 'drizzle-orm/pg-core';
import { timestamptz, workspaceId } from './common.ts';
import { objects } from './definitions.ts';
import { records } from './records.ts';
import { members } from './workspaces.ts';

/** One dismissed pair: two records of one object that are not the same, as a member said. */
export const recordDuplicateDismissals = pgTable(
  'record_duplicate_dismissals',
  {
    workspaceId: workspaceId(),
    objectId: uuid('object_id').notNull(),
    lowRecordId: uuid('low_record_id').notNull(),
    highRecordId: uuid('high_record_id').notNull(),
    createdByMemberId: uuid('created_by_member_id').notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'record_duplicate_dismissals_pkey', columns: [t.workspaceId, t.lowRecordId, t.highRecordId] }),
    foreignKey({
      name: 'record_duplicate_dismissals_object',
      columns: [t.workspaceId, t.objectId],
      foreignColumns: [objects.workspaceId, objects.id],
    }),
    foreignKey({
      name: 'record_duplicate_dismissals_low',
      columns: [t.workspaceId, t.lowRecordId],
      foreignColumns: [records.workspaceId, records.id],
    }),
    foreignKey({
      name: 'record_duplicate_dismissals_high',
      columns: [t.workspaceId, t.highRecordId],
      foreignColumns: [records.workspaceId, records.id],
    }),
    foreignKey({
      name: 'record_duplicate_dismissals_created_by',
      columns: [t.workspaceId, t.createdByMemberId],
      foreignColumns: [members.workspaceId, members.id],
    }),
    // The purge's and a record's lookups from the high side; the primary key serves the low side.
    index('record_duplicate_dismissals_high').on(t.workspaceId, t.highRecordId, t.lowRecordId),
    check('record_duplicate_dismissals_order', sql`${t.lowRecordId} < ${t.highRecordId}`),
  ],
);
