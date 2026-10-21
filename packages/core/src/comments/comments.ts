// Comments (spec 0038): threads on any record, by record id, in their own
// tables beside the records engine, written through `runWrite` with the
// caller's hooks so every change stores its `comments` outbox row (and any
// `notifications` row) in its own transaction, and read in `inWorkspace`.
// Access follows the record (decision 3): whoever may read a live record may
// read its comments, comment, reply, react, and resolve or reopen a thread; a
// record they can't read, or one in the trash, answers as unknown. Only a
// comment's author edits it (decision 4); its author, or a holder of
// `comments.manage`, deletes it. Only members write comments: a key reads
// what its data level lets it read and writes none.
import { sql } from 'drizzle-orm';
import {
  COMMENT_MAX,
  COMMENT_MENTIONS_MAX,
  mentionedIds,
  THREAD_COMMENTS_MAX,
  THREAD_GET_MAX,
  THREAD_PAGE,
  ThreadCursor,
  type CommentEmoji,
  type CommentVersion,
  type CommentView,
  type ReactionSummary,
  type ThreadPage,
  type ThreadView,
} from '@crm/contracts';
import type { WorkspaceTx } from '@crm/db';
import { checkScope } from '../access/mint.ts';
import { can, objectLevel, type Access } from '../access/policy.ts';
import { inWorkspace } from '../access/run.ts';
import { UNKNOWN_RECORD, visibleRecords } from '../access/visibility.ts';
import { canonicalId, checkId, isUuid, isUuidV7, uuidList } from '../engine/ids.ts';
import { inputInvalid, refuse } from '../engine/refusals.ts';
import type { Actor, EngineScope } from '../engine/scope.ts';
import { runWrite, type AfterWrite, type WriteContext } from '../engine/write.ts';
import { notifyComment, withdrawComment } from '../notifications/notify.ts';

/** What a comment the reader can't see (or one that doesn't exist) answers. */
export const UNKNOWN_COMMENT = 'That comment does not exist.';
/** What editing someone else's comment answers. */
export const NOT_YOUR_COMMENT = 'Only its author can edit a comment.';
/** What a principal that isn't a member answers on a write. */
export const MEMBERS_ONLY = 'Only members can comment.';
/** What a thread past `THREAD_COMMENTS_MAX` answers. */
export const THREAD_FULL = 'This thread is full. Start a new one.';
/** What a mention of someone who isn't an active member answers. */
export const UNKNOWN_MENTION = "You mentioned someone who isn't in this workspace.";
/** What a cursor the server didn't make answers, on `cursor`. */
export const THREAD_CURSOR_MESSAGE = 'That comments cursor is not valid here. Start again from the top.';

/** A moment as fixed width UTC text with milliseconds. */
const millis = (column: string) => sql.raw(`to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`);
/** A moment with microseconds, for cursors. */
const micros = (column: string) => sql.raw(`to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`);

/** The acting member, or `FORBIDDEN` for anyone else: only members write comments. */
function memberOf(scope: EngineScope): string {
  const { actor, access } = scope;
  if (access.principal.kind !== 'member' || actor.type !== 'member' || actor.id === null) {
    throw refuse('FORBIDDEN', MEMBERS_ONLY);
  }
  return actor.id;
}

/** The member a principal is, if a member. */
function readerOf(access: Access): string | undefined {
  return access.principal.kind === 'member' ? access.principal.memberId : undefined;
}

/**
 * The record's object when the reader may read it: live, on a live object
 * not at `none`, inside any record rule; else `NOT_FOUND` with the record
 * message. `lock` takes it `for key share`, which blocks only its purge.
 */
export async function readableRecord(tx: WorkspaceTx, access: Access, recordId: string, lock = false): Promise<string> {
  const rows = await tx.execute<{ object_id: string }>(sql`
    select r.object_id::text as object_id
    from records r join objects o on o.workspace_id = r.workspace_id and o.id = r.object_id
    where r.id = ${recordId}::uuid and r.deleted_at is null and o.archived_at is null
    ${lock ? sql`for key share of r` : sql``}
  `);
  const [row] = rows.rows;
  if (row === undefined || objectLevel(access, row.object_id) === 'none') throw refuse('NOT_FOUND', UNKNOWN_RECORD);
  const seen = await visibleRecords(tx, access, [{ objectId: row.object_id, recordId }]);
  if (!seen.has(recordId)) throw refuse('NOT_FOUND', UNKNOWN_RECORD);
  return row.object_id;
}

/** Of `recordIds`, those the reader may read and that are live, by id, with their object. */
export async function readableRecords(
  tx: WorkspaceTx,
  access: Access,
  recordIds: readonly string[],
): Promise<ReadonlyMap<string, string>> {
  const unique = [...new Set(recordIds)];
  if (unique.length === 0) return new Map();
  const rows = await tx.execute<{ id: string; object_id: string }>(sql`
    select r.id::text as id, r.object_id::text as object_id
    from records r join objects o on o.workspace_id = r.workspace_id and o.id = r.object_id
    where r.id = any(${uuidList(unique)}) and r.deleted_at is null and o.archived_at is null
  `);
  const live = rows.rows.filter((row) => objectLevel(access, row.object_id) !== 'none');
  const seen = await visibleRecords(
    tx,
    access,
    live.map((row) => ({ objectId: row.object_id, recordId: row.id })),
  );
  return new Map(live.filter((row) => seen.has(row.id)).map((row) => [row.id, row.object_id]));
}

/** A comment's text trimmed at its ends, refused on `body` when empty or too long. */
function checkBody(body: string): string {
  const trimmed = body.trim();
  if (trimmed.length === 0) throw inputInvalid('body', "A comment can't be empty.");
  if (trimmed.length > COMMENT_MAX) {
    throw inputInvalid('body', `A comment holds at most ${COMMENT_MAX.toLocaleString('en')} characters.`);
  }
  return trimmed;
}

/**
 * The members a text mentions, each an active member of the workspace, else
 * `INPUT_INVALID` on `body`; at most `COMMENT_MENTIONS_MAX`.
 */
async function checkMentions(context: WriteContext, body: string): Promise<readonly string[]> {
  const ids = mentionedIds(body);
  if (ids.length === 0) return [];
  if (ids.length > COMMENT_MENTIONS_MAX) {
    throw inputInvalid('body', `A comment mentions at most ${String(COMMENT_MENTIONS_MAX)} people.`);
  }
  if (!ids.every(isUuid)) throw inputInvalid('body', UNKNOWN_MENTION);
  const unknown = ids.filter((id) => !context.activeMembers.has(id));
  if (unknown.length > 0) {
    const rows = await context.tx.execute<{ id: string }>(
      sql`select id::text as id from members where id = any(${uuidList(unknown)}) and status = 'active'`,
    );
    for (const row of rows.rows) context.activeMembers.add(row.id);
    if (rows.rows.length < unknown.length) throw inputInvalid('body', UNKNOWN_MENTION);
  }
  return ids;
}

/** A stored comment, as the views and the rules need it. */
interface CommentRow extends Record<string, unknown> {
  readonly id: string;
  readonly thread_id: string;
  readonly record_id: string;
  readonly body: string;
  readonly mention_member_ids: string[];
  readonly version: number;
  readonly edited_at: string | null;
  readonly created_at: string;
  readonly created_by_type: Actor['type'];
  readonly created_by_id: string | null;
  readonly resolved_at: string | null;
  readonly resolved_by_type: Actor['type'] | null;
  readonly resolved_by_id: string | null;
  readonly deleted: boolean;
}

const COMMENT_COLUMNS = sql`c.id::text as id, c.thread_id::text as thread_id, c.record_id::text as record_id, c.body,
  c.mention_member_ids::text[] as mention_member_ids, c.version, ${millis('c.edited_at')} as edited_at,
  ${millis('c.created_at')} as created_at, c.created_by_type, c.created_by_id::text as created_by_id,
  ${millis('c.resolved_at')} as resolved_at, c.resolved_by_type, c.resolved_by_id::text as resolved_by_id,
  c.deleted_at is not null as deleted`;

/** Whether the actor wrote the comment. */
const isAuthor = (row: Pick<CommentRow, 'created_by_type' | 'created_by_id'>, actor: Actor) =>
  row.created_by_type === actor.type && row.created_by_id !== null && row.created_by_id === actor.id;

/** One comment by id, live, locked when asked; undefined when missing or deleted. */
async function commentRow(tx: WorkspaceTx, id: string, lock = false): Promise<CommentRow | undefined> {
  const rows = await tx.execute<CommentRow>(sql`
    select ${COMMENT_COLUMNS} from comments c
    where c.id = ${id}::uuid and c.deleted_at is null
    ${lock ? sql`for update of c` : sql``}
  `);
  return rows.rows[0];
}

/**
 * The threads among `threadIds` as `scope` sees them, in the order asked:
 * each with its comments oldest first, deleted ones as placeholders while
 * another comment of the thread is live; a thread with no live comment, or
 * on a record the reader can't read, is left out.
 */
async function readThreads(
  tx: WorkspaceTx,
  scope: Pick<EngineScope, 'access' | 'actor'>,
  threadIds: readonly string[],
): Promise<readonly ThreadView[]> {
  const ids = [...new Set(threadIds)];
  if (ids.length === 0) return [];
  const rows = await tx.execute<CommentRow>(sql`
    select ${COMMENT_COLUMNS} from comments c
    where c.thread_id = any(${uuidList(ids)})
    order by c.thread_id, c.created_at, c.id
  `);
  const byThread = new Map<string, CommentRow[]>();
  for (const row of rows.rows) {
    const list = byThread.get(row.thread_id) ?? [];
    list.push(row);
    byThread.set(row.thread_id, list);
  }
  const readable = await readableRecords(
    tx,
    scope.access,
    [...byThread.values()].flatMap((list) => list.slice(0, 1).map((row) => row.record_id)),
  );
  const shownIds = [...byThread.values()].flatMap((list) =>
    list.some((row) => !row.deleted) && readable.has(list[0]?.record_id ?? '')
      ? list.filter((row) => !row.deleted).map((row) => row.id)
      : [],
  );
  const reactions = await reactionSummaries(tx, scope.access, shownIds);
  const me = readerOf(scope.access);
  const manages = can(scope.access, 'comments.manage');
  return ids.flatMap((threadId) => {
    const list = byThread.get(threadId);
    const first = list?.[0];
    if (list === undefined || first === undefined || first.id !== threadId) return [];
    if (!list.some((row) => !row.deleted) || !readable.has(first.record_id)) return [];
    const comments: CommentView[] = list.map((row) => {
      if (row.deleted) {
        return {
          id: row.id,
          threadId,
          isDeleted: true,
          body: '',
          createdAt: row.created_at,
          version: row.version,
          reactions: [],
          canEdit: false,
          canDelete: false,
        };
      }
      const author = isAuthor(row, scope.actor);
      return {
        id: row.id,
        threadId,
        isDeleted: false,
        body: row.body,
        createdBy: { type: row.created_by_type, id: row.created_by_id },
        createdAt: row.created_at,
        ...(row.edited_at === null ? {} : { editedAt: row.edited_at }),
        version: row.version,
        reactions: reactions.get(row.id) ?? [],
        canEdit: author && me !== undefined,
        canDelete: me !== undefined && (author || manages),
      };
    });
    return [
      {
        id: threadId,
        recordId: first.record_id,
        ...(first.resolved_at === null || first.resolved_by_type === null
          ? {}
          : { resolvedAt: first.resolved_at, resolvedBy: { type: first.resolved_by_type, id: first.resolved_by_id } }),
        comments,
      },
    ];
  });
}

/** Each comment's reactions, by comment id, in the menu's order of first use. */
async function reactionSummaries(
  tx: WorkspaceTx,
  access: Access,
  commentIds: readonly string[],
): Promise<ReadonlyMap<string, readonly ReactionSummary[]>> {
  if (commentIds.length === 0) return new Map();
  const me = readerOf(access) ?? '00000000-0000-0000-0000-000000000000';
  const rows = await tx.execute<{
    comment_id: string;
    emoji: CommentEmoji;
    count: number;
    mine: boolean;
    member_ids: string[];
  }>(sql`
    select comment_id::text as comment_id, emoji, count(*)::int as count, bool_or(member_id = ${me}::uuid) as mine,
      (array_agg(member_id::text order by created_at, member_id))[1:10] as member_ids
    from comment_reactions where comment_id = any(${uuidList(commentIds)})
    group by comment_id, emoji
    order by comment_id, min(created_at), emoji
  `);
  const out = new Map<string, ReactionSummary[]>();
  for (const row of rows.rows) {
    const list = out.get(row.comment_id) ?? [];
    list.push({ emoji: row.emoji, count: row.count, mine: row.mine, memberIds: row.member_ids });
    out.set(row.comment_id, list);
  }
  return out;
}

/** Encodes where a page ended as the opaque cursor. */
function encodeCursor(cursor: ThreadCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

/** Decodes a cursor of the same kind of page, refusing anything that isn't one of ours. */
function decodeCursor(cursor: string, resolved: boolean): ThreadCursor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw inputInvalid('cursor', THREAD_CURSOR_MESSAGE);
  }
  const bound = ThreadCursor.safeParse(parsed);
  if (!bound.success || bound.data.resolved !== resolved) throw inputInvalid('cursor', THREAD_CURSOR_MESSAGE);
  const moment = bound.data.createdAt;
  const stamp = Date.parse(moment);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(moment) ||
    Number.isNaN(stamp) ||
    moment.startsWith('0000') ||
    new Date(stamp).toISOString().slice(0, 19) !== moment.slice(0, 19)
  ) {
    throw inputInvalid('cursor', THREAD_CURSOR_MESSAGE);
  }
  return bound.data;
}

/** The threads of a record that still show: at least one live comment. */
const LIVE_THREAD = sql`exists (select 1 from comments l where l.workspace_id = t.workspace_id and l.thread_id = t.id and l.deleted_at is null)`;

/** The most threads a count reads before it stops: a record with more says "10,000+". */
const COUNT_CAP = 10_000;

/**
 * A page of a record's threads (AC-1151): open ones, or resolved ones (the
 * tab's disclosure), newest first by their first comment, 20 at a time, each
 * whole. The first page carries both counts. A record the reader can't read,
 * or one in the trash, is `NOT_FOUND`.
 */
export async function listThreads(
  scope: EngineScope,
  input: { readonly recordId: string; readonly resolved?: boolean; readonly cursor?: string },
): Promise<ThreadPage> {
  checkScope(scope);
  const recordId = checkId(input.recordId, UNKNOWN_RECORD);
  const resolved = input.resolved === true;
  const after = input.cursor === undefined ? undefined : decodeCursor(input.cursor, resolved);
  return inWorkspace(scope, async (tx) => {
    await readableRecord(tx, scope.access, recordId);
    const state = resolved ? sql`t.resolved_at is not null` : sql`t.resolved_at is null`;
    const bound =
      after === undefined
        ? sql``
        : sql` and (t.created_at, t.id) < (${after.createdAt}::timestamptz, ${after.id}::uuid)`;
    const page = await tx.execute<{ id: string; created_at: string }>(sql`
      select t.id::text as id, ${micros('t.created_at')} as created_at
      from comments t
      where t.record_id = ${recordId}::uuid and t.id = t.thread_id and ${state} and ${LIVE_THREAD}${bound}
      order by t.created_at desc, t.id desc
      limit ${THREAD_PAGE + 1}
    `);
    const rows = page.rows.slice(0, THREAD_PAGE);
    const threads = await readThreads(
      tx,
      scope,
      rows.map((row) => row.id),
    );
    const last = rows.at(-1);
    const nextCursor =
      page.rows.length > THREAD_PAGE && last !== undefined
        ? encodeCursor({ resolved, createdAt: last.created_at, id: last.id })
        : undefined;
    const base = { threads: [...threads], ...(nextCursor === undefined ? {} : { nextCursor }) };
    if (after !== undefined) return base;
    const counted = await tx.execute<{ open: number; resolved: number }>(sql`
      select count(*) filter (where c.resolved_at is null)::int as open,
        count(*) filter (where c.resolved_at is not null)::int as resolved
      from (
        select t.resolved_at from comments t
        where t.record_id = ${recordId}::uuid and t.id = t.thread_id and ${LIVE_THREAD}
        limit ${COUNT_CAP}
      ) c
    `);
    const counts = counted.rows[0] ?? { open: 0, resolved: 0 };
    return { ...base, counts: { open: counts.open, resolved: counts.resolved } };
  });
}

/**
 * Threads by id (`comments.get`, what a `comments` event's ids are read back
 * through): up to 50, in the order asked; missing, emptied and hidden ones
 * are left out alike.
 */
export async function getThreads(
  scope: EngineScope,
  input: { readonly threadIds: readonly string[] },
): Promise<ThreadView[]> {
  checkScope(scope);
  if (input.threadIds.length > THREAD_GET_MAX) {
    throw refuse('CONFIG_INVALID', `Read at most ${String(THREAD_GET_MAX)} threads at once.`);
  }
  const ids = [...new Set(input.threadIds.filter(isUuid).map(canonicalId))];
  if (ids.length === 0) return [];
  return inWorkspace(scope, async (tx) => [...(await readThreads(tx, scope, ids))]);
}

/** The thread a write just touched, read back for its writer, who can see it. */
async function threadAfterWrite(tx: WorkspaceTx, scope: EngineScope, threadId: string): Promise<ThreadView> {
  const [thread] = await readThreads(tx, scope, [threadId]);
  if (thread === undefined) throw new Error('A thread just written could not be read back.');
  return thread;
}

/** The comment with this id as an earlier try made it, or `ID_TAKEN` for anyone else's. */
async function replayOf(tx: WorkspaceTx, scope: EngineScope, id: string): Promise<string | undefined> {
  const rows = await tx.execute<{
    created_by_type: Actor['type'];
    created_by_id: string | null;
    thread_id: string;
    deleted: boolean;
  }>(sql`select created_by_type, created_by_id::text as created_by_id, thread_id::text as thread_id,
      deleted_at is not null as deleted from comments where id = ${id}::uuid`);
  const [row] = rows.rows;
  if (row === undefined) return undefined;
  if (!isAuthor(row, scope.actor) || row.deleted) throw refuse('ID_TAKEN', 'A comment with that id already exists.');
  return row.thread_id;
}

/** A new comment's input. */
export interface CreateCommentInput {
  /** A UUID v7 the browser minted: the retry key. */
  readonly id: string;
  readonly recordId: string;
  /** Absent: a new thread. */
  readonly threadId?: string;
  readonly body: string;
}

/**
 * Comments on a record (AC-1152, AC-1153): a new thread, or a reply, which
 * reopens a resolved thread. Mentions must name active members (AC-1154);
 * each mentioned member is notified, and on a reply the thread's earlier
 * writers too (AC-1163, AC-1164). The same call again returns the same
 * thread and writes nothing. One `comments` outbox row.
 */
export async function createComment(
  scope: EngineScope,
  input: CreateCommentInput,
  hooks: readonly AfterWrite[] = [],
): Promise<ThreadView> {
  checkScope(scope);
  const me = memberOf(scope);
  if (!isUuidV7(input.id)) throw inputInvalid('id', 'The comment id must be a UUID v7.');
  const id = canonicalId(input.id);
  const recordId = checkId(input.recordId, UNKNOWN_RECORD);
  const threadInput = input.threadId === undefined ? undefined : checkId(input.threadId, UNKNOWN_COMMENT);
  const body = checkBody(input.body);
  const { result } = await runWrite(
    scope,
    async (context) => {
      const { tx } = context;
      const replayed = await replayOf(tx, scope, id);
      if (replayed !== undefined) return threadAfterWrite(tx, scope, replayed);
      const objectId = await readableRecord(tx, scope.access, recordId, true);
      const mentioned = await checkMentions(context, body);
      let threadId = id;
      let participants: readonly string[] | undefined;
      if (threadInput !== undefined) {
        const lockedThread = await tx.execute<{
          record_id: string;
          resolved: boolean;
          live: number;
          total: number;
        }>(sql`
          select t.record_id::text as record_id, t.resolved_at is not null as resolved,
            (select count(*)::int from comments l where l.thread_id = t.id and l.deleted_at is null) as live,
            (select count(*)::int from comments l where l.thread_id = t.id) as total
          from comments t where t.id = ${threadInput}::uuid and t.id = t.thread_id
          for update of t
        `);
        const [thread] = lockedThread.rows;
        if (thread === undefined || thread.record_id !== recordId || thread.live === 0) {
          throw refuse('NOT_FOUND', UNKNOWN_COMMENT);
        }
        if (thread.total >= THREAD_COMMENTS_MAX) throw refuse('LIMIT_REACHED', THREAD_FULL);
        threadId = threadInput;
        if (thread.resolved) {
          await tx.execute(sql`
            update comments set resolved_at = null, resolved_by_type = null, resolved_by_id = null,
              resolved_by_member_id = null
            where id = ${threadId}::uuid
          `);
        }
        const writers = await tx.execute<{ member_id: string }>(sql`
          select distinct created_by_member_id::text as member_id from comments
          where thread_id = ${threadId}::uuid and deleted_at is null and created_by_member_id is not null
        `);
        participants = writers.rows.map((row) => row.member_id);
      }
      const inserted = await tx.execute(sql`
        insert into comments (workspace_id, id, record_id, thread_id, body, mention_member_ids,
          created_by_type, created_by_id, created_by_member_id, updated_by_type, updated_by_id, updated_by_member_id)
        values (${scope.workspaceId}::uuid, ${id}::uuid, ${recordId}::uuid, ${threadId}::uuid, ${body},
          ${uuidList(mentioned)}, 'member', ${me}::uuid, ${me}::uuid, 'member', ${me}::uuid, ${me}::uuid)
        on conflict (workspace_id, id) do nothing
      `);
      if (inserted.rowCount === 0) {
        const again = await replayOf(tx, scope, id);
        if (again !== undefined) return threadAfterWrite(tx, scope, again);
        throw refuse('ID_TAKEN', 'A comment with that id already exists.');
      }
      await notifyComment(context, {
        commentId: id,
        threadId,
        recordId,
        mentioned,
        ...(participants === undefined ? {} : { participants }),
      });
      context.record({ comments: [{ threadId, recordId, objectId }] });
      return threadAfterWrite(tx, scope, threadId);
    },
    hooks,
  );
  return result;
}

/**
 * The live comment the writer may act on, locked: `NOT_FOUND` when it is
 * missing, deleted, or on a record they can't read (or one in the trash).
 */
async function lockedComment(
  context: WriteContext,
  commentId: string,
): Promise<{ readonly row: CommentRow; readonly objectId: string }> {
  const row = await commentRow(context.tx, commentId, true);
  if (row === undefined) throw refuse('NOT_FOUND', UNKNOWN_COMMENT);
  try {
    const objectId = await readableRecord(context.tx, context.scope.access, row.record_id, true);
    return { row, objectId };
  } catch {
    throw refuse('NOT_FOUND', UNKNOWN_COMMENT);
  }
}

/**
 * Edits a comment (AC-1155): its author only. The text it replaces is kept
 * in `comment_versions`; newly mentioned members are notified and members no
 * longer mentioned lose their mention (AC-1163). The same text writes nothing.
 */
export async function updateComment(
  scope: EngineScope,
  input: { readonly commentId: string; readonly body: string },
  hooks: readonly AfterWrite[] = [],
): Promise<ThreadView> {
  checkScope(scope);
  const me = memberOf(scope);
  const commentId = checkId(input.commentId, UNKNOWN_COMMENT);
  const body = input.body.trim().length === 0 ? '' : checkBody(input.body);
  if (body === '') throw inputInvalid('body', "A comment can't be empty. Delete it instead.");
  const { result } = await runWrite(
    scope,
    async (context) => {
      const { tx } = context;
      const { row, objectId } = await lockedComment(context, commentId);
      if (!isAuthor(row, scope.actor)) throw refuse('FORBIDDEN', NOT_YOUR_COMMENT);
      if (row.body === body) return threadAfterWrite(tx, scope, row.thread_id);
      const mentioned = await checkMentions(context, body);
      await tx.execute(sql`
        insert into comment_versions (workspace_id, comment_id, version, body, created_at, created_by_type,
          created_by_id, created_by_member_id)
        select workspace_id, id, version, body, coalesce(edited_at, created_at), 'member', ${me}::uuid, ${me}::uuid
        from comments where id = ${commentId}::uuid
      `);
      await tx.execute(sql`
        update comments set body = ${body}, mention_member_ids = ${uuidList(mentioned)}, version = version + 1,
          edited_at = now(), updated_at = now(), updated_by_type = 'member', updated_by_id = ${me}::uuid,
          updated_by_member_id = ${me}::uuid
        where id = ${commentId}::uuid
      `);
      const before = new Set(row.mention_member_ids);
      await notifyComment(context, {
        commentId,
        threadId: row.thread_id,
        recordId: row.record_id,
        mentioned: mentioned.filter((id) => !before.has(id)),
      });
      await withdrawComment(
        context,
        commentId,
        row.mention_member_ids.filter((id) => !mentioned.includes(id)),
      );
      context.record({ comments: [{ threadId: row.thread_id, recordId: row.record_id, objectId }] });
      return threadAfterWrite(tx, scope, row.thread_id);
    },
    hooks,
  );
  return result;
}

/**
 * Deletes a comment (AC-1156): its author, or a holder of `comments.manage`.
 * It leaves every screen, or stays as a placeholder while its thread has
 * other live comments; its notifications go with it.
 */
export async function deleteComment(
  scope: EngineScope,
  input: { readonly commentId: string },
  hooks: readonly AfterWrite[] = [],
): Promise<{ readonly threadId: string }> {
  checkScope(scope);
  const me = memberOf(scope);
  const commentId = checkId(input.commentId, UNKNOWN_COMMENT);
  const { result } = await runWrite(
    scope,
    async (context) => {
      const { tx } = context;
      const { row, objectId } = await lockedComment(context, commentId);
      if (!isAuthor(row, scope.actor) && !can(scope.access, 'comments.manage')) {
        throw refuse('FORBIDDEN', 'Only its author, or a workspace owner or admin, can delete a comment.');
      }
      await tx.execute(sql`
        update comments set deleted_at = now(), deleted_by_type = 'member', deleted_by_id = ${me}::uuid,
          deleted_by_member_id = ${me}::uuid
        where id = ${commentId}::uuid
      `);
      await withdrawComment(context, commentId);
      context.record({ comments: [{ threadId: row.thread_id, recordId: row.record_id, objectId }] });
      return { threadId: row.thread_id };
    },
    hooks,
  );
  return result;
}

/** Resolves or reopens a thread (AC-1157): anyone who may comment on its record. */
export async function setThreadResolved(
  scope: EngineScope,
  input: { readonly threadId: string; readonly resolved: boolean },
  hooks: readonly AfterWrite[] = [],
): Promise<ThreadView> {
  checkScope(scope);
  const me = memberOf(scope);
  const threadId = checkId(input.threadId, UNKNOWN_COMMENT);
  const { result } = await runWrite(
    scope,
    async (context) => {
      const { tx } = context;
      const locked = await tx.execute<{ record_id: string; resolved: boolean; live: number }>(sql`
        select t.record_id::text as record_id, t.resolved_at is not null as resolved,
          (select count(*)::int from comments l where l.thread_id = t.id and l.deleted_at is null) as live
        from comments t where t.id = ${threadId}::uuid and t.id = t.thread_id
        for update of t
      `);
      const [thread] = locked.rows;
      if (thread === undefined || thread.live === 0) throw refuse('NOT_FOUND', UNKNOWN_COMMENT);
      let objectId: string;
      try {
        objectId = await readableRecord(tx, scope.access, thread.record_id, true);
      } catch {
        throw refuse('NOT_FOUND', UNKNOWN_COMMENT);
      }
      if (thread.resolved === input.resolved) return threadAfterWrite(tx, scope, threadId);
      await tx.execute(
        input.resolved
          ? sql`update comments set resolved_at = now(), resolved_by_type = 'member', resolved_by_id = ${me}::uuid,
              resolved_by_member_id = ${me}::uuid where id = ${threadId}::uuid`
          : sql`update comments set resolved_at = null, resolved_by_type = null, resolved_by_id = null,
              resolved_by_member_id = null where id = ${threadId}::uuid`,
      );
      context.record({ comments: [{ threadId, recordId: thread.record_id, objectId }] });
      return threadAfterWrite(tx, scope, threadId);
    },
    hooks,
  );
  return result;
}

/** Adds or takes back the member's reaction (AC-1158). No notification. */
export async function toggleReaction(
  scope: EngineScope,
  input: { readonly commentId: string; readonly emoji: CommentEmoji; readonly on: boolean },
  hooks: readonly AfterWrite[] = [],
): Promise<ThreadView> {
  checkScope(scope);
  const me = memberOf(scope);
  const commentId = checkId(input.commentId, UNKNOWN_COMMENT);
  const { result } = await runWrite(
    scope,
    async (context) => {
      const { tx } = context;
      const { row, objectId } = await lockedComment(context, commentId);
      const changed = input.on
        ? await tx.execute(sql`
            insert into comment_reactions (workspace_id, comment_id, member_id, emoji)
            values (${scope.workspaceId}::uuid, ${commentId}::uuid, ${me}::uuid, ${input.emoji})
            on conflict do nothing
          `)
        : await tx.execute(sql`
            delete from comment_reactions
            where comment_id = ${commentId}::uuid and member_id = ${me}::uuid and emoji = ${input.emoji}
          `);
      if ((changed.rowCount ?? 0) > 0) {
        context.record({ comments: [{ threadId: row.thread_id, recordId: row.record_id, objectId }] });
      }
      return threadAfterWrite(tx, scope, row.thread_id);
    },
    hooks,
  );
  return result;
}

/** A comment's earlier texts, newest first (AC-1155), for whoever may read it. */
export async function commentVersions(
  scope: EngineScope,
  input: { readonly commentId: string },
): Promise<CommentVersion[]> {
  checkScope(scope);
  const commentId = checkId(input.commentId, UNKNOWN_COMMENT);
  return inWorkspace(scope, async (tx) => {
    const row = await commentRow(tx, commentId);
    if (row === undefined) throw refuse('NOT_FOUND', UNKNOWN_COMMENT);
    try {
      await readableRecord(tx, scope.access, row.record_id);
    } catch {
      throw refuse('NOT_FOUND', UNKNOWN_COMMENT);
    }
    const versions = await tx.execute<{ version: number; body: string; at: string }>(sql`
      select version, body, ${millis('created_at')} as at from comment_versions
      where comment_id = ${commentId}::uuid order by version desc
    `);
    return versions.rows.map((version) => ({ version: version.version, body: version.body, at: version.at }));
  });
}
