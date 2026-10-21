// Export files (spec 0037's shape, used first by spec 0023's submissions
// export): one row per export a member started, and its CSV text in chunks
// beside it, kept until `expires_at` (7 days) and deleted by the daily
// cleanup. Files live in Postgres until R2 (#32) arrives. Only the member who
// started an export reads it.
import { sql } from 'drizzle-orm';
import { check, foreignKey, index, integer, jsonb, pgTable, primaryKey, text, uuid } from 'drizzle-orm/pg-core';
import { id, timestamptz, workspaceId } from './common.ts';
import { forms } from './forms.ts';
import { members } from './workspaces.ts';

/**
 * One export: what it holds (`source`, the form, the selection), its job, its
 * file's name, its rows and bytes once written, who started it, and when the
 * file goes.
 */
export const exports = pgTable(
  'exports',
  {
    workspaceId: workspaceId(),
    id: id(),
    source: text('source').notNull(),
    formId: uuid('form_id'),
    selection: jsonb('selection').notNull(),
    fileName: text('file_name').notNull(),
    jobId: uuid('job_id').notNull(),
    rowCount: integer('row_count'),
    byteCount: integer('byte_count'),
    createdByMemberId: uuid('created_by_member_id').notNull(),
    /**
     * The starter's access when it started (core's `exportAccessKey`: their data policy, whether they manage
     * forms, their teams): a download or a batch under any other finds nothing.
     */
    policyKey: text('policy_key').notNull(),
    expiresAt: timestamptz('expires_at').notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'exports_pkey', columns: [t.workspaceId, t.id] }),
    foreignKey({
      name: 'exports_form',
      columns: [t.workspaceId, t.formId],
      foreignColumns: [forms.workspaceId, forms.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'exports_member',
      columns: [t.workspaceId, t.createdByMemberId],
      foreignColumns: [members.workspaceId, members.id],
    }).onDelete('cascade'),
    // The daily cleanup's expired files.
    index('exports_by_expiry').on(t.workspaceId, t.expiresAt),
    // A member's live exports (the cap), and the cascades from a form or a member.
    index('exports_by_member').on(t.workspaceId, t.createdByMemberId, t.expiresAt),
    index('exports_by_form').on(t.workspaceId, t.formId),
    check('exports_source', sql`${t.source} in ('form_submissions')`),
    check('exports_form_source', sql`(${t.source} = 'form_submissions') = (${t.formId} is not null)`),
  ],
);

/** One chunk of an export's CSV text, in order (`part` from 0), at most about 1 MB each. */
export const exportChunks = pgTable(
  'export_chunks',
  {
    workspaceId: workspaceId(),
    exportId: uuid('export_id').notNull(),
    part: integer('part').notNull(),
    body: text('body').notNull(),
  },
  (t) => [
    primaryKey({ name: 'export_chunks_pkey', columns: [t.workspaceId, t.exportId, t.part] }),
    foreignKey({
      name: 'export_chunks_export',
      columns: [t.workspaceId, t.exportId],
      foreignColumns: [exports.workspaceId, exports.id],
    }).onDelete('cascade'),
    check('export_chunks_part', sql`${t.part} >= 0`),
  ],
);
