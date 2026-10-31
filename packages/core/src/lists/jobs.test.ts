// A list's bulk jobs (spec 0048, AC-4817, AC-4818, AC-4825) against a real
// Postgres as the app login, driven slice by slice as Graphile Worker would:
// adding every matching record after a count and a confirm (one already in is
// skipped), its undo taking out exactly the entries it made, removing every
// matching entry and its undo bringing exactly those back, and the start's
// refusals (another object's records, an archived list, someone else's job).
import { sql } from 'drizzle-orm';
import { createDatabase } from '@crm/db';
import { testQuery } from '@crm/db/testing';
import { afterAll, describe, expect, inject, it } from 'vitest';
import type { RuleSource } from '../access/door.ts';
import { NO_RULES, type AccessRules } from '../access/policy.ts';
import { rescope } from '../testing.ts';
import { newId } from '../engine/ids.ts';
import { outboxHook } from '../engine/outbox.ts';
import { createRecord } from '../engine/records.ts';
import { jobKinds } from '../jobs/kinds/index.ts';
import { confirmJob, getJob } from '../jobs/service.ts';
import { jobTestKit, refusalOf } from '../../test/jobs-kit.ts';
import { startAddMatching, startRemoveMatching, undoEntriesJob } from './jobs.ts';
import { addListEntry, archiveList, countEntries, createList, queryEntries } from './lists.ts';

const { appUrl, ownerUrl } = inject('testDatabase');
const db = createDatabase({ url: appUrl, applicationName: 'crm-list-jobs-tests' });
afterAll(async () => {
  await db.close();
});

/** Each test workspace's rules, by workspace id: the kit's runner enters jobs with them. */
const rulesByWorkspace = new Map<string, AccessRules>();
const rules: RuleSource = async (tx) => {
  const { rows } = await tx.execute<{ id: string | null }>(sql`select current_setting('app.workspace_id', true) as id`);
  return rulesByWorkspace.get(rows[0]?.id ?? '') ?? NO_RULES;
};
const { team, runnerFor, drive } = jobTestKit(db, ownerUrl, { rules });
const registry = jobKinds({ environment: 'local' });

/** Now by the database's clock, so an `asOf` compares with what it stamps. */
const databaseNow = async (): Promise<string> =>
  (
    await testQuery<{ now: string }>(
      ownerUrl,
      `select to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as now`,
    )
  )[0]?.now ?? '';

async function world() {
  const t = await team();
  const rows = await db.withWorkspace(t.workspaceId, (tx) =>
    tx.execute<{ id: string; api_slug: string; object_id: string; object: string }>(
      sql`select a.id::text, a.api_slug, a.object_id::text, o.api_slug as object from attributes a join objects o on o.id = a.object_id`,
    ),
  );
  const objectOf = (slug: string) => rows.rows.find((row) => row.object === slug)?.object_id ?? '';
  const people = objectOf('people');
  const name = rows.rows.find((row) => row.object === 'people' && row.api_slug === 'name')?.id ?? '';
  const ownerField = rows.rows.find((row) => row.object === 'people' && row.api_slug === 'owner')?.id ?? '';
  const person = async (firstName: string, ownedBy?: string) =>
    (
      await createRecord(t.owner, {
        objectId: people,
        values: {
          [name]: { firstName },
          ...(ownedBy === undefined ? {} : { [ownerField]: { type: 'member', id: ownedBy } }),
        },
      })
    ).recordId;
  const list = await createList(t.owner, { id: newId(), objectId: people, name: 'Pipe', template: 'pipeline' });
  return { ...t, people, companies: objectOf('companies'), person, ownerField, list };
}

describe('a list’s bulk jobs (AC-4817, AC-4818, AC-4825)', () => {
  it('adds every matching record after a count and a confirm, skips one already in, and undoes exactly its adds', async () => {
    const w = await world();
    const made = [await w.person('Ada'), await w.person('Bo'), await w.person('Cy')];
    await addListEntry(w.owner, { id: newId(), listId: w.list.id, recordId: made[0] ?? '' });
    const id = newId();
    const job = await startAddMatching(
      w.owner,
      registry,
      {
        id,
        listId: w.list.id,
        target: { kind: 'matching', objectId: w.people, except: [], asOf: await databaseNow() },
      },
      [outboxHook()],
    );
    expect(job).toMatchObject({ status: 'preparing', kind: 'entries.bulk_add' });
    const run = runnerFor(registry);
    expect(await drive(run, w.workspaceId, id)).toContain('ready');
    expect((await getJob(w.owner, registry, id)).total).toBe(3);
    await confirmJob(w.owner, registry, id, [outboxHook()]);
    expect((await drive(run, w.workspaceId, id)).at(-1)).toBe('succeeded');
    const finished = await getJob(w.owner, registry, id);
    expect({ done: finished.done, skipped: finished.skipped }).toEqual({ done: 2, skipped: 1 });
    expect((await countEntries(w.owner, { listId: w.list.id })).count).toBe(3);
    // Undo takes out the two it made and keeps the one that was there before.
    const undo = await undoEntriesJob(w.owner, registry, { id: newId(), jobId: id }, [outboxHook()]);
    expect(undo.kind).toBe('entries.bulk_remove');
    expect((await drive(run, w.workspaceId, undo.id)).at(-1)).toBe('succeeded');
    const left = await queryEntries(w.owner, { listId: w.list.id });
    expect(left.entries.map((entry) => entry.recordId)).toEqual([made[0]]);
  });

  it('removes every matching entry, and its undo brings exactly those back', async () => {
    const w = await world();
    for (const firstName of ['Ada', 'Bo', 'Cy']) {
      await addListEntry(w.owner, { id: newId(), listId: w.list.id, recordId: await w.person(firstName) });
    }
    const all = (await queryEntries(w.owner, { listId: w.list.id })).entries;
    const kept = all[0]?.id ?? '';
    const id = newId();
    await startRemoveMatching(w.owner, registry, {
      id,
      listId: w.list.id,
      target: { kind: 'matching', except: [kept], asOf: await databaseNow() },
    });
    const run = runnerFor(registry);
    await drive(run, w.workspaceId, id);
    expect((await getJob(w.owner, registry, id)).total).toBe(2);
    await confirmJob(w.owner, registry, id);
    expect((await drive(run, w.workspaceId, id)).at(-1)).toBe('succeeded');
    expect((await countEntries(w.owner, { listId: w.list.id })).count).toBe(1);
    const undo = await undoEntriesJob(w.owner, registry, { id: newId(), jobId: id });
    expect(undo.kind).toBe('entries.bulk_restore');
    expect((await drive(run, w.workspaceId, undo.id)).at(-1)).toBe('succeeded');
    expect((await countEntries(w.owner, { listId: w.list.id })).count).toBe(3);
  });

  it('never counts, adds or removes a record the starter’s record rule hides (AC-4836)', async () => {
    const w = await world();
    const mine = await w.person('Ada', w.memberId);
    const theirs = await w.person('Bo');
    const own: AccessRules = {
      levels: [],
      records: [
        { subject: { type: 'role', role: 'member' }, objectId: w.people, kind: 'own', attributeId: w.ownerField },
      ],
    };
    rulesByWorkspace.set(w.workspaceId, own);
    const member = rescope(w.member, { rules: own });
    const run = runnerFor(registry);
    const id = newId();
    await startAddMatching(member, registry, {
      id,
      listId: w.list.id,
      target: { kind: 'matching', objectId: w.people, except: [], asOf: await databaseNow() },
    });
    await drive(run, w.workspaceId, id);
    expect((await getJob(member, registry, id)).total).toBe(1);
    await confirmJob(member, registry, id);
    expect((await drive(run, w.workspaceId, id)).at(-1)).toBe('succeeded');
    expect((await queryEntries(w.owner, { listId: w.list.id })).entries.map((entry) => entry.recordId)).toEqual([mine]);
    // The owner adds the hidden one; the member's removal of all matching never counts it.
    await addListEntry(w.owner, { id: newId(), listId: w.list.id, recordId: theirs });
    const removal = newId();
    await startRemoveMatching(member, registry, {
      id: removal,
      listId: w.list.id,
      target: { kind: 'matching', except: [], asOf: await databaseNow() },
    });
    await drive(run, w.workspaceId, removal);
    expect((await getJob(member, registry, removal)).total).toBe(1);
    // Undo waits for the change to end, so it never races what it takes back.
    expect(await refusalOf(undoEntriesJob(member, registry, { id: newId(), jobId: removal }))).toMatchObject({
      code: 'CONFIG_INVALID',
    });
  });

  it('refuses another object’s records, an archived list, and undoing someone else’s job', async () => {
    const w = await world();
    const asOf = await databaseNow();
    expect(
      await refusalOf(
        startAddMatching(w.owner, registry, {
          id: newId(),
          listId: w.list.id,
          target: { kind: 'matching', objectId: w.companies, except: [], asOf },
        }),
      ),
    ).toMatchObject({ code: 'CONFIG_INVALID' });
    const id = newId();
    await startRemoveMatching(w.owner, registry, {
      id,
      listId: w.list.id,
      target: { kind: 'matching', except: [], asOf },
    });
    expect(await refusalOf(undoEntriesJob(w.admin, registry, { id: newId(), jobId: id }))).toMatchObject({
      code: 'NOT_FOUND',
    });
    await archiveList(w.owner, { listId: w.list.id });
    expect(
      await refusalOf(
        startRemoveMatching(w.owner, registry, {
          id: newId(),
          listId: w.list.id,
          target: { kind: 'matching', except: [], asOf },
        }),
      ),
    ).toEqual({ code: 'NOT_FOUND', message: 'That list is archived. Restore it first.' });
  });
});
