// Background jobs, as services (spec 0008, milestone 1): starting a job inside
// the caller's write (`startJob`), reading one or a page of them, cancelling
// and confirming, and the test job. A job is visible to the member who
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
import type { JobRegistry } from './registry.ts';

const { jobs, workspaceCounters } = schema;

/** What NOT_FOUND says for a job: the same for one that doesn't exist and one the caller may not see. */
const JOB_NOT_FOUND = "That job doesn't exist, or you can't see it.";

/** Priority of a member's job and of the system's: people's work goes first. */
export const PRIORITY = { member: 0, system: 10 } as const;

/** How many item rows one insert carries. */
const ITEM_CHUNK = 5_000;

/** How long a finished job stays on the page (and in the table) before the daily cleanup deletes it. */
const FINISHED_KEPT = '30 days';

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

/** What starting a job takes (spec 0008, Starting a job; milestone 1's part). */
export interface StartJobInput {
  /** The job's id: the client's uuid v7 for a member job (the idempotent start key); minted when absent. */
  readonly id?: string;
  readonly kind: string;
  readonly params: unknown;
  /** What the job works on, so a feature can ask what runs on it. */
  readonly subject?: { readonly type: 'object' | 'attribute' | 'list'; readonly id: string };
  /** The ids an item job works through, in order (duplicates kept once). */
  readonly items?: readonly string[];
}

/**
 * Starts a job inside the caller's write transaction (AC-102): if the write
 * rolls back, no job exists and nothing runs; once it commits, the job is on
 * the queue. Starting again with the same id answers the job already made. A
 * member kind needs a member in the scope (a programming error otherwise); a
 * system kind is the system's whoever starts it (AC-125). Refusals: 422
 * CONFIG_INVALID (params), 422 JOB_TOO_LARGE (over a million items), 409
 * LIMIT_REACHED (the workspace's 21st unfinished member job), 409 ID_TAKEN
 * (the id names someone else's job, or one of another kind).
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
  if (items.length > limits.jobItems) {
    throw refuse('JOB_TOO_LARGE', `A job works on at most ${limits.jobItems.toLocaleString('en')} items.`);
  }
  const starter = kind.actor === 'system' ? undefined : memberOf(scope);
  if (kind.actor === 'member' && starter === undefined) {
    throw new Error(`Kind ${kind.kind} is a member's job: start it from a member's scope.`);
  }
  const jobId = input.id ?? randomUUID();
  if (!isUuid(jobId)) throw new Error('A job id is a uuid.');

  // The idempotent replay: the job this id already made, of this kind, by this starter. Anyone else's job with
  // the id (another member's, another kind) is refused rather than handed back as if this start had made it.
  const existing = await sameStart(tx, scope.workspaceId, jobId);
  if (existing !== undefined) return replayOf(existing, kind.kind, starter, jobId);

  if (starter !== undefined) {
    // The limit, counted under the counter row's lock (which every write takes last), so two starts take turns.
    const [counters] = await tx
      .select({ workspaceId: workspaceCounters.workspaceId })
      .from(workspaceCounters)
      .where(eq(workspaceCounters.workspaceId, scope.workspaceId))
      .for('update');
    if (counters === undefined) throw new Error('The workspace has no counters row.');
    const [counted] = await tx
      .execute<{ n: number }>(
        sql`
      select count(*)::int as n from jobs
      where workspace_id = ${scope.workspaceId} and created_by_type = 'member' and finished_at is null
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

  const inserted = await tx
    .insert(jobs)
    .values({
      workspaceId: scope.workspaceId,
      id: jobId,
      kind: kind.kind,
      lane: kind.lane,
      status: 'queued',
      params: parsed.data,
      subjectType: input.subject?.type ?? null,
      subjectId: input.subject?.id ?? null,
      priority: starter === undefined ? PRIORITY.system : PRIORITY.member,
      total: kind.mode === 'items' ? items.length : null,
      createdByType: starter === undefined ? 'system' : 'member',
      createdById: starter ?? null,
      createdByMemberId: starter ?? null,
    })
    .onConflictDoNothing()
    .returning({ id: jobs.id });
  // A concurrent start with the same id won: answer its job, if it is this same start.
  if (inserted.length === 0) {
    const winner = await sameStart(tx, scope.workspaceId, jobId);
    if (winner === undefined) throw new Error('A job with this id went away under its start.');
    return replayOf(winner, kind.kind, starter, jobId);
  }

  for (let offset = 0; offset < items.length; offset += ITEM_CHUNK) {
    const chunk = items.slice(offset, offset + ITEM_CHUNK);
    await tx.execute(sql`
      insert into job_items (workspace_id, job_id, position, item_id)
      select ${scope.workspaceId}::uuid, ${jobId}::uuid, ${offset}::int + t.ord, t.item
      from unnest(${`{${chunk.join(',')}}`}::uuid[]) with ordinality as t(item, ord)
    `);
  }
  await enqueue(tx, jobId);
  // Its first event goes out with the write (spec 0007's `jobs` kind), under its starter.
  context.record({ jobs: [{ jobId, startedBy: starter ?? null }] });
  return { jobId, merged: false };
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
 * `crm-job:<workspace>:<id>`, `replace`), at `runAt` or now. The function refuses (and
 * this throws, a programming error) for a job that isn't runnable or isn't
 * in the transaction's workspace.
 */
export async function enqueue(tx: WorkspaceTx, jobId: string, runAt?: SQL): Promise<void> {
  const result = await tx.execute<{ queued: boolean }>(
    sql`select crm_enqueue_job(${jobId}::uuid, ${runAt ?? sql`now()`}) as queued`,
  );
  if (result.rows[0]?.queued !== true) throw new Error('The job could not be queued.');
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
}

/**
 * Starts a test job (`dev.simulate`) of synthetic items, for holders of
 * `jobs.manage`. Where the kind isn't registered (production) it answers
 * NOT_FOUND, as if it didn't exist (AC-123).
 */
export async function startTestJob(
  scope: EngineScope,
  registry: JobRegistry,
  input: TestJobInput,
  hooks: readonly AfterWrite[] = [],
): Promise<JobView> {
  checkScope(scope);
  if (registry.get('dev.simulate') === undefined) throw refuse('NOT_FOUND', 'There is nothing at this address.');
  if (!managesJobs(scope)) throw refuse('FORBIDDEN', PERMISSIONS['jobs.manage'].message);
  const id = checkId(input.id, JOB_NOT_FOUND);
  const items = Array.from({ length: input.items }, () => randomUUID());
  const params = {
    batchMillis: input.batchMillis,
    ...(input.batchSize === undefined ? {} : { batchSize: input.batchSize }),
    ...(input.failAtPosition === undefined ? {} : { failAtPosition: input.failAtPosition }),
    ...(input.refuseEvery === undefined ? {} : { refuseEvery: input.refuseEvery }),
  };
  await runWrite(scope, (context) => startJob(context, registry, { id, kind: 'dev.simulate', params, items }), hooks);
  return getJob(scope, registry, id);
}
