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
// A note links up to 20 records (migration 0135, `note_records`, its own
// record first): it shows on each one's Notes tab and timeline, but its own
// record alone still decides who may see and change it, and a link needs
// `write` on the linked record's object, as a task's does.
import { sql, type SQL } from 'drizzle-orm';
import {
  NOTE_CONTENT_MAX_BYTES,
  NOTE_COUNT_CAP,
  NOTE_EMPTY,
  NOTE_PAGE,
  NOTE_PAGE_MAX,
  NOTE_RECORDS_MAX,
  NOTE_TITLE_MAX,
  NOTE_TOO_LONG,
  NoteCursor,
  noteBytes,
  noteExcerpt,
  richTextToPlain,
  type Note,
  type NotePage,
  type NoteSummary,
  type NoteHit,
  type NoteLinks,
  type SaveNoteResult,
} from '@crm/contracts';
import { RichTextDocBody, type RecordRefDisplay, type RichTextDoc } from '@crm/contracts/values';
import type { WorkspaceTx } from '@crm/db';
import { canonicalId, checkId, isUuid, isUuidV7, uuidArray, uuidList } from '../engine/ids.ts';
import { readRecords } from '../engine/records.ts';
import { inputInvalid, refuse, refuseOn } from '../engine/refusals.ts';
import type { Actor, EngineScope } from '../engine/scope.ts';
import { runWrite, type AfterWrite, type NoteChange } from '../engine/write.ts';
import { notifyNoteMentions } from '../notifications/notify.ts';
import { checkLinkable, linkedDisplays } from '../tasks/tasks.ts';
import { checkScope } from '../access/mint.ts';
import { isOpen, objectLevel, type Access } from '../access/policy.ts';
import { inWorkspace } from '../access/run.ts';
import { farVisibleSql, recordVisibleSql, UNKNOWN_RECORD, visibleRecords } from '../access/visibility.ts';

/** What a note the reader can't see (or one that doesn't exist, or was deleted) answers. */
export const UNKNOWN_NOTE = 'That note does not exist.';
/** What a change by someone who may only read the record's object answers (AC-447). */
export const NOTE_READ_ONLY = 'You can view this note but not change it.';
/** What restoring a note whose record is in the trash answers. */
export const NOTE_RECORD_TRASHED = 'Restore the record first.';
/** What a cursor the server didn't make answers, on the `cursor` field. */
export const NOTE_CURSOR_MESSAGE = 'That note cursor is not valid here. Start again from the top.';
/** What linking a record the writer may not change answers. */
export const NOTE_LINK_FORBIDDEN = "You can't link a note to a record you can't change.";
/** What a 21st link answers. */
export const NOTE_LINKS_FULL = `A note links at most ${String(NOTE_RECORDS_MAX)} records.`;
/** The body of a note first saved with a title alone. */
const EMPTY_DOC: RichTextDoc = { type: 'doc', content: [{ type: 'paragraph' }] };

/** The members a note's body mentions (its `mention` nodes' ids), each once, in the order they appear. */
export function mentionedIn(doc: unknown): readonly string[] {
  const found = new Set<string>();
  const walk = (node: unknown) => {
    if (typeof node !== 'object' || node === null) return;
    const { type, attrs, content } = node as { type?: unknown; attrs?: { id?: unknown }; content?: unknown };
    if (type === 'mention' && isUuid(attrs?.id)) found.add(canonicalId(attrs.id));
    if (Array.isArray(content)) for (const child of content) walk(child);
  };
  walk(doc);
  return [...found];
}

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

/** One record a note links, with its object (for the outbox row that names it). */
interface NoteLink {
  readonly recordId: string;
  readonly objectId: string;
}

/**
 * The records a note links, its own record first, then the others in link
 * order, whatever their state or visibility (migration 0135). Its own record
 * comes from the note, so a note saved without its first link row still has it.
 */
async function noteLinks(tx: WorkspaceTx, noteId: string, home: NoteLink): Promise<readonly NoteLink[]> {
  const rows = await tx.execute<{ record_id: string; object_id: string }>(sql`
    select l.record_id::text as record_id, r.object_id::text as object_id
    from note_records l join records r on r.workspace_id = l.workspace_id and r.id = l.record_id
    where l.note_id = ${noteId}::uuid and l.record_id <> ${home.recordId}::uuid
    order by l.position, l.record_id
  `);
  return [home, ...rows.rows.map((row) => ({ recordId: row.record_id, objectId: row.object_id }))];
}

/**
 * The outbox's word on a note: one change per record it links, so every one of their screens reads it again; only
 * its own record's names the note.
 */
const changesOf = (noteId: string, links: readonly NoteLink[]): NoteChange[] =>
  links.map((link, at) => ({
    noteId,
    recordId: link.recordId,
    objectId: link.objectId,
    ...(at === 0 ? {} : { linked: true }),
  }));

/** The note's own record as its first link, for a note saved before its links existed (the deploy of 0135). */
async function ensureOwnLink(tx: WorkspaceTx, noteId: string): Promise<void> {
  await tx.execute(sql`
    insert into note_records (workspace_id, note_id, record_id, position, created_at, created_by_type,
      created_by_id, created_by_member_id)
    select n.workspace_id, n.id, n.record_id, 0, n.created_at, n.created_by_type, n.created_by_id,
      n.created_by_member_id
    from notes n where n.id = ${noteId}::uuid
    on conflict do nothing
  `);
}

/** A title as stored: at most 200 characters, refused on `title` past that. */
function checkTitle(title: string): string {
  // NUL can't be stored: refused as input (400), never a database error (500).
  if (title.includes('\u0000')) throw inputInvalid('title', 'This text holds a character that can’t be stored.');
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
      /** A later save of a stored note (or a first save another try of the same note stored first). */
      const saveExisting = async (
        stored: NonNullable<Awaited<ReturnType<typeof noteRow>>>,
      ): Promise<SaveNoteResult> => {
        const home: NoteLink = { recordId: stored.record_id, objectId: stored.object_id };
        // Seen first, so a note the writer can't see never says which records it links.
        if (stored.deleted || !stored.record_live) throw refuse('NOT_FOUND', UNKNOWN_NOTE);
        if (!(await recordVisible(tx, scope.access, stored.object_id, home.recordId))) {
          throw refuse('NOT_FOUND', UNKNOWN_NOTE);
        }
        // Saved from its own record's page, or from the page of a record it links (migration 0135).
        if (stored.record_id !== recordId) {
          const linked = await tx.execute(
            sql`select 1 from note_records where note_id = ${id}::uuid and record_id = ${recordId}::uuid`,
          );
          if (linked.rows.length === 0) throw refuse('ID_TAKEN', 'A note with that id already exists.');
        }
        if (!canWrite(scope.access, stored.object_id)) throw refuse('FORBIDDEN', NOTE_READ_ONLY);
        const changes = await tx.execute<{ title_changed: boolean; content_changed: boolean; content: unknown }>(sql`
          select ${title === undefined ? sql`false` : sql`title <> ${title}`} as title_changed,
            ${content === undefined ? sql`false` : sql`content <> ${JSON.stringify(content)}::jsonb`} as content_changed,
            content
          from notes where id = ${id}::uuid
        `);
        const changed = changes.rows[0];
        if (changed === undefined || (!changed.title_changed && !changed.content_changed)) {
          return { note: summaryOf(stored, scope.access) };
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
        await ensureOwnLink(tx, id);
        context.record({ notes: changesOf(id, await noteLinks(tx, id, home)) });
        // Mentions the save added are notified, ones it removed taken back (spec 0038).
        if (changed.content_changed && content !== undefined) {
          await notifyNoteMentions(context, {
            noteId: id,
            recordId: home.recordId,
            before: mentionedIn(changed.content),
            after: mentionedIn(content),
          });
        }
        const saved = await noteRow(tx, id);
        if (saved === undefined) throw new Error('A note just written could not be read back.');
        // Whose save this one replaced: never the writer's own (a retry, or two of their tabs), only someone else's.
        const ownLast = stored.updated_by_type === actor.type && stored.updated_by_id === actor.id;
        const overwrote =
          !ownLast && input.baseVersion !== undefined && input.baseVersion !== stored.version
            ? { by: actorOf(stored.updated_by_type, stored.updated_by_id), at: stored.updated_at }
            : undefined;
        return { note: summaryOf(saved, scope.access), ...(overwrote === undefined ? {} : { overwrote }) };
      };
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
        // Another try of this first save (a retry after a lost answer) committed meanwhile: read it, with its lock,
        // and carry on as a later save, which answers the same note and writes nothing when nothing changed.
        if (inserted.rowCount === 0) {
          const raced = await noteRow(tx, id, true);
          if (raced === undefined) throw new Error('A note that refused its insert could not be read.');
          return saveExisting(raced);
        }
        // Its own record is its first link (migration 0135), made at the note's own moment.
        await tx.execute(sql`
          insert into note_records (workspace_id, note_id, record_id, position, created_by_type, created_by_id,
            created_by_member_id)
          values (${scope.workspaceId}::uuid, ${id}::uuid, ${recordId}::uuid, 0, ${actor.type}, ${actor.id}::uuid,
            ${memberId}::uuid)
          on conflict do nothing
        `);
        context.record({ notes: [{ noteId: id, recordId, objectId: record.objectId }] });
        await notifyNoteMentions(context, { noteId: id, recordId, before: [], after: mentionedIn(body) });
        const made = await noteRow(tx, id);
        if (made === undefined) throw new Error('A note just written could not be read back.');
        return { note: summaryOf(made, scope.access) };
      }
      return saveExisting(existing);
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
    const links = await noteLinks(tx, noteId, { recordId: row.record_id, objectId: row.object_id });
    const displays = await linkedDisplays(
      tx,
      scope.access,
      links.map((link) => link.recordId),
    );
    const record = displays.get(row.record_id);
    return {
      ...summaryOf(row, scope.access),
      ...(record === undefined ? {} : { record }),
      content: row.content,
      links: othersShown(links, displays),
    };
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
  input: { readonly recordId?: string; readonly cursor?: string; readonly limit?: number },
): Promise<NotePage> {
  checkScope(scope);
  const limit = input.limit ?? NOTE_PAGE;
  if (!Number.isInteger(limit) || limit < 1 || limit > NOTE_PAGE_MAX) {
    throw inputInvalid('limit', `Ask for 1 to ${String(NOTE_PAGE_MAX)} notes.`);
  }
  const after = input.cursor === undefined ? undefined : decodeNoteCursor(input.cursor);
  if (input.recordId === undefined) return listWorkspaceNotes(scope, after, limit);
  const recordId = checkId(input.recordId, UNKNOWN_RECORD);
  return inWorkspace(scope, async (tx) => {
    const record = await liveRecord(tx, recordId, undefined);
    if (record === undefined || record.trashed || !(await recordVisible(tx, scope.access, record.objectId, recordId))) {
      throw refuse('NOT_FOUND', UNKNOWN_RECORD);
    }
    // The notes on it and the notes linked to it (migration 0135), each read through its own record: live, and one
    // the reader may see (a note linked here from a record they can't see is absent).
    const own = recordVisibleSql(scope.access, 'r');
    const from = sql`from notes n ${LIVE_RECORD}
      where n.id in (
        select l.note_id from note_records l where l.record_id = ${recordId}::uuid
        union select n2.id from notes n2 where n2.record_id = ${recordId}::uuid
      )
      and n.deleted_at is null and r.deleted_at is null and o.archived_at is null${own === undefined ? sql`` : sql` and ${own}`}`;
    const bound =
      after === undefined
        ? sql``
        : sql` and (n.updated_at < ${after.updatedAt}::timestamptz or (n.updated_at = ${after.updatedAt}::timestamptz and n.id > ${after.id}::uuid))`;
    const page = await tx.execute<NoteRow>(sql`
      select ${NOTE_COLUMNS} ${from}${bound}
      order by n.updated_at desc nulls last, n.id
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
      sql`select count(*)::int as n from (select 1 ${from} limit ${NOTE_COUNT_CAP + 1}) c`,
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
 * The notes the reader may see, over a note aliased `n` joined to its record
 * `r` and object `o` (`LIVE_RECORD`): live, on a live record of a live object
 * the reader may read, inside that object's record rule (AC-447: a note
 * follows its record). Undefined when the reader may read no object at all.
 */
async function readableNotesSql(tx: WorkspaceTx, access: Access): Promise<SQL | undefined> {
  const objects = await tx.execute<{ id: string }>(
    sql`select o.id::text as id from objects o where o.archived_at is null`,
  );
  const readable = objects.rows.map((row) => row.id).filter((id) => objectLevel(access, id) !== 'none');
  if (readable.length === 0) return undefined;
  const rule = farVisibleSql(access, readable, 'r');
  return sql`n.deleted_at is null and r.deleted_at is null and o.archived_at is null
    and r.object_id = any(${uuidArray(readable)})${rule === undefined ? sql`` : sql` and ${rule}`}`;
}

/** Each note's record as a chip shows it, read as every record read names it (its ids passed the note rule). */
async function recordDisplays(tx: WorkspaceTx, access: Access, ids: readonly string[]) {
  const views = await readRecords(tx, access, [...new Set(ids)], { attributeIds: [], visibleAlready: true });
  return new Map(views.map((view) => [view.id, view.display]));
}

/**
 * The workspace's Notes page: every note the reader may see
 * (`readableNotesSql`), last edited first (then id), each with its record's
 * display; no total. Scans the workspace's notes in edit order: a workspace
 * index on `updated_at` comes with the next notes migration.
 */
async function listWorkspaceNotes(scope: EngineScope, after: NoteCursor | undefined, limit: number): Promise<NotePage> {
  return inWorkspace(scope, async (tx) => {
    const readable = await readableNotesSql(tx, scope.access);
    if (readable === undefined) return { items: [] };
    const bound =
      after === undefined
        ? sql``
        : sql` and (n.updated_at < ${after.updatedAt}::timestamptz or (n.updated_at = ${after.updatedAt}::timestamptz and n.id > ${after.id}::uuid))`;
    const page = await tx.execute<NoteRow>(sql`
      select ${NOTE_COLUMNS} from notes n ${LIVE_RECORD}
      where ${readable}${bound}
      order by n.updated_at desc nulls last, n.id
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
    const displays = await recordDisplays(
      tx,
      scope.access,
      rows.map((row) => row.record_id),
    );
    const items = rows.flatMap((row): NoteSummary[] => {
      const record = displays.get(row.record_id);
      return record === undefined ? [] : [{ ...summaryOf(row, scope.access), record }];
    });
    return { items, ...(nextCursor === undefined ? {} : { nextCursor }) };
  });
}

/**
 * The command menu's notes (spec 0039's search, the flow pass of 30 Oct
 * 2026): those the reader may see whose title contains the text, last edited
 * first, at most `limit`, in the search's own transaction.
 */
export async function searchNotes(
  tx: WorkspaceTx,
  access: Access,
  text: string,
  limit: number,
): Promise<readonly NoteHit[]> {
  const readable = await readableNotesSql(tx, access);
  if (readable === undefined || text === '') return [];
  const rows = await tx.execute<{ id: string; record_id: string; title: string }>(sql`
    select n.id::text as id, n.record_id::text as record_id, n.title
    from notes n ${LIVE_RECORD}
    where ${readable} and strpos(lower(n.title), lower(${text})) > 0
    order by n.updated_at desc, n.id
    limit ${limit}
  `);
  const displays = await recordDisplays(
    tx,
    access,
    rows.rows.map((row) => row.record_id),
  );
  return rows.rows.flatMap((row): NoteHit[] => {
    const record = displays.get(row.record_id);
    return record === undefined ? [] : [{ id: row.id, title: row.title, record }];
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
      context.record({
        notes: changesOf(noteId, await noteLinks(tx, noteId, { recordId: row.record_id, objectId: row.object_id })),
      });
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
      context.record({
        notes: changesOf(noteId, await noteLinks(tx, noteId, { recordId: row.record_id, objectId: row.object_id })),
      });
      return summaryOf(row, scope.access);
    },
    hooks,
  );
  return result;
}

/** The records a note links besides its own, as the reader sees them: live and visible, in link order. */
function othersShown(links: readonly NoteLink[], displays: ReadonlyMap<string, RecordRefDisplay>): RecordRefDisplay[] {
  return links.slice(1).flatMap((link) => {
    const display = displays.get(link.recordId);
    return display === undefined ? [] : [display];
  });
}

/** Record ids, canonical and each once; a malformed one names no record. */
function checkRecordIds(ids: readonly string[] | undefined): readonly string[] {
  if (ids === undefined) return [];
  return [...new Set(ids.map((id) => checkId(id, UNKNOWN_RECORD)))];
}

/**
 * Links records to a note and unlinks others (migration 0135), under the
 * note's row lock: the writer may change the note (`write` on its own
 * record's object, else `FORBIDDEN`), and each record added is live, visible
 * and on an object the writer may change, as a task's link is (`NOT_FOUND`,
 * `FORBIDDEN`). Removed links are only those the writer can see, and never
 * the note's own record; the 20 cap counts every link, hidden ones too
 * (`LIMIT_REACHED`). Links keep their order, closed up to 0..n-1 with the
 * note's own record first. Nothing changed writes nothing; anything else
 * stores one `notes` outbox row per object, naming every record linked
 * before or after, so each of their Notes tabs and timelines reads again.
 */
export async function linkNote(
  scope: EngineScope,
  input: {
    readonly noteId: string;
    readonly addRecordIds?: readonly string[];
    readonly removeRecordIds?: readonly string[];
  },
  hooks: readonly AfterWrite[] = [],
): Promise<NoteLinks> {
  checkScope(scope);
  const noteId = checkId(input.noteId, UNKNOWN_NOTE);
  const adding = checkRecordIds(input.addRecordIds);
  const removing = checkRecordIds(input.removeRecordIds);
  const { result } = await runWrite(
    scope,
    async (context): Promise<NoteLinks> => {
      const { tx } = context;
      const row = await noteRow(tx, noteId, true);
      if (row === undefined || row.deleted || !row.record_live) throw refuse('NOT_FOUND', UNKNOWN_NOTE);
      if (!(await recordVisible(tx, scope.access, row.object_id, row.record_id))) {
        throw refuse('NOT_FOUND', UNKNOWN_NOTE);
      }
      if (!canWrite(scope.access, row.object_id)) throw refuse('FORBIDDEN', NOTE_READ_ONLY);
      const home: NoteLink = { recordId: row.record_id, objectId: row.object_id };
      const links = await noteLinks(tx, noteId, home);
      const current = new Set(links.map((link) => link.recordId));
      const seen = await linkedDisplays(tx, scope.access, [...current]);
      // A link the writer can't see answers as an unknown record, as it would anywhere else: never "already linked".
      if (adding.some((id) => current.has(id) && !seen.has(id))) throw refuse('NOT_FOUND', UNKNOWN_RECORD);
      const added = adding.filter((id) => !current.has(id));
      const removed = removing.filter((id) => id !== home.recordId && current.has(id) && seen.has(id));
      if (current.size - removed.length + added.length > NOTE_RECORDS_MAX) {
        throw refuse('LIMIT_REACHED', NOTE_LINKS_FULL);
      }
      await checkLinkable(context, added, NOTE_LINK_FORBIDDEN);
      if (added.length === 0 && removed.length === 0) return { noteId, links: othersShown(links, seen) };
      const { actor } = scope;
      const memberId = actor.type === 'member' ? actor.id : null;
      if (removed.length > 0) {
        await tx.execute(
          sql`delete from note_records where note_id = ${noteId}::uuid and record_id = any(${uuidList(removed)})`,
        );
      }
      // Its own record's row first (a note saved before its links existed has none), then the rest closed up in
      // order: at most 20 rows, so a smallint never runs out however often links come and go.
      await ensureOwnLink(tx, noteId);
      await tx.execute(sql`
        update note_records l set position = (o.n - 1)::smallint
        from (
          select record_id, row_number() over (order by (record_id = ${home.recordId}::uuid) desc, position, record_id) as n
          from note_records where note_id = ${noteId}::uuid
        ) o
        where l.note_id = ${noteId}::uuid and l.record_id = o.record_id and l.position <> (o.n - 1)
      `);
      if (added.length > 0) {
        await tx.execute(sql`
          insert into note_records (workspace_id, note_id, record_id, position, created_by_type, created_by_id,
            created_by_member_id)
          select ${scope.workspaceId}::uuid, ${noteId}::uuid, x.id,
            ((select count(*) from note_records c where c.note_id = ${noteId}::uuid) + x.n - 1)::smallint,
            ${actor.type}, ${actor.id}::uuid, ${memberId}::uuid
          from unnest(${uuidList(added)}) with ordinality as x(id, n)
        `);
      }
      const after = await noteLinks(tx, noteId, home);
      const touched = new Map([...links, ...after].map((link) => [link.recordId, link]));
      context.record({ notes: changesOf(noteId, [...touched.values()]) });
      const shown = await linkedDisplays(
        tx,
        scope.access,
        after.map((link) => link.recordId),
      );
      return { noteId, links: othersShown(after, shown) };
    },
    hooks,
  );
  return result;
}
