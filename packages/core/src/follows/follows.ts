// Following a record (scope: collaboration, "changes to records you follow reach your inbox live"). A member follows
// a record they created, one whose member field (its owner) names them, or one a task of theirs links; they can
// follow or unfollow any record they may read. `runWrite` calls `followUp` after every write's work, people's, keys',
// automations' and jobs' alike, inside the transaction, so no write path is missed:
// - the follows a write implies are made (`on conflict do nothing`, so an unfollow stands until the next one), and
// - each follower of a record the write changed (its values, a new note or comment, a task done) who isn't the actor
//   gets one `record_activity` notification for it, merged into their unread one from the same actor while it is
//   less than `FOLLOW_BURST_MINUTES` old, so a burst of edits is one notice ("Ada changed 3 fields on Acme"). The
//   notice names attributes by id and counts, never a value; the inbox shows only the fields the reader may see,
//   and only while they may read the record. The system's own writes (recomputes, the cleanup) tell nobody.
// A member's `follow_notices` switch turns the notices off; the follows stay.
import { sql } from 'drizzle-orm';
import type { WorkspaceTx } from '@crm/db';
import { checkScope } from '../access/mint.ts';
import { inWorkspace } from '../access/run.ts';
import { checkId, uuidList } from '../engine/ids.ts';
import { readRecords } from '../engine/records.ts';
import { refuse } from '../engine/refusals.ts';
import type { EngineScope } from '../engine/scope.ts';
import { runWrite, type AfterWrite, type RecordRef, type ValueChange, type WriteContext } from '../engine/write.ts';

/** Something a write did on a record besides its values, which its followers hear of. */
export interface RecordActivity {
  readonly recordId: string;
  readonly kind: 'note' | 'comment' | 'task_done';
}

/** What the follow step reads of a write. */
export interface FollowedChange {
  readonly createdRecords: readonly RecordRef[];
  readonly values: readonly ValueChange[];
  readonly activity: readonly RecordActivity[];
}

/** A notice merges the same actor's later changes while it is unread and younger than this. */
export const FOLLOW_BURST_MINUTES = 10;

/**
 * A write touching more records than this tells no follower: a bulk change by hand (one notice per record would
 * flood). A job's batch (a bulk edit, an import, sample data) tells nobody however small.
 */
export const FOLLOW_NOTICE_RECORDS_MAX = 50;

/** What one record's notice adds: the attributes changed, and how many notes, comments and tasks done. */
export interface ActivitySummary {
  readonly recordId: string;
  readonly fields: readonly string[];
  readonly notes: number;
  readonly comments: number;
  readonly tasks: number;
}

/**
 * Each record's activity in a write, in first touched order: its changed attributes (a record the write created
 * counts none, since its first values are its making, not a change) and its notes, comments and tasks done. Pure.
 */
export function summarizeActivity(change: FollowedChange): readonly ActivitySummary[] {
  const created = new Set(change.createdRecords.map((record) => record.recordId));
  const byRecord = new Map<string, { readonly fields: Set<string>; notes: number; comments: number; tasks: number }>();
  const of = (recordId: string) => {
    const found = byRecord.get(recordId);
    if (found !== undefined) return found;
    const made = { fields: new Set<string>(), notes: 0, comments: 0, tasks: 0 };
    byRecord.set(recordId, made);
    return made;
  };
  for (const value of change.values) {
    if (value.ownerKind !== 'record' || created.has(value.ownerId)) continue;
    of(value.ownerId).fields.add(value.attributeId);
  }
  for (const item of change.activity) {
    const summary = of(item.recordId);
    if (item.kind === 'note') summary.notes += 1;
    else if (item.kind === 'comment') summary.comments += 1;
    else summary.tasks += 1;
  }
  return [...byRecord].map(([recordId, each]) => ({
    recordId,
    fields: [...each.fields],
    notes: each.notes,
    comments: each.comments,
    tasks: each.tasks,
  }));
}

/** Makes the follows of `memberIds` on `recordIds` (active members only); one that exists stays as it is. */
async function follow(tx: WorkspaceTx, workspaceId: string, pairs: readonly (readonly [string, string])[]) {
  if (pairs.length === 0) return;
  await tx.execute(sql`
    insert into record_follows (workspace_id, record_id, member_id)
    select ${workspaceId}::uuid, x.record_id, x.member_id
    from unnest(${uuidList(pairs.map(([recordId]) => recordId))}, ${uuidList(pairs.map(([, memberId]) => memberId))})
      as x(record_id, member_id)
    join members m on m.workspace_id = ${workspaceId}::uuid and m.id = x.member_id and m.status = 'active'
    on conflict do nothing
  `);
}

/** The follows a write implies: its records' makers, and the members its member fields now name. */
async function autoFollow(context: WriteContext, change: FollowedChange): Promise<void> {
  const { tx, scope } = context;
  const { actor } = scope;
  const pairs: (readonly [string, string])[] = [];
  if (actor.type === 'member' && actor.id !== null) {
    for (const record of change.createdRecords) pairs.push([record.recordId, actor.id]);
  }
  // Member fields this write set (an owner made or changed): the members they name now follow the record. The
  // system's writes (recomputes of computed values, which never name an owner) skip the read.
  const set = actor.type === 'system' ? [] : change.values.filter((value) => value.ownerKind === 'record');
  if (set.length > 0) {
    const named = await tx.execute<{ record_id: string; member_id: string }>(sql`
      select distinct v.owner_id::text as record_id, v.actor_member_id::text as member_id
      from unnest(${uuidList(set.map((value) => value.ownerId))}, ${uuidList(set.map((value) => value.attributeId))})
        as x(owner_id, attribute_id)
      join attributes a on a.id = x.attribute_id and a.type = 'actor_reference' and not a.is_system
        and a.computed is null
      join "values" v on v.workspace_id = ${scope.workspaceId}::uuid and v.owner_id = x.owner_id
        and v.attribute_id = x.attribute_id and v.active_until is null and not v.is_cleared
        and v.record_id is not null and v.actor_member_id is not null
    `);
    for (const row of named.rows) pairs.push([row.record_id, row.member_id]);
  }
  await follow(tx, scope.workspaceId, pairs);
}

/**
 * Tells each follower of the records `summaries` names, but the actor and anyone `skip` names (the write told them
 * already, a mention), in one statement; answers who heard. A merge adds to the counts and leaves the notice's
 * time and place as they were, so a change the follower may not see never moves it up or makes it read as new.
 */
async function tellFollowers(
  context: WriteContext,
  summaries: readonly ActivitySummary[],
  skip: readonly string[],
): Promise<string[]> {
  const { tx, scope } = context;
  const { actor } = scope;
  const memberId = actor.type === 'member' ? actor.id : null;
  const incoming = JSON.stringify(
    summaries.map((each) => ({
      record_id: each.recordId,
      fields: each.fields,
      notes: each.notes,
      comments: each.comments,
      tasks: each.tasks,
    })),
  );
  const told = await tx.execute<{ member_id: string }>(sql`
    with incoming as (
      select * from jsonb_to_recordset(${incoming}::jsonb)
        as x(record_id uuid, fields jsonb, notes int, comments int, tasks int)
    ),
    targets as (
      select f.member_id, i.record_id, i.fields, i.notes, i.comments, i.tasks
      from incoming i
      join record_follows f on f.workspace_id = ${scope.workspaceId}::uuid and f.record_id = i.record_id
      join members m on m.workspace_id = f.workspace_id and m.id = f.member_id and m.status = 'active'
      left join notification_settings s on s.workspace_id = f.workspace_id and s.member_id = f.member_id
      where coalesce(s.follow_notices, true) and f.member_id is distinct from ${memberId}::uuid
        and not (f.member_id = any(${uuidList(skip)}))
    ),
    merged as (
      update notifications n set
        activity = jsonb_build_object(
          'fields', (
            select coalesce(jsonb_agg(distinct e.value), '[]'::jsonb)
            from jsonb_array_elements(coalesce(n.activity -> 'fields', '[]'::jsonb) || t.fields) e
          ),
          'notes', coalesce((n.activity ->> 'notes')::int, 0) + t.notes,
          'comments', coalesce((n.activity ->> 'comments')::int, 0) + t.comments,
          'tasks', coalesce((n.activity ->> 'tasks')::int, 0) + t.tasks
        )
      from targets t
      where n.workspace_id = ${scope.workspaceId}::uuid and n.record_id = t.record_id and n.member_id = t.member_id
        and n.kind = 'record_activity' and n.read_at is null and n.done_at is null
        and n.actor_type = ${actor.type} and n.actor_id is not distinct from ${actor.id}::uuid
        and n.created_at > now() - make_interval(mins => ${FOLLOW_BURST_MINUTES})
      returning n.member_id, n.record_id
    ),
    made as (
      insert into notifications (workspace_id, member_id, kind, actor_type, actor_id, actor_member_id, record_id,
        activity, emailed_at)
      select ${scope.workspaceId}::uuid, t.member_id, 'record_activity', ${actor.type}, ${actor.id}::uuid,
        ${memberId}::uuid, t.record_id,
        jsonb_build_object('fields', t.fields, 'notes', t.notes, 'comments', t.comments, 'tasks', t.tasks), now()
      from targets t
      where not exists (select 1 from merged g where g.member_id = t.member_id and g.record_id = t.record_id)
      returning member_id
    )
    select distinct member_id::text as member_id from (
      select member_id from merged union all select member_id from made
    ) told
  `);
  return told.rows.map((row) => row.member_id);
}

/**
 * The follow step of every write (`runWrite`, after its work): the follows it implies, then its followers' notices,
 * whose inboxes hear of them through the write's `notifications` outbox row. Costs nothing for a write that made no
 * record, set no value and did nothing on a record.
 */
export async function followUp(
  context: WriteContext,
  change: FollowedChange & {
    /** Members the write notified already (a mention, a reply): its follow notice would say it twice. */
    readonly notifications: readonly string[];
  },
  options: { readonly jobId?: string } = {},
): Promise<void> {
  if (change.createdRecords.length === 0 && change.values.length === 0 && change.activity.length === 0) return;
  await autoFollow(context, change);
  if (context.scope.actor.type === 'system' || options.jobId !== undefined) return;
  const summaries = summarizeActivity(change).filter(
    (each) => each.fields.length > 0 || each.notes > 0 || each.comments > 0 || each.tasks > 0,
  );
  if (summaries.length === 0 || summaries.length > FOLLOW_NOTICE_RECORDS_MAX) return;
  // A merge into a notice already there is told only for the record's own counts; it never moves the notice.
  const told = await tellFollowers(context, summaries, [...new Set(change.notifications)]);
  if (told.length > 0) context.record({ notifications: told });
}

/** A task given to `memberId`: they follow each record it links (the task's assignment, AC-1165's write). */
export async function followTaskRecords(context: WriteContext, taskId: string, memberId: string): Promise<void> {
  await context.tx.execute(sql`
    insert into record_follows (workspace_id, record_id, member_id)
    select l.workspace_id, l.record_id, m.id
    from task_records l
    join members m on m.workspace_id = l.workspace_id and m.id = ${memberId}::uuid and m.status = 'active'
    where l.task_id = ${taskId}::uuid
    on conflict do nothing
  `);
}

/** What a record the caller can't read answers, the same as one that doesn't exist. */
export const UNKNOWN_FOLLOW_RECORD = 'That record does not exist.';

/** The caller as a member, or `NOT_FOUND`: only a member follows. */
function followerOf(scope: EngineScope): string {
  const { access, actor } = scope;
  if (access.principal.kind !== 'member' || actor.type !== 'member' || actor.id === null) {
    throw refuse('NOT_FOUND', UNKNOWN_FOLLOW_RECORD);
  }
  return actor.id;
}

/** Refuses `NOT_FOUND` unless the record is live, on a live object, and the caller may read it. */
async function readableRecord(tx: WorkspaceTx, scope: EngineScope, recordId: string): Promise<void> {
  const live = await tx.execute(sql`
    select 1 from records r
    join objects o on o.workspace_id = r.workspace_id and o.id = r.object_id and o.archived_at is null
    where r.id = ${recordId}::uuid and r.deleted_at is null
  `);
  // The door's own read: hidden (an object at none, outside a record rule) is absent.
  if (live.rows.length === 0 || (await readRecords(tx, scope.access, [recordId], { attributeIds: [] })).length === 0) {
    throw refuse('NOT_FOUND', UNKNOWN_FOLLOW_RECORD);
  }
}

/** Whether the caller follows a record. */
export interface FollowState {
  readonly following: boolean;
}

/** Whether the caller follows a live record they may read; `NOT_FOUND` for any other. */
export async function getFollow(scope: EngineScope, input: { readonly recordId: string }): Promise<FollowState> {
  checkScope(scope);
  const me = followerOf(scope);
  const recordId = checkId(input.recordId, UNKNOWN_FOLLOW_RECORD);
  return inWorkspace(scope, async (tx) => {
    await readableRecord(tx, scope, recordId);
    const found = await tx.execute(
      sql`select 1 from record_follows where record_id = ${recordId}::uuid and member_id = ${me}::uuid`,
    );
    return { following: found.rows.length > 0 };
  });
}

/**
 * Follows or unfollows a live record the caller may read (`NOT_FOUND` for any other). Doing what is already so
 * writes nothing. Only the caller's own row changes, and no event goes out: nobody else's screen shows it.
 */
export async function setFollow(
  scope: EngineScope,
  input: { readonly recordId: string; readonly following: boolean },
  hooks: readonly AfterWrite[] = [],
): Promise<FollowState> {
  checkScope(scope);
  const me = followerOf(scope);
  const recordId = checkId(input.recordId, UNKNOWN_FOLLOW_RECORD);
  const { result } = await runWrite(
    scope,
    async ({ tx }) => {
      await readableRecord(tx, scope, recordId);
      await tx.execute(
        input.following
          ? sql`
            insert into record_follows (workspace_id, record_id, member_id)
            values (${scope.workspaceId}::uuid, ${recordId}::uuid, ${me}::uuid)
            on conflict do nothing
          `
          : sql`delete from record_follows where record_id = ${recordId}::uuid and member_id = ${me}::uuid`,
      );
      return { following: input.following };
    },
    hooks,
  );
  return result;
}
