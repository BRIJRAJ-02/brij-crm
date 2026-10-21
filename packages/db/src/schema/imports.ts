// Imports (spec 0040). An import is a row in `imports` with its settings; the
// browser stages its ready rows in `import_rows` (typed values, never the
// file), and the `records.import` job writes each one through the engine,
// storing its outcome, the record and what it replaced beside it, so undo is
// exact. Exports share `exports` and `export_chunks` (`exports.ts`). Both
// tables force row level security with the standard policy (hand written in
// the migration), and every index leads with the workspace.
import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { timestamptz, workspaceId } from './common.ts';
import { objects } from './definitions.ts';
import { members, workspaces } from './workspaces.ts';

/** Where an import is: rows still arriving, its job started, or taken back. */
export const importStatus = pgEnum('import_status', ['staging', 'started', 'undone']);

/** What became of one staged row. */
export const importRowOutcome = pgEnum('import_row_outcome', [
  'pending',
  'created',
  'updated',
  'skipped',
  'refused',
  'undone',
]);

/** One import into one object: its settings, its counts as the browser read the file, and its jobs. */
export const imports = pgTable(
  'imports',
  {
    workspaceId: workspaceId(),
    /** The browser's uuid v7: the idempotent create key, and the trash batch id its undo deletes with. */
    id: uuid('id').notNull(),
    objectId: uuid('object_id').notNull(),
    fileName: text('file_name').notNull(),
    /** The file's data rows, and how many the browser set aside as unreadable. */
    rowCount: integer('row_count').notNull(),
    errorRows: integer('error_rows').notNull().default(0),
    /** `ImportSettings` from `@crm/contracts`: the columns' targets, the match attribute and the two rules. */
    settings: jsonb('settings').notNull(),
    status: importStatus('status').notNull().default('staging'),
    jobId: uuid('job_id'),
    undoJobId: uuid('undo_job_id'),
    /** Set at start: after it, undo is closed and the cleanup deletes the staged rows. */
    undoUntil: timestamptz('undo_until'),
    createdByMemberId: uuid('created_by_member_id').notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'imports_pkey', columns: [t.workspaceId, t.id] }),
    foreignKey({ name: 'imports_workspace', columns: [t.workspaceId], foreignColumns: [workspaces.id] }).onDelete(
      'cascade',
    ),
    foreignKey({
      name: 'imports_object',
      columns: [t.workspaceId, t.objectId],
      foreignColumns: [objects.workspaceId, objects.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'imports_created_by',
      columns: [t.workspaceId, t.createdByMemberId],
      foreignColumns: [members.workspaceId, members.id],
    }).onDelete('cascade'),
    check('imports_counts', sql`${t.rowCount} >= 0 and ${t.errorRows} >= 0 and ${t.errorRows} <= ${t.rowCount}`),
    check('imports_file_name', sql`char_length(${t.fileName}) between 1 and 255`),
    // The unfinished count (the limit) and the cleanup: imports by status and age.
    index('imports_status').on(t.workspaceId, t.status, t.createdAt),
    // The cascades from an object or a member.
    index('imports_by_object').on(t.workspaceId, t.objectId),
    index('imports_by_member').on(t.workspaceId, t.createdByMemberId),
  ],
);

/** One staged row of an import: its typed values, its match keys, and what the job did with it. */
export const importRows = pgTable(
  'import_rows',
  {
    workspaceId: workspaceId(),
    importId: uuid('import_id').notNull(),
    /** The file's line number (the first data row is 2), so a member finds it in their file. */
    rowNumber: integer('row_number').notNull(),
    /** The job item id. */
    id: uuid('id')
      .notNull()
      .default(sql`uuidv7()`),
    /** `{ [attributeId]: value }`, or `{ names: string[] }` for a relationship attribute; checked when written. */
    values: jsonb('values').notNull(),
    /** The row's normalised keys on the import's match attribute (`uniqueKeyOf`). */
    matchKeys: text('match_keys')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    outcome: importRowOutcome('outcome').notNull().default('pending'),
    recordId: uuid('record_id'),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    /** For an updated row: `{ [attributeId]: { value, versionId? } }` as each was before the import. */
    before: jsonb('before'),
    /** `{ [attributeId]: versionId }`: what the import wrote, so undo only puts back what nobody changed since. */
    written: jsonb('written'),
    /** `[{ objectId, recordId }]`: far records this row's relation names made (`createMissing`), trashed by undo. */
    made: jsonb('made'),
  },
  (t) => [
    primaryKey({ name: 'import_rows_pkey', columns: [t.workspaceId, t.importId, t.rowNumber] }),
    foreignKey({
      name: 'import_rows_import',
      columns: [t.workspaceId, t.importId],
      foreignColumns: [imports.workspaceId, imports.id],
    }).onDelete('cascade'),
    uniqueIndex('import_rows_id').on(t.workspaceId, t.id),
    check('import_rows_number', sql`${t.rowNumber} >= 2`),
    // The summary's refused rows, and undo's created and updated rows, in file order.
    index('import_rows_outcome').on(t.workspaceId, t.importId, t.outcome, t.rowNumber),
  ],
);
