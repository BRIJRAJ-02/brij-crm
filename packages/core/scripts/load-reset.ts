// `pnpm load:reset` (spec 0011, AC-209): takes the load workspace back to what
// the seed made, so the next run has its free record slots again. Every record
// the harness created (created after the manifest's `seededAt`) goes to the
// trash and is purged at once, through the engine's own erase service as the
// system actor, with its change event in the outbox like any other write.
// Seeded records are never touched, and it refuses (exit 3) a database whose
// workspace isn't the manifest's seeded one. Afterwards the tables it thinned
// are vacuumed, so the next run doesn't read past dead rows. Putting the hub's
// Team back arrives with the `hub` scenario (milestone 4), the first that
// moves people off it.
import { sql } from 'drizzle-orm';
import { createDatabase, type Database } from '@crm/db';
import { eraseRecord, outboxHook } from '../src/index.ts';
import { systemScope } from '../src/system.ts';
import { readManifest, type LoadManifest } from './load-files.ts';
import { LOAD_DIR, loadRefusal, loadUrls, runLoadCommand } from './load-local.ts';
import { freeRecordSlots } from './load-slots.ts';

/** The records the harness created in the seeded workspace: made after the seed finished, live or trashed. */
export async function harnessRecords(db: Database, manifest: LoadManifest): Promise<readonly string[]> {
  return db.withWorkspace(manifest.workspaceId, async (tx) => {
    const result = await tx.execute<{ id: string }>(sql`
      select id::text from records
      where workspace_id = ${manifest.workspaceId} and created_at > ${manifest.seededAt}::timestamptz
      order by id
    `);
    return result.rows.map((row) => row.id);
  });
}

/**
 * Refuses (exit 3) unless the database holds the manifest's workspace under
 * its seeded slug: a manifest from another database must never pick records
 * there to erase.
 */
export async function assertSeededWorkspace(db: Database, manifest: LoadManifest): Promise<void> {
  const slug = await db.withWorkspace(manifest.workspaceId, async (tx) => {
    const result = await tx.execute<{ slug: string }>(
      sql`select slug from workspaces where id = ${manifest.workspaceId}`,
    );
    return result.rows[0]?.slug;
  });
  if (slug !== manifest.slug) {
    throw loadRefusal(
      `This database has no workspace ${manifest.workspaceId} named "${manifest.slug}", the manifest's seeded one. ` +
        'Point LOAD_DATABASE_URL_OWNER at the database `pnpm load:seed` filled.',
    );
  }
}

/** Erases at most this many records at once. */
const ERASE_CONCURRENCY = 4;

/**
 * Erases every record the harness made, as the system actor, then vacuums the
 * tables erasing thins, and answers how many and the slots free after. The
 * first failure stops every worker before it is thrown.
 */
export async function resetLoadWorkspace(
  db: Database,
  manifest: LoadManifest,
  log: (message: string) => void = () => undefined,
): Promise<{ erased: number; live: number; free: number }> {
  await assertSeededWorkspace(db, manifest);
  const ids = await harnessRecords(db, manifest);
  const scope = systemScope(db, manifest.workspaceId);
  let next = 0;
  let failed = false;
  const worker = async () => {
    while (!failed && next < ids.length) {
      const recordId = ids[next];
      next += 1;
      try {
        if (recordId !== undefined) await eraseRecord(scope, { recordId }, [outboxHook()]);
      } catch (error) {
        failed = true;
        throw error;
      }
      if (next % 1_000 === 0) log(`erased ${String(next)} of ${String(ids.length)}`);
    }
  };
  const settled = await Promise.allSettled(Array.from({ length: ERASE_CONCURRENCY }, worker));
  const rejected = settled.find((result) => result.status === 'rejected');
  if (rejected !== undefined) throw rejected.reason;
  if (ids.length > 0) await db.vacuumAnalyze(['records', 'values', 'record_links', 'sort_keys']);
  const slots = await freeRecordSlots(db, manifest.workspaceId);
  return { erased: ids.length, ...slots };
}

async function main(): Promise<void> {
  const urls = loadUrls(process.env);
  const manifest = await readManifest(LOAD_DIR);
  const target = new URL(urls.LOAD_DATABASE_URL_OWNER);
  console.log(
    `Resetting workspace "${manifest.slug}" on ${target.hostname}:${target.port || '5432'}${target.pathname}.`,
  );
  const db = createDatabase({ url: urls.LOAD_DATABASE_URL_OWNER, applicationName: 'crm-load-reset' });
  try {
    const { erased, live, free } = await resetLoadWorkspace(db, manifest, console.log);
    console.log(
      `Erased ${erased.toLocaleString('en')} records the harness made. ` +
        `${live.toLocaleString('en')} live records, ${free.toLocaleString('en')} free slots.`,
    );
  } finally {
    await db.close();
  }
}

if (import.meta.main) await runLoadCommand(main);
