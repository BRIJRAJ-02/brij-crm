// What the load harness reads about the database server itself (spec 0011,
// AC-201, AC-204): its clock, the WAL it has written, the statements with the
// most time (`pg_stat_statements`), and PgBouncer's waits (`SHOW POOLS`). None
// of it reads tenant data. The harness opens it on the load stack's owner
// login and its pooler; nothing in the API or the worker uses it. Its own entry,
// `@crm/db/stats`, which lint refuses outside packages/load and tests.
import pg from 'pg';

/** One statement from `pg_stat_statements`: its normalised text (constants as `$n`) and its totals. */
export interface TopStatement {
  readonly query: string;
  readonly calls: number;
  readonly totalMs: number;
  readonly meanMs: number;
  readonly rows: number;
}

/** The server's own numbers, on one connection of their own. */
export interface ServerStats {
  /** The database's `clock_timestamp()`, in milliseconds since the epoch. */
  readonly clock: () => Promise<number>;
  /** Bytes of WAL written since the server's statistics were last reset (`pg_stat_wal`). */
  readonly walBytes: () => Promise<number>;
  /**
   * Starts `pg_stat_statements` afresh for this database. False when the
   * extension isn't there, or this login may not reset it.
   */
  readonly resetStatements: () => Promise<boolean>;
  /** The `limit` statements with the most total time in this database, or undefined without the extension. */
  readonly topStatements: (limit: number) => Promise<readonly TopStatement[] | undefined>;
  readonly close: () => Promise<void>;
}

/** Postgres's codes for a missing relation or function, and for a library that isn't loaded or allowed. */
const UNAVAILABLE = new Set(['42P01', '42883', '55000', '42501']);

function isUnavailable(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && UNAVAILABLE.has(String(error.code));
}

/** The server's numbers on one connection to `url` (the load stack's owner login). */
export async function openServerStats(options: { url: string; applicationName: string }): Promise<ServerStats> {
  const client = new pg.Client({ connectionString: options.url, application_name: options.applicationName });
  await client.connect();
  return {
    async clock() {
      const result = await client.query<{ at: string }>(
        'select (extract(epoch from clock_timestamp()) * 1000)::float8::text as at',
      );
      return Number(result.rows[0]?.at);
    },
    async walBytes() {
      const result = await client.query<{ bytes: string }>('select wal_bytes::text as bytes from pg_stat_wal');
      return Number(result.rows[0]?.bytes ?? 0);
    },
    async resetStatements() {
      try {
        await client.query(
          'select pg_stat_statements_reset(0, (select oid from pg_database where datname = current_database()), 0)',
        );
        return true;
      } catch (error) {
        if (isUnavailable(error)) return false;
        throw error;
      }
    },
    async topStatements(limit) {
      try {
        const result = await client.query<{
          query: string;
          calls: string;
          total: number;
          mean: number;
          rows: string;
        }>(
          `select query, calls::text, total_exec_time as total, mean_exec_time as mean, rows::text
           from pg_stat_statements where dbid = (select oid from pg_database where datname = current_database())
           order by total_exec_time desc limit $1`,
          [limit],
        );
        return result.rows.map((row) => ({
          query: row.query,
          calls: Number(row.calls),
          totalMs: row.total,
          meanMs: row.mean,
          rows: Number(row.rows),
        }));
      } catch (error) {
        if (isUnavailable(error)) return undefined;
        throw error;
      }
    },
    close: () => client.end(),
  };
}

/** One pool PgBouncer keeps: its database, its login, how many clients wait, and the longest wait now. */
export interface PoolerPool {
  readonly database: string;
  readonly user: string;
  readonly waiting: number;
  readonly maxWaitMs: number;
}

/**
 * PgBouncer's pools now (`SHOW POOLS` on its admin database `pgbouncer`),
 * read as a stats user over `url`, whose database name is replaced by
 * `pgbouncer`. One short connection per read.
 */
export async function readPoolerPools(url: string): Promise<readonly PoolerPool[]> {
  const admin = new URL(url);
  admin.pathname = '/pgbouncer';
  const client = new pg.Client({ connectionString: admin.href });
  await client.connect();
  try {
    const result = await client.query<Record<string, string | number | null>>('SHOW POOLS');
    return result.rows.map((row) => ({
      database: String(row.database ?? ''),
      user: String(row.user ?? ''),
      waiting: Number(row.cl_waiting ?? 0),
      maxWaitMs: Number(row.maxwait ?? 0) * 1000 + Number(row.maxwait_us ?? 0) / 1000,
    }));
  } finally {
    await client.end();
  }
}
