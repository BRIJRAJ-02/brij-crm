// The job runner (spec 0008, One slice): one call runs one slice of one job.
// It claims the job with a lease, enters its actor again (the member through
// `enterAsActor`, so a removed member stops it; the system through
// `systemScope`), runs batches for about 20 seconds (each one engine
// transaction that does the work and saves the item states, the counts, the
// checkpoint and, at most once a second, the job's change event), checks for
// a cancel between batches, and hands the job back to the queue behind
// everyone already waiting. A job started with a snapshot first fills its
// items page by page (`preparing`), then waits for a confirm (`ready`, ended
// `JOB_EXPIRED` by a queue row at its expiry) or queues itself. Every path
// that ends a job `failed` runs its kind's `onFailed` in that transaction,
// under the system's scope (milestone 2). Graphile Worker only wakes it and
// orders the slices. Everything it needs comes in as an argument: the clock,
// the database, the hooks, the scope makers, the log and the shutdown signal.
import { hostname } from 'node:os';
import { and, eq, sql } from 'drizzle-orm';
import { isFinishedJob, REFUSAL_GROUP_IDS, type QueuePayload } from '@crm/contracts';
import { ERROR_CODES } from '@crm/contracts/codes';
import { schema, type Database, type WorkspaceTx } from '@crm/db';
import { inWorkspace } from '../access/run.ts';
import { isUuid } from '../engine/ids.ts';
import { limitsOf } from '../engine/limits.ts';
import { isRefusal } from '../engine/refusals.ts';
import type { Actor, EngineScope } from '../engine/scope.ts';
import { runWrite, type AfterWrite, type WriteContext } from '../engine/write.ts';
import type { AnyKind, FailedJob, ItemOutcome, JobRegistry, StepOutcome } from './registry.ts';
import { enqueue, insertItems, readSnapshotCheckpoint, tryEnqueue, type SnapshotCheckpoint } from './service.ts';

const { jobs, workspaces } = schema;

/** One JSON log line's sink: the api's logger. Fields carry ids, counts and times, never params or values. */
export interface RunnerLog {
  info(message: string, fields: Record<string, unknown>): void;
  warn(message: string, fields: Record<string, unknown>): void;
  error(message: string, fields: Record<string, unknown>): void;
}

/** What the runner needs, all passed in (the worker builds them). */
export interface RunnerDeps {
  /** The pooled tenant database (the app login): every slice's work runs under withWorkspace(). */
  readonly db: Database;
  readonly registry: JobRegistry;
  /** `enterAsActor` from `@crm/core/system`: the member's scope as they are now; NOT_FOUND once removed. */
  readonly enterAsActor: (input: { readonly workspaceId: string; readonly actor: Actor }) => Promise<EngineScope>;
  /** `systemScope` from `@crm/core/system`: the claim, the hand over and system jobs. */
  readonly systemScope: (workspaceId: string) => EngineScope;
  /** The write hooks of every batch (the api's composer: the outbox), made fresh for each write. */
  readonly hooks: () => readonly AfterWrite[];
  /** Told after a batch that stored an outbox row has committed (the worker wakes its relay). */
  readonly onStored?: () => void;
  readonly log: RunnerLog;
  /** The clock, in milliseconds; tests pass one they move. */
  readonly now?: () => number;
  /**
   * Who holds the lease: `<hostname>:<pid>:<start time>` by default, and each
   * slice adds its own number, so two queue rows of one job never run at once
   * even in one process (a light job has no queue of its own).
   */
  readonly leaseOwner?: string;
  /** How long a slice runs batches before it hands the job back (20 seconds). */
  readonly sliceMs?: number;
  /**
   * The light lane's slice budget (1 second): light work is short, and a
   * workspace's long light jobs hand their slots back often, so a light job in
   * any workspace starts within 2 seconds (AC-108).
   */
  readonly lightSliceMs?: number;
  /** How long a lease lasts past each batch (60 seconds). */
  readonly leaseMs?: number;
  /** At most one progress event per job this often (1 second); the final one always goes. */
  readonly progressMs?: number;
  /** How long a prepared job waits for its confirm (1 hour, AC-109). */
  readonly confirmMs?: number;
}

/** How a slice ended, for the log and the tests. */
export type SliceOutcome =
  | 'gone'
  | 'finished-already'
  /** A prepared job waiting for its confirm, before its expiry. */
  | 'waiting'
  | 'leased-elsewhere'
  | 'handed-over'
  /** A snapshot finished and the job waits for its confirm. */
  | 'ready'
  | 'succeeded'
  | 'cancelled'
  | 'failed'
  | 'retrying'
  | 'stopped';

/** The runner: one slice of one job per call. */
export interface Runner {
  /**
   * Runs one slice of the job a queue row names. Resolves with how it ended;
   * rejects (so Graphile retries with its backoff) when a batch failed and
   * the job has tries left. `signal` is the worker's shutdown: the slice
   * finishes the batch in hand and hands the job back.
   */
  runSlice(payload: QueuePayload, signal?: AbortSignal): Promise<SliceOutcome>;
}

const SLICE_MS = 20_000;
const LIGHT_SLICE_MS = 1_000;
const LEASE_MS = 60_000;
const PROGRESS_MS = 1_000;
const CONFIRM_MS = 60 * 60_000;

/** How many ids one snapshot batch reads and stores (spec 0008, Snapshot). */
export const SNAPSHOT_PAGE = 5_000;

/** The plain sentences a job ends with (spec 0008; AC-104, AC-109, AC-113, AC-116). Never a value. */
const ENDINGS = {
  JOB_FAILED: 'This job stopped after repeated errors. What it finished is kept.',
  JOB_INVALID: 'This job can’t run any more: its settings are no longer valid. What it finished is kept.',
  ACTOR_REMOVED: 'The member who started this job was removed, so it stopped. What it finished is kept.',
  WORKSPACE_GONE: 'The workspace was deleted.',
  JOB_EXPIRED: 'This job waited more than an hour for a confirm, so it was cancelled. Start it again.',
  JOB_TOO_LARGE: 'This job would work on more items than one job may hold, so it stopped. Start it on fewer.',
} as const;

/** A code a job ends with. */
type Ending = keyof typeof ENDINGS;

/** The codes a step's `failed` outcome may name: the error map's (AC-124). */
const KNOWN_CODES: ReadonlySet<string> = new Set(ERROR_CODES);

/** Who started a job, as `onFailed` gets it. */
function starterOf(row: JobRow): FailedJob<unknown>['startedBy'] {
  return row.createdByType === 'member' && row.createdByMemberId !== null
    ? { type: 'member', memberId: row.createdByMemberId }
    : { type: 'system' };
}

/**
 * A write context whose scope is the system's, on the same transaction (and
 * its savepoints): what `onFailed` works through (AC-124), since the starter
 * may be gone.
 */
function asSystem(context: WriteContext, system: EngineScope): WriteContext {
  const wrapped: WriteContext = {
    ...context,
    scope: system,
    // Every savepoint, however deep, keeps the system's scope.
    perRecord: (work) => context.perRecord((inner) => work(asSystem(inner, system))),
  };
  return wrapped;
}

/** Graphile Worker's wait before try `attempt` + 1: `exp(min(attempt, 10))` seconds. */
export function retryDelayMs(attempt: number): number {
  return Math.round(Math.exp(Math.min(attempt, 10)) * 1000);
}

type JobRow = typeof jobs.$inferSelect;

/** Makes the runner. */
export function createRunner(deps: RunnerDeps): Runner {
  const now = deps.now ?? Date.now;
  const worker = deps.leaseOwner ?? `${hostname()}:${String(process.pid)}:${String(Date.now())}`;
  // How many slices this runner started: each one's lease names it.
  let slicesStarted = 0;
  const sliceMs = deps.sliceMs ?? SLICE_MS;
  const lightSliceMs = deps.lightSliceMs ?? Math.min(sliceMs, LIGHT_SLICE_MS);
  const leaseMs = deps.leaseMs ?? LEASE_MS;
  const progressMs = deps.progressMs ?? PROGRESS_MS;
  const confirmMs = deps.confirmMs ?? CONFIRM_MS;
  // When each job's last progress event was stored, by job id: at most one a second, in this closure only.
  const lastSent = new Map<string, number>();
  const instant = (ms: number) => sql`to_timestamp(${ms / 1000})`;
  const leaseUntil = () => instant(now() + leaseMs);
  /** Whether a progress event is due for the job: a second since the last, or the final one. */
  const progressDue = (jobId: string, final: boolean) => {
    const sentAt = lastSent.get(jobId);
    return final || sentAt === undefined || now() - sentAt >= progressMs;
  };

  /**
   * Runs the kind's `onFailed` for a job ending `failed` in `context`'s
   * transaction, as the system (AC-124). A hook that throws is logged with
   * the job id and thrown on, so the whole ending rolls back and is tried
   * again after Graphile's backoff.
   */
  async function runOnFailed(
    context: WriteContext,
    row: JobRow,
    kind: AnyKind | undefined,
    params: unknown,
    error: { readonly code: string; readonly message: string },
  ): Promise<void> {
    if (kind?.onFailed === undefined) return;
    try {
      await kind.onFailed(asSystem(context, deps.systemScope(row.workspaceId)), {
        id: row.id,
        params,
        checkpoint: row.checkpoint,
        startedBy: starterOf(row),
        error,
      });
    } catch (failure) {
      deps.log.error('job.onFailed.failed', {
        jobId: row.id,
        kind: row.kind,
        workspaceId: row.workspaceId,
        // The error's class only: a message may quote a value.
        error: failure instanceof Error ? failure.name : 'unknown',
      });
      throw failure;
    }
  }

  /**
   * Ends a job outside a batch (it can't run, it ran out of tries, its
   * snapshot grew too large, or it waited too long for a confirm), with its
   * refusal summary and its final event. A `failed` ending runs the kind's
   * `onFailed` in the same transaction, and throws when the hook throws.
   */
  async function end(
    row: JobRow,
    status: 'failed' | 'cancelled',
    code: Ending,
    options: {
      readonly event: boolean;
      readonly kind?: AnyKind | undefined;
      readonly params?: unknown;
      /** Ends it only while it is still in this status (an expiry never cancels a job a confirm just queued). */
      readonly whileStatus?: JobRow['status'];
    },
  ): Promise<void> {
    const scope = deps.systemScope(row.workspaceId);
    const stored = { event: false };
    await runWrite(
      scope,
      async (context) => {
        const { tx } = context;
        const groups = await refusalGroups(tx, row);
        const [ended] = await tx
          .update(jobs)
          .set({
            status,
            errorCode: code,
            errorMessage: ENDINGS[code],
            finishedAt: sql`now()`,
            leaseOwner: null,
            leaseUntil: null,
            updatedAt: sql`now()`,
            ...(groups.length === 0
              ? {}
              : {
                  result: sql`coalesce(${jobs.result}, '{}'::jsonb) || ${JSON.stringify({ refusals: groups })}::jsonb`,
                }),
          })
          .where(
            and(
              eq(jobs.workspaceId, row.workspaceId),
              eq(jobs.id, row.id),
              sql`${jobs.finishedAt} is null`,
              options.whileStatus === undefined ? undefined : eq(jobs.status, options.whileStatus),
            ),
          )
          .returning({ id: jobs.id });
        // Another path ended (or confirmed) it first: nothing more to do, and no hook to run twice.
        if (ended === undefined) return;
        if (status === 'failed') {
          await runOnFailed(context, row, options.kind, options.params, { code, message: ENDINGS[code] });
        }
        if (options.event) {
          context.record({ jobs: [{ jobId: row.id, startedBy: row.createdByMemberId }] });
          stored.event = true;
        }
      },
      options.event || status === 'failed' ? deps.hooks() : [],
    );
    if (stored.event) deps.onStored?.();
    lastSent.delete(row.id);
  }

  /** What a claim found. */
  type Claim =
    | { readonly kind: 'claimed'; readonly row: JobRow; readonly workspaceGone: boolean }
    | { readonly kind: 'expired'; readonly row: JobRow }
    | { readonly kind: 'gone' | 'finished-already' | 'waiting' | 'leased-elsewhere' };

  /** Claims the job (step 1) for the slice `leaseOwner`: the row under lock, its lease, `running`, one more slice. */
  async function claim(payload: QueuePayload, leaseOwner: string): Promise<Claim> {
    const scope = deps.systemScope(payload.workspaceId);
    return inWorkspace(scope, async (tx): Promise<Claim> => {
      const [found] = await tx
        .select({
          row: jobs,
          // Past its expiry by this runner's clock or the database's, whichever is later: the queue row Graphile
          // runs at `expires_at` (by the database's clock) always finds it expired.
          expired: sql<boolean>`coalesce(${jobs.expiresAt} <= greatest(now(), ${instant(now())}), false)`,
        })
        .from(jobs)
        .where(and(eq(jobs.workspaceId, payload.workspaceId), eq(jobs.id, payload.jobId)))
        .for('update');
      if (found === undefined) return { kind: 'gone' };
      const { row } = found;
      if (isFinishedJob(row.status)) return { kind: 'finished-already' };
      // A prepared job waits for its confirm; the queue row at its expiry ends it (AC-109).
      if (row.status === 'ready') return found.expired ? { kind: 'expired', row } : { kind: 'waiting' };
      if (row.leaseUntil !== null && row.leaseUntil.getTime() > now()) {
        // Another runner holds it (a deploy overlap, a stale lock released): come back when its lease ends.
        await enqueue(tx, row.id, sql`${row.leaseUntil.toISOString()}::timestamptz`);
        return { kind: 'leased-elsewhere' };
      }
      const [workspace] = await tx
        .select({ deletedAt: workspaces.deletedAt })
        .from(workspaces)
        .where(eq(workspaces.id, payload.workspaceId));
      const [claimed] = await tx
        .update(jobs)
        .set({
          leaseOwner,
          leaseUntil: leaseUntil(),
          status: row.status === 'queued' ? 'running' : row.status,
          startedAt: sql`coalesce(${jobs.startedAt}, now())`,
          slices: sql`${jobs.slices} + 1`,
          updatedAt: sql`now()`,
        })
        .where(and(eq(jobs.workspaceId, row.workspaceId), eq(jobs.id, row.id)))
        .returning();
      if (claimed === undefined) return { kind: 'gone' };
      return { kind: 'claimed', row: claimed, workspaceGone: (workspace?.deletedAt ?? null) !== null };
    });
  }

  /** The scope a slice works under (step 2), or why the job can't run. */
  async function enter(row: JobRow): Promise<EngineScope | 'ACTOR_REMOVED' | 'JOB_INVALID'> {
    // System power only for a job the system started; a key's or an automation's job (none exist yet) never
    // borrows it, and can't run until its own door does (#34): fail closed.
    if (row.createdByType === 'system') return deps.systemScope(row.workspaceId);
    if (row.createdByType !== 'member' || row.createdByMemberId === null) return 'JOB_INVALID';
    try {
      return await deps.enterAsActor({
        workspaceId: row.workspaceId,
        actor: { type: 'member', id: row.createdByMemberId },
      });
    } catch (error) {
      if (isRefusal(error) && error.refusal.code === 'NOT_FOUND') return 'ACTOR_REMOVED';
      throw error;
    }
  }

  /** The refused items grouped by code, each with its count and first ids by position (AC-105). */
  async function refusalGroups(tx: WorkspaceTx, row: Pick<JobRow, 'workspaceId' | 'id'>) {
    // Counted per code from the index, then each code's first ids by position read in order from it (0030), so a
    // job with a million refusals never sorts them all to keep 20.
    const result = await tx.execute<{ code: string; count: number; item_ids: string[] }>(sql`
      select coalesce(g.code, '') as code, g.count,
        array(
          select i.item_id from job_items i
          where i.workspace_id = ${row.workspaceId} and i.job_id = ${row.id} and i.state = 'refused'
            and i.code is not distinct from g.code
          order by i.position limit ${REFUSAL_GROUP_IDS}
        ) as item_ids
      from (
        select code, count(*)::int as count from job_items
        where workspace_id = ${row.workspaceId} and job_id = ${row.id} and state = 'refused'
        group by code
      ) g
      order by g.count desc, 1
    `);
    return result.rows.map((group) => ({ code: group.code, count: group.count, itemIds: group.item_ids }));
  }

  interface Counts {
    readonly done: number;
    readonly refused: number;
    readonly skipped: number;
  }

  /** What one batch decided. */
  type Batch =
    | { readonly kind: 'cancelled' }
    | { readonly kind: 'ended' }
    | { readonly kind: 'done' | 'failed'; readonly finished: boolean; readonly counts: Counts };

  /** Ends a job its cancel reached (step 5), in the batch's transaction. */
  async function cancelIn(context: WriteContext, jobId: string, startedBy: string | null): Promise<void> {
    await context.tx
      .update(jobs)
      .set({ status: 'cancelled', finishedAt: sql`now()`, leaseOwner: null, leaseUntil: null, updatedAt: sql`now()` })
      .where(and(eq(jobs.workspaceId, context.scope.workspaceId), eq(jobs.id, jobId)));
    context.record({ jobs: [{ jobId, startedBy }] });
  }

  /** Runs one batch (step 3) as one engine transaction: the work and its progress commit together, or neither. */
  async function batch(scope: EngineScope, kind: AnyKind, params: unknown, jobId: string): Promise<Batch> {
    // Set inside the write (a closure), read once it commits.
    const event = { stored: false };
    const hooks = deps.hooks();
    const { result } = await runWrite(
      scope,
      async (context: WriteContext): Promise<Batch> => {
        const { tx } = context;
        const [row] = await tx
          .select()
          .from(jobs)
          .where(and(eq(jobs.workspaceId, scope.workspaceId), eq(jobs.id, jobId)))
          .for('no key update');
        if (row === undefined) throw new Error('The job went away while it ran.');
        // Ended under this slice (a cancel that landed at once): nothing more to do.
        if (row.finishedAt !== null) return { kind: 'ended' };
        const starter = { jobId, startedBy: row.createdByMemberId };
        if (row.cancelRequestedAt !== null) {
          await cancelIn(context, jobId, row.createdByMemberId);
          event.stored = true;
          return { kind: 'cancelled' };
        }
        const limit = kind.batchSizeOf?.(params) ?? kind.batchSize;
        const checkpoint: unknown = row.checkpoint;
        const position =
          typeof checkpoint === 'object' && checkpoint !== null && 'position' in checkpoint
            ? Number(checkpoint.position) || 0
            : 0;
        let items: { position: number; itemId: string }[] = [];
        if (kind.mode === 'items') {
          const pending = await tx.execute<{ position: number; item_id: string }>(sql`
            select position, item_id from job_items
            where workspace_id = ${scope.workspaceId} and job_id = ${jobId} and state = 'pending' and position > ${position}
            order by position limit ${limit}
          `);
          items = pending.rows.map((item) => ({ position: item.position, itemId: item.item_id }));
        }
        let outcome: StepOutcome = { finished: true };
        if (kind.mode === 'cursor' || items.length > 0) {
          outcome = await kind.step(context, {
            job: { id: jobId, params, checkpoint, attempts: row.attempts },
            ...(kind.mode === 'items' ? { items } : {}),
            limit,
          });
        }
        const failed = outcome.failed;
        if (failed !== undefined && !KNOWN_CODES.has(failed.code)) {
          throw new Error(`Kind ${kind.kind} ended a job with a code the error map doesn't hold.`);
        }
        const decided = new Map<number, ItemOutcome>((outcome.items ?? []).map((item) => [item.position, item]));
        // A step that ends the job may leave items undecided (they stay pending); any other decides every one.
        if (failed === undefined && kind.mode === 'items' && items.some((item) => !decided.has(item.position))) {
          throw new Error(`Kind ${kind.kind} left an item of its batch undecided.`);
        }
        const written = items.filter((item) => decided.has(item.position));
        const counts: Counts =
          kind.mode === 'items'
            ? {
                done: [...decided.values()].filter((item) => item.state === 'done').length,
                refused: [...decided.values()].filter((item) => item.state === 'refused').length,
                skipped: [...decided.values()].filter((item) => item.state === 'skipped').length,
              }
            : {
                done: outcome.counts?.done ?? 0,
                refused: outcome.counts?.refused ?? 0,
                skipped: outcome.counts?.skipped ?? 0,
              };
        if (written.length > 0) {
          // Every item state of the batch in one statement, from one JSON parameter.
          const states = JSON.stringify(
            written.map((item) => {
              const { state, code, message } = decided.get(item.position) ?? { state: 'done' };
              return { position: item.position, state, code: code ?? null, message: message ?? null };
            }),
          );
          await tx.execute(sql`
            update job_items as i
            set state = v.state::job_item_state, code = v.code, message = v.message
            from jsonb_to_recordset(${states}::jsonb) as v(position int, state text, code text, message text)
            where i.workspace_id = ${scope.workspaceId} and i.job_id = ${jobId} and i.position = v.position
          `);
        }
        const finished = failed === undefined && (outcome.finished || (kind.mode === 'items' && items.length < limit));
        const nextCheckpoint =
          kind.mode === 'items'
            ? {
                ...(typeof outcome.checkpoint === 'object' && outcome.checkpoint !== null ? outcome.checkpoint : {}),
                position: (failed === undefined ? items : written).at(-1)?.position ?? position,
              }
            : (outcome.checkpoint ?? checkpoint ?? null);
        const merged = {
          ...(typeof row.result === 'object' && row.result !== null ? row.result : {}),
          ...(outcome.result ?? {}),
        };
        const ends = finished || failed !== undefined;
        const result = ends ? { ...merged, refusals: await refusalGroups(tx, row) } : merged;
        await tx
          .update(jobs)
          .set({
            done: sql`${jobs.done} + ${counts.done}`,
            refused: sql`${jobs.refused} + ${counts.refused}`,
            skipped: sql`${jobs.skipped} + ${counts.skipped}`,
            checkpoint: nextCheckpoint,
            result: Object.keys(result).length === 0 ? null : result,
            attempts: 0,
            leaseUntil: leaseUntil(),
            updatedAt: sql`now()`,
            ...(finished ? { status: 'succeeded', finishedAt: sql`now()`, leaseOwner: null, leaseUntil: null } : {}),
            ...(failed === undefined
              ? {}
              : {
                  status: 'failed',
                  errorCode: failed.code,
                  errorMessage: failed.message,
                  finishedAt: sql`now()`,
                  leaseOwner: null,
                  leaseUntil: null,
                }),
          })
          .where(and(eq(jobs.workspaceId, scope.workspaceId), eq(jobs.id, jobId)));
        // The step ended the job: its hook runs here, in the same transaction (AC-124).
        if (failed !== undefined) await runOnFailed(context, row, kind, params, failed);
        // Progress at most once a second per job, and always the last (AC-106).
        if (progressDue(jobId, ends)) {
          context.record({ jobs: [starter] });
          event.stored = true;
        }
        return { kind: failed === undefined ? 'done' : 'failed', finished, counts };
      },
      hooks,
    );
    if (event.stored) {
      lastSent.set(jobId, now());
      deps.onStored?.();
    }
    return result;
  }

  /** What one snapshot batch decided. */
  type SnapshotBatch = 'cancelled' | 'ended' | 'more' | 'ready' | 'queued' | 'too-large';

  /**
   * Runs one snapshot batch (spec 0008, Snapshot) as one transaction: the
   * kind's next page of ids after the checkpoint's, stored at the next
   * positions with the checkpoint. A short page finishes it: the job waits for
   * its confirm (`ready`, with a queue row at its expiry), or is queued.
   */
  async function snapshotBatch(
    scope: EngineScope,
    kind: AnyKind,
    params: unknown,
    jobId: string,
  ): Promise<SnapshotBatch> {
    const event = { stored: false };
    const { result } = await runWrite(
      scope,
      async (context): Promise<SnapshotBatch> => {
        const { tx } = context;
        const [row] = await tx
          .select()
          .from(jobs)
          .where(and(eq(jobs.workspaceId, scope.workspaceId), eq(jobs.id, jobId)))
          .for('no key update');
        if (row === undefined) throw new Error('The job went away while it ran.');
        if (row.finishedAt !== null) return 'ended';
        if (row.cancelRequestedAt !== null) {
          await cancelIn(context, jobId, row.createdByMemberId);
          event.stored = true;
          return 'cancelled';
        }
        if (kind.snapshot === undefined) throw new Error(`Kind ${kind.kind} has no snapshot.`);
        const at = readSnapshotCheckpoint(row.checkpoint);
        const ids = await kind.snapshot(context, params, at.after, SNAPSHOT_PAGE);
        if (!ids.every(isUuid)) throw new Error(`Kind ${kind.kind}'s snapshot answered something other than ids.`);
        if (at.count + ids.length > limitsOf(scope).jobItems) return 'too-large';
        const stored = await insertItems(tx, scope.workspaceId, jobId, ids, at.position);
        const last = ids.at(-1);
        const next: SnapshotCheckpoint = {
          ...at,
          count: at.count + stored,
          position: at.position + ids.length,
          ...(last === undefined ? {} : { after: last }),
        };
        const starter = { jobId, startedBy: row.createdByMemberId };
        const where = and(eq(jobs.workspaceId, scope.workspaceId), eq(jobs.id, jobId));
        if (ids.length === SNAPSHOT_PAGE) {
          await tx
            .update(jobs)
            .set({ checkpoint: { snapshot: next }, leaseUntil: leaseUntil(), updatedAt: sql`now()` })
            .where(where);
          if (progressDue(jobId, false)) {
            context.record({ jobs: [starter] });
            event.stored = true;
          }
          return 'more';
        }
        context.record({ jobs: [starter] });
        event.stored = true;
        if (at.confirm) {
          const expiresAt = instant(now() + confirmMs);
          // Queued while still `preparing`: the row at its expiry ends it if nobody confirms (AC-109).
          await enqueue(tx, jobId, expiresAt);
          await tx
            .update(jobs)
            .set({
              status: 'ready',
              total: next.count,
              checkpoint: null,
              expiresAt,
              leaseOwner: null,
              leaseUntil: null,
              updatedAt: sql`now()`,
            })
            .where(where);
          return 'ready';
        }
        await tx
          .update(jobs)
          .set({ status: 'queued', total: next.count, checkpoint: null, updatedAt: sql`now()` })
          .where(where);
        return 'queued';
      },
      deps.hooks(),
    );
    if (event.stored) {
      lastSent.set(jobId, now());
      deps.onStored?.();
    }
    return result;
  }

  /**
   * Counts a failed try (fresh transaction): `retry` for Graphile's backoff,
   * or `failed` once at the kind's limit, ended `JOB_FAILED` with its hook
   * (thrown on when the hook throws: the next try ends it again).
   */
  async function failedTry(row: JobRow, kind: AnyKind, params: unknown): Promise<'retry' | 'failed'> {
    const scope = deps.systemScope(row.workspaceId);
    const attempts = await inWorkspace(scope, async (tx) => {
      const [updated] = await tx
        .update(jobs)
        .set({
          attempts: sql`${jobs.attempts} + 1`,
          leaseOwner: null,
          leaseUntil: null,
          // Graphile's own next try (its backoff), shown on the page as "Retrying".
          runAt: sql`now() + make_interval(secs => ${retryDelayMs(row.attempts + 1) / 1000})`,
          updatedAt: sql`now()`,
        })
        .where(and(eq(jobs.workspaceId, row.workspaceId), eq(jobs.id, row.id), sql`${jobs.finishedAt} is null`))
        .returning({ attempts: jobs.attempts });
      return updated?.attempts;
    });
    // Ended meanwhile (its cancel landed at once): nothing to retry.
    if (attempts === undefined) return 'failed';
    if (attempts < kind.maxAttempts) return 'retry';
    deps.log.error('job.failed', { jobId: row.id, kind: row.kind, workspaceId: row.workspaceId, attempts });
    await end(row, 'failed', 'JOB_FAILED', { event: true, kind, params });
    return 'failed';
  }

  /** The slice once claimed (steps 2 to 5): who, the batches, the hand over. */
  async function work(
    claimed: Extract<Claim, { kind: 'claimed' }>,
    leaseOwner: string,
    started: number,
    signal: AbortSignal | undefined,
  ): Promise<SliceOutcome> {
    const { row } = claimed;
    const fields = { jobId: row.id, kind: row.kind, workspaceId: row.workspaceId, slice: row.slices };
    deps.log.info('job.slice.start', fields);
    const finish = (outcome: SliceOutcome, extra: Record<string, unknown> = {}) => {
      deps.log.info('job.slice.end', { ...fields, ...extra, outcome, durationMs: now() - started });
      return outcome;
    };
    if (claimed.workspaceGone) {
      await end(row, 'cancelled', 'WORKSPACE_GONE', { event: false });
      return finish('cancelled');
    }
    // The params are checked again at every slice (AC-116): a deploy may have changed the kind, or removed it.
    const kind = deps.registry.get(row.kind);
    const parsed = kind?.params.safeParse(row.params);
    if (kind === undefined || parsed?.success !== true) {
      await end(row, 'failed', 'JOB_INVALID', { event: true, kind });
      return finish('failed');
    }
    const params = parsed.data;
    // Its tries were used up and its ending rolled back (the hook threw): end it again, before any work.
    if (row.attempts >= kind.maxAttempts) {
      await end(row, 'failed', 'JOB_FAILED', { event: true, kind, params });
      return finish('failed');
    }
    const scope = await enter(row);
    if (scope === 'ACTOR_REMOVED' || scope === 'JOB_INVALID') {
      await end(row, 'failed', scope, { event: true, kind, params });
      return finish('failed');
    }
    let batches = 0;
    const total = { done: 0, refused: 0, skipped: 0 };
    try {
      const preparing = row.status === 'preparing';
      for (;;) {
        if (preparing) {
          const outcome = await snapshotBatch(scope, kind, params, row.id);
          batches += 1;
          if (outcome === 'ended') return finish('finished-already', { batches });
          if (outcome === 'cancelled') return finish('cancelled', { batches });
          if (outcome === 'too-large') {
            await end(row, 'failed', 'JOB_TOO_LARGE', { event: true, kind, params });
            return finish('failed', { batches });
          }
          if (outcome === 'ready') return finish('ready', { batches });
          // The snapshot is done and the job queued: the next slice works through its items.
          if (outcome === 'queued') break;
        } else {
          const outcome = await batch(scope, kind, params, row.id);
          batches += 1;
          if (outcome.kind === 'ended') return finish('finished-already', { batches, ...total });
          if (outcome.kind === 'cancelled') return finish('cancelled', { batches, ...total });
          total.done += outcome.counts.done;
          total.refused += outcome.counts.refused;
          total.skipped += outcome.counts.skipped;
          if (outcome.kind === 'failed') {
            lastSent.delete(row.id);
            return finish('failed', { batches, ...total });
          }
          if (outcome.finished) {
            lastSent.delete(row.id);
            return finish('succeeded', { batches, ...total });
          }
        }
        if (signal?.aborted === true || now() - started >= (kind.lane === 'light' ? lightSliceMs : sliceMs)) break;
      }
    } catch (error) {
      deps.log.warn('job.batch.failed', {
        ...fields,
        batches,
        attempt: row.attempts + 1,
        // The error's class and code only: a message may quote a value.
        error: error instanceof Error ? error.name : 'unknown',
      });
      const ended = await failedTry(row, kind, params);
      if (ended === 'failed') return finish('failed', { batches, ...total });
      // Thrown on, so Graphile tries again after its backoff; the batch that failed rolled back whole.
      finish('retrying', { batches, ...total });
      throw error;
    }
    // Hand over (step 4): the next slice queues behind every row already waiting, and its event carries the
    // progress the slice's last batches made (they may have been inside the once a second throttle), so a job
    // waiting for a slot never shows stale counts. A job ended meanwhile (a cancel that landed at once) is queued
    // no more. The next slice may run in another process, so this one forgets the job's throttle.
    const handed = await runWrite(
      deps.systemScope(row.workspaceId),
      async (context) => {
        await context.tx
          .update(jobs)
          .set({ leaseOwner: null, leaseUntil: null, updatedAt: sql`now()` })
          .where(and(eq(jobs.workspaceId, row.workspaceId), eq(jobs.id, row.id), eq(jobs.leaseOwner, leaseOwner)));
        const queued = await tryEnqueue(context.tx, row.id);
        if (queued) context.record({ jobs: [{ jobId: row.id, startedBy: row.createdByMemberId }] });
        return queued;
      },
      deps.hooks(),
    );
    lastSent.delete(row.id);
    if (handed.result) deps.onStored?.();
    return finish(signal?.aborted === true ? 'stopped' : 'handed-over', { batches, ...total });
  }

  /** Lets go of a slice's lease when it threw, so Graphile's retry can claim the job again at once. */
  async function release(row: JobRow, leaseOwner: string): Promise<void> {
    await inWorkspace(deps.systemScope(row.workspaceId), (tx) =>
      tx
        .update(jobs)
        .set({ leaseOwner: null, leaseUntil: null, updatedAt: sql`now()` })
        .where(and(eq(jobs.workspaceId, row.workspaceId), eq(jobs.id, row.id), eq(jobs.leaseOwner, leaseOwner))),
    );
  }

  return {
    async runSlice(payload, signal) {
      const started = now();
      slicesStarted += 1;
      const leaseOwner = `${worker}:${String(slicesStarted)}`;
      const claimed = await claim(payload, leaseOwner);
      if (claimed.kind === 'expired') {
        await end(claimed.row, 'cancelled', 'JOB_EXPIRED', { event: true, whileStatus: 'ready' });
        deps.log.info('job.expired', {
          jobId: claimed.row.id,
          kind: claimed.row.kind,
          workspaceId: claimed.row.workspaceId,
        });
        return 'cancelled';
      }
      if (claimed.kind === 'leased-elsewhere') {
        // A second queue row of a job another slice holds (a deploy overlap, a stale lock released): it waits.
        deps.log.info('job.leased-elsewhere', { jobId: payload.jobId, workspaceId: payload.workspaceId });
      }
      if (claimed.kind !== 'claimed') return claimed.kind;
      try {
        return await work(claimed, leaseOwner, started, signal);
      } catch (error) {
        // Whatever threw, its lease goes with it (a failed try already let go of it).
        await release(claimed.row, leaseOwner).catch(() => undefined);
        throw error;
      }
    },
  };
}
