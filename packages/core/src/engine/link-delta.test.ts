// Spec 0014, milestone 2: link deltas (`changeLinks`), the archived by object
// rule on link reads, and the record picker's search, against a real Postgres.
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, type Database } from '@crm/db';
import type { EngineRefusal } from '@crm/contracts/values';
import { setObjectArchived } from './definitions.ts';
import { deleteRecord, restoreRecord } from './deletion.ts';
import { getHistory } from './history.ts';
import { newId } from './ids.ts';
import { changeLinks, type LinksDelta } from './link-delta.ts';
import { outboxHook } from './outbox.ts';
import { searchRecords } from './record-search.ts';
import { createRecord, getRecords, setRecordValues } from './records.ts';
import { isRefusal } from './refusals.ts';
import { defineRelationship } from './relationships.ts';
import type { EngineScope } from './scope.ts';
import { createWorkspace } from './workspaces.ts';
import { editRecord } from '../records/records.ts';
import { rescope, testScope } from '../testing.ts';

const { appUrl, ownerUrl } = inject('testDatabase');
let db: Database;
let owner: Database;

beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-link-delta-tests' });
  owner = createDatabase({ url: ownerUrl, applicationName: 'crm-link-delta-tests-owner' });
});
afterAll(async () => {
  await db.close();
  await owner.close();
});

const must = (value: string | undefined): string => {
  if (value === undefined) throw new Error('Missing id.');
  return value;
};

let count = 0;
async function world() {
  count += 1;
  const created = await createWorkspace(db, {
    name: 'Deltas',
    slug: `deltas-${String(count)}-${String(Date.now())}`,
    firstMember: { name: 'Ada', email: 'ada@example.com' },
  });
  const scope = testScope({ db, workspaceId: created.workspaceId, actor: { type: 'member', id: created.memberId } });
  const rows = await db.withWorkspace(scope.workspaceId, (tx) =>
    tx.execute<{ id: string; api_slug: string; object_id: string }>(
      sql`select id::text, api_slug, object_id::text from attributes where object_id is not null`,
    ),
  );
  const people = must(created.objects.people);
  const companies = must(created.objects.companies);
  const deals = must(created.objects.deals);
  const on = (objectId: string) => (slug: string) =>
    must(rows.rows.find((row) => row.object_id === objectId && row.api_slug === slug)?.id);
  return {
    ...created,
    scope,
    people,
    companies,
    deals,
    person: on(people),
    company: on(companies),
    deal: on(deals),
  };
}
type World = Awaited<ReturnType<typeof world>>;

async function person(w: World, firstName: string, email?: string) {
  const values: Record<string, unknown> = { [w.person('name')]: { firstName } };
  if (email !== undefined) values[w.person('email_addresses')] = [email];
  return (await createRecord(w.scope, { objectId: w.people, values })).recordId;
}

async function company(w: World, name: string, scope: EngineScope = w.scope) {
  return (await createRecord(scope, { objectId: w.companies, values: { [w.company('name')]: name } })).recordId;
}

async function valueOf(scope: EngineScope, recordId: string, attributeId: string): Promise<unknown> {
  const [record] = await getRecords(scope, { ids: [recordId] });
  return record?.values[attributeId];
}

const ids = (value: unknown): readonly string[] =>
  (Array.isArray(value) ? value : value === null || value === undefined ? [] : [value]).map(
    (item: { recordId: string }) => item.recordId,
  );

async function refusal(promise: Promise<unknown>): Promise<EngineRefusal | undefined> {
  try {
    await promise;
  } catch (error) {
    if (isRefusal(error)) return error.refusal;
    throw error;
  }
  return undefined;
}

const add = (
  w: World,
  recordId: string,
  attributeId: string,
  targets: readonly { objectId: string; recordId: string }[],
  more: Partial<Extract<LinksDelta, { kind: 'add' }>> = {},
) => ({ kind: 'add', recordId, attributeId, targets, ...more }) as const;

async function outboxOf(w: World, mutationId: string) {
  const rows = await db.withWorkspace(w.scope.workspaceId, (tx) =>
    tx.execute<{ object_id: string; record_ids: string[]; attribute_ids: string[] }>(
      sql`select object_id::text, record_ids::text[], attribute_ids::text[] from outbox where mutation_id = ${mutationId}::uuid order by object_id`,
    ),
  );
  return rows.rows;
}

describe('adding and removing links on a side that holds many (AC-290, AC-296)', () => {
  it('adds one link, rewrites nothing else, and changes the far side in the same write', async () => {
    const w = await world();
    const acme = await company(w, 'Acme');
    const [ada, ben, cy] = [await person(w, 'Ada'), await person(w, 'Ben'), await person(w, 'Cy')];
    await changeLinks(w.scope, add(w, acme, w.company('team'), [{ objectId: w.people, recordId: ada }]));
    const before = await db.withWorkspace(w.scope.workspaceId, (tx) =>
      tx.execute<{ id: string }>(
        sql`select id::text from record_links where to_record_id = ${acme} and active_until is null`,
      ),
    );
    const mutationId = newId();
    const outcome = await changeLinks(
      w.scope,
      add(w, acme, w.company('team'), [
        { objectId: w.people, recordId: ben },
        { objectId: w.people, recordId: cy },
      ]),
      [outboxHook({ mutationId })],
    );
    expect(ids(await valueOf(w.scope, acme, w.company('team')))).toEqual([ada, ben, cy]);
    expect(ids(await valueOf(w.scope, ben, w.person('company')))).toEqual([acme]);
    // Ada's link is the same row it was: nothing on the side was rewritten.
    const after = await db.withWorkspace(w.scope.workspaceId, (tx) =>
      tx.execute<{ id: string }>(
        sql`select id::text from record_links where to_record_id = ${acme} and active_until is null`,
      ),
    );
    expect(after.rows.map((row) => row.id)).toEqual(expect.arrayContaining(before.rows.map((row) => row.id)));
    expect(outcome.changes.map((change) => change.ownerId)).toEqual([acme, ben, cy]);
    // One row per object: the near record on Companies, both far records on People, with both sides named.
    const rows = await outboxOf(w, mutationId);
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.object_id === w.companies)?.record_ids).toEqual([acme]);
    expect([...(rows.find((row) => row.object_id === w.people)?.record_ids ?? [])].sort()).toEqual([ben, cy].sort());
    // History on both sides, with who.
    const history = await getHistory(w.scope, { recordId: ben, attributeId: w.person('company') });
    expect(history.at(-1)).toMatchObject({ setBy: { type: 'member', id: w.memberId } });
  });

  it('removes only the named link, and an add or remove that changes nothing succeeds and stores no event', async () => {
    const w = await world();
    const acme = await company(w, 'Acme');
    const [ada, ben] = [await person(w, 'Ada'), await person(w, 'Ben')];
    await changeLinks(
      w.scope,
      add(w, acme, w.company('team'), [
        { objectId: w.people, recordId: ada },
        { objectId: w.people, recordId: ben },
      ]),
    );
    await changeLinks(w.scope, {
      kind: 'remove',
      recordId: acme,
      attributeId: w.company('team'),
      targetRecordIds: [ada],
    });
    expect(ids(await valueOf(w.scope, acme, w.company('team')))).toEqual([ben]);
    expect(await valueOf(w.scope, ada, w.person('company'))).toBeNull();
    const mutationId = newId();
    const hooks = [outboxHook({ mutationId })];
    const again = await changeLinks(
      w.scope,
      { kind: 'remove', recordId: acme, attributeId: w.company('team'), targetRecordIds: [ada] },
      hooks,
    );
    const twice = await changeLinks(
      w.scope,
      add(w, acme, w.company('team'), [{ objectId: w.people, recordId: ben }]),
      hooks,
    );
    expect([again.changes, twice.changes]).toEqual([[], []]);
    expect(await outboxOf(w, mutationId)).toEqual([]);
  });

  it('refuses a records.setValues of a side that holds many, and keeps the whole value path for the engine', async () => {
    const w = await world();
    const acme = await company(w, 'Acme');
    const ada = await person(w, 'Ada');
    expect(
      await refusal(
        editRecord(w.scope, {
          recordId: acme,
          values: { [w.company('team')]: { value: [{ objectId: w.people, recordId: ada }] } },
        }),
      ),
    ).toEqual({
      code: 'ATTRIBUTE_VALUE_INVALID',
      message: 'Add or remove links one at a time.',
      attributeId: w.company('team'),
    });
    // A side that holds one still takes a whole value there; the engine's own write still takes a list.
    await editRecord(w.scope, {
      recordId: ada,
      values: { [w.person('company')]: { value: { objectId: w.companies, recordId: acme } } },
    });
    expect(ids(await valueOf(w.scope, acme, w.company('team')))).toEqual([ada]);
    await setRecordValues(w.scope, { recordId: acme, values: { [w.company('team')]: { value: null } } });
    expect(ids(await valueOf(w.scope, acme, w.company('team')))).toEqual([]);
  });
});

describe('a side that holds one (AC-291, AC-295)', () => {
  it('replaces its link in one save, the old far record losing it, and clears it on remove', async () => {
    const w = await world();
    const [acme, globex] = [await company(w, 'Acme'), await company(w, 'Globex')];
    const ada = await person(w, 'Ada');
    await changeLinks(w.scope, add(w, ada, w.person('company'), [{ objectId: w.companies, recordId: acme }]));
    const [first] = await getRecords(w.scope, { ids: [ada] });
    const version = first?.versions[w.person('company')];
    const outcome = await changeLinks(
      w.scope,
      add(w, ada, w.person('company'), [{ objectId: w.companies, recordId: globex }], {
        baseVersionId: version ?? null,
      }),
    );
    expect(outcome.changes.map((change) => change.ownerId).sort()).toEqual([ada, acme, globex].sort());
    expect(outcome.changes[0]?.replaced).toBeUndefined();
    expect(ids(await valueOf(w.scope, acme, w.company('team')))).toEqual([]);
    expect(ids(await valueOf(w.scope, globex, w.company('team')))).toEqual([ada]);
    // Edited from the version before: this save reports the one it replaced.
    const stale = await changeLinks(
      w.scope,
      add(w, ada, w.person('company'), [{ objectId: w.companies, recordId: acme }], { baseVersionId: version ?? null }),
    );
    expect(stale.changes[0]?.replaced).toMatchObject({ setBy: { type: 'member', id: w.memberId } });
    await changeLinks(w.scope, {
      kind: 'remove',
      recordId: ada,
      attributeId: w.person('company'),
      targetRecordIds: [acme],
    });
    expect(await valueOf(w.scope, ada, w.person('company'))).toBeNull();
    expect(ids(await valueOf(w.scope, acme, w.company('team')))).toEqual([]);
  });

  it('refuses two records on a side that holds one', async () => {
    const w = await world();
    const [acme, globex] = [await company(w, 'Acme'), await company(w, 'Globex')];
    const ada = await person(w, 'Ada');
    expect(
      (
        await refusal(
          changeLinks(
            w.scope,
            add(w, ada, w.person('company'), [
              { objectId: w.companies, recordId: acme },
              { objectId: w.companies, recordId: globex },
            ]),
          ),
        )
      )?.code,
    ).toBe('ATTRIBUTE_VALUE_INVALID');
  });
});

describe('moving a record taken on a far side of one (AC-292, AC-293)', () => {
  it('refuses RELATIONSHIP_TAKEN naming the picked record, and moves it in one save with move', async () => {
    const w = await world();
    const [acme, globex] = [await company(w, 'Acme'), await company(w, 'Globex')];
    const ada = await person(w, 'Ada');
    await changeLinks(w.scope, add(w, acme, w.company('team'), [{ objectId: w.people, recordId: ada }]));
    const mutationId = newId();
    const hooks = [outboxHook({ mutationId })];
    expect(
      await refusal(
        changeLinks(w.scope, add(w, globex, w.company('team'), [{ objectId: w.people, recordId: ada }]), hooks),
      ),
    ).toEqual({
      code: 'RELATIONSHIP_TAKEN',
      message: 'Ada is already linked to another record through Team.',
      attributeId: w.company('team'),
    });
    expect(await outboxOf(w, mutationId)).toEqual([]);
    const moved = await changeLinks(
      w.scope,
      add(w, globex, w.company('team'), [{ objectId: w.people, recordId: ada }], { move: true }),
      hooks,
    );
    expect(ids(await valueOf(w.scope, acme, w.company('team')))).toEqual([]);
    expect(ids(await valueOf(w.scope, globex, w.company('team')))).toEqual([ada]);
    expect(ids(await valueOf(w.scope, ada, w.person('company')))).toEqual([globex]);
    // The old holder is named, on this same side.
    expect(moved.changes).toContainEqual(expect.objectContaining({ ownerId: acme, attributeId: w.company('team') }));
    const rows = await outboxOf(w, mutationId);
    expect([...(rows.find((row) => row.object_id === w.companies)?.record_ids ?? [])].sort()).toEqual(
      [acme, globex].sort(),
    );
  });

  it('lets exactly one of two links racing onto the same record win', async () => {
    const w = await world();
    const [acme, globex] = [await company(w, 'Acme'), await company(w, 'Globex')];
    const ada = await person(w, 'Ada');
    const outcomes = await Promise.allSettled([
      changeLinks(w.scope, add(w, acme, w.company('team'), [{ objectId: w.people, recordId: ada }])),
      changeLinks(w.scope, add(w, globex, w.company('team'), [{ objectId: w.people, recordId: ada }])),
    ]);
    const refused = outcomes.filter((outcome) => outcome.status === 'rejected');
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(refused).toHaveLength(1);
    const [lost] = refused;
    expect(lost?.status === 'rejected' && isRefusal(lost.reason) ? lost.reason.refusal.code : undefined).toBe(
      'RELATIONSHIP_TAKEN',
    );
    expect(ids(await valueOf(w.scope, ada, w.person('company')))).toHaveLength(1);
  });

  it('keeps both sides agreeing when an add races a delete of the far record, or a whole value write', async () => {
    const w = await world();
    const acme = await company(w, 'Acme');
    const [ada, ben] = [await person(w, 'Ada'), await person(w, 'Ben')];
    const raced = await Promise.allSettled([
      changeLinks(w.scope, add(w, acme, w.company('team'), [{ objectId: w.people, recordId: ada }])),
      deleteRecord(w.scope, { recordId: ada }),
    ]);
    const [linking] = raced;
    if (linking.status === 'rejected') {
      expect(isRefusal(linking.reason) ? linking.reason.refusal.code : linking.reason).toBe('RECORD_DELETED');
    }
    // Either way the trashed person shows on no side, and a restore shows what was written.
    expect(ids(await valueOf(w.scope, acme, w.company('team')))).toEqual([]);
    await restoreRecord(w.scope, { recordId: ada });
    const restored = ids(await valueOf(w.scope, acme, w.company('team')));
    expect(restored).toEqual(linking.status === 'fulfilled' ? [ada] : []);
    // A delta and a whole value write on the same side take turns on the near record's lock.
    await Promise.all([
      changeLinks(w.scope, add(w, acme, w.company('team'), [{ objectId: w.people, recordId: ben }])),
      setRecordValues(w.scope, {
        recordId: acme,
        values: { [w.company('team')]: { value: [{ objectId: w.people, recordId: ada }] } },
      }),
    ]);
    const team = ids(await valueOf(w.scope, acme, w.company('team')));
    expect([[ada], [ada, ben]]).toContainEqual(team);
    expect(ids(await valueOf(w.scope, ben, w.person('company')))).toEqual(team.includes(ben) ? [acme] : []);
  });

  it('gives way to a holder in the trash, and a restore of that holder no longer holds it', async () => {
    const w = await world();
    const [acme, globex] = [await company(w, 'Acme'), await company(w, 'Globex')];
    const ada = await person(w, 'Ada');
    await changeLinks(w.scope, add(w, acme, w.company('team'), [{ objectId: w.people, recordId: ada }]));
    await deleteRecord(w.scope, { recordId: acme });
    await changeLinks(w.scope, add(w, globex, w.company('team'), [{ objectId: w.people, recordId: ada }]));
    await restoreRecord(w.scope, { recordId: acme });
    expect(ids(await valueOf(w.scope, ada, w.person('company')))).toEqual([globex]);
    expect(ids(await valueOf(w.scope, acme, w.company('team')))).toEqual([]);
  });
});

describe('refusals (AC-293, AC-304, AC-308)', () => {
  it('refuses a record in the trash, another object, itself, a missing record and too many', async () => {
    const w = await world();
    const acme = await company(w, 'Acme');
    const ada = await person(w, 'Ada');
    const gone = await person(w, 'Gone');
    await deleteRecord(w.scope, { recordId: gone });
    const codeOf = async (delta: LinksDelta) => (await refusal(changeLinks(w.scope, delta)))?.code;
    expect(await codeOf(add(w, acme, w.company('team'), [{ objectId: w.people, recordId: gone }]))).toBe(
      'RECORD_DELETED',
    );
    expect(await codeOf(add(w, acme, w.company('team'), [{ objectId: w.companies, recordId: acme }]))).toBe(
      'ATTRIBUTE_VALUE_INVALID',
    );
    expect(await codeOf(add(w, acme, w.company('team'), [{ objectId: w.people, recordId: newId() }]))).toBe(
      'NOT_FOUND',
    );
    // An object this side doesn't link to.
    const deal = (await createRecord(w.scope, { objectId: w.deals, values: { [w.deal('name')]: 'Big' } })).recordId;
    expect(await codeOf(add(w, acme, w.company('team'), [{ objectId: w.deals, recordId: deal }]))).toBe(
      'ATTRIBUTE_VALUE_INVALID',
    );
    expect(
      await codeOf({
        kind: 'remove',
        recordId: acme,
        attributeId: w.company('team'),
        targetRecordIds: Array.from({ length: 101 }, () => newId()),
      }),
    ).toBe('ATTRIBUTE_VALUE_INVALID');
    expect(await codeOf(add(w, acme, w.person('company'), [{ objectId: w.people, recordId: ada }]))).toBe('NOT_FOUND');
    // A self relationship: a record never links to itself.
    await defineRelationship(w.scope, {
      cardinality: 'many_to_one',
      from: { objectId: w.people, apiSlug: 'manager', title: 'Manager' },
      to: { objectId: w.people, apiSlug: 'reports', title: 'Reports' },
    });
    const manager = (
      await db.withWorkspace(w.scope.workspaceId, (tx) =>
        tx.execute<{ id: string }>(sql`select id::text from attributes where api_slug = 'manager'`),
      )
    ).rows[0]?.id;
    expect(await codeOf(add(w, ada, must(manager), [{ objectId: w.people, recordId: ada }]))).toBe(
      'ATTRIBUTE_VALUE_INVALID',
    );
  });

  it('refuses a far record the writer can’t see as missing, and a side they may only read', async () => {
    const w = await world();
    const acme = await company(w, 'Acme');
    const ada = await person(w, 'Ada');
    const role = { type: 'role' as const, role: 'member' };
    const blind = rescope(w.scope, {
      role: 'member',
      rules: {
        levels: [{ subject: role, target: { type: 'object', objectId: w.companies }, level: 'none' }],
        records: [],
      },
    });
    expect(
      (await refusal(changeLinks(blind, add(w, ada, w.person('company'), [{ objectId: w.companies, recordId: acme }]))))
        ?.code,
    ).toBe('NOT_FOUND');
    const readOnly = rescope(w.scope, {
      role: 'member',
      rules: {
        levels: [
          {
            subject: role,
            target: { type: 'attribute', objectId: w.people, attributeId: w.person('company') },
            level: 'read',
          },
        ],
        records: [],
      },
    });
    expect(
      (
        await refusal(
          changeLinks(readOnly, add(w, ada, w.person('company'), [{ objectId: w.companies, recordId: acme }])),
        )
      )?.code,
    ).toBe('ATTRIBUTE_READ_ONLY');
  });

  it('leaves an effectively archived side out of reads, refuses it NOT_FOUND, and a restore brings every link back', async () => {
    const w = await world();
    const acme = await company(w, 'Acme');
    const ada = await person(w, 'Ada');
    await changeLinks(w.scope, add(w, ada, w.person('company'), [{ objectId: w.companies, recordId: acme }]));
    await setObjectArchived(w.scope, { objectId: w.companies, archived: true });
    const [read] = await getRecords(w.scope, { ids: [ada] });
    expect(Object.hasOwn(read?.values ?? {}, w.person('company'))).toBe(false);
    expect(
      (
        await refusal(
          changeLinks(w.scope, add(w, ada, w.person('company'), [{ objectId: w.companies, recordId: acme }])),
        )
      )?.code,
    ).toBe('NOT_FOUND');
    expect((await refusal(searchRecords(w.scope, { objectId: w.companies, query: '' })))?.code).toBe('NOT_FOUND');
    await setObjectArchived(w.scope, { objectId: w.companies, archived: false });
    expect(ids(await valueOf(w.scope, ada, w.person('company')))).toEqual([acme]);
  });
});

describe('searchRecords (AC-289, AC-292, AC-304)', () => {
  it('lists the most recently updated, then a name prefix, then contains on the name and emails', async () => {
    const w = await world();
    await person(w, 'Anna', 'anna@north.example');
    await person(w, 'Andy');
    const bo = await person(w, 'Bo', 'bo@andover.example');
    const names = (results: readonly { ref: { name: string } }[]) => results.map((result) => result.ref.name);
    expect(names(await searchRecords(w.scope, { objectId: w.people, query: '' }))).toEqual(['Bo', 'Andy', 'Anna']);
    expect(names(await searchRecords(w.scope, { objectId: w.people, query: 'An' }))).toEqual(['Andy', 'Anna']);
    expect(names(await searchRecords(w.scope, { objectId: w.people, query: 'b' }))).toEqual(['Bo']);
    // Three or more: names that start with it first, then any that contain it (Bo's email holds "andover").
    expect(names(await searchRecords(w.scope, { objectId: w.people, query: 'and' }))).toEqual(['Andy', 'Bo']);
    expect(names(await searchRecords(w.scope, { objectId: w.people, query: 'north' }))).toEqual(['Anna']);
    expect(
      (await searchRecords(w.scope, { objectId: w.people, query: '', limit: 1 })).map((r) => r.ref.recordId),
    ).toEqual([bo]);
    // Wildcards match literally.
    expect(await searchRecords(w.scope, { objectId: w.people, query: '%%%' })).toEqual([]);
  });

  it('marks results linked from the record edited, and names who holds a taken one (or hides them)', async () => {
    const w = await world();
    const [acme, globex] = [await company(w, 'Acme'), await company(w, 'Globex')];
    const [ada, ben] = [await person(w, 'Ada'), await person(w, 'Ben')];
    await changeLinks(w.scope, add(w, acme, w.company('team'), [{ objectId: w.people, recordId: ada }]));
    await changeLinks(w.scope, add(w, globex, w.company('team'), [{ objectId: w.people, recordId: ben }]));
    const fromGlobex = await searchRecords(w.scope, {
      objectId: w.people,
      query: '',
      forAttributeId: w.company('team'),
      forRecordId: globex,
    });
    const byName = new Map(fromGlobex.map((result) => [result.ref.name, result]));
    expect(byName.get('Ben')).toMatchObject({ linked: true });
    expect(byName.get('Ben')?.takenBy).toBeUndefined();
    expect(byName.get('Ada')).toMatchObject({ linked: false, takenBy: { recordId: acme, name: 'Acme' } });
    // A far side that holds many has no holder to name.
    const fromAda = await searchRecords(w.scope, {
      objectId: w.companies,
      query: '',
      forAttributeId: w.person('company'),
      forRecordId: ada,
    });
    expect(fromAda.find((result) => result.ref.recordId === acme)).toEqual(expect.objectContaining({ linked: true }));
    expect(fromAda.every((result) => result.takenBy === undefined)).toBe(true);
    // A member whose record rule hides every company (a rule on a system column matches no value row) sees
    // Acme's hold as hidden, never named.
    const role = { type: 'role' as const, role: 'member' };
    const own = rescope(w.scope, {
      role: 'member',
      rules: {
        levels: [],
        records: [{ subject: role, objectId: w.companies, attributeId: w.company('created_by'), kind: 'own' }],
      },
    });
    const mine = await company(w, 'Mine', own);
    const fromMine = await searchRecords(own, {
      objectId: w.people,
      query: 'ad',
      forAttributeId: w.company('team'),
      forRecordId: mine,
    });
    expect(fromMine.map((result) => [result.ref.recordId, result.takenBy])).toEqual([[ada, { hidden: true }]]);
    // And searching Companies itself shows none of them.
    expect(await searchRecords(own, { objectId: w.companies, query: '' })).toEqual([]);
  });

  it('seeks the name prefix as a range bounded on both ends of sort_keys_text', async () => {
    const w = await world();
    for (const name of ['Alpha', 'Beta', 'Gamma']) await company(w, name);
    // The search's own prefix statement, explained as the app role in the workspace.
    const plan = await db.withWorkspace(w.scope.workspaceId, async (tx) => {
      await tx.execute(sql`set local enable_seqscan = off`);
      const primary = w.company('name');
      return tx.execute<{ 'QUERY PLAN': string }>(sql`
        explain select k.record_id from sort_keys k
        join records r on r.workspace_id = k.workspace_id and r.id = k.record_id
          and r.object_id = ${w.companies}::uuid and r.deleted_at is null
        where k.attribute_id = ${primary}::uuid and k.live and k.text_key is not null
          and k.text_key >= (lower('be') collate "und-x-icu")
          and k.text_key < ((lower('be') || U&'\\FFFF') collate "und-x-icu")
        order by k.text_key, k.owner_id limit 20
      `);
    });
    const text = plan.rows.map((row) => row['QUERY PLAN']).join('\n');
    expect(text).toMatch(/Index (Only )?Scan using sort_keys_text/);
    expect(text).toMatch(/Index Cond: .*text_key >= .*text_key < /s);
    const found = await searchRecords(w.scope, { objectId: w.companies, query: 'be' });
    expect(found.map((result) => result.ref.name)).toEqual(['Beta']);
  });
});
