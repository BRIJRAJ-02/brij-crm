// The worker's queue connection (spec 0008): one small pool on the direct
// connection, logged in as `crm_worker_user` (the only login whose group,
// crm_worker, reads and changes Graphile Worker's tables). Graphile's two
// runners share it, and the worker reads the queue's health through it:
// stale locks to release, and the backlog it logs once a minute. The daily
// cleanup (milestone 3) works through it too: which jobs still have a queue
// row, the dead rows it deletes, the outbox it prunes and the workspaces it
// lists, all things only crm_worker may do. It reads ids and times only; the
// queue holds nothing else.
import pg from 'pg';
import { assertDirectUrl } from './direct.ts';
import { pruneOutbox } from './outbox.ts';

/** The schema Graphile Worker keeps its queue in. */
export const QUEUE_SCHEMA = 'graphile_worker';

/** The queue's pool and what the worker asks of it. */
export interface QueueConnection {
  /** The pool Graphile's runners share (LISTEN included): at most `max` connections. */
  readonly pool: pg.Pool;
  /**
   * Releases the locks of workers whose every queue and job lock is older
   * than `olderThanSeconds` (2 minutes): no live runner call is that old, so
   * only a dead process holds them, and a worker with any newer lock is left
   * alone. Answers how many workers' locks were released.
   */
  releaseStaleLocks(olderThanSeconds?: number): Promise<number>;
  /** How many queue rows are due and unlocked, and how long the oldest has waited, in seconds. */
  backlog(): Promise<{ readonly waiting: number; readonly oldestSeconds: number }>;
  /**
   * Which of a workspace's jobs still have a queue row (by job key
   * `crm-job:<workspace_id>:<id>`, locked or not): the daily cleanup queues
   * again only a job with none (AC-112). A row a hand over cleared the key of
   * (a dead row) doesn't count, since it never runs again.
   */
  rows(workspaceId: string, jobIds: readonly string[]): Promise<readonly string[]>;
  /**
   * Deletes dead queue rows, unlocked with their attempts used up (a killed
   * hand over's, or one that reached Graphile's backstop), through Graphile's
   * own `complete_jobs`, at most `DEAD_BATCH` a round until none is left;
   * answers how many went (AC-121).
   */
  deleteDead(): Promise<number>;
  /** The ids of workspaces not deleted, after `after`, in id order, at most `max` (1 to 500): `crm_workspace_ids`. */
  workspaceIds(after: string | undefined, max: number): Promise<readonly string[]>;
  /** One outbox prune batch (`pruneOutbox`, spec 0007) on this connection: only crm_worker may run it. */
  pruneOutbox(): Promise<number>;
  /**
   * What the worker reads before it sleeps (spec 0008, Letting the database
   * sleep), in one round trip: whether any queue row or queue is locked (a
   * call in flight, or a stale lock not yet released), when the earliest
   * runnable unlocked row is due, whether any outbox row waits to be
   * published (`crm_outbox_workspaces`, asked only when `outbox` is true: a
   * worker without a relay never publishes them), and the database's time.
   */
  sleepCheck(options: { readonly outbox: boolean }): Promise<SleepCheck>;
  close(): Promise<void>;
}

/** What the queue and the outbox say before the worker sleeps. */
export interface SleepCheck {
  readonly locked: boolean;
  /** The earliest unlocked row with attempts left, or undefined for none. */
  readonly nextRunAt: Date | undefined;
  readonly unpublished: boolean;
  /** The database's clock, so the worker compares times on one clock. */
  readonly now: Date;
}

/** The most dead queue rows one round deletes. */
export const DEAD_BATCH = 1_000;

/** The job key `crm_enqueue_job` gives a job's queue row: the workspace and the job, since a job id is unique per workspace only. */
export function jobKey(workspaceId: string, jobId: string): string {
  return `crm-job:${workspaceId}:${jobId}`;
}

/** How old a lock must be before a stale lock release takes it: no live call runs 2 minutes (each returns by 30). */
export const STALE_LOCK_SECONDS = 120;

/**
 * Opens the queue's pool on `url` (`DATABASE_URL_DIRECT`, refused when it is
 * a Neon pooler: Graphile LISTENs). `onError` hears an idle client failing.
 */
export function openQueueConnection(options: {
  readonly url: string;
  readonly applicationName: string;
  readonly max?: number;
  readonly onError?: (error: Error) => void;
}): QueueConnection {
  assertDirectUrl(options.url, 'DATABASE_URL_DIRECT');
  const pool = new pg.Pool({
    connectionString: options.url,
    application_name: options.applicationName,
    max: options.max ?? 4,
  });
  pool.on('error', (error) => (options.onError ?? console.error)(error));
  return {
    pool,
    async releaseStaleLocks(olderThanSeconds = STALE_LOCK_SECONDS) {
      const result = await pool.query<{ released: number }>(
        `with locks as (
           select locked_by, locked_at from ${QUEUE_SCHEMA}._private_jobs where locked_by is not null
           union all
           select locked_by, locked_at from ${QUEUE_SCHEMA}._private_job_queues where locked_by is not null
         ),
         -- A worker counts as dead only when every lock it holds is old: force_unlock_workers releases all of a
         -- worker's locks, so one still taking new ones (alive) is never touched.
         stale as (
           select locked_by from locks group by locked_by
           having max(locked_at) < now() - make_interval(secs => $1)
         ), ids as (select array_agg(locked_by) as workers from stale)
         select coalesce(array_length(workers, 1), 0)::int as released,
           ${QUEUE_SCHEMA}.force_unlock_workers(coalesce(workers, '{}'::text[]))
         from ids`,
        [olderThanSeconds],
      );
      return result.rows[0]?.released ?? 0;
    },
    async backlog() {
      const result = await pool.query<{ waiting: number; oldest: number }>(
        `select count(*)::int as waiting,
           coalesce(extract(epoch from now() - min(run_at)), 0)::int as oldest
         from ${QUEUE_SCHEMA}._private_jobs
         where run_at <= now() and locked_at is null and attempts < max_attempts`,
      );
      const row = result.rows[0];
      return { waiting: row?.waiting ?? 0, oldestSeconds: row?.oldest ?? 0 };
    },
    async rows(workspaceId, jobIds) {
      if (jobIds.length === 0) return [];
      const keys = jobIds.map((jobId) => jobKey(workspaceId, jobId));
      const result = await pool.query<{ key: string }>(
        `select key from ${QUEUE_SCHEMA}._private_jobs where key = any($1::text[])`,
        [keys],
      );
      const found = new Set(result.rows.map((row) => row.key));
      return jobIds.filter((jobId) => found.has(jobKey(workspaceId, jobId)));
    },
    async deleteDead() {
      let deleted = 0;
      for (;;) {
        const result = await pool.query<{ deleted: number }>(
          `select count(*)::int as deleted from ${QUEUE_SCHEMA}.complete_jobs(array(
             select id from ${QUEUE_SCHEMA}._private_jobs
             where locked_at is null and attempts >= max_attempts
             order by id limit $1
           ))`,
          [DEAD_BATCH],
        );
        const round = result.rows[0]?.deleted ?? 0;
        deleted += round;
        if (round < DEAD_BATCH) return deleted;
      }
    },
    async workspaceIds(after, max) {
      const result = await pool.query<{ id: string }>('select id from public.crm_workspace_ids($1, $2) as w(id)', [
        after ?? null,
        max,
      ]);
      return result.rows.map((row) => row.id);
    },
    pruneOutbox: () => pruneOutbox(pool),
    async sleepCheck({ outbox }) {
      const result = await pool.query<{
        locked: boolean;
        next_run_at: Date | null;
        unpublished: boolean;
        now: Date;
      }>(
        `select
           exists (select 1 from ${QUEUE_SCHEMA}._private_jobs where locked_at is not null)
             or exists (select 1 from ${QUEUE_SCHEMA}._private_job_queues where locked_at is not null) as locked,
           (select min(run_at) from ${QUEUE_SCHEMA}._private_jobs
             where locked_at is null and attempts < max_attempts) as next_run_at,
           case when $1::boolean
             then exists (select 1 from public.crm_outbox_workspaces(1, null))
             else false end as unpublished,
           now() as now`,
        [outbox],
      );
      const row = result.rows[0];
      if (row === undefined) throw new Error('The sleep check answered nothing.');
      return {
        locked: row.locked,
        nextRunAt: row.next_run_at ?? undefined,
        unpublished: row.unpublished,
        now: row.now,
      };
    },
    close: () => pool.end(),
  };
}
