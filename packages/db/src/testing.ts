// `@crm/db/testing`: a fresh, migrated Postgres database for integration
// tests, never a mocked one (the house rules). A package's Vitest global setup
// calls `prepareTestDatabase` once per run; tests then connect as an app login
// role inside `crm_app`, so row level security applies exactly as in
// production.
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

/** The local Docker Postgres (`pnpm dev`) as its superuser, unless `TEST_DATABASE_ADMIN_URL` says otherwise. */
const DEFAULT_ADMIN_URL = 'postgres://postgres:postgres@localhost:5433/postgres';
const OWNER = { role: 'crm_owner', password: 'crm_owner_local' } as const;
const APP = { role: 'crm_test_app', password: 'crm_test_app_local' } as const;
/** The advisory lock that takes turns between packages setting up at once. */
const SETUP_LOCK = 4_004_004;

/** Where a test database lives, and how to reach it as the app and as the owner. */
export interface TestDatabase {
  /** The app login role (a member of `crm_app`, bound by row level security). */
  readonly appUrl: string;
  /** The owner role, for checks that read the catalog or set up data across workspaces. */
  readonly ownerUrl: string;
}

/**
 * Drops and creates the database `name`, applies every migration as the owner
 * role, and makes sure the test app login exists in `crm_app`. Each package
 * uses its own name, so packages can run their suites at the same time.
 */
export async function prepareTestDatabase(
  name: string,
  adminUrl = process.env.TEST_DATABASE_ADMIN_URL ?? DEFAULT_ADMIN_URL,
): Promise<TestDatabase> {
  if (!/^crm_test_[a-z0-9_]+$/.test(name)) {
    throw new Error(`A test database name starts with crm_test_ (got "${name}").`);
  }
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
    await ensureRole(admin, OWNER.role, OWNER.password, 'createrole');
    await admin.query(`drop database if exists ${admin.escapeIdentifier(name)} with (force)`);
    await admin.query(`create database ${admin.escapeIdentifier(name)} owner ${admin.escapeIdentifier(OWNER.role)}`);

    const owner = new pg.Client({ connectionString: ownerUrl, application_name: 'crm-test-migrate' });
    await owner.connect();
    try {
      await migrate(drizzle({ client: owner }), {
        migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)),
      });
      await ensureRole(owner, APP.role, APP.password, 'nosuperuser nobypassrls nocreatedb nocreaterole');
      await owner.query(`grant crm_app to ${owner.escapeIdentifier(APP.role)}`);
    } finally {
      await owner.end();
    }
  } finally {
    await admin.end();
  }

  return { appUrl: withCredentials(adminUrl, APP.role, APP.password, name), ownerUrl };
}

async function ensureRole(client: pg.Client, role: string, password: string, options: string): Promise<void> {
  const exists = await client.query('select 1 from pg_roles where rolname = $1', [role]);
  if (exists.rowCount === 0) {
    await client.query(
      `create role ${client.escapeIdentifier(role)} login password ${client.escapeLiteral(password)} ${options}`,
    );
  }
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
