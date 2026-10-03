// The identity store (spec 0005, sign in and access): the only code that
// reads or writes the `auth` schema. It answers the few questions the API asks
// before any workspace is set (which workspace has this address, which
// workspaces is this user in, who is this user), and builds Better Auth's
// database adapter, so the auth library never gets a pool of its own.
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
   * Better Auth's database: its Drizzle adapter (provider `pg`, transactions
   * on) over the `auth` schema, on this store's pool. Pass it to
   * `betterAuth({ database })` with `advanced.database.generateId: 'uuid'`.
   */
  authDatabase(): AuthDatabase;
  /** Closes the pool. */
  close(): Promise<void>;
}

/**
 * Opens the identity store on its own small pool, as the app login role (the
 * same `DATABASE_URL` as `createDatabase`). The `auth` schema has no row level
 * security, so this pool needs no workspace setting; it never touches a
 * tenant table.
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

    authDatabase() {
      return drizzleAdapter(db, { provider: 'pg', schema: AUTH_MODELS, transaction: true });
    },

    close: () => pool.end(),
  };
}
