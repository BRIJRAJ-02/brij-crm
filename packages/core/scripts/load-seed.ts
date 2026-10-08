// `pnpm load:seed [--profile crm|smoke|test]` (spec 0011, AC-195): one
// command from nothing to a seeded load stack. It starts the stack's data
// services when they're down, applies the migrations and creates the app and
// identity logins on the load database (the same scripts as `pnpm db:setup`),
// seeds the profile (`crm` by default), mints a session for every seeded
// user, writes `.load/manifest.json` and `.load/sessions.json`, then starts
// the API and the worker. It refuses (exit 3) a database that already holds a
// `load` workspace (naming `pnpm load:stack:wipe`) and any address that isn't
// localhost. The root `.env` is never read: every address comes from the
// `LOAD_*` variables, each defaulting to the load stack. Pointed at another
// local Postgres (`LOAD_DATABASE_URL_OWNER`), it leaves Docker alone.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createDatabase, createIdentityStore } from '@crm/db';
import { SeedProfileName, writeManifest, writeSessions } from './load-files.ts';
import { isLoadStackDatabase, LOAD_DIR, loadRefusal, loadUrls, runLoadCommand, type LoadUrls } from './load-local.ts';
import { LOAD_AUTH_SECRET, mintSessions } from './load-sessions.ts';
import { isLoadStackUp, startLoadStack } from './load-stack.ts';
import { seedCrm } from './seed-crm.ts';

const DB_SCRIPTS = fileURLToPath(new URL('../../db/scripts/', import.meta.url));

/** Runs one of packages/db's setup scripts with exactly these variables (and PATH), never the root `.env`. */
function dbScript(name: string, env: Readonly<Record<string, string>>): void {
  const result = spawnSync(process.execPath, [`${DB_SCRIPTS}${name}`], {
    stdio: 'inherit',
    env: { PATH: process.env.PATH ?? '', ...env },
  });
  if (result.status !== 0) throw new Error(`packages/db/scripts/${name} failed (exit ${String(result.status)}).`);
}

/** Migrations, then the app login (as PgBouncer connects) and the identity login, on the load database. */
function setUpDatabase(urls: LoadUrls): void {
  const owner = { DATABASE_URL_OWNER: urls.LOAD_DATABASE_URL_OWNER };
  dbScript('migrate.ts', owner);
  dbScript('app-login.ts', { ...owner, DATABASE_URL: urls.LOAD_PGBOUNCER_URL });
  dbScript('identity-login.ts', {
    ...owner,
    DATABASE_URL: urls.LOAD_PGBOUNCER_URL,
    IDENTITY_DATABASE_URL: urls.LOAD_IDENTITY_DATABASE_URL,
  });
}

async function main(): Promise<void> {
  const started = Date.now();
  const log = (message: string) => {
    console.log(`${((Date.now() - started) / 1000).toFixed(1).padStart(8)}s  ${message}`);
  };
  const { values } = parseArgs({ options: { profile: { type: 'string', default: 'crm' } } });
  const profile = SeedProfileName.safeParse(values.profile);
  if (!profile.success) throw loadRefusal(`Unknown profile "${values.profile}": use crm, smoke or test.`);
  const urls = loadUrls(process.env);
  const onStack = isLoadStackDatabase(urls.LOAD_DATABASE_URL_OWNER);
  if (onStack && !isLoadStackUp()) {
    log('starting the load stack');
    startLoadStack(false);
  }
  setUpDatabase(urls);
  log('migrations and logins');

  const db = createDatabase({ url: urls.LOAD_DATABASE_URL_OWNER, applicationName: 'crm-load-seed', maxConnections: 2 });
  const identity = createIdentityStore({ url: urls.LOAD_DATABASE_URL_OWNER, applicationName: 'crm-load-seed' });
  try {
    log(`seeding the ${profile.data} profile`);
    const manifest = await seedCrm({ db, identity, log }, { profile: profile.data });
    log(`manifest ${await writeManifest(LOAD_DIR, manifest)}`);
    const sessions = await mintSessions(db, {
      workspaceId: manifest.workspaceId,
      users: manifest.users,
      secret: LOAD_AUTH_SECRET,
    });
    const path = await writeSessions(LOAD_DIR, {
      apiUrl: urls.LOAD_API_URL,
      mintedAt: new Date().toISOString(),
      sessions,
    });
    log(`${String(manifest.users.length)} sessions ${path}`);
    const counts = Object.entries(manifest.counts)
      .map(([key, count]) => `${key} ${count.live.toLocaleString('en')} live of ${count.stored.toLocaleString('en')}`)
      .join(', ');
    log(`seeded workspace ${manifest.workspaceId}: ${counts}`);
  } finally {
    await identity.close();
    await db.close();
  }
  if (onStack) {
    startLoadStack(true);
    log('the API and the worker are up');
  }
}

if (import.meta.main) await runLoadCommand(main);
