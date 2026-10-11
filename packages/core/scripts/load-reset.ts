// `pnpm load:reset` (spec 0011, AC-209): takes the load workspace back to what
// the seed made, so the next run has its free record slots again. Every record
// the harness created (created after the manifest's `seededAt`) goes to the
// trash and is purged at once, through the engine's own erase service as the
// system actor, with its change event in the outbox like any other write.
// Seeded records are never touched. Putting the hub's Team back arrives with
// the `hub` scenario (milestone 4), the first that moves people off it.
//
// The free slot count is shared with `pnpm load:run`, which refuses to start
// (exit 3, naming this command) when a run's creates might not fit.
import { sql } from 'drizzle-orm';
import { createDatabase, type Database } from '@crm/db';
import { eraseRecord, outboxHook } from '../src/index.ts';
import { systemScope } from '../src/system.ts';
import { readManifest, type LoadManifest } from './load-files.ts';
import { LOAD_DIR, loadUrls, runLoadCommand } from './load-local.ts';
import { SCALE_BUDGET } from './scale-budget.ts';

/** The workspace's live records and its free record slots under the budget's records per workspace. */
export async function freeRecordSlots(db: Database, workspaceId: string): Promise<{ live: number; free: number }> {
  const live = await db.withWorkspace(workspaceId, async (tx) => {
    const result = await tx.execute<{ live: number }>(
      sql`select live_records::int as live from workspace_counters where workspace_id = ${workspaceId}`,
    );
    return result.rows[0]?.live ?? 0;
  });
  return { live, free: SCALE_BUDGET.recordsPerWorkspace - live };
}

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

/** Erases at most this many records at once. */
const ERASE_CONCURRENCY = 4;

/** Erases every record the harness made, as the system actor, and answers how many and the slots free after. */
export async function resetLoadWorkspace(
  db: Database,
  manifest: LoadManifest,
  log: (message: string) => void = () => undefined,
): Promise<{ erased: number; live: number; free: number }> {
  const ids = await harnessRecords(db, manifest);
  const scope = systemScope(db, manifest.workspaceId);
  let next = 0;
  const worker = async () => {
    while (next < ids.length) {
      const recordId = ids[next];
      next += 1;
      if (recordId !== undefined) await eraseRecord(scope, { recordId }, [outboxHook()]);
      if (next % 1_000 === 0) log(`erased ${String(next)} of ${String(ids.length)}`);
    }
  };
  await Promise.all(Array.from({ length: ERASE_CONCURRENCY }, worker));
  const slots = await freeRecordSlots(db, manifest.workspaceId);
  return { erased: ids.length, ...slots };
}

async function main(): Promise<void> {
  const urls = loadUrls(process.env);
  const manifest = await readManifest(LOAD_DIR);
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
