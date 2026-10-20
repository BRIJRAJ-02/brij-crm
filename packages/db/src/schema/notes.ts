// Notes (spec 0019, milestone 3): their own table beside the records engine,
// not records. A note belongs to one record for life, holds the rich text
// editor's document (`content`, Tiptap JSON, never HTML), its plain text copy
// (`content_text`, derived on the server, for the list's excerpt and later
// search) and a title. `version` counts its saves, so a save that started
// from an older version is told whose it replaced (last write wins). Its
// foreign key to the record has no `on delete` action, so a record removed
// for good while it still has a note fails, unless the purge step deleted the
// notes first, in the same transaction.
import { sql } from 'drizzle-orm';
import { check, foreignKey, index, integer, jsonb, pgTable, primaryKey, text, uuid } from 'drizzle-orm/pg-core';
import { actorColumns, auditColumns, timestamptz, workspaceId } from './common.ts';
import { records } from './records.ts';
import { actorConstraints } from './workspaces.ts';

const deletedBy = actorColumns('deleted_by');

/** One note on one record. A deleted note stays here, hidden, for 30 days (the daily cleanup removes it). */
export const notes = pgTable(
  'notes',
  {
    workspaceId: workspaceId(),
    /** A UUID v7 the browser mints when the note window opens on a new note. */
    id: uuid('id').notNull(),
    recordId: uuid('record_id').notNull(),
    /** Up to 200 characters; empty shows as "Untitled note". */
    title: text('title').notNull().default(''),
    /** A `RichTextDoc`, at most 200 KB as UTF-8 JSON (checked by the service). */
    content: jsonb('content').notNull(),
    /** `richTextToPlain(content)`, written by the server, never the client. */
    contentText: text('content_text').notNull().default(''),
    /** 1 on the first save, one more on each save after. */
    version: integer('version').notNull().default(1),
    ...auditColumns(),
    deletedAt: timestamptz('deleted_at'),
    deletedByType: deletedBy.type,
    deletedById: deletedBy.id,
    deletedByMemberId: deletedBy.memberId,
  },
  (t) => [
    primaryKey({ name: 'notes_pkey', columns: [t.workspaceId, t.id] }),
    // No `on delete` action: a record removed for good with a note left fails (the purge step deletes them first).
    foreignKey({
      name: 'notes_record',
      columns: [t.workspaceId, t.recordId],
      foreignColumns: [records.workspaceId, records.id],
    }),
    check('notes_title', sql`char_length(${t.title}) <= 200`),
    check('notes_content_text', sql`char_length(${t.contentText}) <= 100000`),
    check('notes_version', sql`${t.version} >= 1`),
    check('notes_deleted', sql`(${t.deletedAt} is null) = (${t.deletedByType} is null)`),
    // A record's Notes tab (last edited first), and the purge step's delete and the foreign key's check.
    index('notes_by_record').on(t.workspaceId, t.recordId, t.updatedAt.desc(), t.id),
    // The timeline's "added a note", by when each was made.
    index('notes_by_record_created').on(t.workspaceId, t.recordId, t.createdAt.desc(), t.id),
    index('notes_trashed')
      .on(t.workspaceId, t.deletedAt)
      .where(sql`${t.deletedAt} is not null`),
    ...actorConstraints('notes', 'created_by', t.workspaceId, {
      type: t.createdByType,
      id: t.createdById,
      memberId: t.createdByMemberId,
    }),
    ...actorConstraints('notes', 'updated_by', t.workspaceId, {
      type: t.updatedByType,
      id: t.updatedById,
      memberId: t.updatedByMemberId,
    }),
    ...actorConstraints('notes', 'deleted_by', t.workspaceId, {
      type: t.deletedByType,
      id: t.deletedById,
      memberId: t.deletedByMemberId,
    }),
  ],
);
