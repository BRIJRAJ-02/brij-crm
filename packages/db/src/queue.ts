// The worker's queue connection (spec 0008): one small pool on the direct
// connection, logged in as `crm_worker_user` (the only login whose group,
// crm_worker, reads and changes Graphile Worker's tables). Graphile's two
// runners share it, and the worker reads the queue's health through it:
// stale locks to release, and the backlog it logs once a minute. It reads ids
// and times only; the queue holds nothing else.
import pg from 'pg';
import { assertDirectUrl } from './direct.ts';

/** The schema Graphile Worker keeps its queue in. */
export const QUEUE_SCHEMA = 'graphile_worker';

/** The queue's pool and what the worker asks of it. */
export interface QueueConnection {
  /** The pool Graphile's runners share (LISTEN included): at most `max` connections. */
  readonly pool: pg.Pool;
  /**
   * Releases the queue and job locks older than `olderThanSeconds` (2
   * minutes): no live runner call is that old, so only a dead process holds
   * them. Answers how many workers' locks were released.
   */
  releaseStaleLocks(olderThanSeconds?: number): Promise<number>;
  /** How many queue rows are due and unlocked, and how long the oldest has waited, in seconds. */
  backlog(): Promise<{ readonly waiting: number; readonly oldestSeconds: number }>;
  close(): Promise<void>;
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
        `with stale as (
           select locked_by from ${QUEUE_SCHEMA}._private_jobs
           where locked_at < now() - make_interval(secs => $1) and locked_by is not null
           union
           select locked_by from ${QUEUE_SCHEMA}._private_job_queues
           where locked_at < now() - make_interval(secs => $1) and locked_by is not null
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
    close: () => pool.end(),
  };
}
