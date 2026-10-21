// Tasks (spec 0019, milestone 1): their own tables beside the records engine,
// written through `runWrite` with the caller's hooks, so every change stores
// one `tasks` outbox row in its own transaction (AC-448), and read in
// `inWorkspace`. Access follows spec 0009's task rule (AC-447): a task is
// visible when it links no records at all (a link to a trashed record still
// counts), the reader is its assignee or creator, or a linked record is live
// and visible to them; it may be changed by its assignee, its creator, anyone
// when it links nothing, and anyone who may write a visible linked record's
// object. Linking a record needs `write` on its object. A write never removes
// a link the writer can't see, and never names a record or member the writer
// can't see in a refusal.
import { sql, type SQL } from 'drizzle-orm';
import {
  TASK_COUNT_CAP,
  TASK_DUE_CAP,
  TASK_GET_MAX,
  TASK_PAGE,
  TASK_PAGE_MAX,
  TASK_RECORDS_MAX,
  TASK_TITLE_MAX,
  TaskCursor,
  type TaskMine,
  type TaskPage,
  type TaskStatus,
  type TaskTotal,
  type TaskView,
} from '@crm/contracts';
import { DateValue, type RecordRefDisplay } from '@crm/contracts/values';
import type { WorkspaceTx } from '@crm/db';
import { canonicalId, checkId, isUuid, isUuidV7, uuidList } from '../engine/ids.ts';
import { readRecords } from '../engine/records.ts';
import { inputInvalid, refuse } from '../engine/refusals.ts';
import type { Actor, EngineScope } from '../engine/scope.ts';
import { runWrite, type AfterWrite, type WriteContext } from '../engine/write.ts';
import { checkScope } from '../access/mint.ts';
import { isOpen, objectLevel, type Access } from '../access/policy.ts';
import { inWorkspace } from '../access/run.ts';
import { recordVisibleSql, UNKNOWN_RECORD, visibleRecords } from '../access/visibility.ts';

/** What a task the reader can't see (or one that doesn't exist) answers. */
export const UNKNOWN_TASK = 'That task does not exist.';
/** What a change outside the change rule answers (AC-447). */
export const TASK_READ_ONLY = 'You can view this task but not change it.';
/** What linking a record the writer may not change answers (AC-447). */
export const LINK_FORBIDDEN = "You can't link a task to a record you can't change.";
/** What an assignee who isn't an active member answers. */
export const UNKNOWN_MEMBER = "That member isn't in this workspace.";
/** What a 21st link answers. */
export const LINKS_FULL = `A task links at most ${String(TASK_RECORDS_MAX)} records.`;
/** Past this place a task's links close up again (a smallint holds 32,767). */
export const POSITION_RENUMBER = 30_000;

/** What a cursor the server didn't make answers, on the `cursor` field. */
export const TASK_CURSOR_MESSAGE = 'That task cursor is not valid here. Start again from the top.';

/** A new task (`tasks.create`). */
export interface CreateTaskInput {
  /** A UUID v7 the browser minted: the retry key. */
  readonly id: string;
  readonly title: string;
  readonly dueOn?: string;
  /** Absent: unassigned. */
  readonly assigneeMemberId?: string;
  readonly recordIds?: readonly string[];
}

/** A change to one task (`tasks.update`): only the fields given; `null` clears. */
export interface UpdateTaskInput {
  readonly taskId: string;
  readonly title?: string;
  readonly dueOn?: string | null;
  readonly assigneeMemberId?: string | null;
  readonly isDone?: boolean;
  readonly addRecordIds?: readonly string[];
  readonly removeRecordIds?: readonly string[];
}

/** One page of a task list (`tasks.list`): one record's tasks, or My tasks' (assigned, created or all). */
export interface ListTasksInput {
  readonly scope: { readonly recordId: string } | { readonly mine: TaskMine };
  readonly status: TaskStatus;
  readonly cursor?: string;
  readonly limit?: number;
}

/** A moment as fixed width UTC text with milliseconds, as `TaskView` carries it. */
const millis = (column: string) => sql.raw(`to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`);
/** A moment with microseconds, for cursors, so two tasks made in one millisecond still page apart. */
const micros = (column: string) => sql.raw(`to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`);

/** What a principal that isn't a member (an API key) answers when its data level doesn't reach tasks. */
const NOT_FOR_KEYS = 'This key can’t work with tasks.';

/**
 * Tasks have no object of their own, so a principal that isn't a member (an
 * API key, later an automation) reaches them only through its data level on
 * every object: `read` to read them, `write` to change them (fail closed: a
 * key at none sees no task, not even one with no links). Members and the
 * system go through the task rule alone.
 */
function principalReaches(access: Access, need: 'read' | 'write'): boolean {
  const { kind } = access.principal;
  if (kind === 'member' || kind === 'system') return true;
  const level = access.data.defaultObject;
  return need === 'read' ? level === 'read' || level === 'write' : level === 'write';
}

/** The member the principal is, if a member: the assignee rule reads it. */
function memberOf(access: Access): string | undefined {
  return access.principal.kind === 'member' ? access.principal.memberId : undefined;
}

/** A task's stored row, as the view and the rules need it. */
interface TaskRow extends Record<string, unknown> {
  readonly id: string;
  readonly title: string;
  readonly is_done: boolean;
  readonly done_at: string | null;
  readonly done_by_type: Actor['type'] | null;
  readonly done_by_id: string | null;
  readonly due_on: string | null;
  readonly assignee_member_id: string | null;
  readonly created_at: string;
  readonly created_by_type: Actor['type'];
  readonly created_by_id: string | null;
  readonly updated_at: string;
  /** Every linked record, in link order, whatever its state or visibility. */
  readonly record_ids: string[];
}

const TASK_COLUMNS = sql`t.id::text as id, t.title, t.is_done, ${millis('t.done_at')} as done_at, t.done_by_type,
  t.done_by_id::text as done_by_id, t.due_on::text as due_on, t.assignee_member_id::text as assignee_member_id,
  ${millis('t.created_at')} as created_at, t.created_by_type, t.created_by_id::text as created_by_id,
  ${millis('t.updated_at')} as updated_at,
  coalesce((select array_agg(l.record_id::text order by l.position, l.record_id) from task_records l
    where l.workspace_id = t.workspace_id and l.task_id = t.id), '{}') as record_ids`;

/** The live tasks among `ids`, as stored (deleted ones left out), with their links. */
async function taskRows(tx: WorkspaceTx, ids: readonly string[], lock = false): Promise<readonly TaskRow[]> {
  if (ids.length === 0) return [];
  const result = await tx.execute<TaskRow>(sql`
    select ${TASK_COLUMNS} from tasks t
    where t.id = any(${uuidList(ids)}) and t.deleted_at is null
    ${lock ? sql`for update of t` : sql``}
  `);
  return result.rows;
}

/** The linked records the reader may see, live (not in the trash, not on an archived object), with their displays, by id. */
async function linkedDisplays(
  tx: WorkspaceTx,
  access: Access,
  recordIds: readonly string[],
): Promise<ReadonlyMap<string, RecordRefDisplay>> {
  const unique = [...new Set(recordIds)];
  if (unique.length === 0) return new Map();
  // Live records only, and hidden is absent: a record on an object at none, or outside a record rule, is left out.
  const views = await readRecords(tx, access, unique, { attributeIds: [] });
  if (views.length === 0) return new Map();
  // A record on an archived object is no more live than one in the trash (the task rule's "live").
  const objectIds = [...new Set(views.map((view) => view.display.objectId))];
  const archived = await tx.execute<{ id: string }>(
    sql`select id::text as id from objects where id = any(${uuidList(objectIds)}) and archived_at is not null`,
  );
  const gone = new Set(archived.rows.map((row) => row.id));
  return new Map(views.filter((view) => !gone.has(view.display.objectId)).map((view) => [view.id, view.display]));
}

/** Whether the actor made the task. */
const isCreator = (row: Pick<TaskRow, 'created_by_type' | 'created_by_id'>, actor: Actor) =>
  row.created_by_type === actor.type && row.created_by_id !== null && row.created_by_id === actor.id;

/**
 * The task rule (spec 0009's Decision, AC-447): visible when it links no
 * records at all, the reader is its assignee or creator, or one of its links
 * is to a live record the reader may see.
 */
export function taskVisible(
  row: Pick<TaskRow, 'assignee_member_id' | 'created_by_type' | 'created_by_id' | 'record_ids'>,
  scope: Pick<EngineScope, 'access' | 'actor'>,
  seen: ReadonlyMap<string, RecordRefDisplay>,
): boolean {
  const me = memberOf(scope.access);
  if (row.record_ids.length === 0) return true;
  if (me !== undefined && row.assignee_member_id === me) return true;
  if (isCreator(row, scope.actor)) return true;
  return row.record_ids.some((id) => seen.has(id));
}

/**
 * The change rule (AC-447): its assignee, its creator, anyone when it links
 * no records at all, and anyone with `write` on the object of a live linked
 * record they may see.
 */
export function taskChangeable(
  row: Pick<TaskRow, 'assignee_member_id' | 'created_by_type' | 'created_by_id' | 'record_ids'>,
  scope: Pick<EngineScope, 'access' | 'actor'>,
  seen: ReadonlyMap<string, RecordRefDisplay>,
): boolean {
  const me = memberOf(scope.access);
  if (row.record_ids.length === 0) return true;
  if (me !== undefined && row.assignee_member_id === me) return true;
  if (isCreator(row, scope.actor)) return true;
  return row.record_ids.some((id) => {
    const display = seen.get(id);
    return display !== undefined && objectLevel(scope.access, display.objectId) === 'write';
  });
}

/** A stored actor as the view carries it. */
const actorOf = (type: Actor['type'], id: string | null): Actor => ({ type, id });

/** A task as the reader sees it: only its live, visible linked records, in link order. */
function viewOf(
  row: TaskRow,
  scope: Pick<EngineScope, 'access' | 'actor'>,
  seen: ReadonlyMap<string, RecordRefDisplay>,
): TaskView {
  const records = row.record_ids.flatMap((id) => {
    const display = seen.get(id);
    return display === undefined ? [] : [display];
  });
  return {
    id: row.id,
    title: row.title,
    isDone: row.is_done,
    ...(row.done_at === null || row.done_by_type === null
      ? {}
      : { doneAt: row.done_at, doneBy: actorOf(row.done_by_type, row.done_by_id) }),
    ...(row.due_on === null ? {} : { dueOn: row.due_on }),
    ...(row.assignee_member_id === null ? {} : { assigneeMemberId: row.assignee_member_id }),
    records,
    recordCount: records.length,
    canChange: taskChangeable(row, scope, seen),
    createdAt: row.created_at,
    createdBy: actorOf(row.created_by_type, row.created_by_id),
    updatedAt: row.updated_at,
  };
}

/**
 * The tasks among `ids` the reader may see, live, as views, in the order of
 * `ids`. `evenHidden` keeps a task the writer just changed out of their own
 * sight (an unlink of the only link they could see): they get its view once,
 * and its event then takes it off their screens.
 */
async function readTaskViews(
  tx: WorkspaceTx,
  scope: Pick<EngineScope, 'access' | 'actor'>,
  ids: readonly string[],
  evenHidden = false,
): Promise<readonly TaskView[]> {
  const rows = await taskRows(tx, ids);
  const seen = await linkedDisplays(
    tx,
    scope.access,
    rows.flatMap((row) => row.record_ids),
  );
  const byId = new Map(rows.map((row) => [row.id, row]));
  return ids.flatMap((id) => {
    const row = byId.get(id);
    if (row === undefined || (!evenHidden && !taskVisible(row, scope, seen))) return [];
    return [viewOf(row, scope, seen)];
  });
}

/** A title trimmed at its ends, refused on `title` when empty or over 2,000 characters. */
function checkTitle(title: string): string {
  const trimmed = title.trim();
  if (trimmed.length === 0) throw inputInvalid('title', 'Give the task a title.');
  // NUL can't be stored: refused as input (400), never a database error (500).
  if (trimmed.includes('\u0000')) throw inputInvalid('title', 'This text holds a character that can’t be stored.');
  if (trimmed.length > TASK_TITLE_MAX) {
    throw inputInvalid('title', `A task title holds at most ${TASK_TITLE_MAX.toLocaleString('en')} characters.`);
  }
  return trimmed;
}

/** A due date as `YYYY-MM-DD`, refused on `dueOn` otherwise. */
function checkDueOn(dueOn: string): string {
  const parsed = DateValue.safeParse(dueOn);
  if (!parsed.success) throw inputInvalid('dueOn', 'Give a real date, such as 2026-10-08.');
  return parsed.data;
}

/** Record ids, canonical and each once; a malformed one names no record. */
function checkRecordIds(ids: readonly string[] | undefined): readonly string[] {
  if (ids === undefined) return [];
  const canonical = ids.map((id) => checkId(id, UNKNOWN_RECORD));
  return [...new Set(canonical)];
}

/** Refuses `NOT_FOUND` unless `memberId` is an active member of the workspace. */
async function checkAssignee(context: WriteContext, memberId: string): Promise<string> {
  const id = checkId(memberId, UNKNOWN_MEMBER);
  if (context.activeMembers.has(id)) return id;
  const rows = await context.tx.execute<{ id: string }>(
    sql`select id::text as id from members where id = ${id}::uuid and status = 'active'`,
  );
  if (rows.rows.length === 0) throw refuse('NOT_FOUND', UNKNOWN_MEMBER);
  context.activeMembers.add(id);
  return id;
}

/**
 * Checks records a write links (AC-447): each live, on a live object, visible
 * to the writer, else `NOT_FOUND`; each on an object the writer may change,
 * else `FORBIDDEN`. Locks each `for key share`, which blocks only its purge
 * (a trash goes ahead, and the read rules then hide the link), never an edit.
 */
async function checkLinkable(context: WriteContext, recordIds: readonly string[]): Promise<void> {
  if (recordIds.length === 0) return;
  const { tx, scope } = context;
  const rows = await tx.execute<{ id: string; object_id: string }>(sql`
    select r.id::text as id, r.object_id::text as object_id
    from records r join objects o on o.workspace_id = r.workspace_id and o.id = r.object_id
    where r.id = any(${uuidList(recordIds)}) and r.deleted_at is null and o.archived_at is null
    order by r.id
    for key share of r
  `);
  if (rows.rows.length < recordIds.length) throw refuse('NOT_FOUND', UNKNOWN_RECORD);
  if (isOpen(scope.access)) return;
  const seen = await visibleRecords(
    tx,
    scope.access,
    rows.rows.map((row) => ({ objectId: row.object_id, recordId: row.id })),
  );
  if (seen.size < rows.rows.length) throw refuse('NOT_FOUND', UNKNOWN_RECORD);
  if (rows.rows.some((row) => objectLevel(scope.access, row.object_id) !== 'write')) {
    throw refuse('FORBIDDEN', LINK_FORBIDDEN);
  }
}

/** The task with this id as its earlier try made it, or why not: `ID_TAKEN` for anyone else's. */
async function replayOf(tx: WorkspaceTx, scope: EngineScope, id: string): Promise<'replay' | undefined> {
  const rows = await tx.execute<{ created_by_type: Actor['type']; created_by_id: string | null; deleted: boolean }>(
    sql`select created_by_type, created_by_id::text as created_by_id, deleted_at is not null as deleted
      from tasks where id = ${id}::uuid`,
  );
  const [row] = rows.rows;
  if (row === undefined) return undefined;
  if (!isCreator(row, scope.actor) || row.deleted) throw refuse('ID_TAKEN', 'A task with that id already exists.');
  return 'replay';
}

/**
 * Creates a task (AC-432, AC-449): the title trimmed, an optional due date
 * and assignee (an active member), and 0 to 20 linked records, each live,
 * visible and on an object the writer may change, in input order. The same
 * call again (a lost answer) returns the same task and writes nothing; an id
 * used by anyone else's task is `ID_TAKEN`. One `tasks` outbox row.
 */
export async function createTask(
  scope: EngineScope,
  input: CreateTaskInput,
  hooks: readonly AfterWrite[] = [],
): Promise<TaskView> {
  checkScope(scope);
  if (!principalReaches(scope.access, 'write')) throw refuse('FORBIDDEN', NOT_FOR_KEYS);
  if (!isUuidV7(input.id)) throw inputInvalid('id', 'The task id must be a UUID v7.');
  const id = canonicalId(input.id);
  const title = checkTitle(input.title);
  const dueOn = input.dueOn === undefined ? undefined : checkDueOn(input.dueOn);
  const recordIds = checkRecordIds(input.recordIds);
  if (recordIds.length > TASK_RECORDS_MAX) throw refuse('LIMIT_REACHED', LINKS_FULL);
  const { result } = await runWrite(
    scope,
    async (context) => {
      const { tx } = context;
      if ((await replayOf(tx, scope, id)) === 'replay') return readTaskViews(tx, scope, [id], true);
      const assignee =
        input.assigneeMemberId === undefined ? undefined : await checkAssignee(context, input.assigneeMemberId);
      await checkLinkable(context, recordIds);
      const actor = scope.actor;
      const memberId = actor.type === 'member' ? actor.id : null;
      const inserted = await tx.execute(sql`
        insert into tasks (workspace_id, id, title, due_on, assignee_member_id,
          created_by_type, created_by_id, created_by_member_id, updated_by_type, updated_by_id, updated_by_member_id)
        values (${scope.workspaceId}::uuid, ${id}::uuid, ${title}, ${dueOn ?? null}::date, ${assignee ?? null}::uuid,
          ${actor.type}, ${actor.id}::uuid, ${memberId}::uuid, ${actor.type}, ${actor.id}::uuid, ${memberId}::uuid)
        on conflict (workspace_id, id) do nothing
      `);
      // Another try of the same create landed first, in a transaction that committed meanwhile.
      if (inserted.rowCount === 0) {
        if ((await replayOf(tx, scope, id)) === 'replay') return readTaskViews(tx, scope, [id], true);
        throw refuse('ID_TAKEN', 'A task with that id already exists.');
      }
      if (recordIds.length > 0) {
        await tx.execute(sql`
          insert into task_records (workspace_id, task_id, record_id, position, created_by_type, created_by_id, created_by_member_id)
          select ${scope.workspaceId}::uuid, ${id}::uuid, x.id, (x.n - 1)::smallint, ${actor.type}, ${actor.id}::uuid, ${memberId}::uuid
          from unnest(${uuidList(recordIds)}) with ordinality as x(id, n)
        `);
      }
      context.record({ tasks: [{ taskId: id, recordIds }] });
      return readTaskViews(tx, scope, [id], true);
    },
    hooks,
  );
  const [view] = result;
  // The writer made it, so they can see it: anything else is a bug, not a refusal.
  if (view === undefined) throw new Error('A task just written could not be read back.');
  return view;
}

/** The current links of a locked task, with each record's object and whether it is live. */
interface LinkRow extends Record<string, unknown> {
  readonly record_id: string;
  readonly object_id: string;
  readonly live: boolean;
  readonly position: number;
}

/**
 * Changes one task (AC-433, AC-434): only the fields given, under the task's
 * row lock and the change rule. Ticking it done records who and when;
 * unticking clears both. Added links are checked like a create's; removed
 * links are only those the writer can see (others are ignored, so a hidden
 * link is never removed); the 20 cap counts every link, hidden ones too.
 * Nothing changed writes nothing and stores no outbox row.
 */
export async function updateTask(
  scope: EngineScope,
  input: UpdateTaskInput,
  hooks: readonly AfterWrite[] = [],
): Promise<TaskView> {
  checkScope(scope);
  if (!principalReaches(scope.access, 'read')) throw refuse('NOT_FOUND', UNKNOWN_TASK);
  if (!principalReaches(scope.access, 'write')) throw refuse('FORBIDDEN', NOT_FOR_KEYS);
  const taskId = checkId(input.taskId, UNKNOWN_TASK);
  const title = input.title === undefined ? undefined : checkTitle(input.title);
  const dueOn = input.dueOn === undefined || input.dueOn === null ? input.dueOn : checkDueOn(input.dueOn);
  const adding = checkRecordIds(input.addRecordIds);
  const removing = checkRecordIds(input.removeRecordIds);
  const { result } = await runWrite(
    scope,
    async (context) => {
      const { tx } = context;
      const [row] = await taskRows(tx, [taskId], true);
      if (row === undefined) throw refuse('NOT_FOUND', UNKNOWN_TASK);
      const seen = await linkedDisplays(tx, scope.access, row.record_ids);
      if (!taskVisible(row, scope, seen)) throw refuse('NOT_FOUND', UNKNOWN_TASK);
      if (!taskChangeable(row, scope, seen)) throw refuse('FORBIDDEN', TASK_READ_ONLY);

      const sets: SQL[] = [];
      if (title !== undefined && title !== row.title) sets.push(sql`title = ${title}`);
      if (dueOn !== undefined && dueOn !== row.due_on) sets.push(sql`due_on = ${dueOn}::date`);
      if (input.assigneeMemberId !== undefined) {
        const assignee = input.assigneeMemberId === null ? null : await checkAssignee(context, input.assigneeMemberId);
        if (assignee !== row.assignee_member_id) sets.push(sql`assignee_member_id = ${assignee}::uuid`);
      }
      const actor = scope.actor;
      const memberId = actor.type === 'member' ? actor.id : null;
      if (input.isDone !== undefined && input.isDone !== row.is_done) {
        sets.push(
          input.isDone
            ? sql`is_done = true, done_at = now(), done_by_type = ${actor.type}, done_by_id = ${actor.id}::uuid, done_by_member_id = ${memberId}::uuid`
            : sql`is_done = false, done_at = null, done_by_type = null, done_by_id = null, done_by_member_id = null`,
        );
      }

      // Links: removed only when the writer can see them; added only when not linked already.
      const current = new Set(row.record_ids);
      const removed = removing.filter((id) => current.has(id) && seen.has(id));
      // A link the writer can't see answers as an unknown record, as it would anywhere else: never "already linked".
      if (adding.some((id) => current.has(id) && !seen.has(id))) throw refuse('NOT_FOUND', UNKNOWN_RECORD);
      const added = adding.filter((id) => !current.has(id));
      if (current.size - removed.length + added.length > TASK_RECORDS_MAX) {
        throw refuse('LIMIT_REACHED', LINKS_FULL);
      }
      await checkLinkable(context, added);
      if (removed.length > 0) {
        await tx.execute(
          sql`delete from task_records where task_id = ${taskId}::uuid and record_id = any(${uuidList(removed)})`,
        );
      }
      if (added.length > 0) {
        const positions = await tx.execute<Pick<LinkRow, 'position'>>(
          sql`select coalesce(max(position), -1)::int as position from task_records where task_id = ${taskId}::uuid`,
        );
        let after = positions.rows[0]?.position ?? -1;
        // Each add appends past the highest place; past POSITION_RENUMBER (links removed and added for years),
        // the links close up to 0..n-1 in their order first, under the task's lock, so a smallint never overflows.
        if (after + added.length > POSITION_RENUMBER) {
          const renumbered = await tx.execute<{ n: number }>(sql`
            update task_records l set position = (o.n - 1)::smallint
            from (
              select record_id, row_number() over (order by position, record_id) as n
              from task_records where task_id = ${taskId}::uuid
            ) o
            where l.task_id = ${taskId}::uuid and l.record_id = o.record_id
            returning o.n::int as n
          `);
          after = renumbered.rows.length - 1;
        }
        await tx.execute(sql`
          insert into task_records (workspace_id, task_id, record_id, position, created_by_type, created_by_id, created_by_member_id)
          select ${scope.workspaceId}::uuid, ${taskId}::uuid, x.id, (${after} + x.n)::smallint, ${actor.type}, ${actor.id}::uuid, ${memberId}::uuid
          from unnest(${uuidList(added)}) with ordinality as x(id, n)
        `);
      }
      if (sets.length === 0 && removed.length === 0 && added.length === 0) {
        return readTaskViews(tx, scope, [taskId], true);
      }
      await tx.execute(sql`
        update tasks set ${sql.join([...sets, sql`updated_at = now(), updated_by_type = ${actor.type}, updated_by_id = ${actor.id}::uuid, updated_by_member_id = ${memberId}::uuid`], sql`, `)}
        where id = ${taskId}::uuid
      `);
      const linked = [...new Set([...row.record_ids, ...added])];
      context.record({ tasks: [{ taskId, recordIds: linked }] });
      return readTaskViews(tx, scope, [taskId], true);
    },
    hooks,
  );
  const [view] = result;
  // The writer saw it and changed it, so it reads back.
  if (view === undefined) throw new Error('A task just written could not be read back.');
  return view;
}

/** A task's row for delete and restore: live or deleted, locked. */
async function anyTaskRow(
  tx: WorkspaceTx,
  taskId: string,
): Promise<(TaskRow & { readonly deleted: boolean }) | undefined> {
  const result = await tx.execute<TaskRow & { deleted: boolean }>(sql`
    select ${TASK_COLUMNS}, t.deleted_at is not null as deleted from tasks t
    where t.id = ${taskId}::uuid
    for update of t
  `);
  return result.rows[0];
}

/**
 * Deletes a task (AC-445): hidden from every read at once, kept for 30 days
 * for Undo and restore, then removed by the daily cleanup (with its links).
 * Under the change rule (AC-447). One `tasks` outbox row naming its records.
 */
export async function deleteTask(
  scope: EngineScope,
  input: { readonly taskId: string },
  hooks: readonly AfterWrite[] = [],
): Promise<void> {
  checkScope(scope);
  if (!principalReaches(scope.access, 'read')) throw refuse('NOT_FOUND', UNKNOWN_TASK);
  if (!principalReaches(scope.access, 'write')) throw refuse('FORBIDDEN', NOT_FOR_KEYS);
  const taskId = checkId(input.taskId, UNKNOWN_TASK);
  await runWrite(
    scope,
    async (context) => {
      const { tx } = context;
      const row = await anyTaskRow(tx, taskId);
      if (row === undefined || row.deleted) throw refuse('NOT_FOUND', UNKNOWN_TASK);
      const seen = await linkedDisplays(tx, scope.access, row.record_ids);
      if (!taskVisible(row, scope, seen)) throw refuse('NOT_FOUND', UNKNOWN_TASK);
      if (!taskChangeable(row, scope, seen)) throw refuse('FORBIDDEN', TASK_READ_ONLY);
      const { actor } = scope;
      const memberId = actor.type === 'member' ? actor.id : null;
      await tx.execute(sql`
        update tasks set deleted_at = now(), deleted_by_type = ${actor.type}, deleted_by_id = ${actor.id}::uuid,
          deleted_by_member_id = ${memberId}::uuid
        where id = ${taskId}::uuid
      `);
      context.record({ tasks: [{ taskId, recordIds: row.record_ids }] });
    },
    hooks,
  );
}

/**
 * Brings a deleted task back exactly as it was (AC-445), its links with it;
 * `NOT_FOUND` once the cleanup removed it. Under the change rule. A task that
 * isn't deleted comes back as it is, with nothing written.
 */
export async function restoreTask(
  scope: EngineScope,
  input: { readonly taskId: string },
  hooks: readonly AfterWrite[] = [],
): Promise<TaskView> {
  checkScope(scope);
  if (!principalReaches(scope.access, 'read')) throw refuse('NOT_FOUND', UNKNOWN_TASK);
  if (!principalReaches(scope.access, 'write')) throw refuse('FORBIDDEN', NOT_FOR_KEYS);
  const taskId = checkId(input.taskId, UNKNOWN_TASK);
  const { result } = await runWrite(
    scope,
    async (context) => {
      const { tx } = context;
      const row = await anyTaskRow(tx, taskId);
      if (row === undefined) throw refuse('NOT_FOUND', UNKNOWN_TASK);
      const seen = await linkedDisplays(tx, scope.access, row.record_ids);
      if (!taskVisible(row, scope, seen)) throw refuse('NOT_FOUND', UNKNOWN_TASK);
      if (!taskChangeable(row, scope, seen)) throw refuse('FORBIDDEN', TASK_READ_ONLY);
      if (row.deleted) {
        await tx.execute(sql`
          update tasks set deleted_at = null, deleted_by_type = null, deleted_by_id = null, deleted_by_member_id = null
          where id = ${taskId}::uuid
        `);
        context.record({ tasks: [{ taskId, recordIds: row.record_ids }] });
      }
      return readTaskViews(tx, scope, [taskId], true);
    },
    hooks,
  );
  const [view] = result;
  if (view === undefined) throw new Error('A task just restored could not be read back.');
  return view;
}

/**
 * Tasks by id (`tasks.get`, what a `tasks` event's ids are read back
 * through): up to 100, in the order asked, each live and visible to the
 * reader; the rest are left out, the same for missing, deleted and hidden.
 */
export async function getTasks(scope: EngineScope, input: { readonly ids: readonly string[] }): Promise<TaskView[]> {
  checkScope(scope);
  if (input.ids.length > TASK_GET_MAX) {
    throw refuse('CONFIG_INVALID', `Read at most ${String(TASK_GET_MAX)} tasks at once.`);
  }
  const ids = [...new Set(input.ids.filter(isUuid).map(canonicalId))];
  if (ids.length === 0 || !principalReaches(scope.access, 'read')) return [];
  return inWorkspace(scope, async (tx) => [...(await readTaskViews(tx, scope, ids))]);
}

/** Encodes where a page ended as the opaque cursor: base64url JSON. */
function encodeTaskCursor(cursor: TaskCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

/** Decodes a cursor of `status`, refusing anything that isn't one of ours (400 `INPUT_INVALID` on `cursor`). */
function decodeTaskCursor(cursor: string, status: TaskStatus): TaskCursor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw inputInvalid('cursor', TASK_CURSOR_MESSAGE);
  }
  const bound = TaskCursor.safeParse(parsed);
  if (!bound.success || bound.data.status !== status) throw inputInvalid('cursor', TASK_CURSOR_MESSAGE);
  // Moments the server wrote: fixed width UTC with microseconds, so a forged one never reaches a cast.
  const moment = bound.data.status === 'open' ? bound.data.createdAt : bound.data.doneAt;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(moment)) throw inputInvalid('cursor', TASK_CURSOR_MESSAGE);
  // A real moment from year 1 on (Postgres has no year 0, and refuses month 13 or the 32nd): it round trips.
  const stamp = Date.parse(moment);
  const badDay = bound.data.status === 'open' && bound.data.dueOn?.startsWith('0000') === true;
  if (
    badDay ||
    Number.isNaN(stamp) ||
    new Date(stamp).toISOString().slice(0, 19) !== moment.slice(0, 19) ||
    moment.startsWith('0000')
  ) {
    throw inputInvalid('cursor', TASK_CURSOR_MESSAGE);
  }
  return bound.data;
}

/** A page's row: the task's id and its sort values for the cursor. */
interface PageRow extends Record<string, unknown> {
  readonly id: string;
  readonly due_on: string | null;
  readonly created_at: string;
  readonly done_at: string | null;
}

/**
 * Refuses `NOT_FOUND` "That record does not exist." unless the record is
 * live, on a live object the reader may see, and inside their record rule:
 * a hidden or trashed record's tasks are absent.
 */
async function checkListedRecord(tx: WorkspaceTx, access: Access, recordId: string): Promise<void> {
  const rows = await tx.execute<{ object_id: string }>(sql`
    select r.object_id::text as object_id
    from records r join objects o on o.workspace_id = r.workspace_id and o.id = r.object_id
    where r.id = ${recordId}::uuid and r.deleted_at is null and o.archived_at is null
  `);
  const [row] = rows.rows;
  if (row === undefined) throw refuse('NOT_FOUND', UNKNOWN_RECORD);
  if (isOpen(access)) return;
  const seen = await visibleRecords(tx, access, [{ objectId: row.object_id, recordId }]);
  if (!seen.has(recordId)) throw refuse('NOT_FOUND', UNKNOWN_RECORD);
}

/**
 * The task rule as SQL over the task aliased `t` (spec 0019's visibility
 * predicate, AC-447), for lists that don't start from one visible record (My
 * tasks' "All tasks"): it links no records at all (a link to a trashed record
 * still counts), the reader is its assignee or creator, or one of its links
 * is to a live record, on a live object, that the reader may see.
 */
function taskVisibleSql(scope: Pick<EngineScope, 'access' | 'actor'>): SQL {
  const me = memberOf(scope.access);
  const { actor } = scope;
  const narrowed = recordVisibleSql(scope.access, 'r');
  // Scalar subqueries, not EXISTS: Postgres turns an EXISTS under an OR into a hash of every link in the
  // workspace (a second at 100,000 tasks); a scalar one runs per row, and a page stops after 50 rows. Each link
  // finds its record by its key.
  const linkedLive = sql`coalesce((select true from task_records l
    where l.workspace_id = t.workspace_id and l.task_id = t.id
      and coalesce((select r.deleted_at is null and o.archived_at is null
        ${narrowed === undefined ? sql`` : sql`and ${narrowed}`}
        from records r join objects o on o.workspace_id = r.workspace_id and o.id = r.object_id
        where r.workspace_id = l.workspace_id and r.id = l.record_id), false)
    limit 1), false)`;
  const parts = [
    ...(me === undefined ? [] : [sql`t.assignee_member_id = ${me}::uuid`]),
    actor.id === null ? sql`false` : sql`(t.created_by_type = ${actor.type} and t.created_by_id = ${actor.id}::uuid)`,
    linkedLive,
    sql`(select count(*) from task_records l where l.workspace_id = t.workspace_id and l.task_id = t.id) = 0`,
  ];
  return sql`(${sql.join(parts, sql` or `)})`;
}

/**
 * Where a list's rows come from, `from` to the end of its `where`: a record's
 * links joined to their tasks, or My tasks' filter on its own index
 * (`tasks_assigned_*`, `tasks_created_*`, `tasks_all_*`; the status written
 * as the indexes' own predicate, so the planner proves them). Undefined when
 * the reader can't match anything (a principal that isn't a member has no
 * tasks assigned to or created by them as a member).
 */
function listFrom(scope: EngineScope, input: ListTasksInput, recordId: string | undefined): SQL | undefined {
  const done = sql.raw(input.status === 'done' ? 't.is_done' : 'not t.is_done');
  if (recordId !== undefined) {
    return sql`from task_records l join tasks t on t.workspace_id = l.workspace_id and t.id = l.task_id
      where l.record_id = ${recordId}::uuid and t.deleted_at is null and ${done}`;
  }
  const mine = 'mine' in input.scope ? input.scope.mine : 'all';
  const me = memberOf(scope.access);
  if (mine === 'assigned') {
    return me === undefined
      ? undefined
      : sql`from tasks t where t.assignee_member_id = ${me}::uuid and t.deleted_at is null and ${done}`;
  }
  if (mine === 'created') {
    return me === undefined
      ? undefined
      : sql`from tasks t where t.created_by_member_id = ${me}::uuid and t.deleted_at is null and ${done}`;
  }
  return sql`from tasks t where t.deleted_at is null and ${done} and ${taskVisibleSql(scope)}`;
}

/**
 * One page of a task list: a record's tasks (AC-435), through
 * `task_records_by_record` joined to `tasks`, or My tasks' (AC-436): those
 * assigned to me, created by me, or every task I may see (the task rule as
 * SQL), each on its own partial index. Open ones by due date (earliest first,
 * no date last, then oldest first, then id), or done ones newest done first
 * (then id). A record's list needs no task rule: the record is visible, so
 * every task linked to it is. `total` (counted up to 10,001) only on a
 * record's first page (its tab's count); My tasks shows none, so reads none. A hidden or trashed record is `NOT_FOUND`; a cursor the server
 * didn't make is 400 `INPUT_INVALID` on `cursor`.
 */
export async function listTasks(scope: EngineScope, input: ListTasksInput): Promise<TaskPage> {
  checkScope(scope);
  const limit = input.limit ?? TASK_PAGE;
  if (!Number.isInteger(limit) || limit < 1 || limit > TASK_PAGE_MAX) {
    throw inputInvalid('limit', `Ask for 1 to ${String(TASK_PAGE_MAX)} tasks.`);
  }
  const status = input.status;
  const after = input.cursor === undefined ? undefined : decodeTaskCursor(input.cursor, status);
  const recordId = 'recordId' in input.scope ? checkId(input.scope.recordId, UNKNOWN_RECORD) : undefined;
  if (recordId === undefined && !('mine' in input.scope && ['assigned', 'created', 'all'].includes(input.scope.mine))) {
    throw inputInvalid('scope', 'Name a record, or which of your tasks to list.');
  }
  if (!principalReaches(scope.access, 'read')) {
    if (recordId !== undefined) throw refuse('NOT_FOUND', UNKNOWN_RECORD);
    return { items: [] };
  }
  return inWorkspace(scope, async (tx) => {
    if (recordId !== undefined) await checkListedRecord(tx, scope.access, recordId);
    const from = listFrom(scope, input, recordId);
    if (from === undefined) return { items: [] };
    let bound = sql``;
    if (after?.status === 'open') {
      const tail = sql`(t.created_at, t.id) > (${after.createdAt}::timestamptz, ${after.id}::uuid)`;
      bound =
        after.dueOn === null
          ? sql` and t.due_on is null and ${tail}`
          : sql` and (t.due_on > ${after.dueOn}::date or t.due_on is null or (t.due_on = ${after.dueOn}::date and ${tail}))`;
    } else if (after?.status === 'done') {
      bound = sql` and (t.done_at < ${after.doneAt}::timestamptz or (t.done_at = ${after.doneAt}::timestamptz and t.id > ${after.id}::uuid))`;
    }
    const order =
      status === 'open'
        ? sql`order by t.due_on asc nulls last, t.created_at, t.id`
        : sql`order by t.done_at desc nulls last, t.id`;
    const page = await tx.execute<PageRow>(sql`
      select t.id::text as id, t.due_on::text as due_on, ${micros('t.created_at')} as created_at,
        ${micros('t.done_at')} as done_at
      ${from}${bound}
      ${order}
      limit ${limit + 1}
    `);
    const rows = page.rows.slice(0, limit);
    const items = await readTaskViews(
      tx,
      scope,
      rows.map((row) => row.id),
    );
    const last = rows.at(-1);
    const more = page.rows.length > limit && last !== undefined;
    const nextCursor = !more
      ? undefined
      : encodeTaskCursor(
          status === 'open'
            ? { status, dueOn: last.due_on, createdAt: last.created_at, id: last.id }
            : { status, doneAt: last.done_at ?? '', id: last.id },
        );
    // Only a record's list is counted (its tab's label); My tasks shows no count, so it reads none.
    if (after !== undefined || recordId === undefined) {
      return { items: [...items], ...(nextCursor === undefined ? {} : { nextCursor }) };
    }
    const counted = await tx.execute<{ n: number }>(
      sql`select count(*)::int as n from (select 1 ${from} limit ${TASK_COUNT_CAP + 1}) c`,
    );
    const n = counted.rows[0]?.n ?? 0;
    return {
      items: [...items],
      ...(nextCursor === undefined ? {} : { nextCursor }),
      total: { count: Math.min(n, TASK_COUNT_CAP), atLeast: n > TASK_COUNT_CAP },
    };
  });
}

/**
 * The sidebar's Tasks badge (spec 0034, AC-924): how many open, live tasks
 * are assigned to me and due on or before `today` (my local date, which the
 * browser sends), on `tasks_assigned_open` and counted up to `TASK_DUE_CAP`.
 * A task assigned to me is always mine to see (the task rule), so no rule
 * runs. An API key has no tasks of its own: none. A `today` that isn't a date
 * is 400 `INPUT_INVALID` on `today`.
 */
export async function countDueTasks(scope: EngineScope, input: { readonly today: string }): Promise<TaskTotal> {
  checkScope(scope);
  if (!DateValue.safeParse(input.today).success) throw inputInvalid('today', 'Send today as a date.');
  const me = memberOf(scope.access);
  if (me === undefined || !principalReaches(scope.access, 'read')) return { count: 0, atLeast: false };
  return inWorkspace(scope, async (tx) => {
    const counted = await tx.execute<{ n: number }>(sql`
      select count(*)::int as n from (
        select 1 from tasks t
        where t.workspace_id = ${scope.workspaceId}::uuid and t.assignee_member_id = ${me}::uuid
          and t.deleted_at is null and not t.is_done and t.due_on <= ${input.today}::date
        limit ${TASK_DUE_CAP + 1}
      ) c`);
    const n = counted.rows[0]?.n ?? 0;
    return { count: Math.min(n, TASK_DUE_CAP), atLeast: n > TASK_DUE_CAP };
  });
}
