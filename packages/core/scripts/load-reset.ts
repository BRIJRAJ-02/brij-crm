// `pnpm load:reset` (spec 0011, AC-209): takes the load workspace back to what
// the seed made, so the next run has its free record slots again. Every record
// the harness created (created after the manifest's `seededAt`) goes to the
// trash and is purged at once, through the engine's own erase service as the
// system actor, with its change event in the outbox like any other write.
// Seeded records are never touched, and it refuses (exit 3) a database whose
// workspace isn't the manifest's seeded one. Then the hub's Team goes back to
// the seeded people (the `hub` scenario and the hub clear bench move people
// on and off it): every live seeded person whose Company isn't what it was
// when the seed finished gets it back, through the same engine as the system
// actor, 5,000 at a time; and the hub's name too. Afterwards the tables it
// thinned are vacuumed, so the next run doesn't read past dead rows.
import { sql } from 'drizzle-orm';
import { createDatabase, type Database } from '@crm/db';
import { eraseRecord, MAX_BATCH, outboxHook, setValues, setValuesBatch } from '../src/index.ts';
import { systemScope } from '../src/system.ts';
import { readManifest, type LoadManifest } from './load-files.ts';
import { LOAD_DIR, loadRefusal, loadUrls, runLoadCommand } from './load-local.ts';
import { freeRecordSlots } from './load-slots.ts';
import { HUB_COMPANY_NAME } from './seed-crm.ts';

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

/** A seeded person whose Company moved since the seed: its id, and the company it held then (undefined for none). */
export interface MovedPerson {
  readonly id: string;
  readonly seeded: string | undefined;
}

/**
 * The live seeded people whose Company now differs from the one they held
 * when the seed finished (`seededAt`), with the hub on either side: the people
 * the `hub` scenario and the hub clear bench moved off the hub or onto it. A
 * link's history keeps its ended versions, so the seeded one is the version
 * current at `seededAt`.
 */
export async function movedPeople(db: Database, manifest: LoadManifest): Promise<readonly MovedPerson[]> {
  const companyAttributeId = manifest.attributes['people.company'];
  const peopleObjectId = manifest.objects.people;
  if (companyAttributeId === undefined || peopleObjectId === undefined) {
    throw loadRefusal('The manifest has no People or no People Company. Seed again: `pnpm load:seed`.');
  }
  return db.withWorkspace(manifest.workspaceId, async (tx) => {
    const result = await tx.execute<{ id: string; seeded: string | null }>(sql`
      with rel as (
        select relationship_id from attributes where workspace_id = ${manifest.workspaceId} and id = ${companyAttributeId}
      ), seeded as (
        select l.from_record_id as person, l.to_record_id as company
        from record_links l join rel on rel.relationship_id = l.relationship_id
        where l.workspace_id = ${manifest.workspaceId} and l.active_from <= ${manifest.seededAt}::timestamptz
          and (l.active_until is null or l.active_until > ${manifest.seededAt}::timestamptz)
      ), now_ as (
        select l.from_record_id as person, l.to_record_id as company
        from record_links l join rel on rel.relationship_id = l.relationship_id
        where l.workspace_id = ${manifest.workspaceId} and l.active_until is null
      )
      select r.id::text, s.company::text as seeded
      from records r
      left join seeded s on s.person = r.id
      left join now_ n on n.person = r.id
      where r.workspace_id = ${manifest.workspaceId} and r.object_id = ${peopleObjectId} and r.deleted_at is null
        and r.created_at <= ${manifest.seededAt}::timestamptz
        and s.company is distinct from n.company
        and (s.company = ${manifest.hubCompanyId} or n.company = ${manifest.hubCompanyId})
      order by r.id
    `);
    return result.rows.map((row) => ({ id: row.id, seeded: row.seeded ?? undefined }));
  });
}

/** People put back per progress line (AC-209: the Team goes back in batches of 5,000). */
export const RESTORE_BATCH = 5_000;

/**
 * Puts the hub's Team back to the seeded people (AC-209), and the hub's name
 * (AC-206's renames): each moved person's Company back to what it was when
 * the seed finished, as the system actor through the engine's batch write
 * (each record all or nothing, its change event in the outbox), 5,000 people
 * per batch in engine calls of 500. Answers how many it put back.
 */
export async function restoreHubTeam(
  db: Database,
  manifest: LoadManifest,
  log: (message: string) => void = () => undefined,
): Promise<number> {
  const scope = systemScope(db, manifest.workspaceId);
  const companyAttributeId = manifest.attributes['people.company'];
  const companiesObjectId = manifest.objects.companies;
  const nameAttributeId = manifest.attributes['companies.name'];
  if (companyAttributeId === undefined || companiesObjectId === undefined || nameAttributeId === undefined) {
    throw loadRefusal('The manifest has no People Company, Companies or Company name. Seed again: `pnpm load:seed`.');
  }
  const moved = await movedPeople(db, manifest);
  for (let start = 0; start < moved.length; start += RESTORE_BATCH) {
    const batch = moved.slice(start, start + RESTORE_BATCH);
    for (let at = 0; at < batch.length; at += MAX_BATCH) {
      const items = batch.slice(at, at + MAX_BATCH).map((person) => ({
        recordId: person.id,
        values: {
          [companyAttributeId]: {
            value: person.seeded === undefined ? null : { objectId: companiesObjectId, recordId: person.seeded },
          },
        },
      }));
      for (const outcome of await setValuesBatch(scope, { items }, [outboxHook()])) {
        if (!outcome.ok) {
          const why = outcome.refusals.map((each) => each.message).join('; ');
          throw new Error(`Putting ${outcome.recordId}'s Company back was refused: ${why}`);
        }
      }
    }
    log(`hub Team: put back ${String(start + batch.length)} of ${String(moved.length)}`);
  }
  const name = await db.withWorkspace(manifest.workspaceId, async (tx) => {
    const result = await tx.execute<{ name: string | null }>(sql`
      select text_value as name from "values"
      where workspace_id = ${manifest.workspaceId} and owner_id = ${manifest.hubCompanyId}
        and attribute_id = ${nameAttributeId} and active_until is null and not is_cleared
    `);
    return result.rows[0]?.name ?? undefined;
  });
  if (name !== HUB_COMPANY_NAME) {
    const values = { [nameAttributeId]: { value: HUB_COMPANY_NAME } };
    await setValues(scope, { recordId: manifest.hubCompanyId, values }, [outboxHook()]);
    log(`hub name: "${name ?? ''}" back to "${HUB_COMPANY_NAME}"`);
  }
  return moved.length;
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
): Promise<{ erased: number; restored: number; live: number; free: number }> {
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
  const restored = await restoreHubTeam(db, manifest, log);
  if (ids.length + restored > 0) await db.vacuumAnalyze(['records', 'values', 'record_links', 'sort_keys']);
  const slots = await freeRecordSlots(db, manifest.workspaceId);
  return { erased: ids.length, restored, ...slots };
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
    const { erased, restored, live, free } = await resetLoadWorkspace(db, manifest, console.log);
    console.log(
      `Erased ${erased.toLocaleString('en')} records the harness made, and put ${restored.toLocaleString('en')} ` +
        `people's Company back (the hub's Team as seeded). ${live.toLocaleString('en')} live records, ` +
        `${free.toLocaleString('en')} free slots.`,
    );
  } finally {
    await db.close();
  }
}

if (import.meta.main) await runLoadCommand(main);
