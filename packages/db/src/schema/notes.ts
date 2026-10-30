// Notes (spec 0019, milestone 3): their own table beside the records engine,
// not records. A call or a meeting logged on a record is a note with a `kind`
// and an `occurred_at` (migration 0141), with its duration and outcome. A note
// belongs to one record for life (which decides who may see and change it)
// and links up to 19 more (`note_records`, migration 0136,
// its own record first at position 0), holds the rich text
// editor's document (`content`, Tiptap JSON, never HTML), its plain text copy
// (`content_text`, derived on the server, for the list's excerpt and later
// search) and a title. `version` counts its saves, so a save that started
// from an older version is told whose it replaced (last write wins). Its
// foreign key to the record has no `on delete` action, so a record removed
// for good while it still has a note fails, unless the purge step deleted the
// notes first, in the same transaction.
import type { NoteKind, NoteOutcome } from '@crm/contracts/note-limits';
import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  uuid,
} from 'drizzle-orm/pg-core';
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
    /** `note`, or a `call` or `meeting` logged on the record (migration 0141), for life. */
    kind: text('kind').$type<NoteKind>().notNull().default('note'),
    /** When it happened: a plain note's is its creation; a call's or meeting's may be earlier (never a day ahead). */
    occurredAt: timestamptz('occurred_at').notNull().defaultNow(),
    /** A call's or meeting's length in minutes, 1 to 1,440; never on a plain note. */
    durationMinutes: smallint('duration_minutes'),
    /** How it went, from the kind's own set; never on a plain note. */
    outcome: text('outcome').$type<NoteOutcome>(),
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
    check('notes_kind', sql`${t.kind} in ('note', 'call', 'meeting')`),
    check(
      'notes_duration',
      sql`${t.durationMinutes} is null or (${t.kind} <> 'note' and ${t.durationMinutes} between 1 and 1440)`,
    ),
    check(
      'notes_outcome',
      sql`${t.outcome} is null
        or (${t.kind} = 'call' and ${t.outcome} in ('connected', 'no_answer', 'left_message'))
        or (${t.kind} = 'meeting' and ${t.outcome} in ('held', 'cancelled', 'no_show'))`,
    ),
    // A record's Notes tab (last edited first), and the purge step's delete and the foreign key's check.
    index('notes_by_record').on(t.workspaceId, t.recordId, t.updatedAt.desc(), t.id),
    // The timeline's "added a note", "logged a call", by when each happened (migration 0141; a plain note's moment is
    // its creation).
    index('notes_by_record_occurred').on(t.workspaceId, t.recordId, t.occurredAt.desc(), t.id),
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

const linkedBy = actorColumns('created_by');

/**
 * One record a note links, in the note's order (migration 0136): its own record at position 0, then up to 19 more,
 * at most 20 checked by the service under the note's lock. The note's own record still decides who may see it.
 */
export const noteRecords = pgTable(
  'note_records',
  {
    workspaceId: workspaceId(),
    noteId: uuid('note_id').notNull(),
    recordId: uuid('record_id').notNull(),
    position: smallint('position').notNull(),
    /** When the link was made: the record's timeline shows the note at this moment. */
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    createdByType: linkedBy.type.notNull(),
    createdById: linkedBy.id,
    createdByMemberId: linkedBy.memberId,
  },
  (t) => [
    primaryKey({ name: 'note_records_pkey', columns: [t.workspaceId, t.noteId, t.recordId] }),
    foreignKey({
      name: 'note_records_note',
      columns: [t.workspaceId, t.noteId],
      foreignColumns: [notes.workspaceId, notes.id],
    }).onDelete('cascade'),
    // No `on delete` action: a record removed for good with a link left fails (the purge registry deletes them).
    foreignKey({
      name: 'note_records_record',
      columns: [t.workspaceId, t.recordId],
      foreignColumns: [records.workspaceId, records.id],
    }),
    // A record's Notes tab and timeline, the registry's delete and the foreign key's check.
    index('note_records_by_record').on(t.workspaceId, t.recordId, t.createdAt.desc(), t.noteId),
    check('note_records_position', sql`${t.position} >= 0`),
    ...actorConstraints('note_records', 'created_by', t.workspaceId, {
      type: t.createdByType,
      id: t.createdById,
      memberId: t.createdByMemberId,
    }),
  ],
);
