// Bulk deletes, restores and the trash (spec 0022, milestone 1), against a
// real Postgres as the app role: links, entries, history, unique values and
// record slots round trip; one batch restores exactly its records; the trash
// lists what the principal may see, newest first, by keyset.
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, type Database } from '@crm/db';
import { getHistory } from './history.ts';
import { newId } from './ids.ts';
import { addEntry, defineList, getRecordEntries } from './lists.ts';
import { outboxHook } from './outbox.ts';
import { createRecord, getRecords, setValues } from './records.ts';
import { isRefusal } from './refusals.ts';
import type { Actor, EngineScope } from './scope.ts';
import { countTrash, deleteRecords, queryTrash, restoreBatch, restoreRecords } from './trash.ts';
import { createWorkspace } from './workspaces.ts';
import { rescope, testScope } from '../testing.ts';

const { appUrl } = inject('testDatabase');
let db: Database;

beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-trash-tests' });
});
afterAll(async () => {
  await db.close();
});

let made = 0;
async function world() {
  made += 1;
  const created = await createWorkspace(db, {
    name: 'Trash',
    slug: `trash-${String(made)}-${String(Date.now())}`,
    firstMember: { name: 'Ada Lovelace', email: 'ada@example.com' },
  });
  const actor: Actor = { type: 'member', id: created.memberId };
  const scope = testScope({ db, workspaceId: created.workspaceId, actor });
  const rows = await db.withWorkspace(created.workspaceId, (tx) =>
    tx.execute<{ id: string; object_id: string; api_slug: string }>(
      sql`select id::text, object_id::text, api_slug from attributes where object_id is not null`,
    ),
  );
  const people = created.objects.people ?? '';
  const companies = created.objects.companies ?? '';
  const attribute = (objectId: string, slug: string) =>
    rows.rows.find((row) => row.object_id === objectId && row.api_slug === slug)?.id ?? '';
  return {
    ...created,
    scope,
    people,
    companies,
    person: (slug: string) => attribute(people, slug),
    company: (slug: string) => attribute(companies, slug),
  };
}
type World = Awaited<ReturnType<typeof world>>;

async function person(w: World, firstName: string, email?: string) {
  const values: Record<string, unknown> = { [w.person('name')]: { firstName } };
  if (email !== undefined) values[w.person('email_addresses')] = [email];
  return (await createRecord(w.scope, { objectId: w.people, values })).recordId;
}

async function dealName(w: World) {
  const rows = await db.withWorkspace(w.workspaceId, (tx) =>
    tx.execute<{ id: string }>(
      sql`select id::text from attributes where object_id = ${w.objects.deals ?? ''} and api_slug = 'name'`,
    ),
  );
  return rows.rows[0]?.id ?? '';
}

async function liveRecords(w: World) {
  const rows = await db.withWorkspace(w.workspaceId, (tx) =>
    tx.execute<{ n: number }>(sql`select live_records as n from workspace_counters`),
  );
  return rows.rows[0]?.n;
}

async function refusalOf(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    if (isRefusal(error)) return error.refusal;
    throw error;
  }
  throw new Error('Expected a refusal.');
}

describe('deleteRecords', () => {
  it('moves up to 500 records to the trash with one batch, hiding their links and entries (AC-524, AC-525)', async () => {
    const w = await world();
    const acme = (await createRecord(w.scope, { objectId: w.companies, values: { [w.company('name')]: 'Acme' } }))
      .recordId;
    const ada = await person(w, 'Ada', 'ada@acme.com');
    const bob = await person(w, 'Bob');
    const cy = await person(w, 'Cy');
    await setValues(w.scope, {
      recordId: ada,
      values: { [w.person('company')]: { value: { objectId: w.companies, recordId: acme } } },
    });
    const { listId } = await defineList(w.scope, { objectId: w.people, apiSlug: 'crew', name: 'Crew' });
    await addEntry(w.scope, { listId, recordId: ada });
    const before = await liveRecords(w);
    const batchId = newId();
    const outcomes = await deleteRecords(w.scope, { objectId: w.people, recordIds: [ada, bob], batchId }, [
      outboxHook({ mutationId: newId() }),
    ]);
    expect(outcomes).toEqual([
      { recordId: ada, state: 'deleted' },
      { recordId: bob, state: 'deleted' },
    ]);
    expect((await getRecords(w.scope, { ids: [ada, bob, cy] })).map((view) => view.id)).toEqual([cy]);
    // Ada's link is hidden from Acme's side, and her entry with her.
    const [acmeView] = await getRecords(w.scope, { ids: [acme] });
    expect(acmeView?.values[w.company('team')]).toEqual([]);
    expect(await liveRecords(w)).toBe((before ?? 0) - 2);
    const stored = await db.withWorkspace(w.workspaceId, (tx) =>
      tx.execute<{ id: string; batch: string }>(
        sql`select id::text, deleted_batch_id::text as batch from records where deleted_at is not null order by id`,
      ),
    );
    expect(stored.rows.map((row) => row.batch)).toEqual([batchId, batchId]);
    // One outbox row for the object, naming both as deleted.
    const outbox = await db.withWorkspace(w.workspaceId, (tx) =>
      tx.execute<{ deleted: string[] }>(
        sql`select deleted_ids::text[] as deleted from outbox where kind = 'records' and object_id = ${w.people} order by seq desc limit 1`,
      ),
    );
    expect([...(outbox.rows[0]?.deleted ?? [])].sort()).toEqual([ada, bob].sort());
  });

  it('answers a retry with the same batch as deleted and changes nothing; another delete as already deleted (AC-540)', async () => {
    const w = await world();
    const ada = await person(w, 'Ada');
    const batchId = newId();
    await deleteRecords(w.scope, { objectId: w.people, recordIds: [ada], batchId });
    const before = await liveRecords(w);
    expect(await deleteRecords(w.scope, { objectId: w.people, recordIds: [ada], batchId })).toEqual([
      { recordId: ada, state: 'deleted' },
    ]);
    expect(await liveRecords(w)).toBe(before);
    expect(await deleteRecords(w.scope, { objectId: w.people, recordIds: [ada], batchId: newId() })).toEqual([
      {
        recordId: ada,
        state: 'already-deleted',
        refusal: { code: 'RECORD_DELETED', message: 'That record was already deleted.' },
      },
    ]);
  });

  it('refuses unknown records, records of another object and hidden ones per record, NOT_FOUND', async () => {
    const w = await world();
    const ada = await person(w, 'Ada');
    const acme = (await createRecord(w.scope, { objectId: w.companies, values: {} })).recordId;
    const unknown = newId();
    const outcomes = await deleteRecords(w.scope, {
      objectId: w.people,
      recordIds: [ada, acme, unknown],
      batchId: newId(),
    });
    expect(outcomes.map((outcome) => [outcome.state, outcome.refusal?.code])).toEqual([
      ['deleted', undefined],
      ['refused', 'NOT_FOUND'],
      ['refused', 'NOT_FOUND'],
    ]);
    // A record outside a member's record rule (owned by someone else) is refused as unknown.
    const bob = await person(w, 'Bob');
    const ruled = rescope(w.scope, {
      actor: { type: 'member', id: newId() },
      role: 'member',
      rules: {
        levels: [],
        // An own records rule on Created by, which no value holds: every record is outside it.
        records: [
          {
            subject: { type: 'role', role: 'member' },
            objectId: w.people,
            attributeId: w.person('created_by'),
            kind: 'own',
          },
        ],
      },
    });
    const hidden = await deleteRecords(ruled, { objectId: w.people, recordIds: [bob], batchId: newId() });
    expect(hidden[0]?.refusal?.code).toBe('NOT_FOUND');
    expect(await getRecords(w.scope, { ids: [bob] })).toHaveLength(1);
  });

  it('refuses the whole call on an object the member may only read, deleting nothing (FORBIDDEN)', async () => {
    const w = await world();
    const ada = await person(w, 'Ada');
    const readOnly = rescope(w.scope, {
      role: 'member',
      rules: {
        levels: [
          { subject: { type: 'role', role: 'member' }, target: { type: 'object', objectId: w.people }, level: 'read' },
        ],
        records: [],
      },
    });
    expect(
      await refusalOf(deleteRecords(readOnly, { objectId: w.people, recordIds: [ada], batchId: newId() })),
    ).toEqual({
      code: 'FORBIDDEN',
      message: 'You can view People but not change them.',
    });
    expect(await getRecords(w.scope, { ids: [ada] })).toHaveLength(1);
  });

  it('refuses more than 500 records, CONFIG_INVALID (AC-539)', async () => {
    const w = await world();
    const ids = Array.from({ length: 501 }, () => newId());
    expect(await refusalOf(deleteRecords(w.scope, { objectId: w.people, recordIds: ids, batchId: newId() }))).toEqual({
      code: 'CONFIG_INVALID',
      message: 'Changes to more than 500 records arrive soon.',
    });
  });

  it('deletes each record once when two deletes over the same records run at once, with no deadlock', async () => {
    const w = await world();
    const ids = await Promise.all(['A', 'B', 'C', 'D', 'E', 'F'].map((name) => person(w, name)));
    const before = await liveRecords(w);
    const [first, second] = await Promise.all([
      deleteRecords(w.scope, { objectId: w.people, recordIds: ids.slice(0, 4), batchId: newId() }),
      deleteRecords(w.scope, { objectId: w.people, recordIds: [...ids.slice(2)].reverse(), batchId: newId() }),
    ]);
    const deleted = [...first, ...second].filter((outcome) => outcome.state === 'deleted').map((each) => each.recordId);
    expect([...deleted].sort()).toEqual([...ids].sort());
    expect(await liveRecords(w)).toBe((before ?? 0) - 6);
  });
});

describe('restoreBatch and restoreRecords', () => {
  it('restores a batch with its links, entries and full history (AC-526)', async () => {
    const w = await world();
    const acme = (await createRecord(w.scope, { objectId: w.companies, values: { [w.company('name')]: 'Acme' } }))
      .recordId;
    const ada = await person(w, 'Ada');
    await setValues(w.scope, { recordId: ada, values: { [w.person('job_title')]: { value: 'Engineer' } } });
    await setValues(w.scope, { recordId: ada, values: { [w.person('job_title')]: { value: 'Countess' } } });
    await setValues(w.scope, {
      recordId: ada,
      values: { [w.person('company')]: { value: { objectId: w.companies, recordId: acme } } },
    });
    const { listId } = await defineList(w.scope, { objectId: w.people, apiSlug: 'crew', name: 'Crew' });
    await addEntry(w.scope, { listId, recordId: ada });
    const history = await getHistory(w.scope, { recordId: ada, attributeId: w.person('job_title') });
    const batchId = newId();
    await deleteRecords(w.scope, { objectId: w.people, recordIds: [ada], batchId });
    const before = await liveRecords(w);
    expect(await restoreBatch(w.scope, { batchId })).toEqual([{ recordId: ada, state: 'restored' }]);
    const [adaView] = await getRecords(w.scope, { ids: [ada] });
    expect(adaView?.values[w.person('company')]).toEqual({ objectId: w.companies, recordId: acme });
    expect(adaView?.values[w.person('job_title')]).toBe('Countess');
    expect(await getRecordEntries(w.scope, { recordId: ada })).toHaveLength(1);
    expect(await getHistory(w.scope, { recordId: ada, attributeId: w.person('job_title') })).toEqual(history);
    expect(await liveRecords(w)).toBe((before ?? 0) + 1);
    // The batch is gone from the trash: undoing it again finds nothing.
    expect(await refusalOf(restoreBatch(w.scope, { batchId }))).toEqual({
      code: 'NOT_FOUND',
      message: 'Nothing from that delete is still in the trash.',
    });
  });

  it('restores only records still holding the batch, and leaves one whose unique value was taken in the trash', async () => {
    const w = await world();
    const ada = await person(w, 'Ada', 'ada@acme.com');
    const bob = await person(w, 'Bob');
    const cy = await person(w, 'Cy');
    const batchId = newId();
    await deleteRecords(w.scope, { objectId: w.people, recordIds: [ada, bob, cy], batchId });
    // Cy is restored and deleted again in another batch since; someone else now has Ada's email.
    await restoreRecords(w.scope, { recordIds: [cy] });
    await deleteRecords(w.scope, { objectId: w.people, recordIds: [cy], batchId: newId() });
    await person(w, 'Ada Two', 'ada@acme.com');
    const outcomes = await restoreBatch(w.scope, { batchId });
    expect(outcomes.map((outcome) => [outcome.recordId, outcome.state, outcome.refusal?.code])).toEqual(
      [
        [ada, 'refused', 'UNIQUE_CONFLICT'],
        [bob, 'restored', undefined],
      ].sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    );
    expect(outcomes.find((outcome) => outcome.recordId === ada)?.refusal?.message).toContain('ada@acme.com');
    expect((await getRecords(w.scope, { ids: [ada, bob, cy] })).map((view) => view.id)).toEqual([bob]);
  });

  it('refuses records past the free record slots, LIMIT_REACHED, and restores the rest', async () => {
    const w = await world();
    const ids = await Promise.all(['A', 'B', 'C'].map((name) => person(w, name)));
    await deleteRecords(w.scope, { objectId: w.people, recordIds: ids, batchId: newId() });
    const live = (await liveRecords(w)) ?? 0;
    const tight = rescope(w.scope, { limits: { liveRecords: live + 2 } });
    const outcomes = await restoreRecords(tight, { recordIds: ids });
    expect(outcomes.filter((outcome) => outcome.state === 'restored')).toHaveLength(2);
    const refused = outcomes.filter((outcome) => outcome.state === 'refused');
    expect(refused.map((outcome) => outcome.refusal?.code)).toEqual(['LIMIT_REACHED']);
    expect(refused[0]?.refusal?.message).toMatch(/Delete some before restoring/);
  });

  it('refuses a record past the 30 days NOT_FOUND, answers a live one live, and per record FORBIDDEN on a read only object (AC-534)', async () => {
    const w = await world();
    const old = await person(w, 'Old');
    const fresh = await person(w, 'Fresh');
    const deal = (
      await createRecord(w.scope, {
        objectId: w.objects.deals ?? '',
        values: { [await dealName(w)]: 'Big deal' },
      })
    ).recordId;
    await deleteRecords(w.scope, { objectId: w.people, recordIds: [old, fresh], batchId: newId() });
    await deleteRecords(w.scope, { objectId: w.objects.deals ?? '', recordIds: [deal], batchId: newId() });
    await db.withWorkspace(w.workspaceId, (tx) =>
      tx.execute(sql`update records set deleted_at = now() - interval '31 days' where id = ${old}`),
    );
    const live = await person(w, 'Live');
    const readOnlyDeals = rescope(w.scope, {
      role: 'member',
      rules: {
        levels: [
          {
            subject: { type: 'role', role: 'member' },
            target: { type: 'object', objectId: w.objects.deals ?? '' },
            level: 'read',
          },
        ],
        records: [],
      },
    });
    const outcomes = await restoreRecords(readOnlyDeals, { recordIds: [old, fresh, live, deal] });
    expect(outcomes).toEqual([
      {
        recordId: old,
        state: 'refused',
        refusal: { code: 'NOT_FOUND', message: 'That record was deleted more than 30 days ago.' },
      },
      { recordId: fresh, state: 'restored' },
      { recordId: live, state: 'live' },
      {
        recordId: deal,
        state: 'refused',
        refusal: { code: 'FORBIDDEN', message: 'You can view Deals but not change them.' },
      },
    ]);
  });
});

describe('queryTrash and countTrash (AC-533)', () => {
  it('lists the trash newest first by keyset, by object, with the count', async () => {
    const w = await world();
    const ids: string[] = [];
    for (const name of ['A', 'B', 'C', 'D', 'E']) {
      const id = await person(w, name);
      ids.push(id);
      await deleteRecords(w.scope, { objectId: w.people, recordIds: [id], batchId: newId() });
    }
    const acme = (await createRecord(w.scope, { objectId: w.companies, values: { [w.company('name')]: 'Acme' } }))
      .recordId;
    await deleteRecords(w.scope, { objectId: w.companies, recordIds: [acme], batchId: newId() });
    const first = await queryTrash(w.scope, { limit: 4 });
    expect(first.items.map((item) => item.recordId)).toEqual([acme, ...[...ids].reverse().slice(0, 3)]);
    expect(first.nextCursor).toBeDefined();
    const second = await queryTrash(w.scope, { limit: 4, cursor: first.nextCursor ?? '' });
    expect(second.items.map((item) => item.recordId)).toEqual([ids[1], ids[0]]);
    expect(second.nextCursor).toBeUndefined();
    const [top] = first.items;
    expect(top).toMatchObject({
      recordId: acme,
      objectId: w.companies,
      display: { name: 'Acme', kind: 'company' },
      deletedBy: { type: 'member', id: w.memberId },
    });
    expect(Date.parse(top?.expiresAt ?? '') - Date.parse(top?.deletedAt ?? '')).toBe(30 * 24 * 60 * 60 * 1000);
    const people = await queryTrash(w.scope, { objectId: w.people });
    expect(people.items.map((item) => item.recordId)).toEqual([...ids].reverse());
    expect(await countTrash(w.scope)).toEqual({ count: 6, atLeast: false });
    expect(await countTrash(w.scope, { objectId: w.companies })).toEqual({ count: 1, atLeast: false });
    expect(await refusalOf(queryTrash(w.scope, { cursor: 'not-a-cursor' }))).toMatchObject({ code: 'FILTER_INVALID' });
  });

  it('leaves out hidden objects and records, and names a record with a hidden name "Unnamed" (AC-538)', async () => {
    const w = await world();
    const ada = await person(w, 'Ada');
    const acme = (await createRecord(w.scope, { objectId: w.companies, values: { [w.company('name')]: 'Acme' } }))
      .recordId;
    await deleteRecords(w.scope, { objectId: w.people, recordIds: [ada], batchId: newId() });
    await deleteRecords(w.scope, { objectId: w.companies, recordIds: [acme], batchId: newId() });
    const member = (rules: Parameters<typeof rescope>[1]['rules']): EngineScope =>
      rescope(w.scope, {
        actor: { type: 'member', id: newId() },
        role: 'member',
        ...(rules === undefined ? {} : { rules }),
      });
    const role = { type: 'role' as const, role: 'member' };
    const noPeople = member({
      levels: [{ subject: role, target: { type: 'object', objectId: w.people }, level: 'none' }],
      records: [],
    });
    expect((await queryTrash(noPeople)).items.map((item) => item.recordId)).toEqual([acme]);
    expect(await countTrash(noPeople)).toEqual({ count: 1, atLeast: false });
    expect(await refusalOf(queryTrash(noPeople, { objectId: w.people }))).toMatchObject({ code: 'NOT_FOUND' });
    const hiddenName = member({
      levels: [
        {
          subject: role,
          target: { type: 'attribute', attributeId: w.company('name'), objectId: w.companies },
          level: 'hidden',
        },
      ],
      records: [],
    });
    const named = await queryTrash(hiddenName, { objectId: w.companies });
    expect(named.items[0]?.display.name).toBe('Unnamed company');
    const ownOnly = member({
      levels: [],
      records: [{ subject: role, objectId: w.people, attributeId: w.person('created_by'), kind: 'own' }],
    });
    expect((await queryTrash(ownOnly, { objectId: w.people })).items).toEqual([]);
  });
});
