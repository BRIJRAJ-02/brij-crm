// The identity store (spec 0005, sign in and access): the only code that
// reads or writes the `auth` schema. It answers the few questions the API asks
// before any workspace is set (which workspace has this address, which
// workspaces is this user in, who is this user), and builds Better Auth's
// database adapter, so the auth library never gets a pool of its own.
//
// It connects as the identity login (`IDENTITY_DATABASE_URL`, a member of
// `crm_identity`), the only role that reads and writes schema `auth`. The app
// login only inserts the two directory rows inside the workspace transaction.
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { and, asc, eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import type { DatabaseOptions } from '../client.ts';
import {
  account,
  rateLimit,
  session,
  user,
  verification,
  workspaceDirectory,
  workspaceMembership,
} from '../schema/auth.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Better Auth's models, keyed by its model names, as its Drizzle adapter looks them up. */
const AUTH_MODELS = { user, session, account, verification, rateLimit } as const;

/** A workspace as the directory knows it: enough to find it and to list it, never to enter it. */
export interface DirectoryWorkspace {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
}

/** A person who can sign in. `name` is empty until they give one. */
export interface IdentityUser {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly emailVerified: boolean;
}

/** What `betterAuth({ database })` takes: Better Auth's Drizzle adapter over the `auth` schema. */
export type AuthDatabase = ReturnType<typeof drizzleAdapter>;

/** A fixed window limit: at most `max` uses per `window` seconds. */
export interface RateLimitRule {
  readonly window: number;
  readonly max: number;
}

/** Whether a use was within its limit, and if not, the seconds until the window frees up. */
export interface RateLimitDecision {
  readonly allowed: boolean;
  readonly retryAfterSeconds: number | undefined;
}

/** Global identity: the directory, users, and Better Auth's storage. Reads no tenant data. */
export interface IdentityStore {
  /** The workspace at this address, or undefined. Lookup only: it grants nothing. */
  findWorkspace(slug: string): Promise<DirectoryWorkspace | undefined>;
  /** The workspaces this user was added to, oldest first (by when the directory row was made). */
  workspacesOf(userId: string): Promise<readonly DirectoryWorkspace[]>;
  /** The user with this id, or undefined. */
  getUser(id: string): Promise<IdentityUser | undefined>;
  /** Saves the name only when the user has none yet (an email code sign up starts empty). True when it saved. */
  setUserNameIfEmpty(id: string, name: string): Promise<boolean>;
  /**
   * Counts one use of `key` against `rule` in Better Auth's `auth.rate_limit`
   * table, in one atomic statement, so the limit holds across instances. For
   * limits Better Auth can't key itself (per email: it keys by IP and path).
   * A key here must not look like Better Auth's `<ip>|<path>`; prefix it.
   */
  consumeRateLimit(key: string, rule: RateLimitRule): Promise<RateLimitDecision>;
  /**
   * Refuses (throws) unless this store is connected as an identity login: a
   * member of `crm_identity`, outside `crm_app`, and unable to bypass row
   * level security or own the database. The api calls it before serving.
   */
  assertIdentityRole(): Promise<void>;
  /**
   * Better Auth's database: its Drizzle adapter (provider `pg`, transactions
   * on) over the `auth` schema, on this store's pool. Pass it to
   * `betterAuth({ database })` with `advanced.database.generateId: 'uuid'`.
   */
  authDatabase(): AuthDatabase;
  /** Closes the pool. */
  close(): Promise<void>;
}

/**
 * Opens the identity store on its own small pool, as the identity login role
 * (`IDENTITY_DATABASE_URL`, never the app's `DATABASE_URL`). The `auth` schema
 * has no row level security, so this pool needs no workspace setting, and the
 * identity login has no grant on any tenant table.
 */
export function createIdentityStore(options: DatabaseOptions): IdentityStore {
  const pool = new pg.Pool({
    connectionString: options.url,
    application_name: options.applicationName,
    max: options.maxConnections ?? 5,
  });
  pool.on('error', (error) => (options.onPoolError ?? console.error)(error));
  const db = drizzle({ client: pool, schema: AUTH_MODELS });

  const directoryColumns = {
    id: workspaceDirectory.workspaceId,
    slug: workspaceDirectory.slug,
    name: workspaceDirectory.name,
  };

  return {
    async findWorkspace(slug) {
      const [row] = await db
        .select(directoryColumns)
        .from(workspaceDirectory)
        .where(eq(workspaceDirectory.slug, slug))
        .limit(1);
      return row;
    },

    async workspacesOf(userId) {
      if (!UUID.test(userId)) return [];
      return db
        .select(directoryColumns)
        .from(workspaceMembership)
        .innerJoin(workspaceDirectory, eq(workspaceDirectory.workspaceId, workspaceMembership.workspaceId))
        .where(eq(workspaceMembership.userId, userId))
        .orderBy(asc(workspaceDirectory.createdAt), asc(workspaceDirectory.workspaceId));
    },

    async getUser(id) {
      if (!UUID.test(id)) return undefined;
      const [row] = await db
        .select({ id: user.id, name: user.name, email: user.email, emailVerified: user.emailVerified })
        .from(user)
        .where(eq(user.id, id))
        .limit(1);
      return row;
    },

    async setUserNameIfEmpty(id, name) {
      const trimmed = name.trim();
      if (!UUID.test(id) || trimmed === '') return false;
      const saved = await db
        .update(user)
        .set({ name: trimmed, updatedAt: sql`now()` })
        .where(and(eq(user.id, id), sql`btrim(${user.name}) = ''`))
        .returning({ id: user.id });
      return saved.length > 0;
    },

    async consumeRateLimit(key, rule) {
      const now = Date.now();
      const windowMs = rule.window * 1000;
      // A fixed window: `last_request` holds when the window opened, so the row
      // outlives it only as long as Better Auth's own pruning allows.
      const result = await db.execute<{ count: number; window_start: string }>(sql`
        insert into ${rateLimit} as r (key, count, last_request) values (${key}, 1, ${now})
        on conflict (key) do update set
          count = case when r.last_request <= ${now - windowMs} then 1 else r.count + 1 end,
          last_request = case when r.last_request <= ${now - windowMs} then ${now} else r.last_request end
        returning r.count, r.last_request as window_start
      `);
      const row = result.rows[0];
      if (row === undefined) throw new Error('The rate limit row was not written.');
      if (row.count <= rule.max) return { allowed: true, retryAfterSeconds: undefined };
      const opened = Number(row.window_start);
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((opened + windowMs - now) / 1000)) };
    },

    async assertIdentityRole() {
      const result = await pool.query<{
        role: string;
        unsafe: boolean;
        is_identity_member: boolean;
        is_app_member: boolean;
      }>(`
        select
          r.rolname as role,
          r.rolsuper or r.rolbypassrls or d.datdba = r.oid as unsafe,
          pg_has_role(r.oid, 'crm_identity', 'USAGE') as is_identity_member,
          pg_has_role(r.oid, 'crm_app', 'USAGE') or pg_has_role(r.oid, 'crm_app', 'SET') as is_app_member
        from pg_roles r
        cross join pg_database d
        where r.rolname = current_user and d.datname = current_database()
      `);
      const row = result.rows[0];
      if (!row) throw new Error('Could not read the connected identity role.');
      if (row.unsafe) {
        throw new Error(
          `The identity store is connected as "${row.role}", which owns the database or bypasses row level security. ` +
            'Point IDENTITY_DATABASE_URL at the identity login role (see `pnpm db:identity-login`).',
        );
      }
      if (row.is_app_member) {
        throw new Error(
          `The identity store is connected as "${row.role}", a member of crm_app. The identity login must reach no tenant table.`,
        );
      }
      if (!row.is_identity_member) {
        throw new Error(
          `The role "${row.role}" is not a member of crm_identity. Run \`pnpm db:migrate\` and \`pnpm db:identity-login\`.`,
        );
      }
    },

    authDatabase() {
      return drizzleAdapter(db, { provider: 'pg', schema: AUTH_MODELS, transaction: true });
    },

    close: () => pool.end(),
  };
}
