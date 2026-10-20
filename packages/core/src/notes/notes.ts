// Notes (spec 0019, milestones 3 and 4): their own table beside the records
// engine, written through `runWrite` with the caller's hooks, so every change
// stores one `notes` outbox row in its own transaction (AC-448), and read in
// `inWorkspace`. Access follows the note's record (AC-447): a note is visible
// only when its record is live and visible to the reader, and adding,
// editing or deleting one needs `write` on the record's object. A save is an
// upsert by the id the browser minted (AC-439, AC-449): the first creates it,
// a repeat of the same save after a lost answer writes nothing, and a save
// that started from an older version is told whose it replaced (AC-443). The
// body is checked against 200 KB here, the one layer that does (AC-441).
import { sql } from 'drizzle-orm';
import {
  NOTE_CONTENT_MAX_BYTES,
  NOTE_COUNT_CAP,
  NOTE_EMPTY,
  NOTE_PAGE,
  NOTE_PAGE_MAX,
  NOTE_TITLE_MAX,
  NOTE_TOO_LONG,
  NoteCursor,
  noteBytes,
  noteExcerpt,
  richTextToPlain,
  type Note,
  type NotePage,
  type NoteSummary,
  type SaveNoteResult,
} from '@crm/contracts';
import { RichTextDocBody, type RichTextDoc } from '@crm/contracts/values';
import type { WorkspaceTx } from '@crm/db';
import { canonicalId, checkId, isUuidV7 } from '../engine/ids.ts';
import { inputInvalid, refuse, refuseOn } from '../engine/refusals.ts';
import type { Actor, EngineScope } from '../engine/scope.ts';
import { runWrite, type AfterWrite } from '../engine/write.ts';
import { checkScope } from '../access/mint.ts';
import { isOpen, objectLevel, type Access } from '../access/policy.ts';
import { inWorkspace } from '../access/run.ts';
import { UNKNOWN_RECORD, visibleRecords } from '../access/visibility.ts';

/** What a note the reader can't see (or one that doesn't exist, or was deleted) answers. */
export const UNKNOWN_NOTE = 'That note does not exist.';
/** What a change by someone who may only read the record's object answers (AC-447). */
export const NOTE_READ_ONLY = 'You can view this note but not change it.';
/** What restoring a note whose record is in the trash answers. */
export const NOTE_RECORD_TRASHED = 'Restore the record first.';
/** What a cursor the server didn't make answers, on the `cursor` field. */
export const NOTE_CURSOR_MESSAGE = 'That note cursor is not valid here. Start again from the top.';
/** The body of a note first saved with a title alone. */
const EMPTY_DOC: RichTextDoc = { type: 'doc', content: [{ type: 'paragraph' }] };

/** A save of a note (`notes.save`): its first, or a later one with only the fields given. */
export interface SaveNoteInput {
  /** A UUID v7 the browser minted when the note window opened: the retry key. */
  readonly id: string;
  readonly recordId: string;
  readonly title?: string;
  /** Parsed here too, so any caller is held to the document's rules; the size is checked apart. */
  readonly content?: unknown;
  /** The version this save started from: null or absent for a new note. */
  readonly baseVersion?: number | null;
}

/** A moment as fixed width UTC text with milliseconds, as the shapes carry it. */
const millis = (column: string) => sql.raw(`to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`);
/** A moment with microseconds, for cursors. */
const micros = (column: string) => sql.raw(`to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`);

/** A note's stored row, as the shapes need it (its text only as far as the excerpt reads). */
interface NoteRow extends Record<string, unknown> {
  readonly id: string;
  readonly record_id: string;
  readonly object_id: string;
  readonly title: string;
  readonly head: string;
  readonly version: number;
  readonly created_at: string;
  readonly created_by_type: Actor['type'];
  readonly created_by_id: string | null;
  readonly updated_at: string;
  readonly updated_by_type: Actor['type'];
  readonly updated_by_id: string | null;
  readonly cursor_at: string;
}

/** The columns of `NoteRow`, over a note aliased `n` joined to its record aliased `r`. */
const NOTE_COLUMNS = sql`n.id::text as id, n.record_id::text as record_id, r.object_id::text as object_id, n.title,
  left(n.content_text, 600) as head, n.version, ${millis('n.created_at')} as created_at, n.created_by_type,
  n.created_by_id::text as created_by_id, ${millis('n.updated_at')} as updated_at, n.updated_by_type,
  n.updated_by_id::text as updated_by_id, ${micros('n.updated_at')} as cursor_at`;

/** A note's record, live on a live object: what every note read joins. */
const LIVE_RECORD = sql`join records r on r.workspace_id = n.workspace_id and r.id = n.record_id
  join objects o on o.workspace_id = r.workspace_id and o.id = r.object_id`;

/** A stored actor as the shapes carry it. */
const actorOf = (type: Actor['type'], id: string | null): Actor => ({ type, id });

/** Whether the principal may add, edit or delete notes on records of this object. */
const canWrite = (access: Access, objectId: string) => objectLevel(access, objectId) === 'write';

/** A note as its list shows it. */
function summaryOf(row: NoteRow, access: Access): NoteSummary {
  return {
    id: row.id,
    recordId: row.record_id,
    title: row.title,
    excerpt: noteExcerpt(row.head),
    version: row.version,
    canChange: canWrite(access, row.object_id),
    createdAt: row.created_at,
    createdBy: actorOf(row.created_by_type, row.created_by_id),
    updatedAt: row.updated_at,
    updatedBy: actorOf(row.updated_by_type, row.updated_by_id),
  };
}

/** Whether the principal may see this live record (its object not at none, inside its record rule). */
async function recordVisible(tx: WorkspaceTx, access: Access, objectId: string, recordId: string): Promise<boolean> {
  if (isOpen(access)) return true;
  if (objectLevel(access, objectId) === 'none') return false;
  return (await visibleRecords(tx, access, [{ objectId, recordId }])).has(recordId);
}

/** A live record's object, or undefined when it is missing, trashed, or on an archived object. */
async function liveRecord(
  tx: WorkspaceTx,
  recordId: string,
  lock: 'key share' | undefined,
): Promise<{ readonly objectId: string; readonly trashed: boolean } | undefined> {
  const rows = await tx.execute<{ object_id: string; trashed: boolean }>(sql`
    select r.object_id::text as object_id, (r.deleted_at is not null or o.archived_at is not null) as trashed
    from records r join objects o on o.workspace_id = r.workspace_id and o.id = r.object_id
    where r.id = ${recordId}::uuid
    ${lock === undefined ? sql`` : sql`for key share of r`}
  `);
  const [row] = rows.rows;
  return row === undefined ? undefined : { objectId: row.object_id, trashed: row.trashed };
}

/** One note as stored, live or deleted, with its record's state, locked when asked. */
async function noteRow(
  tx: WorkspaceTx,
  noteId: string,
  lock = false,
): Promise<(NoteRow & { readonly deleted: boolean; readonly record_live: boolean }) | undefined> {
  const rows = await tx.execute<NoteRow & { deleted: boolean; record_live: boolean }>(sql`
    select ${NOTE_COLUMNS}, n.deleted_at is not null as deleted,
      (r.deleted_at is null and o.archived_at is null) as record_live
    from notes n ${LIVE_RECORD}
    where n.id = ${noteId}::uuid
    ${lock ? sql`for update of n` : sql``}
  `);
  return rows.rows[0];
}

/** A title as stored: at most 200 characters, refused on `title` past that. */
function checkTitle(title: string): string {
  if (title.length > NOTE_TITLE_MAX) {
    throw inputInvalid('title', `A note title holds at most ${String(NOTE_TITLE_MAX)} characters.`);
  }
  return title;
}

/** A body as stored: the document's rules (400 on `content`), then 200 KB (422 `CONFIG_INVALID` on `content`). */
function checkContent(content: unknown): RichTextDoc {
  const parsed = RichTextDocBody.safeParse(content);
  if (!parsed.success) throw inputInvalid('content', 'That isn’t a note body this app can store.');
  if (noteBytes(parsed.data) > NOTE_CONTENT_MAX_BYTES) throw refuseOn('CONFIG_INVALID', NOTE_TOO_LONG, 'content');
  return parsed.data;
}

/**
 * Saves a note (AC-439 to AC-443, AC-449): an upsert by the browser's id.
 * New: its record live, visible and on an object the writer may change, and a
 * title or text that isn't blank (else `CONFIG_INVALID` "Write something
 * first."); version 1. Existing: the same record (else `ID_TAKEN`), live (else
 * `NOT_FOUND`), the given fields written, the version one more, and when
 * `baseVersion` isn't the stored version, `overwrote` names whose save it
 * replaced. Nothing changed writes nothing (a repeated first save after a
 * lost answer included). One `notes` outbox row per change.
 */
export async function saveNote(
  scope: EngineScope,
  input: SaveNoteInput,
  hooks: readonly AfterWrite[] = [],
): Promise<SaveNoteResult> {
  checkScope(scope);
  if (!isUuidV7(input.id)) throw inputInvalid('id', 'The note id must be a UUID v7.');
  const id = canonicalId(input.id);
  const recordId = checkId(input.recordId, UNKNOWN_RECORD);
  const title = input.title === undefined ? undefined : checkTitle(input.title);
  const content = input.content === undefined ? undefined : checkContent(input.content);
  const { result } = await runWrite(
    scope,
    async (context): Promise<SaveNoteResult> => {
      const { tx } = context;
      const actor = scope.actor;
      const memberId = actor.type === 'member' ? actor.id : null;
      const existing = await noteRow(tx, id, true);
      if (existing === undefined) {
        // A new note: its record live, visible and changeable, locked against a purge (never against an edit).
        const record = await liveRecord(tx, recordId, 'key share');
        if (record === undefined || record.trashed) throw refuse('NOT_FOUND', UNKNOWN_RECORD);
        if (!(await recordVisible(tx, scope.access, record.objectId, recordId))) {
          throw refuse('NOT_FOUND', UNKNOWN_RECORD);
        }
        if (!canWrite(scope.access, record.objectId)) throw refuse('FORBIDDEN', NOTE_READ_ONLY);
        const body = content ?? EMPTY_DOC;
        const text = richTextToPlain(body);
        if ((title ?? '').trim() === '' && text.trim() === '') throw refuseOn('CONFIG_INVALID', NOTE_EMPTY, 'content');
        const inserted = await tx.execute(sql`
          insert into notes (workspace_id, id, record_id, title, content, content_text,
            created_by_type, created_by_id, created_by_member_id, updated_by_type, updated_by_id, updated_by_member_id)
          values (${scope.workspaceId}::uuid, ${id}::uuid, ${recordId}::uuid, ${title ?? ''}, ${JSON.stringify(body)}::jsonb,
            ${text}, ${actor.type}, ${actor.id}::uuid, ${memberId}::uuid, ${actor.type}, ${actor.id}::uuid, ${memberId}::uuid)
          on conflict (workspace_id, id) do nothing
        `);
        // Another save of this id committed meanwhile: the browser sends one at a time, so it was someone else's.
        if (inserted.rowCount === 0) throw refuse('ID_TAKEN', 'A note with that id already exists.');
        context.record({ notes: [{ noteId: id, recordId, objectId: record.objectId }] });
        const made = await noteRow(tx, id);
        if (made === undefined) throw new Error('A note just written could not be read back.');
        return { note: summaryOf(made, scope.access) };
      }
      if (existing.record_id !== recordId) throw refuse('ID_TAKEN', 'A note with that id already exists.');
      if (existing.deleted || !existing.record_live) throw refuse('NOT_FOUND', UNKNOWN_NOTE);
      if (!(await recordVisible(tx, scope.access, existing.object_id, recordId))) {
        throw refuse('NOT_FOUND', UNKNOWN_NOTE);
      }
      if (!canWrite(scope.access, existing.object_id)) throw refuse('FORBIDDEN', NOTE_READ_ONLY);
      const changes = await tx.execute<{ title_changed: boolean; content_changed: boolean }>(sql`
        select ${title === undefined ? sql`false` : sql`title <> ${title}`} as title_changed,
          ${content === undefined ? sql`false` : sql`content <> ${JSON.stringify(content)}::jsonb`} as content_changed
        from notes where id = ${id}::uuid
      `);
      const changed = changes.rows[0];
      if (changed === undefined || (!changed.title_changed && !changed.content_changed)) {
        return { note: summaryOf(existing, scope.access) };
      }
      await tx.execute(sql`
        update notes set
          ${changed.title_changed && title !== undefined ? sql`title = ${title},` : sql``}
          ${
            changed.content_changed && content !== undefined
              ? sql`content = ${JSON.stringify(content)}::jsonb, content_text = ${richTextToPlain(content)},`
              : sql``
          }
          version = version + 1, updated_at = now(), updated_by_type = ${actor.type},
          updated_by_id = ${actor.id}::uuid, updated_by_member_id = ${memberId}::uuid
        where id = ${id}::uuid
      `);
      context.record({ notes: [{ noteId: id, recordId, objectId: existing.object_id }] });
      const saved = await noteRow(tx, id);
      if (saved === undefined) throw new Error('A note just written could not be read back.');
      const overwrote =
        input.baseVersion !== undefined && input.baseVersion !== existing.version
          ? { by: actorOf(existing.updated_by_type, existing.updated_by_id), at: existing.updated_at }
          : undefined;
      return { note: summaryOf(saved, scope.access), ...(overwrote === undefined ? {} : { overwrote }) };
    },
    hooks,
  );
  return result;
}

/** A live note the reader may see, with its body (`notes.get`); anything else is `NOT_FOUND`. */
export async function getNote(scope: EngineScope, input: { readonly noteId: string }): Promise<Note> {
  checkScope(scope);
  const noteId = checkId(input.noteId, UNKNOWN_NOTE);
  return inWorkspace(scope, async (tx) => {
    const rows = await tx.execute<NoteRow & { content: RichTextDoc }>(sql`
      select ${NOTE_COLUMNS}, n.content
      from notes n ${LIVE_RECORD}
      where n.id = ${noteId}::uuid and n.deleted_at is null and r.deleted_at is null and o.archived_at is null
    `);
    const [row] = rows.rows;
    if (row === undefined || !(await recordVisible(tx, scope.access, row.object_id, row.record_id))) {
      throw refuse('NOT_FOUND', UNKNOWN_NOTE);
    }
    return { ...summaryOf(row, scope.access), content: row.content };
  });
}

/** Decodes a cursor, refusing anything that isn't one of ours (400 `INPUT_INVALID` on `cursor`). */
function decodeNoteCursor(cursor: string): NoteCursor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw inputInvalid('cursor', NOTE_CURSOR_MESSAGE);
  }
  const bound = NoteCursor.safeParse(parsed);
  if (!bound.success) throw inputInvalid('cursor', NOTE_CURSOR_MESSAGE);
  const moment = bound.data.updatedAt;
  // A moment the server wrote: fixed width UTC with microseconds that round trips, so a forged one never reaches a cast.
  const stamp = Date.parse(moment);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(moment) ||
    moment.startsWith('0000') ||
    Number.isNaN(stamp) ||
    new Date(stamp).toISOString().slice(0, 19) !== moment.slice(0, 19)
  ) {
    throw inputInvalid('cursor', NOTE_CURSOR_MESSAGE);
  }
  return bound.data;
}

/**
 * One page of a record's notes (AC-442): last edited first (then id), through
 * `notes_by_record`; `total` (counted up to 10,001) on the first page only. A
 * hidden or trashed record is `NOT_FOUND`, so its notes are absent; a cursor
 * the server didn't make is 400 `INPUT_INVALID` on `cursor`.
 */
export async function listNotes(
  scope: EngineScope,
  input: { readonly recordId: string; readonly cursor?: string; readonly limit?: number },
): Promise<NotePage> {
  checkScope(scope);
  const limit = input.limit ?? NOTE_PAGE;
  if (!Number.isInteger(limit) || limit < 1 || limit > NOTE_PAGE_MAX) {
    throw inputInvalid('limit', `Ask for 1 to ${String(NOTE_PAGE_MAX)} notes.`);
  }
  const after = input.cursor === undefined ? undefined : decodeNoteCursor(input.cursor);
  const recordId = checkId(input.recordId, UNKNOWN_RECORD);
  return inWorkspace(scope, async (tx) => {
    const record = await liveRecord(tx, recordId, undefined);
    if (record === undefined || record.trashed || !(await recordVisible(tx, scope.access, record.objectId, recordId))) {
      throw refuse('NOT_FOUND', UNKNOWN_RECORD);
    }
    const from = sql`from notes n ${LIVE_RECORD} where n.record_id = ${recordId}::uuid and n.deleted_at is null`;
    const bound =
      after === undefined
        ? sql``
        : sql` and (n.updated_at < ${after.updatedAt}::timestamptz or (n.updated_at = ${after.updatedAt}::timestamptz and n.id > ${after.id}::uuid))`;
    const page = await tx.execute<NoteRow>(sql`
      select ${NOTE_COLUMNS} ${from}${bound}
      order by n.updated_at desc, n.id
      limit ${limit + 1}
    `);
    const rows = page.rows.slice(0, limit);
    const last = rows.at(-1);
    const nextCursor =
      page.rows.length > limit && last !== undefined
        ? Buffer.from(JSON.stringify({ updatedAt: last.cursor_at, id: last.id } satisfies NoteCursor)).toString(
            'base64url',
          )
        : undefined;
    const items = rows.map((row) => summaryOf(row, scope.access));
    if (after !== undefined) return { items, ...(nextCursor === undefined ? {} : { nextCursor }) };
    const counted = await tx.execute<{ n: number }>(
      sql`select count(*)::int as n from (select 1 from notes n where n.record_id = ${recordId}::uuid and n.deleted_at is null limit ${NOTE_COUNT_CAP + 1}) c`,
    );
    const n = counted.rows[0]?.n ?? 0;
    return {
      items,
      ...(nextCursor === undefined ? {} : { nextCursor }),
      total: { count: Math.min(n, NOTE_COUNT_CAP), atLeast: n > NOTE_COUNT_CAP },
    };
  });
}

/**
 * Deletes a note (AC-445): hidden from every read at once, kept for 30 days
 * for Undo and restore, then removed by the daily cleanup. Needs `write` on
 * its record's object. One `notes` outbox row.
 */
export async function deleteNote(
  scope: EngineScope,
  input: { readonly noteId: string },
  hooks: readonly AfterWrite[] = [],
): Promise<void> {
  checkScope(scope);
  const noteId = checkId(input.noteId, UNKNOWN_NOTE);
  await runWrite(
    scope,
    async (context) => {
      const { tx } = context;
      const row = await noteRow(tx, noteId, true);
      if (row === undefined || row.deleted || !row.record_live) throw refuse('NOT_FOUND', UNKNOWN_NOTE);
      if (!(await recordVisible(tx, scope.access, row.object_id, row.record_id))) {
        throw refuse('NOT_FOUND', UNKNOWN_NOTE);
      }
      if (!canWrite(scope.access, row.object_id)) throw refuse('FORBIDDEN', NOTE_READ_ONLY);
      const { actor } = scope;
      const memberId = actor.type === 'member' ? actor.id : null;
      await tx.execute(sql`
        update notes set deleted_at = now(), deleted_by_type = ${actor.type}, deleted_by_id = ${actor.id}::uuid,
          deleted_by_member_id = ${memberId}::uuid
        where id = ${noteId}::uuid
      `);
      context.record({ notes: [{ noteId, recordId: row.record_id, objectId: row.object_id }] });
    },
    hooks,
  );
}

/**
 * Brings a deleted note back exactly as it was (AC-445): `NOT_FOUND` once the
 * cleanup removed it, `RECORD_DELETED` "Restore the record first." while its
 * record is in the trash. Needs `write` on the record's object. A note that
 * isn't deleted comes back as it is, with nothing written.
 */
export async function restoreNote(
  scope: EngineScope,
  input: { readonly noteId: string },
  hooks: readonly AfterWrite[] = [],
): Promise<NoteSummary> {
  checkScope(scope);
  const noteId = checkId(input.noteId, UNKNOWN_NOTE);
  const { result } = await runWrite(
    scope,
    async (context) => {
      const { tx } = context;
      const row = await noteRow(tx, noteId, true);
      if (row === undefined) throw refuse('NOT_FOUND', UNKNOWN_NOTE);
      if (!(await recordVisible(tx, scope.access, row.object_id, row.record_id))) {
        throw refuse('NOT_FOUND', UNKNOWN_NOTE);
      }
      if (!row.record_live) throw refuse('RECORD_DELETED', NOTE_RECORD_TRASHED);
      if (!canWrite(scope.access, row.object_id)) throw refuse('FORBIDDEN', NOTE_READ_ONLY);
      if (!row.deleted) return summaryOf(row, scope.access);
      await tx.execute(sql`
        update notes set deleted_at = null, deleted_by_type = null, deleted_by_id = null, deleted_by_member_id = null
        where id = ${noteId}::uuid
      `);
      context.record({ notes: [{ noteId, recordId: row.record_id, objectId: row.object_id }] });
      return summaryOf(row, scope.access);
    },
    hooks,
  );
  return result;
}
