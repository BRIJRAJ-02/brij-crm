// The job runner (spec 0008, One slice): one call runs one slice of one job.
// It claims the job with a lease, enters its actor again (the member through
// `enterAsActor`, so a removed member stops it; the system through
// `systemScope`), runs batches for about 20 seconds (each one engine
// transaction that does the work and saves the item states, the counts, the
// checkpoint and, at most once a second, the job's change event), checks for
// a cancel between batches, and hands the job back to the queue behind
// everyone already waiting. Graphile Worker only wakes it and orders the
// slices. Everything it needs comes in as an argument: the clock, the
// database, the hooks, the scope makers, the log and the shutdown signal.
import { hostname } from 'node:os';
import { and, eq, sql } from 'drizzle-orm';
import { isFinishedJob, REFUSAL_GROUP_IDS, type QueuePayload } from '@crm/contracts';
import { schema, type Database, type WorkspaceTx } from '@crm/db';
import { inWorkspace } from '../access/run.ts';
import { isRefusal } from '../engine/refusals.ts';
import type { Actor, EngineScope } from '../engine/scope.ts';
import { runWrite, type AfterWrite, type WriteContext } from '../engine/write.ts';
import type { AnyKind, ItemOutcome, JobRegistry, StepOutcome } from './registry.ts';
import { enqueue } from './service.ts';

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
  /** Who holds the lease: `<hostname>:<pid>:<start time>` by default. */
  readonly leaseOwner?: string;
  /** How long a slice runs batches before it hands the job back (20 seconds). */
  readonly sliceMs?: number;
  /** How long a lease lasts past each batch (60 seconds). */
  readonly leaseMs?: number;
  /** At most one progress event per job this often (1 second); the final one always goes. */
  readonly progressMs?: number;
}

/** How a slice ended, for the log and the tests. */
export type SliceOutcome =
  | 'gone'
  | 'finished-already'
  | 'leased-elsewhere'
  | 'handed-over'
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
const LEASE_MS = 60_000;
const PROGRESS_MS = 1_000;

/** The plain sentences a job ends with (spec 0008; AC-104, AC-113). Never a value. */
const ENDINGS = {
  JOB_FAILED: 'This job stopped after repeated errors. What it finished is kept.',
  JOB_INVALID: 'This job can’t run any more: its settings are no longer valid. What it finished is kept.',
  ACTOR_REMOVED: 'The member who started this job was removed, so it stopped. What it finished is kept.',
  WORKSPACE_GONE: 'The workspace was deleted.',
} as const;

/** Graphile Worker's wait before try `attempt` + 1: `exp(min(attempt, 10))` seconds. */
export function retryDelayMs(attempt: number): number {
  return Math.round(Math.exp(Math.min(attempt, 10)) * 1000);
}

type JobRow = typeof jobs.$inferSelect;

/** Makes the runner. */
export function createRunner(deps: RunnerDeps): Runner {
  const now = deps.now ?? Date.now;
  const leaseOwner = deps.leaseOwner ?? `${hostname()}:${String(process.pid)}:${String(Date.now())}`;
  const sliceMs = deps.sliceMs ?? SLICE_MS;
  const leaseMs = deps.leaseMs ?? LEASE_MS;
  const progressMs = deps.progressMs ?? PROGRESS_MS;
  // When each job's last progress event was stored, by job id: at most one a second, in this closure only.
  const lastSent = new Map<string, number>();
  const leaseUntil = () => sql`to_timestamp(${(now() + leaseMs) / 1000})`;

  /** Ends a job outside a batch (it can't run, or it ran out of tries), with its final event. */
  async function end(
    row: JobRow,
    status: 'failed' | 'cancelled',
    code: keyof typeof ENDINGS,
    event: boolean,
  ): Promise<void> {
    const scope = deps.systemScope(row.workspaceId);
    await runWrite(
      scope,
      async (context) => {
        await context.tx
          .update(jobs)
          .set({
            status,
            errorCode: code,
            errorMessage: ENDINGS[code],
            finishedAt: sql`now()`,
            leaseOwner: null,
            leaseUntil: null,
            updatedAt: sql`now()`,
          })
          .where(and(eq(jobs.workspaceId, row.workspaceId), eq(jobs.id, row.id), sql`${jobs.finishedAt} is null`));
        if (event) context.record({ jobs: [{ jobId: row.id, startedBy: row.createdByMemberId }] });
      },
      event ? deps.hooks() : [],
    );
    if (event) deps.onStored?.();
    lastSent.delete(row.id);
  }

  /** Claims the job (step 1): the row under lock, its lease, `running`, one more slice. */
  async function claim(
    payload: QueuePayload,
  ): Promise<
    | { readonly kind: 'claimed'; readonly row: JobRow; readonly workspaceGone: boolean }
    | { readonly kind: 'gone' | 'finished-already' | 'leased-elsewhere' }
  > {
    const scope = deps.systemScope(payload.workspaceId);
    return inWorkspace(scope, async (tx) => {
      const [row] = await tx
        .select()
        .from(jobs)
        .where(and(eq(jobs.workspaceId, payload.workspaceId), eq(jobs.id, payload.jobId)))
        .for('update');
      if (row === undefined) return { kind: 'gone' as const };
      if (isFinishedJob(row.status) || row.status === 'ready') return { kind: 'finished-already' as const };
      if (row.leaseUntil !== null && row.leaseUntil.getTime() > now() && row.leaseOwner !== leaseOwner) {
        // Another runner holds it (a deploy overlap, a stale lock released): come back when its lease ends.
        await enqueue(tx, row.id, sql`${row.leaseUntil.toISOString()}::timestamptz`);
        return { kind: 'leased-elsewhere' as const };
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
      if (claimed === undefined) return { kind: 'gone' as const };
      return { kind: 'claimed' as const, row: claimed, workspaceGone: (workspace?.deletedAt ?? null) !== null };
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
  async function refusalGroups(tx: WorkspaceTx, row: JobRow) {
    const result = await tx.execute<{ code: string; count: number; item_ids: string[] }>(sql`
      select coalesce(code, '') as code, count(*)::int as count,
        (array_agg(item_id order by position))[1:${REFUSAL_GROUP_IDS}] as item_ids
      from job_items
      where workspace_id = ${row.workspaceId} and job_id = ${row.id} and state = 'refused'
      group by 1 order by 2 desc, 1
    `);
    return result.rows.map((group) => ({ code: group.code, count: group.count, itemIds: group.item_ids }));
  }

  /** What one batch decided. */
  type Batch =
    { readonly kind: 'cancelled' } | { readonly kind: 'done'; readonly finished: boolean; readonly counts: Counts };

  interface Counts {
    readonly done: number;
    readonly refused: number;
    readonly skipped: number;
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
        const starter = { jobId, startedBy: row.createdByMemberId };
        if (row.cancelRequestedAt !== null) {
          await tx
            .update(jobs)
            .set({
              status: 'cancelled',
              finishedAt: sql`now()`,
              leaseOwner: null,
              leaseUntil: null,
              updatedAt: sql`now()`,
            })
            .where(and(eq(jobs.workspaceId, scope.workspaceId), eq(jobs.id, jobId)));
          context.record({ jobs: [starter] });
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
        const decided = new Map<number, ItemOutcome>((outcome.items ?? []).map((item) => [item.position, item]));
        if (kind.mode === 'items' && items.some((item) => !decided.has(item.position))) {
          throw new Error(`Kind ${kind.kind} left an item of its batch undecided.`);
        }
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
        if (kind.mode === 'items' && items.length > 0) {
          // Every item state of the batch in one statement, from one JSON parameter.
          const states = JSON.stringify(
            items.map((item) => {
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
        const finished = outcome.finished || (kind.mode === 'items' && items.length < limit);
        const nextCheckpoint =
          kind.mode === 'items'
            ? {
                ...(typeof outcome.checkpoint === 'object' && outcome.checkpoint !== null ? outcome.checkpoint : {}),
                position: items.at(-1)?.position ?? position,
              }
            : (outcome.checkpoint ?? checkpoint ?? null);
        const merged = {
          ...(typeof row.result === 'object' && row.result !== null ? row.result : {}),
          ...(outcome.result ?? {}),
        };
        const result = finished ? { ...merged, refusals: await refusalGroups(tx, row) } : merged;
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
          })
          .where(and(eq(jobs.workspaceId, scope.workspaceId), eq(jobs.id, jobId)));
        // Progress at most once a second per job, and always the last (AC-106).
        const sentAt = lastSent.get(jobId);
        if (finished || sentAt === undefined || now() - sentAt >= progressMs) {
          context.record({ jobs: [starter] });
          event.stored = true;
        }
        return { kind: 'done', finished, counts };
      },
      hooks,
    );
    if (event.stored) {
      lastSent.set(jobId, now());
      deps.onStored?.();
    }
    return result;
  }

  /** Counts a failed try (fresh transaction): `retry` for Graphile's backoff, or `failed` once at the kind's limit. */
  async function failedTry(row: JobRow, kind: AnyKind): Promise<'retry' | 'failed'> {
    const scope = deps.systemScope(row.workspaceId);
    const attempts = await inWorkspace(scope, async (tx) => {
      const [updated] = await tx
        .update(jobs)
        .set({
          attempts: sql`${jobs.attempts} + 1`,
          leaseOwner: null,
          leaseUntil: null,
          // Graphile's own next try (its backoff), shown on the page as "Retrying at".
          runAt: sql`now() + make_interval(secs => ${retryDelayMs(row.attempts + 1) / 1000})`,
          updatedAt: sql`now()`,
        })
        .where(and(eq(jobs.workspaceId, row.workspaceId), eq(jobs.id, row.id)))
        .returning({ attempts: jobs.attempts });
      return updated?.attempts ?? kind.maxAttempts;
    });
    if (attempts < kind.maxAttempts) return 'retry';
    deps.log.error('job.failed', { jobId: row.id, kind: row.kind, workspaceId: row.workspaceId, attempts });
    await end(row, 'failed', 'JOB_FAILED', true);
    return 'failed';
  }

  return {
    async runSlice(payload, signal) {
      const started = now();
      const claimed = await claim(payload);
      if (claimed.kind !== 'claimed') return claimed.kind;
      const { row } = claimed;
      const fields = { jobId: row.id, kind: row.kind, workspaceId: row.workspaceId, slice: row.slices };
      deps.log.info('job.slice.start', fields);
      const finish = (outcome: SliceOutcome, extra: Record<string, unknown> = {}) => {
        deps.log.info('job.slice.end', { ...fields, ...extra, outcome, durationMs: now() - started });
        return outcome;
      };
      if (claimed.workspaceGone) {
        await end(row, 'cancelled', 'WORKSPACE_GONE', false);
        return finish('cancelled');
      }
      const kind = deps.registry.get(row.kind);
      const params = kind?.params.safeParse(row.params);
      if (kind === undefined || params?.success !== true) {
        await end(row, 'failed', 'JOB_INVALID', true);
        return finish('failed');
      }
      const scope = await enter(row);
      if (scope === 'ACTOR_REMOVED' || scope === 'JOB_INVALID') {
        await end(row, 'failed', scope, true);
        return finish('failed');
      }
      let batches = 0;
      const total = { done: 0, refused: 0, skipped: 0 };
      try {
        for (;;) {
          const outcome = await batch(scope, kind, params.data, row.id);
          batches += 1;
          if (outcome.kind === 'cancelled') return finish('cancelled', { batches, ...total });
          total.done += outcome.counts.done;
          total.refused += outcome.counts.refused;
          total.skipped += outcome.counts.skipped;
          if (outcome.finished) {
            lastSent.delete(row.id);
            return finish('succeeded', { batches, ...total });
          }
          if (signal?.aborted === true || now() - started >= sliceMs) break;
        }
      } catch (error) {
        deps.log.warn('job.batch.failed', {
          ...fields,
          batches,
          attempt: row.attempts + 1,
          // The error's class and code only: a message may quote a value.
          error: error instanceof Error ? error.name : 'unknown',
        });
        const ended = await failedTry(row, kind);
        if (ended === 'failed') return finish('failed', { batches, ...total });
        // Thrown on, so Graphile tries again after its backoff; the batch that failed rolled back whole.
        finish('retrying', { batches, ...total });
        throw error;
      }
      // Hand over (step 4): the next slice queues behind every row already waiting.
      await inWorkspace(deps.systemScope(row.workspaceId), async (tx) => {
        await tx
          .update(jobs)
          .set({ leaseOwner: null, leaseUntil: null, updatedAt: sql`now()` })
          .where(and(eq(jobs.workspaceId, row.workspaceId), eq(jobs.id, row.id), eq(jobs.leaseOwner, leaseOwner)));
        await enqueue(tx, row.id);
      });
      return finish(signal?.aborted === true ? 'stopped' : 'handed-over', { batches, ...total });
    },
  };
}
