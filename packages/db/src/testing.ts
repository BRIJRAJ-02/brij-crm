// `@crm/db/testing`: a fresh, migrated Postgres database for integration
// tests, never a mocked one (the house rules). A package's Vitest global setup
// calls `prepareTestDatabase` once per run; tests then connect as an app login
// role inside `crm_app`, so row level security applies exactly as in
// production, and reach the `auth` schema as an identity login inside
// `crm_identity`, as the identity store does.
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

/** The local Docker Postgres (`pnpm dev`) as its superuser, unless `TEST_DATABASE_ADMIN_URL` says otherwise. */
const DEFAULT_ADMIN_URL = 'postgres://postgres:postgres@localhost:5433/postgres';
const OWNER = { role: 'crm_owner', password: 'crm_owner_local' } as const;
const APP = { role: 'crm_test_app', password: 'crm_test_app_local' } as const;
const IDENTITY = { role: 'crm_test_identity', password: 'crm_test_identity_local' } as const;
/** A login role's options: no way around row level security, and nothing else either. */
const LOGIN_OPTIONS = 'nosuperuser nobypassrls nocreatedb nocreaterole';
/** The advisory lock that takes turns between packages setting up at once. */
const SETUP_LOCK = 4_004_004;

/** Where a test database lives, and how to reach it as the app, as the identity store and as the owner. */
export interface TestDatabase {
  /** The app login role (a member of `crm_app`, bound by row level security). */
  readonly appUrl: string;
  /** The identity login role (a member of `crm_identity`): the only one that reads and writes schema `auth`. */
  readonly identityUrl: string;
  /** The owner role, for checks that read the catalog or set up data across workspaces. */
  readonly ownerUrl: string;
  /**
   * A superuser on this database, for the few checks the owner can't make:
   * reading `pg_authid`, or granting a built in role like `pg_read_all_data`.
   */
  readonly adminUrl: string;
}

/**
 * A short tag for this checkout, from its path: each git worktree gets its own
 * test databases, so suites in several worktrees can run at the same time.
 */
const CHECKOUT = createHash('sha256')
  .update(fileURLToPath(new URL('../../..', import.meta.url)))
  .digest('hex')
  .slice(0, 8);

/**
 * Drops and creates this checkout's copy of the database `base` (suffixed with the
 * checkout's tag), applies every migration as the owner role, and makes sure
 * the test app login exists in `crm_app` and the test identity login in
 * `crm_identity`. Each package uses its own name, and
 * each worktree its own tag, so suites can run at the same time.
 */
export async function prepareTestDatabase(
  base: string,
  adminUrl = process.env.TEST_DATABASE_ADMIN_URL ?? DEFAULT_ADMIN_URL,
): Promise<TestDatabase> {
  if (!/^crm_test_[a-z0-9_]+$/.test(base)) {
    throw new Error(`A test database name starts with crm_test_ (got "${base}").`);
  }
  const name = `${base}_${CHECKOUT}`;
  const admin = new pg.Client({ connectionString: adminUrl, application_name: 'crm-test-setup' });
  try {
    await admin.connect();
  } catch (error) {
    throw new Error(
      `Integration tests need Postgres at ${redact(adminUrl)}. Start it with \`pnpm dev\` (or docker compose up postgres), or set TEST_DATABASE_ADMIN_URL.`,
      { cause: error },
    );
  }
  // Packages prepare their databases at the same time, and roles are shared
  // by the whole server, so one setup runs at a time.
  await admin.query('select pg_advisory_lock($1)', [SETUP_LOCK]);
  const ownerUrl = withCredentials(adminUrl, OWNER.role, OWNER.password, name);
  try {
    await ensureRole(admin, OWNER.role, OWNER.password, 'createrole bypassrls');
    // Like Neon's owner, it bypasses row level security, so it can create crm_search (a role made before that
    // was added gets it here).
    await admin.query(`alter role ${admin.escapeIdentifier(OWNER.role)} bypassrls`);
    await admin.query(`drop database if exists ${admin.escapeIdentifier(name)} with (force)`);
    await admin.query(`create database ${admin.escapeIdentifier(name)} owner ${admin.escapeIdentifier(OWNER.role)}`);

    const owner = new pg.Client({ connectionString: ownerUrl, application_name: 'crm-test-migrate' });
    await owner.connect();
    try {
      await migrate(drizzle({ client: owner }), {
        migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)),
      });
      await ensureRole(owner, APP.role, APP.password, LOGIN_OPTIONS);
      await owner.query(`grant crm_app to ${owner.escapeIdentifier(APP.role)}`);
      await ensureRole(owner, IDENTITY.role, IDENTITY.password, LOGIN_OPTIONS);
      await owner.query(`grant crm_identity to ${owner.escapeIdentifier(IDENTITY.role)}`);
    } finally {
      await owner.end();
    }
  } finally {
    await admin.end();
  }

  return {
    appUrl: withCredentials(adminUrl, APP.role, APP.password, name),
    identityUrl: withCredentials(adminUrl, IDENTITY.role, IDENTITY.password, name),
    ownerUrl,
    adminUrl: onDatabase(adminUrl, name),
  };
}

/**
 * Adds a signed up user (an `auth.user` row, as Better Auth would make one) for
 * tests that need a real identity, connecting through `url`: the test
 * database's `identityUrl`, since only the identity login may write there.
 * Returns the user's id.
 */
export async function createTestUser(url: string, input: { email: string; name?: string }): Promise<string> {
  const client = new pg.Client({ connectionString: url, application_name: 'crm-test-user' });
  await client.connect();
  try {
    const result = await client.query<{ id: string }>(
      'insert into auth."user" (email, name, email_verified) values ($1, $2, true) returning id',
      [input.email, input.name ?? ''],
    );
    const id = result.rows[0]?.id;
    if (id === undefined) throw new Error('The test user was not created.');
    return id;
  } finally {
    await client.end();
  }
}

/**
 * Runs one statement through `url` (a login of a test database) and returns
 * its rows, for a test's setup or checks outside packages/db, which may not
 * open connections of its own. As the identity login it reaches `auth`; as
 * the app login, row level security applies with no workspace set.
 */
export async function testQuery<Row extends Record<string, unknown>>(
  url: string,
  text: string,
  params: readonly unknown[] = [],
): Promise<Row[]> {
  const client = new pg.Client({ connectionString: url, application_name: 'crm-test-query' });
  await client.connect();
  try {
    const result = await client.query<Row>(text, [...params]);
    return result.rows;
  } finally {
    await client.end();
  }
}

/**
 * Takes an access exclusive lock on `table` through `url` and holds it until
 * `release()`, so a statement that reads the table waits: for a test that
 * needs a slow statement to cancel. The table name is checked, never quoted
 * from input.
 */
export async function holdTableLock(url: string, table: 'records'): Promise<{ release: () => Promise<void> }> {
  const client = new pg.Client({ connectionString: url, application_name: 'crm-test-lock' });
  await client.connect();
  try {
    await client.query('begin');
    await client.query(`lock table ${client.escapeIdentifier(table)} in access exclusive mode`);
  } catch (error) {
    await client.end();
    throw error;
  }
  return {
    release: async () => {
      try {
        await client.query('rollback');
      } finally {
        await client.end();
      }
    },
  };
}

/** One statement a client sent: its text and its parameters. */
export interface SentStatement {
  readonly text: string;
  readonly params: readonly unknown[];
}

/**
 * Runs `work` and answers every statement any `pg` client in this process
 * sent meanwhile, in order: for a test that pins the SQL a service sends
 * (spec 0009, AC-149). Run nothing else at the same time, since every client
 * is recorded.
 */
export async function recordStatements(work: () => Promise<unknown>): Promise<readonly SentStatement[]> {
  const sent: SentStatement[] = [];
  const prototype = pg.Client.prototype as unknown as { query: (...args: unknown[]) => unknown };
  const original = prototype.query;
  prototype.query = function (this: unknown, ...args: unknown[]) {
    const [first, second] = args;
    const given = Array.isArray(second) ? (second as unknown[]) : [];
    if (typeof first === 'string') sent.push({ text: first, params: given });
    else if (typeof first === 'object' && first !== null && 'text' in first && typeof first.text === 'string') {
      const values = 'values' in first && Array.isArray(first.values) ? (first.values as unknown[]) : given;
      sent.push({ text: first.text, params: values });
    }
    return original.apply(this, args);
  };
  try {
    await work();
  } finally {
    prototype.query = original;
  }
  return sent;
}

/**
 * Runs `work` holding the lock every suite's `prepareTestDatabase` takes, so
 * no suite migrates while it runs. For a test that briefly commits a role
 * the migrations' closing checks would refuse (a member of
 * `pg_read_all_data`, say): roles belong to the whole server.
 */
export async function withSetupLock<T>(
  work: () => Promise<T>,
  adminUrl = process.env.TEST_DATABASE_ADMIN_URL ?? DEFAULT_ADMIN_URL,
): Promise<T> {
  const admin = new pg.Client({ connectionString: adminUrl, application_name: 'crm-test-lock' });
  await admin.connect();
  try {
    await admin.query('select pg_advisory_lock($1)', [SETUP_LOCK]);
    return await work();
  } finally {
    await admin.end();
  }
}

async function ensureRole(client: pg.Client, role: string, password: string, options: string): Promise<void> {
  const exists = await client.query('select 1 from pg_roles where rolname = $1', [role]);
  if (exists.rowCount === 0) {
    await client.query(
      `create role ${client.escapeIdentifier(role)} login password ${client.escapeLiteral(password)} ${options}`,
    );
  }
}

function onDatabase(url: string, database: string): string {
  const next = new URL(url);
  next.pathname = `/${database}`;
  return next.toString();
}

function withCredentials(url: string, user: string, password: string, database: string): string {
  const next = new URL(url);
  next.username = user;
  next.password = password;
  next.pathname = `/${database}`;
  return next.toString();
}

function redact(url: string): string {
  const next = new URL(url);
  next.password = next.password === '' ? '' : '***';
  return next.toString();
}
