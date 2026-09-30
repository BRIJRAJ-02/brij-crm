import { sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema/index.ts';

type Drizzle = NodePgDatabase<typeof schema>;
export type WorkspaceTx = Parameters<Parameters<Drizzle['transaction']>[0]>[0];

export interface DatabaseOptions {
  /** The pooled connection (Neon pooler, or PgBouncer locally), as the app role. */
  url: string;
  applicationName: string;
  maxConnections?: number;
  onPoolError?: (error: Error) => void;
}

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
  /** Refuses to continue if this connection could bypass row level security. */
  assertAppRole(): Promise<void>;
  close(): Promise<void>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createDatabase(options: DatabaseOptions): Database {
  const pool = new pg.Pool({
    connectionString: options.url,
    application_name: options.applicationName,
    max: options.maxConnections ?? 10,
  });
  // An idle client can drop (a deploy, a Neon restart). Report it; the pool replaces it.
  pool.on('error', (error) => (options.onPoolError ?? console.error)(error));

  const db = drizzle({ client: pool, schema });

  return {
    async withWorkspace(workspaceId, work) {
      if (!UUID.test(workspaceId)) {
        throw new TypeError('withWorkspace needs a workspace id (a uuid).');
      }
      return db.transaction(async (tx) => {
        await tx.execute(sql`select set_config('app.workspace_id', ${workspaceId}, true)`);
        return work(tx);
      });
    },

    async checkHealth() {
      const started = performance.now();
      const result = await pool.query<{ server_version: string }>('show server_version');
      return {
        serverVersion: result.rows[0]?.server_version ?? 'unknown',
        latencyMs: Math.round(performance.now() - started),
      };
    },

    async assertAppRole() {
      const result = await pool.query<{
        role: string;
        rolsuper: boolean;
        rolbypassrls: boolean;
        owns_database: boolean;
        is_app_member: boolean;
      }>(`
        select
          r.rolname as role,
          r.rolsuper,
          r.rolbypassrls,
          d.datdba = r.oid as owns_database,
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
      if (row.rolsuper || row.rolbypassrls || row.owns_database) {
        throw new Error(
          `The app is connected as "${row.role}", which can bypass row level security. ` +
            'Point DATABASE_URL at the app login role (see `pnpm db:app-login`).',
        );
      }
      if (!row.is_app_member) {
        throw new Error(
          `The role "${row.role}" is not a member of crm_app. Run \`pnpm db:migrate\` and \`pnpm db:app-login\`.`,
        );
      }
    },

    close: () => pool.end(),
  };
}
