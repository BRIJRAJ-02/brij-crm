import { sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema/index.ts';

/** Drizzle over this package's schema, on a pool or on one client. */
export type Drizzle = NodePgDatabase<typeof schema>;
export type WorkspaceTx = Parameters<Parameters<Drizzle['transaction']>[0]>[0];

export interface DatabaseOptions {
  /** The pooled connection (Neon pooler, or PgBouncer locally), as the app role. */
  url: string;
  applicationName: string;
  maxConnections?: number;
  onPoolError?: (error: Error) => void;
}

/** The tables `vacuumAnalyze` may tidy: the big tenant tables bulk loads fill. */
export const VACUUM_TABLES = ['records', 'values', 'record_links', 'list_entries', 'sort_keys'] as const;
export type VacuumTable = (typeof VACUUM_TABLES)[number];

export interface DatabaseHealth {
  serverVersion: string;
  latencyMs: number;
}

export interface Database {
  /**
   * The only way to run tenant queries. Opens a transaction and sets
   * `app.workspace_id` first, so row level security scopes every statement
   * to this workspace. Outside it, the policies match nothing.
   */
  withWorkspace<T>(workspaceId: string, work: (tx: WorkspaceTx) => Promise<T>): Promise<T>;
  /** A fixed readiness probe. It reads no tenant data. */
  checkHealth(): Promise<DatabaseHealth>;
  /**
   * Refuses to continue if this connection could bypass row level security
   * (itself, or through any role it is in, by any grant, even one held only
   * WITH ADMIN), or is in `pg_read_all_data` or `pg_write_all_data`, which
   * skip every grant.
   */
  assertAppRole(): Promise<void>;
  /**
   * Vacuums and analyzes whole tables after a bulk load, outside any
   * transaction (vacuum can't run in one), so index only scans have a current
   * visibility map. Reads no tenant data; only the fixed `VACUUM_TABLES`.
   * Needs the owner connection: Postgres skips tables it doesn't own, so this
   * refuses rather than silently doing nothing.
   */
  vacuumAnalyze(tables: readonly VacuumTable[]): Promise<void>;
  /**
   * Cancels the statement backend `pid` is running, only while that backend
   * still carries `tag` as its application name (set for one transaction by
   * the work being cancelled), so a connection since handed to another
   * request is never touched. Runs on its own one connection pool, so a
   * cancel never waits behind the work it cancels. Reads no tenant data.
   * Answers whether a running statement was cancelled.
   *
   * The check and the cancel are one statement, but `pg_stat_activity` is a
   * snapshot: if the tagged work finishes in the microseconds between the
   * snapshot and the signal, and its connection starts its next statement
   * (another request's, once the pool hands it on) in that window, that
   * statement is cancelled instead. It fails with `57014` and its request
   * sees `QUERY_CANCELLED` and retries: availability only, never data, the
   * same race Postgres's own cancel request has.
   */
  cancelTagged(pid: number, tag: string): Promise<boolean>;
  close(): Promise<void>;
}

/** How long a cancel waits for its connection before giving up. */
const CANCEL_CONNECT_TIMEOUT_MS = 2_000;

/** How long a cancel's own statement may run: set per transaction (the pooler refuses it as a startup setting). */
const CANCEL_STATEMENT_TIMEOUT = '2s';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `withWorkspace` itself, on any Drizzle instance: the pool's, or the outbox
 * reader's one direct client. Opens a transaction and sets `app.workspace_id`
 * first, so row level security scopes every statement to this workspace.
 * Throws a `TypeError` unless the id is a uuid.
 */
export function workspaceTransaction<T>(
  db: Drizzle,
  workspaceId: string,
  work: (tx: WorkspaceTx) => Promise<T>,
): Promise<T> {
  if (!UUID.test(workspaceId)) {
    return Promise.reject(new TypeError('withWorkspace needs a workspace id (a uuid).'));
  }
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.workspace_id', ${workspaceId}, true)`);
    return work(tx);
  });
}

export function createDatabase(options: DatabaseOptions): Database {
  const pool = new pg.Pool({
    connectionString: options.url,
    application_name: options.applicationName,
    max: options.maxConnections ?? 10,
  });
  // One connection of its own for cancels: a full main pool must never hold a cancel back. It uses the same
  // url as the work (the api's DATABASE_URL, Neon's pooler in production), not a direct one: the api has no
  // direct url (only the worker does), and through the pooler the cancel is an ordinary statement, so it
  // reaches the tagged backend's row in pg_stat_activity like any other session in the database. A
  // connection that can't be made in 2 seconds gives up, so one hung connect can't queue every later cancel.
  const cancelPool = new pg.Pool({
    connectionString: options.url,
    application_name: `${options.applicationName}-cancel`,
    max: 1,
    connectionTimeoutMillis: CANCEL_CONNECT_TIMEOUT_MS,
  });
  // An idle client can drop (a deploy, a Neon restart). Report it; the pool replaces it.
  pool.on('error', (error) => (options.onPoolError ?? console.error)(error));
  cancelPool.on('error', (error) => (options.onPoolError ?? console.error)(error));

  const db = drizzle({ client: pool, schema });

  return {
    withWorkspace: (workspaceId, work) => workspaceTransaction(db, workspaceId, work),

    async checkHealth() {
      const started = performance.now();
      const result = await pool.query<{ server_version: string }>('show server_version');
      return {
        serverVersion: result.rows[0]?.server_version ?? 'unknown',
        latencyMs: Math.round(performance.now() - started),
      };
    },

    async vacuumAnalyze(tables) {
      const unknown = tables.filter((table) => !(VACUUM_TABLES as readonly string[]).includes(table));
      if (unknown.length > 0) throw new TypeError(`Can't vacuum ${unknown.join(', ')}.`);
      const notOwned = await pool.query<{ name: string }>(
        `select c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relname = any($1) and not pg_has_role(c.relowner, 'USAGE')`,
        [tables],
      );
      if (notOwned.rows.length > 0) {
        throw new Error(
          `vacuumAnalyze needs the owner connection (not owner of ${notOwned.rows.map((row) => row.name).join(', ')}).`,
        );
      }
      for (const table of tables) await pool.query(`vacuum (analyze) "${table}"`);
    },

    async assertAppRole() {
      const result = await pool.query<{
        role: string;
        rolsuper: boolean;
        rolbypassrls: boolean;
        owns_database: boolean;
        reaches_bypass: boolean;
        reaches_all_data: string | null;
        is_app_member: boolean;
      }>(`
        select
          r.rolname as role,
          r.rolsuper,
          r.rolbypassrls,
          d.datdba = r.oid as owns_database,
          -- MEMBER follows every grant, even one with neither INHERIT nor SET: a role held WITH ADMIN can
          -- still be granted onward, so it counts as reached.
          exists (
            select 1 from pg_roles b
            where b.oid <> r.oid and (b.rolbypassrls or b.rolsuper)
              and pg_has_role(r.oid, b.oid, 'MEMBER')
          ) as reaches_bypass,
          (
            select string_agg(b.rolname, ', ' order by b.rolname) from pg_roles b
            where b.rolname in ('pg_read_all_data', 'pg_write_all_data')
              and pg_has_role(r.oid, b.oid, 'MEMBER')
          ) as reaches_all_data,
          exists (
            select 1
            from pg_auth_members m
            join pg_roles g on g.oid = m.roleid
            where g.rolname = 'crm_app' and m.member = r.oid
          ) as is_app_member
        from pg_roles r
        cross join pg_database d
        where r.rolname = current_user and d.datname = current_database()
      `);
      const row = result.rows[0];
      if (!row) throw new Error('Could not read the connected role.');
      // Through a role it can become (crm_search, say) counts too.
      if (row.rolsuper || row.rolbypassrls || row.owns_database || row.reaches_bypass) {
        throw new Error(
          `The app is connected as "${row.role}", which can bypass row level security. ` +
            'Point DATABASE_URL at the app login role (see `pnpm db:app-login`).',
        );
      }
      // pg_read_all_data and pg_write_all_data skip every grant, the `auth` schema's included.
      if (row.reaches_all_data !== null) {
        throw new Error(
          `The app is connected as "${row.role}", a member of ${row.reaches_all_data}, which reads or writes every table. ` +
            'Point DATABASE_URL at the app login role (see `pnpm db:app-login`).',
        );
      }
      if (!row.is_app_member) {
        throw new Error(
          `The role "${row.role}" is not a member of crm_app. Run \`pnpm db:migrate\` and \`pnpm db:app-login\`.`,
        );
      }
    },

    async cancelTagged(pid, tag) {
      const client = await cancelPool.connect();
      let broken: Error | undefined;
      try {
        // A short timeout of its own, local to this transaction, so a stuck cancel frees the one connection.
        await client.query('begin');
        await client.query(`set local statement_timeout = '${CANCEL_STATEMENT_TIMEOUT}'`);
        const result = await client.query<{ cancelled: boolean }>(
          `select pg_cancel_backend(pid) as cancelled from pg_stat_activity
           where pid = $1 and application_name = $2 and state = 'active'`,
          [pid, tag],
        );
        await client.query('commit');
        return result.rows.some((row) => row.cancelled);
      } catch (error) {
        broken = error instanceof Error ? error : new Error(String(error));
        throw error;
      } finally {
        // A connection that failed mid transaction is dropped rather than handed to the next cancel.
        client.release(broken);
      }
    },

    close: async () => {
      await Promise.all([pool.end(), cancelPool.end()]);
    },
  };
}
