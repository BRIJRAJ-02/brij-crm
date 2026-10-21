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
import { isIP } from 'node:net';
import type { SecurityEventKind } from '@crm/contracts';
import { and, asc, desc, eq, ne, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import type { DatabaseOptions } from '../client.ts';
import { timePool } from '../timing.ts';
import {
  account,
  rateLimit,
  securityEvent,
  session,
  user,
  userPrefs,
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

/** One live session as Account › Security lists it (spec 0033): never its token. */
export interface SessionListing {
  readonly id: string;
  readonly deviceLabel: string | null;
  readonly country: string | null;
  readonly city: string | null;
  /** Last used, ISO 8601 UTC with microseconds (the keyset cursor's moment). */
  readonly updatedAt: string;
  /** Signed in, ISO 8601 UTC. */
  readonly createdAt: string;
}

/** Where a page of sessions starts after: the last row's `updatedAt` and id. */
export interface SessionKey {
  readonly updatedAt: string;
  readonly id: string;
}

/** One security event to keep (spec 0033, AC-898). `detail` never holds a code, secret or token. */
export interface SecurityEventInput {
  readonly userId: string;
  readonly kind: SecurityEventKind;
  readonly sessionId?: string;
  /** An IP the edge guard trusted, or nothing. */
  readonly ip?: string;
  readonly country?: string;
  readonly deviceLabel?: string;
  readonly detail?: Readonly<Record<string, string | number | boolean>>;
}

/** Global identity: the directory, users, and Better Auth's storage. Reads no tenant data. */
export interface IdentityStore {
  /** The workspace at this address, or undefined. Lookup only: it grants nothing. */
  findWorkspace(slug: string): Promise<DirectoryWorkspace | undefined>;
  /** The workspaces this user was added to, oldest first (by when the directory row was made). */
  workspacesOf(userId: string): Promise<readonly DirectoryWorkspace[]>;
  /** The workspace this user last opened (spec 0031, AC-802), or undefined. Where to go, never access. */
  lastWorkspaceOf(userId: string): Promise<string | undefined>;
  /**
   * Remembers the workspace this user last opened (spec 0031, AC-802). The
   * caller has passed the access door for it. Writes only when the value
   * changes, so opening page after page in one workspace costs one read.
   */
  setLastWorkspace(userId: string, workspaceId: string): Promise<void>;
  /**
   * Drops the directory's note that this user is in this workspace, once the
   * tenant transaction that removed their member row has committed (spec
   * 0031, AC-812, AC-814), so their switcher stops listing it. Access never
   * read it: the door already refuses them.
   */
  dropMembership(userId: string, workspaceId: string): Promise<void>;
  /** The user with this id, or undefined. */
  getUser(id: string): Promise<IdentityUser | undefined>;
  /**
   * The user's live (unexpired) sessions, most recently used first, after
   * `after` when given, at most `limit` (spec 0033, AC-890). Ids and labels
   * only: a token never leaves this store.
   */
  listSessions(
    userId: string,
    options: { readonly after?: SessionKey; readonly limit: number },
  ): Promise<readonly SessionListing[]>;
  /**
   * Deletes the session with this id only when it is the user's (AC-891):
   * what it was on, or undefined when nothing of theirs had that id.
   */
  revokeSession(
    userId: string,
    sessionId: string,
  ): Promise<{ readonly deviceLabel: string | null; readonly country: string | null } | undefined>;
  /** Deletes every session of the user but `keepSessionId`; answers how many went (AC-892). */
  revokeOtherSessions(userId: string, keepSessionId: string): Promise<number>;
  /**
   * When this session of the user last proved who it is (sign in, or a step
   * up), ISO 8601 UTC; undefined for a session that isn't theirs or has none.
   */
  sessionVerifiedAt(userId: string, sessionId: string): Promise<string | undefined>;
  /** Keeps one security event (AC-898). */
  recordSecurityEvent(event: SecurityEventInput): Promise<void>;
  /** Saves the name only when the user has none yet (an email code sign up starts empty). True when it saved. */
  setUserNameIfEmpty(id: string, name: string): Promise<boolean>;
  /**
   * Counts one use of `key` against `rule` in Better Auth's `auth.rate_limit`
   * table, in one atomic statement, so the limit holds across instances. For
   * limits Better Auth can't key itself (per email: it keys by IP and path).
   * A key here must not look like Better Auth's `<ip>|<path>`; prefix it.
   * Its rows hold when their window closes, so Better Auth's pruning (rows
   * older than the longest window it knows of) never drops a window still
   * open, however long.
   */
  consumeRateLimit(key: string, rule: RateLimitRule, cost?: number): Promise<RateLimitDecision>;
  /**
   * Refuses (throws) unless this store is connected as an identity login: a
   * member of `crm_identity`, outside `crm_app`, unable to bypass row level
   * security, own the database, create roles or databases, and in no role
   * (directly or through another) that can, nor in `pg_read_all_data` or
   * `pg_write_all_data`. The api calls it before serving.
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
  // The session check every request makes waits here too (spec 0011, AC-202).
  if (options.timing !== undefined) timePool(pool, options.timing);
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

    async lastWorkspaceOf(userId) {
      if (!UUID.test(userId)) return undefined;
      const [row] = await db
        .select({ workspaceId: userPrefs.lastWorkspaceId })
        .from(userPrefs)
        .where(eq(userPrefs.userId, userId))
        .limit(1);
      return row?.workspaceId ?? undefined;
    },

    async setLastWorkspace(userId, workspaceId) {
      if (!UUID.test(userId) || !UUID.test(workspaceId)) throw new TypeError('Expected uuids.');
      await db
        .insert(userPrefs)
        .values({ userId, lastWorkspaceId: workspaceId })
        .onConflictDoUpdate({
          target: userPrefs.userId,
          set: { lastWorkspaceId: workspaceId, updatedAt: sql`now()` },
          setWhere: sql`${userPrefs.lastWorkspaceId} is distinct from ${workspaceId}::uuid`,
        });
    },

    async dropMembership(userId, workspaceId) {
      if (!UUID.test(userId) || !UUID.test(workspaceId)) return;
      await db
        .delete(workspaceMembership)
        .where(and(eq(workspaceMembership.userId, userId), eq(workspaceMembership.workspaceId, workspaceId)));
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

    async listSessions(userId, { after, limit }) {
      if (!UUID.test(userId)) return [];
      if (after !== undefined && !UUID.test(after.id)) return [];
      const moment = sql<string>`to_char(${session.updatedAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
      const rows = await db
        .select({
          id: session.id,
          deviceLabel: session.deviceLabel,
          country: session.country,
          city: session.city,
          updatedAt: moment,
          createdAt: sql<string>`to_char(${session.createdAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
        })
        .from(session)
        .where(
          and(
            eq(session.userId, userId),
            sql`${session.expiresAt} > now()`,
            after === undefined
              ? undefined
              : sql`(${session.updatedAt}, ${session.id}) < (${after.updatedAt}::timestamptz, ${after.id}::uuid)`,
          ),
        )
        .orderBy(desc(session.updatedAt), desc(session.id))
        .limit(Math.max(1, Math.min(limit, 200)));
      return rows;
    },

    async revokeSession(userId, sessionId) {
      if (!UUID.test(userId) || !UUID.test(sessionId)) return undefined;
      const [gone] = await db
        .delete(session)
        .where(and(eq(session.id, sessionId), eq(session.userId, userId)))
        .returning({ deviceLabel: session.deviceLabel, country: session.country });
      return gone;
    },

    async revokeOtherSessions(userId, keepSessionId) {
      if (!UUID.test(userId) || !UUID.test(keepSessionId)) return 0;
      const gone = await db
        .delete(session)
        .where(and(eq(session.userId, userId), ne(session.id, keepSessionId)))
        .returning({ id: session.id });
      return gone.length;
    },

    async sessionVerifiedAt(userId, sessionId) {
      if (!UUID.test(userId) || !UUID.test(sessionId)) return undefined;
      const [row] = await db
        .select({ verifiedAt: session.verifiedAt })
        .from(session)
        .where(and(eq(session.id, sessionId), eq(session.userId, userId), sql`${session.expiresAt} > now()`))
        .limit(1);
      return row?.verifiedAt ? row.verifiedAt.toISOString() : undefined;
    },

    async recordSecurityEvent(event) {
      if (!UUID.test(event.userId)) return;
      const sessionId = event.sessionId !== undefined && UUID.test(event.sessionId) ? event.sessionId : null;
      await db.insert(securityEvent).values({
        userId: event.userId,
        kind: event.kind,
        sessionId,
        ip: event.ip !== undefined && isIP(event.ip) !== 0 ? event.ip : null,
        country: event.country ?? null,
        deviceLabel: event.deviceLabel ?? null,
        detail: event.detail ?? {},
      });
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

    async consumeRateLimit(key, rule, cost = 1) {
      // `cost` uses at once (an invite to 20 addresses is 20 sends); at least one.
      const uses = Math.max(1, Math.floor(cost));
      const now = Date.now();
      const closes = now + rule.window * 1000;
      // A fixed window: `last_request` holds when the window closes (not when it
      // opened, as Better Auth's own rows do). Better Auth prunes rows whose
      // `last_request` is older than its longest window, so a row here goes
      // only once its window is long over, whatever its length.
      const result = await db.execute<{ count: number; window_end: string }>(sql`
        insert into ${rateLimit} as r (key, count, last_request) values (${key}, ${uses}, ${closes})
        on conflict (key) do update set
          count = case when r.last_request <= ${now} then ${uses} else r.count + ${uses} end,
          last_request = case when r.last_request <= ${now} then ${closes} else r.last_request end
        returning r.count, r.last_request as window_end
      `);
      const row = result.rows[0];
      if (row === undefined) throw new Error('The rate limit row was not written.');
      if (row.count <= rule.max) return { allowed: true, retryAfterSeconds: undefined };
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((Number(row.window_end) - now) / 1000)) };
    },

    async assertIdentityRole() {
      const result = await pool.query<{
        role: string;
        unsafe: boolean;
        reaches_power: string | null;
        is_identity_member: boolean;
        is_app_member: boolean;
      }>(`
        select
          r.rolname as role,
          r.rolsuper or r.rolbypassrls or r.rolcreaterole or r.rolcreatedb or d.datdba = r.oid as unsafe,
          (
            select string_agg(b.rolname, ', ' order by b.rolname) from pg_roles b
            where b.oid <> r.oid
              and (
                b.rolsuper or b.rolbypassrls or b.rolcreaterole or b.rolcreatedb
                or b.rolname in ('pg_read_all_data', 'pg_write_all_data')
              )
              -- MEMBER follows every grant, even one with neither INHERIT nor SET (held WITH ADMIN, say).
              and pg_has_role(r.oid, b.oid, 'MEMBER')
          ) as reaches_power,
          pg_has_role(r.oid, 'crm_identity', 'USAGE') as is_identity_member,
          pg_has_role(r.oid, 'crm_app', 'MEMBER') as is_app_member
        from pg_roles r
        cross join pg_database d
        where r.rolname = current_user and d.datname = current_database()
      `);
      const row = result.rows[0];
      if (!row) throw new Error('Could not read the connected identity role.');
      if (row.unsafe) {
        throw new Error(
          `The identity store is connected as "${row.role}", which owns the database, bypasses row level security, ` +
            'or creates roles or databases. Point IDENTITY_DATABASE_URL at the identity login role (see `pnpm db:identity-login`).',
        );
      }
      // Through a role it is in, directly or not (a Neon console role is in neon_superuser, say), counts too.
      if (row.reaches_power !== null) {
        throw new Error(
          `The identity store is connected as "${row.role}", a member of ${row.reaches_power}, which reads or writes ` +
            'every table or holds powers the identity login must not. Use a login made by `pnpm db:identity-login`.',
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
