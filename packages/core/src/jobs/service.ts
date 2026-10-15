// Background jobs, as services (spec 0008): starting a job inside the
// caller's write (`startJob`: coalescing, once keys, a later start and a
// snapshot to confirm), reading one or a page of them, cancelling and
// confirming, and the test job. A job is visible to the member who
// started it and to holders of `jobs.manage` (owners and admins); anyone
// else, and any id that names nothing, gets the same NOT_FOUND (AC-114).
import { randomUUID } from 'node:crypto';
import { and, eq, sql, type SQL } from 'drizzle-orm';
import {
  isFinishedJob,
  jobLabel,
  JobResult,
  PERMISSIONS,
  type JobList,
  type JobsListInput,
  type JobView,
} from '@crm/contracts';
import { schema, type WorkspaceTx } from '@crm/db';
import { checkScope } from '../access/mint.ts';
import { can } from '../access/policy.ts';
import { inWorkspace } from '../access/run.ts';
import { checkId, isUuid } from '../engine/ids.ts';
import { limitsOf } from '../engine/limits.ts';
import { refuse } from '../engine/refusals.ts';
import type { EngineScope } from '../engine/scope.ts';
import { runWrite, type AfterWrite, type WriteContext } from '../engine/write.ts';
import type { AnyKind, JobRegistry } from './registry.ts';

const { jobs, workspaceCounters } = schema;

/** What NOT_FOUND says for a job: the same for one that doesn't exist and one the caller may not see. */
const JOB_NOT_FOUND = "That job doesn't exist, or you can't see it.";

/** Priority of a member's job and of the system's: people's work goes first. */
export const PRIORITY = { member: 0, system: 10 } as const;

/** How many item rows one insert carries. */
const ITEM_CHUNK = 5_000;

/** How long a finished job stays on the page (and in the table) before the daily cleanup deletes it. */
export const FINISHED_KEPT = '30 days';

/** A job row as the services read it. */
type JobRow = typeof jobs.$inferSelect;

/** Whether the scope's actor may manage every job in the workspace. */
const managesJobs = (scope: EngineScope): boolean => can(scope.access, 'jobs.manage');

/** The member id the scope acts as, or undefined for the system or a key. */
const memberOf = (scope: EngineScope): string | undefined =>
  scope.actor.type === 'member' && scope.actor.id !== null ? scope.actor.id : undefined;

/** Whether the scope may see (and so cancel and confirm) this job: its starter, or a holder of `jobs.manage`. */
function mayTouch(scope: EngineScope, row: Pick<JobRow, 'createdByType' | 'createdByMemberId'>): boolean {
  if (managesJobs(scope)) return true;
  const me = memberOf(scope);
  return me !== undefined && row.createdByType === 'member' && row.createdByMemberId === me;
}

const iso = (date: Date | null): string | undefined => (date === null ? undefined : date.toISOString());

/** A job row as the screens see it, for a caller allowed to see it. */
export function toJobView(row: JobRow, registry: JobRegistry): JobView {
  const status = row.status;
  const finished = isFinishedJob(status);
  const kind = registry.get(row.kind);
  const result = JobResult.safeParse(row.result);
  const retrying = !finished && row.attempts > 0;
  return {
    id: row.id,
    kind: row.kind,
    label: jobLabel(row.kind),
    status,
    ...(row.subjectType !== null && row.subjectId !== null
      ? { subject: { type: row.subjectType, id: row.subjectId } }
      : {}),
    ...(row.total === null ? {} : { total: row.total }),
    done: row.done,
    refused: row.refused,
    skipped: row.skipped,
    startedBy:
      row.createdByType === 'member' && row.createdByMemberId !== null
        ? { type: 'member', memberId: row.createdByMemberId }
        : { type: 'system' },
    createdAt: row.createdAt.toISOString(),
    ...(row.startedAt === null ? {} : { startedAt: row.startedAt.toISOString() }),
    ...(row.finishedAt === null ? {} : { finishedAt: row.finishedAt.toISOString() }),
    ...(retrying ? { retryAt: row.runAt.toISOString() } : {}),
    ...(status === 'ready' && row.expiresAt !== null ? { expiresAt: iso(row.expiresAt) } : {}),
    ...(row.errorCode === null ? {} : { error: { code: row.errorCode, message: row.errorMessage ?? '' } }),
    ...(row.result !== null && result.success ? { result: result.data } : {}),
    // A cancel already asked for (`cancelling`) can't be asked again.
    cancellable: kind?.cancellable === true && !finished && status !== 'cancelling',
  };
}

/** Reads one job under lock (or not), refusing NOT_FOUND for a bad id, a missing job and one the caller can't see. */
async function readJob(
  tx: WorkspaceTx,
  scope: EngineScope,
  jobId: string,
  lock: 'update' | undefined,
): Promise<JobRow> {
  const id = checkId(jobId, JOB_NOT_FOUND);
  const query = tx
    .select()
    .from(jobs)
    .where(and(eq(jobs.workspaceId, scope.workspaceId), eq(jobs.id, id)));
  const [row] = lock === undefined ? await query : await query.for(lock);
  if (row === undefined || !mayTouch(scope, row)) throw refuse('NOT_FOUND', JOB_NOT_FOUND);
  return row;
}

/** What starting a job takes (spec 0008, Starting a job). */
export interface StartJobInput {
  /** The job's id: the client's uuid v7 for a member job (the idempotent start key); minted when absent. */
  readonly id?: string;
  readonly kind: string;
  readonly params: unknown;
  /** What the job works on, so a feature can ask what runs on it. */
  readonly subject?: { readonly type: 'object' | 'attribute' | 'list'; readonly id: string };
  /** The ids an item job works through, in order (duplicates kept once). */
  readonly items?: readonly string[];
  /** Fill the items from the kind's snapshot in the background first (`preparing`, AC-109). */
  readonly snapshot?: boolean;
  /** Snapshot, then wait for `jobs.confirm` (`ready`, for an hour) before running (AC-109). */
  readonly confirm?: boolean;
  /** Not before this time (AC-111); else now plus the kind's start delay. */
  readonly runAt?: Date;
  /**
   * Coalescing (AC-110): while a job of this kind and key still waits
   * (`queued`, no slice run), this start adds its items to it and answers it.
   * A member kind's key is kept per starter, so no member's items ever run as
   * another member.
   */
  readonly dedupeKey?: string;
  /** A system kind's start that must happen once, such as `maintenance:2026-10-04`: a second answers the first. */
  readonly onceKey?: string;
}

/** Where a snapshot got to: the last id read, how many it stored, the last position used, and whether to confirm. */
export interface SnapshotCheckpoint {
  readonly after?: string;
  readonly count: number;
  readonly position: number;
  readonly confirm: boolean;
}

/** A snapshot's checkpoint, as `startJob` wrote it and each snapshot batch moves it (`{ snapshot: … }`). */
export function readSnapshotCheckpoint(checkpoint: unknown): SnapshotCheckpoint {
  const inner: unknown =
    typeof checkpoint === 'object' && checkpoint !== null && 'snapshot' in checkpoint ? checkpoint.snapshot : undefined;
  const value = typeof inner === 'object' && inner !== null ? (inner as Record<string, unknown>) : {};
  const whole = (field: unknown) => (typeof field === 'number' && Number.isInteger(field) && field >= 0 ? field : 0);
  return {
    ...(isUuid(value.after) ? { after: value.after } : {}),
    count: whole(value.count),
    position: whole(value.position),
    confirm: value.confirm === true,
  };
}

/** The longest coalescing or once key a start may carry. */
const MAX_KEY = 200;

/**
 * Starts a job inside the caller's write transaction (AC-102): if the write
 * rolls back, no job exists and nothing runs; once it commits, the job is on
 * the queue. Starting again with the same id answers the job already made. A
 * member kind needs a member in the scope (a programming error otherwise); a
 * system kind is the system's whoever starts it (AC-125). With `dedupeKey` a
 * start joins the job of that kind and key still waiting (AC-110), with
 * `onceKey` it answers the job already made for it, with `runAt` it waits
 * till then (AC-111), and with `snapshot` or `confirm` it fills its items in
 * the background first (AC-109). Refusals: 422 CONFIG_INVALID (params), 422
 * JOB_TOO_LARGE (over a million items), 409 LIMIT_REACHED (the workspace's
 * 21st unfinished member job of a kind that counts, AC-126), 409 ID_TAKEN
 * (the id names someone else's job, or one of another kind). A system kind
 * (and every kind's `onFailed`) acts with system power on the params and
 * items it is given, so the feature authorises them through the door first;
 * a `countsTowardLimit: false` kind's key must not come from client input,
 * or one member could hold any number of waiting jobs.
 */
export async function startJob(
  context: WriteContext,
  registry: JobRegistry,
  input: StartJobInput,
): Promise<{ readonly jobId: string; readonly merged: boolean }> {
  const { tx, scope } = context;
  const kind = registry.get(input.kind);
  if (kind === undefined) throw new Error(`No job kind ${input.kind} is registered here.`);
  const parsed = kind.params.safeParse(input.params);
  if (!parsed.success) throw refuse('CONFIG_INVALID', 'Some of this job’s settings are invalid.');
  const items = [...new Set(input.items ?? [])];
  if (!items.every(isUuid)) throw new Error('Job items are ids.');
  const limits = limitsOf(scope);
  if (items.length > limits.jobItems) throw tooLarge(limits.jobItems);
  const starter = kind.actor === 'system' ? undefined : memberOf(scope);
  if (kind.actor === 'member' && starter === undefined) {
    throw new Error(`Kind ${kind.kind} is a member's job: start it from a member's scope.`);
  }
  // Programming errors, never refusals: the feature's own code chose these.
  const snapshot = input.snapshot === true || input.confirm === true;
  if (snapshot && kind.snapshot === undefined) throw new Error(`Kind ${kind.kind} takes no snapshot.`);
  if (snapshot && items.length > 0) throw new Error('A snapshot job takes its items from its snapshot.');
  if (snapshot && input.dedupeKey !== undefined) throw new Error('A coalesced start names its items itself.');
  if (kind.countsTowardLimit === false && input.dedupeKey === undefined) {
    throw new Error(`Kind ${kind.kind} stays out of the job limit, so every start carries a dedupeKey.`);
  }
  if (input.onceKey !== undefined && kind.actor !== 'system') throw new Error('Only a system kind takes a onceKey.');
  for (const key of [input.dedupeKey, input.onceKey]) {
    if (key !== undefined && (key.length === 0 || key.length > MAX_KEY))
      throw new Error('A job key is 1 to 200 characters.');
  }
  if (input.runAt !== undefined && Number.isNaN(input.runAt.getTime())) throw new Error('A job’s run time is a date.');
  const dedupeKey =
    input.dedupeKey === undefined
      ? undefined
      : starter === undefined
        ? input.dedupeKey
        : `member:${starter}:${input.dedupeKey}`;
  const jobId = input.id ?? randomUUID();
  if (!isUuid(jobId)) throw new Error('A job id is a uuid.');

  // The idempotent replay: the job this id already made, of this kind, by this starter. Anyone else's job with
  // the id (another member's, another kind) is refused rather than handed back as if this start had made it.
  const existing = await sameStart(tx, scope.workspaceId, jobId);
  if (existing !== undefined) return replayOf(existing, kind.kind, starter, jobId);
  if (input.onceKey !== undefined) {
    const once = await onceJob(tx, scope.workspaceId, kind.kind, input.onceKey);
    if (once !== undefined) return { jobId: once, merged: false };
  }
  const join = { kind, params: parsed.data, items, limit: limits.jobItems };
  if (dedupeKey !== undefined) {
    // A coalesced start takes the counter row first, as the write that will store its event does at commit: two
    // racing starts then queue on that one lock, rather than one waiting on the other's key while holding it.
    await lockCounters(tx, scope.workspaceId);
    const merged = await mergeInto(context, join, dedupeKey);
    if (merged !== undefined) return { jobId: merged, merged: true };
  }

  // When it may first run: the time asked for, else now plus the kind's coalescing window.
  const runAt =
    input.runAt === undefined
      ? sql`now() + make_interval(secs => ${(kind.startDelayMs ?? 0) / 1000})`
      : sql`${input.runAt.toISOString()}::timestamptz`;
  const inserted = await tx
    .insert(jobs)
    .values({
      workspaceId: scope.workspaceId,
      id: jobId,
      kind: kind.kind,
      lane: kind.lane,
      status: snapshot ? 'preparing' : 'queued',
      params: parsed.data,
      subjectType: input.subject?.type ?? null,
      subjectId: input.subject?.id ?? null,
      dedupeKey: dedupeKey ?? null,
      onceKey: input.onceKey ?? null,
      priority: starter === undefined ? PRIORITY.system : PRIORITY.member,
      runAt,
      total: snapshot || kind.mode !== 'items' ? null : items.length,
      checkpoint: snapshot ? { snapshot: { count: 0, position: 0, confirm: input.confirm === true } } : null,
      createdByType: starter === undefined ? 'system' : 'member',
      createdById: starter ?? null,
      createdByMemberId: starter ?? null,
    })
    .onConflictDoNothing()
    .returning({ id: jobs.id });
  // A concurrent start won (the same id, the same once key, or the same waiting key): answer its job.
  if (inserted.length === 0) {
    const winner = await sameStart(tx, scope.workspaceId, jobId);
    if (winner !== undefined) return replayOf(winner, kind.kind, starter, jobId);
    if (input.onceKey !== undefined) {
      const once = await onceJob(tx, scope.workspaceId, kind.kind, input.onceKey);
      if (once !== undefined) return { jobId: once, merged: false };
    }
    if (dedupeKey !== undefined) {
      const merged = await mergeInto(context, join, dedupeKey);
      if (merged !== undefined) return { jobId: merged, merged: true };
    }
    throw new Error('A job with this id went away under its start.');
  }

  await insertItems(tx, scope.workspaceId, jobId, items, 0);
  if (starter !== undefined && kind.countsTowardLimit !== false) {
    // The limit, counted under the counter row's lock, taken last as every write takes it (after the items, so
    // a large start never holds the workspace's writes while its items go in), so two starts take turns. Kinds
    // that stay out of the limit (AC-126) aren't counted; their one waiting job per key bounds them.
    await lockCounters(tx, scope.workspaceId);
    const [counted] = await tx
      .execute<{ n: number }>(
        sql`
      select count(*)::int as n from jobs
      where workspace_id = ${scope.workspaceId} and created_by_type = 'member' and finished_at is null
        and id <> ${jobId}
        and kind not in (select jsonb_array_elements_text(${JSON.stringify(registry.uncounted())}::jsonb))
    `,
      )
      .then((result) => result.rows);
    if ((counted?.n ?? 0) >= limits.unfinishedJobs) {
      throw refuse(
        'LIMIT_REACHED',
        `This workspace already runs ${String(limits.unfinishedJobs)} jobs. Wait for one to finish, or cancel one.`,
      );
    }
  }
  await enqueue(tx, jobId, runAt);
  // Its first event goes out with the write (spec 0007's `jobs` kind), under its starter.
  context.record({ jobs: [{ jobId, startedBy: starter ?? null }] });
  return { jobId, merged: false };
}

/** Takes the workspace's counter row (every write takes it, the outbox numbering from it). */
async function lockCounters(tx: WorkspaceTx, workspaceId: string): Promise<void> {
  const [counters] = await tx
    .select({ workspaceId: workspaceCounters.workspaceId })
    .from(workspaceCounters)
    .where(eq(workspaceCounters.workspaceId, workspaceId))
    .for('update');
  if (counters === undefined) throw new Error('The workspace has no counters row.');
}

/** A start too large to hold. */
const tooLarge = (limit: number) =>
  refuse('JOB_TOO_LARGE', `A job works on at most ${limit.toLocaleString('en')} items.`);

/** The job of this kind already made for a once key, if any. */
async function onceJob(tx: WorkspaceTx, workspaceId: string, kind: string, onceKey: string) {
  const [row] = await tx
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.workspaceId, workspaceId), eq(jobs.kind, kind), eq(jobs.onceKey, onceKey)));
  return row?.id;
}

/**
 * Coalescing (AC-110): adds a start's items to the waiting job of its kind
 * and key (`queued`, no slice run yet), under that job's lock, after its last
 * position, an item already there kept once. Answers that job's id, or
 * undefined when none waits. The key must name the params too: a start whose
 * params differ from the waiting job's is a programming error.
 */
async function mergeInto(
  context: WriteContext,
  join: { readonly kind: AnyKind; readonly params: unknown; readonly items: readonly string[]; readonly limit: number },
  dedupeKey: string,
): Promise<string | undefined> {
  const { tx, scope } = context;
  const [waiting] = await tx
    .select({
      id: jobs.id,
      total: jobs.total,
      createdByMemberId: jobs.createdByMemberId,
      sameParams: sql<boolean>`${jobs.params} = ${JSON.stringify(join.params)}::jsonb`,
    })
    .from(jobs)
    .where(
      and(
        eq(jobs.workspaceId, scope.workspaceId),
        eq(jobs.kind, join.kind.kind),
        eq(jobs.dedupeKey, dedupeKey),
        eq(jobs.status, 'queued'),
        eq(jobs.slices, 0),
      ),
    )
    .for('update');
  if (waiting === undefined) return undefined;
  if (!waiting.sameParams) throw new Error(`A start of ${join.kind.kind} joins a waiting job with other params.`);
  if (join.kind.mode === 'items' && join.items.length > 0) {
    if ((waiting.total ?? 0) + join.items.length > join.limit) throw tooLarge(join.limit);
    const [last] = await tx
      .execute<{ position: number }>(
        sql`select coalesce(max(position), 0)::int as position from job_items
            where workspace_id = ${scope.workspaceId} and job_id = ${waiting.id}`,
      )
      .then((result) => result.rows);
    const added = await insertItems(tx, scope.workspaceId, waiting.id, join.items, last?.position ?? 0);
    if (added > 0) {
      await tx
        .update(jobs)
        .set({ total: sql`coalesce(${jobs.total}, 0) + ${added}`, updatedAt: sql`now()` })
        .where(and(eq(jobs.workspaceId, scope.workspaceId), eq(jobs.id, waiting.id)));
      context.record({ jobs: [{ jobId: waiting.id, startedBy: waiting.createdByMemberId }] });
    }
  }
  return waiting.id;
}

/**
 * Adds `ids` to a job's items at the positions after `after`, in chunks of
 * 5,000; an id the job already holds is kept once. Answers how many it added.
 */
export async function insertItems(
  tx: WorkspaceTx,
  workspaceId: string,
  jobId: string,
  ids: readonly string[],
  after: number,
): Promise<number> {
  let added = 0;
  for (let offset = 0; offset < ids.length; offset += ITEM_CHUNK) {
    const chunk = ids.slice(offset, offset + ITEM_CHUNK);
    // The ids go as one JSON parameter, never spliced into an array literal.
    const result = await tx.execute(sql`
      insert into job_items (workspace_id, job_id, position, item_id)
      select ${workspaceId}::uuid, ${jobId}::uuid, ${after + offset}::int + t.ord::int, t.item::uuid
      from jsonb_array_elements_text(${JSON.stringify(chunk)}::jsonb) with ordinality as t(item, ord)
      on conflict do nothing
    `);
    added += result.rowCount ?? 0;
  }
  return added;
}

/** A job already made with an id: its kind and starter, to tell a replay from someone else's job. */
async function sameStart(tx: WorkspaceTx, workspaceId: string, jobId: string) {
  const [row] = await tx
    .select({ kind: jobs.kind, createdByType: jobs.createdByType, createdByMemberId: jobs.createdByMemberId })
    .from(jobs)
    .where(and(eq(jobs.workspaceId, workspaceId), eq(jobs.id, jobId)));
  return row;
}

/** The replay's answer when the job with this id is this same start (kind and starter); 409 ID_TAKEN otherwise. */
function replayOf(
  row: { readonly kind: string; readonly createdByType: string; readonly createdByMemberId: string | null },
  kind: string,
  starter: string | undefined,
  jobId: string,
): { readonly jobId: string; readonly merged: boolean } {
  const same =
    row.kind === kind &&
    (starter === undefined
      ? row.createdByType === 'system'
      : row.createdByType === 'member' && row.createdByMemberId === starter);
  if (!same) throw refuse('ID_TAKEN', 'That job id is already in use. Start the job again with a new id.');
  return { jobId, merged: false };
}

/**
 * Puts a job on Graphile's queue through `crm_enqueue_job` (job key
 * `crm-job:<workspace>:<id>`, `replace`), at `runAt` or now. Answers false
 * when the function refused: a job that isn't runnable (finished, or `ready`)
 * or isn't in the transaction's workspace.
 */
export async function tryEnqueue(tx: WorkspaceTx, jobId: string, runAt?: SQL): Promise<boolean> {
  const result = await tx.execute<{ queued: boolean }>(
    sql`select crm_enqueue_job(${jobId}::uuid, ${runAt ?? sql`now()`}) as queued`,
  );
  return result.rows[0]?.queued === true;
}

/** As `tryEnqueue`, but a refusal throws: the job was meant to be runnable here (a programming error). */
export async function enqueue(tx: WorkspaceTx, jobId: string, runAt?: SQL): Promise<void> {
  if (!(await tryEnqueue(tx, jobId, runAt))) throw new Error('The job could not be queued.');
}

/** One job, for its starter or a holder of `jobs.manage`; NOT_FOUND otherwise (AC-114). */
export async function getJob(scope: EngineScope, registry: JobRegistry, jobId: string): Promise<JobView> {
  checkScope(scope);
  const row = await inWorkspace(scope, (tx) => readJob(tx, scope, jobId, undefined));
  return toJobView(row, registry);
}

/** Where a page of jobs continues: the group, and the last row's creation time and id. */
interface ListCursor {
  readonly unfinished: boolean;
  readonly createdAt: string;
  readonly id: string;
}

const encodeCursor = (cursor: ListCursor): string =>
  Buffer.from(JSON.stringify([cursor.unfinished ? 1 : 0, cursor.createdAt, cursor.id])).toString('base64url');

function decodeCursor(text: string): ListCursor {
  try {
    const value: unknown = JSON.parse(Buffer.from(text, 'base64url').toString('utf8'));
    if (Array.isArray(value) && value.length === 3) {
      const [unfinished, createdAt, id] = value as unknown[];
      if (
        (unfinished === 0 || unfinished === 1) &&
        typeof createdAt === 'string' &&
        !Number.isNaN(Date.parse(createdAt)) &&
        isUuid(id)
      ) {
        return { unfinished: unfinished === 1, createdAt, id };
      }
    }
  } catch {
    // Not one of ours: refused below.
  }
  throw refuse('CONFIG_INVALID', 'That page of jobs can’t be read. Start from the first page.');
}

/**
 * A page of jobs (AC-118): unfinished first, then those finished in the last
 * 30 days, newest first, at most `limit` (50). `mine` is the caller's own;
 * `all` every job in the workspace, system ones included, and needs
 * `jobs.manage` (403 FORBIDDEN otherwise).
 */
export async function listJobs(
  scope: EngineScope,
  registry: JobRegistry,
  input: Pick<JobsListInput, 'scope' | 'cursor' | 'limit'>,
): Promise<JobList> {
  checkScope(scope);
  const which = input.scope ?? 'mine';
  if (which === 'all' && !managesJobs(scope)) throw refuse('FORBIDDEN', PERMISSIONS['jobs.manage'].message);
  const me = memberOf(scope);
  if (which === 'mine' && me === undefined) return { jobs: [] };
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 50);
  const cursor = input.cursor === undefined ? undefined : decodeCursor(input.cursor);
  const recent = sql`${jobs.finishedAt} > now() - ${FINISHED_KEPT}::interval`;
  const after = (c: ListCursor) => sql`(${jobs.createdAt}, ${jobs.id}) < (${c.createdAt}::timestamptz, ${c.id}::uuid)`;
  const where = [
    eq(jobs.workspaceId, scope.workspaceId),
    which === 'mine' ? sql`${jobs.createdByType} = 'member' and ${jobs.createdByMemberId} = ${me ?? null}` : sql`true`,
    cursor === undefined
      ? sql`(${jobs.finishedAt} is null or ${recent})`
      : cursor.unfinished
        ? sql`((${jobs.finishedAt} is null and ${after(cursor)}) or ${recent})`
        : sql`(${recent} and ${after(cursor)})`,
  ];
  const rows = await inWorkspace(scope, (tx) =>
    tx
      .select({ row: jobs, createdText: sql<string>`${jobs.createdAt}::text` })
      .from(jobs)
      .where(and(...where))
      .orderBy(sql`${jobs.finishedAt} is null desc`, sql`${jobs.createdAt} desc`, sql`${jobs.id} desc`)
      .limit(limit + 1),
  );
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    jobs: page.map(({ row }) => toJobView(row, registry)),
    ...(rows.length > limit && last !== undefined
      ? {
          nextCursor: encodeCursor({
            unfinished: last.row.finishedAt === null,
            createdAt: last.createdText,
            id: last.row.id,
          }),
        }
      : {}),
  };
}

/**
 * Cancels a job (AC-107): one not yet running ends `cancelled` at once; a
 * running one becomes `cancelling`, and its runner stops before its next
 * batch. The starter or a holder of `jobs.manage` may (NOT_FOUND for anyone
 * else); a finished job answers 409 JOB_FINISHED, and a kind that can't be
 * cancelled 409 JOB_NOT_CANCELLABLE. Work already done stays done.
 */
export async function cancelJob(
  scope: EngineScope,
  registry: JobRegistry,
  jobId: string,
  hooks: readonly AfterWrite[] = [],
): Promise<JobView> {
  checkScope(scope);
  const { result } = await runWrite(
    scope,
    async (context) => {
      const { tx } = context;
      const row = await readJob(tx, scope, jobId, 'update');
      if (isFinishedJob(row.status)) throw refuse('JOB_FINISHED', 'That job has already finished.');
      if (registry.get(row.kind)?.cancellable !== true) {
        throw refuse('JOB_NOT_CANCELLABLE', 'This kind of job can’t be cancelled.');
      }
      const running = row.status === 'running' || row.status === 'cancelling';
      const [updated] = await tx
        .update(jobs)
        .set(
          running
            ? {
                status: 'cancelling',
                cancelRequestedAt: sql`coalesce(${jobs.cancelRequestedAt}, now())`,
                cancelRequestedByMemberId: sql`coalesce(${jobs.cancelRequestedByMemberId}, ${memberOf(scope) ?? null}::uuid)`,
                updatedAt: sql`now()`,
              }
            : { status: 'cancelled', finishedAt: sql`now()`, updatedAt: sql`now()` },
        )
        .where(and(eq(jobs.workspaceId, scope.workspaceId), eq(jobs.id, row.id)))
        .returning();
      if (updated === undefined) throw new Error('The job went away under its lock.');
      context.record({ jobs: [{ jobId: row.id, startedBy: row.createdByMemberId }] });
      return updated;
    },
    hooks,
  );
  return toJobView(result, registry);
}

/**
 * Confirms a job waiting in `ready` (AC-109): it is queued. The starter or a
 * holder of `jobs.manage` may; a job past its hour answers 409 JOB_EXPIRED,
 * a finished one 409 JOB_FINISHED, and any other 409 JOB_NOT_READY.
 */
export async function confirmJob(
  scope: EngineScope,
  registry: JobRegistry,
  jobId: string,
  hooks: readonly AfterWrite[] = [],
): Promise<JobView> {
  checkScope(scope);
  const { result } = await runWrite(
    scope,
    async (context) => {
      const { tx } = context;
      const row = await readJob(tx, scope, jobId, 'update');
      if (isFinishedJob(row.status)) throw refuse('JOB_FINISHED', 'That job has already finished.');
      if (row.status !== 'ready') throw refuse('JOB_NOT_READY', 'That job isn’t waiting for a confirm.');
      if (row.expiresAt !== null && row.expiresAt.getTime() <= Date.now()) {
        throw refuse('JOB_EXPIRED', 'That job waited more than an hour unconfirmed. Start it again.');
      }
      const [updated] = await tx
        .update(jobs)
        .set({ status: 'queued', expiresAt: null, updatedAt: sql`now()` })
        .where(and(eq(jobs.workspaceId, scope.workspaceId), eq(jobs.id, row.id)))
        .returning();
      if (updated === undefined) throw new Error('The job went away under its lock.');
      await enqueue(tx, row.id);
      context.record({ jobs: [{ jobId: row.id, startedBy: row.createdByMemberId }] });
      return updated;
    },
    hooks,
  );
  return toJobView(result, registry);
}

/** A test job's settings (`jobs.startTest`). */
export interface TestJobInput {
  readonly id: string;
  readonly items: number;
  readonly batchSize?: number | undefined;
  readonly batchMillis: number;
  readonly failAtPosition?: number | undefined;
  readonly refuseEvery?: number | undefined;
  /** Snapshot its items in the background, then wait for a confirm (AC-109). */
  readonly confirm?: boolean | undefined;
}

/**
 * Starts a test job (`dev.simulate`) of synthetic items, for holders of
 * `jobs.manage` (FORBIDDEN otherwise, checked first, as every permission
 * entry is). Where the kind isn't registered (production) it answers
 * NOT_FOUND, as if it didn't exist (AC-123).
 */
export async function startTestJob(
  scope: EngineScope,
  registry: JobRegistry,
  input: TestJobInput,
  hooks: readonly AfterWrite[] = [],
): Promise<JobView> {
  checkScope(scope);
  if (!managesJobs(scope)) throw refuse('FORBIDDEN', PERMISSIONS['jobs.manage'].message);
  if (registry.get('dev.simulate') === undefined) throw refuse('NOT_FOUND', 'There is nothing at this address.');
  const id = checkId(input.id, JOB_NOT_FOUND);
  const confirm = input.confirm === true;
  // With a confirm, the snapshot makes the items (the same synthetic ids on a replay); else they're made here.
  const items = confirm ? [] : Array.from({ length: input.items }, () => randomUUID());
  const params = {
    batchMillis: input.batchMillis,
    ...(input.batchSize === undefined ? {} : { batchSize: input.batchSize }),
    ...(input.failAtPosition === undefined ? {} : { failAtPosition: input.failAtPosition }),
    ...(input.refuseEvery === undefined ? {} : { refuseEvery: input.refuseEvery }),
    ...(confirm ? { snapshotItems: input.items } : {}),
  };
  await runWrite(
    scope,
    (context) => startJob(context, registry, { id, kind: 'dev.simulate', params, items, confirm }),
    hooks,
  );
  return getJob(scope, registry, id);
}
