// Delete forever, Empty trash and the purge registry (spec 0022, milestone 4)
// against a real Postgres as the app login: only `records.purge` holders
// remove records for good, only records in the trash go, every registered
// dependent runs first in the same transaction and is counted, the daily
// purge's batch answers one probe when nothing is due, and Empty trash runs
// as a counted, confirmed job.
import { sql } from 'drizzle-orm';
import { createDatabase } from '@crm/db';
import { testQuery } from '@crm/db/testing';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { purgeBatch, purgeRecords } from '../engine/deletion.ts';
import { newId, uuidArray } from '../engine/ids.ts';
import { outboxHook } from '../engine/outbox.ts';
import type { PurgeDependent } from '../engine/purge-dependents.ts';
import { createRecord } from '../engine/records.ts';
import { deleteRecords } from '../engine/trash.ts';
import { runWrite } from '../engine/write.ts';
import { jobKinds } from '../jobs/kinds/index.ts';
import { confirmJob, getJob } from '../jobs/service.ts';
import { jobTestKit, refusalOf } from '../../test/jobs-kit.ts';
import { deleteForever, startBulk } from './start.ts';

const { appUrl, ownerUrl } = inject('testDatabase');
const db = createDatabase({ url: appUrl, applicationName: 'crm-purge-tests' });
afterAll(async () => {
  await db.close();
});

const { team, runnerFor, drive } = jobTestKit(db, ownerUrl);

/**
 * Now by the database's clock, as an ISO time with microseconds: an `asOf` a
 * test compares with `created_at` or `deleted_at`, which the database stamps,
 * so a clock a millisecond apart from this machine's never moves a record
 * across it.
 */
const databaseNow = async (): Promise<string> =>
  (
    await testQuery<{ now: string }>(
      ownerUrl,
      `select to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as now`,
    )
  )[0]?.now ?? '';
const registry = jobKinds({ environment: 'local' });

async function world() {
  const t = await team();
  const rows = await db.withWorkspace(t.workspaceId, (tx) =>
    tx.execute<{ id: string; object_id: string }>(
      sql`select a.id::text, a.object_id::text from attributes a join objects o on o.id = a.object_id where o.api_slug = 'people' and a.api_slug = 'name'`,
    ),
  );
  const people = rows.rows[0]?.object_id ?? '';
  const name = rows.rows[0]?.id ?? '';
  const person = async (firstName: string) =>
    (await createRecord(t.owner, { objectId: people, values: { [name]: { firstName } } })).recordId;
  const trashed = async (...names: string[]) => {
    const ids: string[] = [];
    for (const each of names) ids.push(await person(each));
    await deleteRecords(t.owner, { objectId: people, recordIds: ids, batchId: newId() });
    return ids;
  };
  return { ...t, people, person, trashed };
}

const exists = async (ids: readonly string[]) =>
  (await testQuery<{ id: string }>(ownerUrl, 'select id::text from records where id = any($1::uuid[])', [ids])).map(
    (row) => row.id,
  );

/** A fake dependent: counts the records it is handed, and whether they still exist when it runs (same transaction). */
function fakeDependent() {
  const seen: { ids: readonly string[]; stillThere: number }[] = [];
  const dependent: PurgeDependent = {
    name: 'fake',
    remove: async (tx, recordIds) => {
      const rows = await tx.execute<{ n: number }>(
        sql`select count(*)::int as n from records where id = any(${uuidArray(recordIds)})`,
      );
      seen.push({ ids: recordIds, stillThere: rows.rows[0]?.n ?? 0 });
      return recordIds.length;
    },
  };
  return { dependent, seen };
}

describe('Delete forever (AC-535, AC-538)', () => {
  it('removes trashed records for an admin, leaves a live one, and refuses a member FORBIDDEN', async () => {
    const w = await world();
    const [ada = '', bob = ''] = await w.trashed('Ada', 'Bob');
    const cy = await w.person('Cy');
    expect(await refusalOf(deleteForever(w.member, { recordIds: [ada] }))).toEqual({
      code: 'FORBIDDEN',
      message: 'Only workspace owners and admins can delete records forever.',
    });
    expect(await exists([ada])).toEqual([ada]);
    const outcomes = await deleteForever(w.admin, { recordIds: [ada, bob, cy] }, [outboxHook()]);
    expect(outcomes).toEqual([
      { recordId: ada, state: 'purged' },
      { recordId: bob, state: 'purged' },
      { recordId: cy, state: 'not-in-trash' },
    ]);
    expect(await exists([ada, bob, cy])).toEqual([cy]);
  });

  it('empties the trash as a counted, confirmed job', async () => {
    const w = await world();
    const ids = await w.trashed('Ada', 'Bob', 'Cy');
    const id = newId();
    await startBulk(w.admin, registry, {
      id,
      action: 'purge',
      target: { kind: 'trash', except: [], asOf: await databaseNow() },
    });
    expect(
      await refusalOf(
        startBulk(w.member, registry, {
          id: newId(),
          action: 'purge',
          target: { kind: 'trash', except: [], asOf: new Date().toISOString() },
        }),
      ),
    ).toMatchObject({ code: 'FORBIDDEN' });
    const run = runnerFor(registry);
    await drive(run, w.workspaceId, id);
    expect((await getJob(w.admin, registry, id)).total).toBe(3);
    await confirmJob(w.admin, registry, id);
    expect((await drive(run, w.workspaceId, id)).at(-1)).toBe('succeeded');
    expect(await exists(ids)).toEqual([]);
  });
});

describe('the purge registry (AC-536, AC-537)', () => {
  it('runs every dependent before the records, in the same transaction, and counts it', async () => {
    const w = await world();
    const ids = await w.trashed('Ada', 'Bob');
    const { dependent, seen } = fakeDependent();
    const { result } = await runWrite(w.admin, (context) =>
      purgeRecords(context, { recordIds: ids, dependents: [dependent] }),
    );
    expect(seen).toEqual([{ ids: [...ids].sort(), stillThere: 2 }]);
    expect(result.counts.dependents).toEqual({ fake: 2 });
    expect(await exists(ids)).toEqual([]);
  });

  it('purges a record past 30 days with its dependents, keeps one at 29, and answers one probe when nothing is due', async () => {
    const w = await world();
    const [old = '', recent = ''] = await w.trashed('Old', 'Recent');
    await testQuery(ownerUrl, "update records set deleted_at = now() - interval '31 days' where id = $1", [old]);
    await testQuery(ownerUrl, "update records set deleted_at = now() - interval '29 days' where id = $1", [recent]);
    const { dependent, seen } = fakeDependent();
    const { result } = await runWrite(w.owner, (context) => purgeBatch(context, { dependents: [dependent] }));
    expect(result.counts).toMatchObject({ records: 1, dependents: { fake: 1 } });
    expect(seen).toEqual([{ ids: [old], stillThere: 1 }]);
    expect(await exists([old, recent])).toEqual([recent]);
    // Nothing past the window now: the batch ends at its probe, no dependent asked.
    const again = await runWrite(w.owner, (context) => purgeBatch(context, { dependents: [dependent] }));
    expect(again.result).toEqual({ full: false, counts: { records: 0, entries: 0, values: 0, links: 0 } });
    expect(seen).toHaveLength(1);
  });
});
