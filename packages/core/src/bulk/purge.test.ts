// Delete forever, Empty trash and the purge registry (spec 0022, milestone 4)
// against a real Postgres as the app login: only `records.purge` holders
// remove records for good, only records in the trash go, every registered
// dependent runs first in the same transaction and is counted, the daily
// purge's batch answers one probe when nothing is due, and Empty trash runs
// as a counted, confirmed job. It fails closed (AC-538 as amended 21 October
// 2026): records of an object the person may only read stay in the trash.
import { sql } from 'drizzle-orm';
import { createDatabase } from '@crm/db';
import type { RuleSource } from '../access/door.ts';
import { enterBookingPage } from '../access/door.ts';
import { NO_RULES, type AccessRules } from '../access/policy.ts';
import { NO_CALENDAR } from '../booking/calendar.ts';
import { createBookingPage } from '../booking/pages.ts';
import { bookPublicSlot } from '../booking/public.ts';
import { saveNote } from '../notes/notes.ts';
import { createTask } from '../tasks/tasks.ts';
import { rescope } from '../testing.ts';
import { testQuery } from '@crm/db/testing';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { purgeBatch, purgeRecords } from '../engine/deletion.ts';
import { newId, uuidArray } from '../engine/ids.ts';
import { outboxHook } from '../engine/outbox.ts';
import type { PurgeDependent } from '../engine/purge-dependents.ts';
import { createRecord } from '../engine/records.ts';
import { deleteRecords, restoreRecords } from '../engine/trash.ts';
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

/** Each test workspace's rules, by workspace id, as #24 will store them: the kit's runner enters jobs with them. */
const rulesByWorkspace = new Map<string, AccessRules>();
const rules: RuleSource = async (tx) => {
  const { rows } = await tx.execute<{ id: string | null }>(sql`select current_setting('app.workspace_id', true) as id`);
  return rulesByWorkspace.get(rows[0]?.id ?? '') ?? NO_RULES;
};

const { team, runnerFor, drive } = jobTestKit(db, ownerUrl, { rules });

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
    tx.execute<{ id: string; object_id: string; slug: string }>(
      sql`select a.id::text, a.object_id::text, o.api_slug as slug from attributes a join objects o on o.id = a.object_id where a.api_slug = 'name'`,
    ),
  );
  const objects = Object.fromEntries(rows.rows.map((row) => [row.slug, row.object_id]));
  const names = Object.fromEntries(rows.rows.map((row) => [row.slug, row.id]));
  const people = objects.people ?? '';
  const name = names.people ?? '';
  const person = async (firstName: string) =>
    (await createRecord(t.owner, { objectId: people, values: { [name]: { firstName } } })).recordId;
  const trashed = async (...names: string[]) => {
    const ids: string[] = [];
    for (const each of names) ids.push(await person(each));
    await deleteRecords(t.owner, { objectId: people, recordIds: ids, batchId: newId() });
    return ids;
  };
  /** Companies (or another object with a plain name) made and deleted by the owner. */
  const trashedIn = async (slug: string, ...titles: string[]) => {
    const objectId = objects[slug] ?? '';
    const ids: string[] = [];
    for (const each of titles) {
      ids.push((await createRecord(t.owner, { objectId, values: { [names[slug] ?? '']: each } })).recordId);
    }
    await deleteRecords(t.owner, { objectId, recordIds: ids, batchId: newId() });
    return ids;
  };
  /** The admin, who may only read the objects named (every object for 'all'), in their scope and the runner's. */
  const readOnlyAdmin = async (slugs: readonly string[] | 'all') => {
    const all = await testQuery<{ id: string }>(ownerUrl, 'select id::text from objects where workspace_id = $1', [
      t.workspaceId,
    ]);
    const ids = slugs === 'all' ? all.map((row) => row.id) : slugs.map((slug) => objects[slug] ?? '');
    const readOnly: AccessRules = {
      levels: ids.map((objectId) => ({
        subject: { type: 'role', role: 'admin' },
        target: { type: 'object', objectId },
        level: 'read',
      })),
      records: [],
    };
    rulesByWorkspace.set(t.workspaceId, readOnly);
    return rescope(t.admin, { rules: readOnly });
  };
  return { ...t, objects, people, person, trashed, trashedIn, readOnlyAdmin };
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
      { recordId: ada, state: 'purged', objectId: w.people },
      { recordId: bob, state: 'purged', objectId: w.people },
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

describe('failing closed (AC-538 as amended 21 October 2026)', () => {
  it('keeps a record of an object the admin may only read in the trash, refused with its reason, and deletes the rest', async () => {
    const w = await world();
    const [person = ''] = await w.trashed('Ada');
    const [company = ''] = await w.trashedIn('companies', 'Acme');
    const admin = await w.readOnlyAdmin(['companies']);
    expect(await deleteForever(admin, { recordIds: [person, company] })).toEqual([
      { recordId: person, state: 'purged', objectId: w.people },
      {
        recordId: company,
        state: 'refused',
        objectId: w.objects.companies,
        refusal: { code: 'FORBIDDEN', message: 'You can view Companies but not change them.' },
      },
    ]);
    expect(await exists([person, company])).toEqual([company]);
  });

  it('refuses a purge job of an object the admin may only read', async () => {
    const w = await world();
    await w.trashedIn('companies', 'Acme');
    const admin = await w.readOnlyAdmin(['companies']);
    expect(
      await refusalOf(
        startBulk(admin, registry, {
          id: newId(),
          action: 'purge',
          target: { kind: 'trash', objectId: w.objects.companies ?? '', except: [], asOf: await databaseNow() },
        }),
      ),
    ).toEqual({ code: 'FORBIDDEN', message: 'You can view Companies but not change them.' });
  });

  it('empties the trash of what the admin may change, and says how many of each read only object stay', async () => {
    const w = await world();
    const people = await w.trashed('Ada', 'Bob');
    const companies = await w.trashedIn('companies', 'Acme', 'Globex', 'Initech');
    const admin = await w.readOnlyAdmin(['companies']);
    const id = newId();
    await startBulk(admin, registry, {
      id,
      action: 'purge',
      target: { kind: 'trash', except: [], asOf: await databaseNow() },
    });
    const run = runnerFor(registry);
    expect((await drive(run, w.workspaceId, id)).at(-1)).toBe('ready');
    // The count is what will go: the read only object's records are left out of it.
    expect((await getJob(admin, registry, id)).total).toBe(2);
    await confirmJob(admin, registry, id);
    expect((await drive(run, w.workspaceId, id)).at(-1)).toBe('succeeded');
    expect((await exists([...people, ...companies])).sort()).toEqual([...companies].sort());
    expect((await getJob(admin, registry, id)).result).toMatchObject({
      left: [{ objectId: w.objects.companies, count: 3 }],
    });
  });

  it('refuses a purge or a restore across objects to someone who may change none of them', async () => {
    const w = await world();
    await w.trashed('Ada');
    const admin = await w.readOnlyAdmin('all');
    for (const action of ['purge', 'restore'] as const) {
      expect(
        await refusalOf(
          startBulk(admin, registry, {
            id: newId(),
            action,
            target: { kind: 'trash', except: [], asOf: await databaseNow() },
          }),
        ),
      ).toEqual({ code: 'FORBIDDEN', message: 'You can view these records but not change them.' });
    }
  });

  it('keeps a record deleted again after Empty trash counted it, for its own 30 days', async () => {
    const w = await world();
    const [ada = '', bob = ''] = await w.trashed('Ada', 'Bob');
    const id = newId();
    await startBulk(w.admin, registry, {
      id,
      action: 'purge',
      target: { kind: 'trash', except: [], asOf: await databaseNow() },
    });
    const run = runnerFor(registry);
    expect((await drive(run, w.workspaceId, id)).at(-1)).toBe('ready');
    await restoreRecords(w.owner, { recordIds: [ada] });
    await deleteRecords(w.owner, { objectId: w.people, recordIds: [ada], batchId: newId() });
    await confirmJob(w.admin, registry, id);
    expect((await drive(run, w.workspaceId, id)).at(-1)).toBe('succeeded');
    expect(await exists([ada, bob])).toEqual([ada]);
    expect(await getJob(w.admin, registry, id)).toMatchObject({ done: 1, skipped: 1 });
  });
});

describe('the purge registry (AC-536, AC-537)', () => {
  it('removes a record for good with its note and task link, and clears the ids its bookings hold (AC-536)', async () => {
    const w = await world();
    // A booking makes its visitor a person (and a company for a work address), and holds their ids.
    const now = new Date('2026-11-01T00:00:00.000Z');
    const page = await createBookingPage(
      w.owner,
      { id: newId(), title: 'Chat', timeZone: 'UTC', settings: { location: { type: 'address', value: '1 High St' } } },
      now,
    );
    await bookPublicSlot(
      await enterBookingPage({ db }, page.publicKey),
      { calendar: NO_CALENDAR, now: () => now, linkKey: Buffer.alloc(32, 7) },
      {
        idempotencyKey: newId(),
        start: '2026-11-03T10:00:00.000Z',
        duration: 30,
        name: 'Ada Lovelace',
        email: 'ada@analytical.example',
        timeZone: 'Europe/London',
        note: '',
        guests: [],
      },
    );
    const bookingIds = () =>
      testQuery<{ person: string | null; company: string | null }>(
        ownerUrl,
        'select person_record_id::text as person, company_record_id::text as company from bookings where workspace_id = $1',
        [w.workspaceId],
      );
    const [held] = await bookingIds();
    const person = held?.person ?? '';
    const company = held?.company ?? undefined;
    expect(person).not.toBe('');
    await saveNote(w.owner, { id: newId(), recordId: person, title: 'Met at the fair' });
    await createTask(w.owner, { id: newId(), title: 'Follow up', recordIds: [person] });
    await deleteRecords(w.owner, { objectId: w.people, recordIds: [person], batchId: newId() });
    if (company !== undefined) {
      await deleteRecords(w.owner, { objectId: w.objects.companies ?? '', recordIds: [company], batchId: newId() });
    }
    await deleteForever(w.admin, { recordIds: company === undefined ? [person] : [person, company] });
    expect(await exists(company === undefined ? [person] : [person, company])).toEqual([]);
    const left = await testQuery<{ notes: number; links: number }>(
      ownerUrl,
      `select (select count(*)::int from notes where record_id = $1) as notes,
              (select count(*)::int from task_records where record_id = $1) as links`,
      [person],
    );
    expect(left).toEqual([{ notes: 0, links: 0 }]);
    // The booking stays, its record ids cleared: nothing points at a record that is gone.
    expect(await bookingIds()).toEqual([{ person: null, company: null }]);
  });

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
