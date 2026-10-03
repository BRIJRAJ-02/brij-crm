// Milestone 3 of spec 0004: relationships, lists and entries, and deletion
// (delete, restore, purge, erasure), against a real Postgres.
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, type Database } from '@crm/db';
import type { EngineRefusal } from '@crm/contracts/values';
import { defineAttribute, defineObject, updateAttribute } from './definitions.ts';
import { deleteRecord, eraseRecord, purgeDeleted, restoreRecord } from './deletion.ts';
import { getHistory, getTimeInStages, getValuesAsOf } from './history.ts';
import { addEntry, defineList, getEntries, getRecordEntries, removeEntry, restoreEntry } from './lists.ts';
import { defineOption } from './options.ts';
import { createRecord, getRecords, setValues } from './records.ts';
import { isRefusal } from './refusals.ts';
import { defineRelationship } from './relationships.ts';
import type { EngineScope } from './scope.ts';
import { createWorkspace } from './workspaces.ts';
import type { AfterWrite, Change } from './write.ts';

const { appUrl } = inject('testDatabase');
let db: Database;

beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-links-tests' });
});
afterAll(async () => {
  await db.close();
});

const id = (value: string | undefined): string => {
  if (value === undefined) throw new Error('Missing id.');
  return value;
};

let count = 0;
async function workspace(limits?: EngineScope['limits']) {
  count += 1;
  const created = await createWorkspace(db, {
    name: 'Links',
    slug: `links-${String(count)}-${String(Date.now())}`,
    firstMember: { name: 'Ada', email: 'ada@example.com' },
  });
  const scope: EngineScope = {
    db,
    workspaceId: created.workspaceId,
    actor: { type: 'member', id: created.memberId },
    ...(limits === undefined ? {} : { limits }),
  };
  const slugsOf = async (objectId: string) => {
    const rows = await db.withWorkspace(scope.workspaceId, (tx) =>
      tx.execute<{ id: string; api_slug: string }>(
        sql`select id, api_slug from attributes where object_id = ${objectId}`,
      ),
    );
    const map = Object.fromEntries(rows.rows.map((row) => [row.api_slug, row.id]));
    return (slug: string) => id(map[slug]);
  };
  const people = id(created.objects.people);
  const companies = id(created.objects.companies);
  const deals = id(created.objects.deals);
  return {
    ...created,
    scope,
    people,
    companies,
    deals,
    person: await slugsOf(people),
    company: await slugsOf(companies),
    deal: await slugsOf(deals),
  };
}

type World = Awaited<ReturnType<typeof workspace>>;

async function newPerson(world: World, firstName: string, extra: Record<string, unknown> = {}) {
  const { recordId } = await createRecord(world.scope, {
    objectId: world.people,
    values: { [world.person('name')]: { firstName }, ...extra },
  });
  return recordId;
}

async function newCompany(world: World, name: string) {
  const { recordId } = await createRecord(world.scope, {
    objectId: world.companies,
    values: { [world.company('name')]: name },
  });
  return recordId;
}

async function valueOf(scope: EngineScope, recordId: string, attributeId: string): Promise<unknown> {
  const [record] = await getRecords(scope, { ids: [recordId] });
  return record?.values[attributeId];
}

async function refusals(promise: Promise<unknown>): Promise<readonly EngineRefusal[]> {
  try {
    await promise;
  } catch (error) {
    if (isRefusal(error)) return error.refusals;
    throw error;
  }
  throw new Error('Expected a refusal.');
}

async function rowCount(scope: EngineScope, query: ReturnType<typeof sql>): Promise<number> {
  const result = await db.withWorkspace(scope.workspaceId, (tx) => tx.execute<{ n: number }>(query));
  return result.rows[0]?.n ?? 0;
}

describe('relationships', () => {
  it('seeds the standard relationships, an attribute at each end (AC-1, AC-5)', async () => {
    const world = await workspace();
    for (const slug of ['company', 'associated_deals']) expect(world.person(slug)).toBeTruthy();
    for (const slug of ['team', 'parent_company', 'subsidiaries', 'associated_deals']) {
      expect(world.company(slug)).toBeTruthy();
    }
    for (const slug of ['associated_company', 'associated_people']) expect(world.deal(slug)).toBeTruthy();
  });

  it('stores each link once and reads it from both ends, in order (AC-5)', async () => {
    const world = await workspace();
    const acme = await newCompany(world, 'Acme');
    const ada = await newPerson(world, 'Ada');
    const grace = await newPerson(world, 'Grace');
    await setValues(world.scope, {
      recordId: ada,
      values: { [world.person('company')]: { value: { objectId: world.companies, recordId: acme } } },
    });
    await setValues(world.scope, {
      recordId: grace,
      values: { [world.person('company')]: { value: { objectId: world.companies, recordId: acme } } },
    });
    expect(await valueOf(world.scope, ada, world.person('company'))).toEqual({
      objectId: world.companies,
      recordId: acme,
    });
    expect(await valueOf(world.scope, acme, world.company('team'))).toEqual([
      { objectId: world.people, recordId: ada },
      { objectId: world.people, recordId: grace },
    ]);
    // Reordering from the company's end keeps one link per pair.
    await setValues(world.scope, {
      recordId: acme,
      values: {
        [world.company('team')]: {
          value: [
            { objectId: world.people, recordId: grace },
            { objectId: world.people, recordId: ada },
          ],
        },
      },
    });
    expect(await valueOf(world.scope, acme, world.company('team'))).toEqual([
      { objectId: world.people, recordId: grace },
      { objectId: world.people, recordId: ada },
    ]);
    expect(
      await rowCount(
        world.scope,
        sql`select count(*)::int as n from record_links where to_record_id = ${acme} and active_until is null`,
      ),
    ).toBe(2);
  });

  it('replaces the link on a single end and ends the old one in history (AC-3, AC-5)', async () => {
    const world = await workspace();
    const acme = await newCompany(world, 'Acme');
    const globex = await newCompany(world, 'Globex');
    const ada = await newPerson(world, 'Ada');
    const company = world.person('company');
    await setValues(world.scope, {
      recordId: ada,
      values: { [company]: { value: { objectId: world.companies, recordId: acme } } },
    });
    const [first] = await getHistory(world.scope, { recordId: ada, attributeId: company });
    await setValues(world.scope, {
      recordId: ada,
      values: { [company]: { value: { objectId: world.companies, recordId: globex } } },
    });
    expect(await valueOf(world.scope, acme, world.company('team'))).toEqual([]);
    expect(await valueOf(world.scope, globex, world.company('team'))).toEqual([
      { objectId: world.people, recordId: ada },
    ]);
    const history = await getHistory(world.scope, { recordId: ada, attributeId: company });
    expect(history.map((version) => version.value)).toEqual([
      { objectId: world.companies, recordId: acme },
      { objectId: world.companies, recordId: globex },
    ]);
    expect(history[0]?.activeUntil).toBe(history[1]?.activeFrom);
    expect(history[1]?.setBy).toEqual(world.scope.actor);
    const acmeTeam = await getHistory(world.scope, { recordId: acme, attributeId: world.company('team') });
    expect(acmeTeam.map((version) => version.value)).toEqual([[{ objectId: world.people, recordId: ada }], []]);
    // History shows milliseconds; a moment just after the first version started, and before the second.
    const at = new Date(Date.parse(id(first?.activeFrom)) + 1).toISOString();
    expect(at < id(history[1]?.activeFrom)).toBe(true);
    expect(await getValuesAsOf(world.scope, { recordId: ada, at })).toMatchObject({
      [company]: { objectId: world.companies, recordId: acme },
    });
  });

  it('writes nothing for an unchanged reference, and tells the hooks about both ends (AC-3, AC-17)', async () => {
    const world = await workspace();
    const acme = await newCompany(world, 'Acme');
    const ada = await newPerson(world, 'Ada');
    const seen: Change[] = [];
    const hook: AfterWrite = (change) => {
      seen.push(change);
      return Promise.resolve();
    };
    const value = { value: { objectId: world.companies, recordId: acme } };
    const firstWrite = await setValues(world.scope, { recordId: ada, values: { [world.person('company')]: value } }, [
      hook,
    ]);
    expect(firstWrite[world.person('company')]?.versionId).toBeDefined();
    expect(seen[0]?.values.map((change) => [change.ownerId, change.attributeId])).toEqual([
      [ada, world.person('company')],
      [acme, world.company('team')],
    ]);
    const again = await setValues(world.scope, { recordId: ada, values: { [world.person('company')]: value } });
    expect(again[world.person('company')]).toEqual({});
  });

  it("moves the far record too when a link changes, and names each record's object (AC-7, AC-17)", async () => {
    const world = await workspace();
    const acme = await newCompany(world, 'Acme');
    const ada = await newPerson(world, 'Ada');
    const before = await rowCount(
      world.scope,
      sql`select extract(epoch from updated_at)::float8 * 1000000 as n from records where id = ${acme}`,
    );
    const seen: Change[] = [];
    await setValues(
      world.scope,
      {
        recordId: ada,
        values: { [world.person('company')]: { value: { objectId: world.companies, recordId: acme } } },
      },
      [
        (change) => {
          seen.push(change);
          return Promise.resolve();
        },
      ],
    );
    const after = await rowCount(
      world.scope,
      sql`select extract(epoch from updated_at)::float8 * 1000000 as n from records where id = ${acme}`,
    );
    expect(after).toBeGreaterThan(before);
    const [acmeView] = await getRecords(world.scope, { ids: [acme] });
    expect(acmeView?.updatedBy).toEqual(world.scope.actor);
    expect(seen[0]?.values.map((change) => [change.ownerId, 'objectId' in change && change.objectId])).toEqual([
      [ada, world.people],
      [acme, world.companies],
    ]);
  });

  it('refuses a taken single end, naming the record, and lets one of two racing links win (AC-5)', async () => {
    const world = await workspace();
    const acme = await newCompany(world, 'Acme');
    const globex = await newCompany(world, 'Globex');
    const ada = await newPerson(world, 'Ada');
    await setValues(world.scope, {
      recordId: ada,
      values: { [world.person('company')]: { value: { objectId: world.companies, recordId: acme } } },
    });
    const [taken] = await refusals(
      setValues(world.scope, {
        recordId: globex,
        values: { [world.company('team')]: { value: [{ objectId: world.people, recordId: ada }] } },
      }),
    );
    expect(taken?.code).toBe('RELATIONSHIP_TAKEN');
    expect(taken?.message).toContain('Ada');

    // One to one: a desk has one occupant, and a person one desk.
    const { objectId: desks } = await defineObject(world.scope, {
      apiSlug: 'desks',
      singularName: 'Desk',
      pluralName: 'Desks',
      icon: 'box',
      hue: 'gray',
    });
    const { fromAttributeId: deskOf } = await defineRelationship(world.scope, {
      cardinality: 'one_to_one',
      from: { objectId: world.people, apiSlug: 'desk', title: 'Desk' },
      to: { objectId: desks, apiSlug: 'occupant', title: 'Occupant' },
    });
    const { recordId: desk } = await createRecord(world.scope, {
      objectId: desks,
      values: { [await deskName(world, desks)]: 'Desk 7' },
    });
    const grace = await newPerson(world, 'Grace');
    const alan = await newPerson(world, 'Alan');
    const link = (recordId: string) =>
      setValues(world.scope, { recordId, values: { [deskOf]: { value: { objectId: desks, recordId: desk } } } });
    const outcomes = await Promise.allSettled([link(grace), link(alan)]);
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    const failed = outcomes.find((outcome) => outcome.status === 'rejected');
    expect(failed?.status === 'rejected' && isRefusal(failed.reason) ? failed.reason.refusal.code : undefined).toBe(
      'RELATIONSHIP_TAKEN',
    );
    expect(
      await rowCount(
        world.scope,
        sql`select count(*)::int as n from record_links where to_record_id = ${desk} and active_until is null`,
      ),
    ).toBe(1);
  });

  it('keeps a one way reference to the objects it names, with nothing on the other side (AC-5)', async () => {
    const world = await workspace();
    const before = await rowCount(
      world.scope,
      sql`select count(*)::int as n from attributes where object_id = ${world.people}`,
    );
    const { fromAttributeId: referredBy, toAttributeId } = await defineRelationship(world.scope, {
      cardinality: 'many_to_many',
      from: { objectId: world.deals, apiSlug: 'referred_by', title: 'Referred by' },
      targetObjectIds: [world.people, world.companies],
    });
    expect(toAttributeId).toBeUndefined();
    expect(
      await rowCount(world.scope, sql`select count(*)::int as n from attributes where object_id = ${world.people}`),
    ).toBe(before);
    const ada = await newPerson(world, 'Ada');
    const acme = await newCompany(world, 'Acme');
    const { recordId: deal } = await createRecord(world.scope, {
      objectId: world.deals,
      values: {
        [world.deal('name')]: 'Big deal',
        [referredBy]: [
          { objectId: world.people, recordId: ada },
          { objectId: world.companies, recordId: acme },
        ],
      },
    });
    expect(await valueOf(world.scope, deal, referredBy)).toEqual([
      { objectId: world.people, recordId: ada },
      { objectId: world.companies, recordId: acme },
    ]);
    const { recordId: other } = await createRecord(world.scope, {
      objectId: world.deals,
      values: { [world.deal('name')]: 'Other' },
    });
    const [wrong] = await refusals(
      setValues(world.scope, {
        recordId: deal,
        values: { [referredBy]: { value: [{ objectId: world.deals, recordId: other }] } },
      }),
    );
    expect(wrong?.code).toBe('ATTRIBUTE_VALUE_INVALID');
  });

  it('ends a link once when both ends change it at the same time, and links a pair once (AC-3, AC-5)', async () => {
    const world = await workspace();
    const acme = await newCompany(world, 'Acme');
    const ada = await newPerson(world, 'Ada');
    await setValues(world.scope, {
      recordId: ada,
      values: { [world.person('company')]: { value: { objectId: world.companies, recordId: acme } } },
    });
    const outcomes = await Promise.allSettled([
      setValues(world.scope, { recordId: ada, values: { [world.person('company')]: { value: null } } }),
      setValues(world.scope, { recordId: acme, values: { [world.company('team')]: { value: null } } }),
    ]);
    expect(outcomes.map((outcome) => outcome.status)).toEqual(['fulfilled', 'fulfilled']);
    const ended = await db.withWorkspace(world.scope.workspaceId, (tx) =>
      tx.execute<{ n: number; changed: boolean }>(
        sql`select count(*)::int as n, bool_or(active_until is null) as changed from record_links where from_record_id = ${ada}`,
      ),
    );
    expect(ended.rows[0]).toEqual({ n: 1, changed: false });

    const deal = await newDeal(world, 'Big deal');
    const mutual = await Promise.allSettled([
      setValues(world.scope, {
        recordId: deal,
        values: { [world.deal('associated_people')]: { value: [{ objectId: world.people, recordId: ada }] } },
      }),
      setValues(world.scope, {
        recordId: ada,
        values: { [world.person('associated_deals')]: { value: [{ objectId: world.deals, recordId: deal }] } },
      }),
    ]);
    expect(mutual.map((outcome) => outcome.status)).toEqual(['fulfilled', 'fulfilled']);
    expect(await valueOf(world.scope, ada, world.person('associated_deals'))).toEqual([
      { objectId: world.deals, recordId: deal },
    ]);
  });

  it('hands a single end over from a record in the trash, and its restore leaves it handed over (AC-5, AC-8)', async () => {
    const world = await workspace();
    const acme = await newCompany(world, 'Acme');
    const globex = await newCompany(world, 'Globex');
    const ada = await newPerson(world, 'Ada');
    await setValues(world.scope, {
      recordId: ada,
      values: { [world.person('company')]: { value: { objectId: world.companies, recordId: acme } } },
    });
    await deleteRecord(world.scope, { recordId: acme });
    await setValues(world.scope, {
      recordId: globex,
      values: { [world.company('team')]: { value: [{ objectId: world.people, recordId: ada }] } },
    });
    await restoreRecord(world.scope, { recordId: acme });
    expect(await valueOf(world.scope, ada, world.person('company'))).toEqual({
      objectId: world.companies,
      recordId: globex,
    });
    expect(await valueOf(world.scope, acme, world.company('team'))).toEqual([]);
  });

  it("refuses a link that names another workspace's record (AC-9)", async () => {
    const mine = await workspace();
    const theirs = await workspace();
    const ada = await newPerson(mine, 'Ada');
    const acme = await newCompany(theirs, 'Acme');
    const [relationship] = (
      await db.withWorkspace(mine.scope.workspaceId, (tx) =>
        tx.execute<{ id: string }>(
          sql`select relationship_id as id from attributes where id = ${mine.person('company')}`,
        ),
      )
    ).rows;
    const insert = db.withWorkspace(mine.scope.workspaceId, (tx) =>
      tx.execute(sql`
        insert into record_links (workspace_id, version_id, relationship_id, from_record_id, to_record_id, from_single, to_single, active_from, set_by_type)
        values (${mine.scope.workspaceId}, uuidv7(), ${id(relationship?.id)}, ${ada}, ${acme}, true, false, now(), 'system')
      `),
    );
    await expect(insert).rejects.toMatchObject({ cause: { code: '23503' } });
    // Through the service, the record simply isn't there.
    const [missing] = await refusals(
      setValues(mine.scope, {
        recordId: ada,
        values: { [mine.person('company')]: { value: { objectId: mine.companies, recordId: acme } } },
      }),
    );
    expect(missing?.code).toBe('ATTRIBUTE_VALUE_INVALID');
  });

  it('links an object to itself through two named ends, and refuses a record linking to itself (AC-5)', async () => {
    const world = await workspace();
    const parent = await newCompany(world, 'Parent');
    const child = await newCompany(world, 'Child');
    await setValues(world.scope, {
      recordId: child,
      values: { [world.company('parent_company')]: { value: { objectId: world.companies, recordId: parent } } },
    });
    expect(await valueOf(world.scope, parent, world.company('subsidiaries'))).toEqual([
      { objectId: world.companies, recordId: child },
    ]);
    const [self] = await refusals(
      setValues(world.scope, {
        recordId: parent,
        values: { [world.company('parent_company')]: { value: { objectId: world.companies, recordId: parent } } },
      }),
    );
    expect(self?.code).toBe('ATTRIBUTE_VALUE_INVALID');
  });
});

async function deskName(world: World, desks: string): Promise<string> {
  const rows = await db.withWorkspace(world.scope.workspaceId, (tx) =>
    tx.execute<{ id: string }>(sql`select id from attributes where object_id = ${desks} and api_slug = 'name'`),
  );
  return id(rows.rows[0]?.id);
}

async function pipeline(world: World, allowsDuplicates = true) {
  const { listId } = await defineList(world.scope, {
    objectId: world.deals,
    apiSlug: `pipeline_${String(Date.now())}_${String(Math.random()).slice(2, 6)}`,
    name: 'Pipeline',
    allowsDuplicates,
  });
  const { attributeId: stage } = await defineAttribute(world.scope, {
    listId,
    apiSlug: 'stage',
    title: 'Stage',
    type: 'status',
  });
  const intro = (await defineOption(world.scope, { attributeId: stage, label: 'Intro', hue: 'sky' })).optionId;
  const signed = (await defineOption(world.scope, { attributeId: stage, label: 'Signed', hue: 'green' })).optionId;
  return { listId, stage, intro, signed };
}

async function newDeal(world: World, name: string) {
  const { recordId } = await createRecord(world.scope, {
    objectId: world.deals,
    values: { [world.deal('name')]: name },
  });
  return recordId;
}

describe('lists and entries', () => {
  it('checks existing entries before a list attribute turns unique (AC-6, AC-10)', async () => {
    const world = await workspace();
    const { listId } = await pipeline(world);
    const { attributeId: code } = await defineAttribute(world.scope, {
      listId,
      apiSlug: 'code',
      title: 'Code',
      type: 'text',
    });
    const deal = await newDeal(world, 'Big deal');
    await addEntry(world.scope, { listId, recordId: deal, values: { [code]: 'A1' } });
    await addEntry(world.scope, { listId, recordId: deal, values: { [code]: 'a1' } });
    const [duplicates] = await refusals(updateAttribute(world.scope, { attributeId: code, isUnique: true }));
    expect(duplicates?.code).toBe('UNIQUE_HAS_DUPLICATES');
  });

  it('gives each entry its own id, values and history, apart from its record (AC-6)', async () => {
    const world = await workspace();
    const { listId, stage, intro, signed } = await pipeline(world);
    const deal = await newDeal(world, 'Big deal');
    const { entryId } = await addEntry(world.scope, { listId, recordId: deal, values: { [stage]: intro } });
    const second = await addEntry(world.scope, { listId, recordId: deal });
    expect(second.entryId).not.toBe(entryId);
    await setValues(world.scope, { entryId, values: { [stage]: { value: signed } } });
    const [entry] = await getEntries(world.scope, { ids: [entryId] });
    expect(entry).toMatchObject({ listId, recordId: deal, values: { [stage]: signed } });
    expect((await getRecords(world.scope, { ids: [deal] }))[0]?.values[stage]).toBeUndefined();
    const history = await getHistory(world.scope, { entryId, attributeId: stage });
    expect(history.map((version) => version.value)).toEqual([intro, signed]);
    const stages = await getTimeInStages(world.scope, { entryId, attributeId: stage });
    expect(stages.map((each) => each.optionId)).toEqual([intro, signed]);
    expect(await getRecordEntries(world.scope, { recordId: deal })).toHaveLength(2);
  });

  it('lets a record in once when the list says so, and holds the entry limit (AC-6, AC-16)', async () => {
    const world = await workspace({ entriesPerList: 2, lists: 2 });
    const { listId } = await pipeline(world, false);
    const a = await newDeal(world, 'A');
    const b = await newDeal(world, 'B');
    const c = await newDeal(world, 'C');
    const { entryId } = await addEntry(world.scope, { listId, recordId: a });
    expect((await refusals(addEntry(world.scope, { listId, recordId: a })))[0]?.code).toBe('ENTRY_EXISTS');
    await addEntry(world.scope, { listId, recordId: b });
    expect((await refusals(addEntry(world.scope, { listId, recordId: c })))[0]?.code).toBe('LIMIT_REACHED');
    // A removed entry frees its slot, and comes back only while there's room and no other entry for it.
    await removeEntry(world.scope, { entryId });
    expect(await getEntries(world.scope, { ids: [entryId] })).toEqual([]);
    const again = await addEntry(world.scope, { listId, recordId: a });
    expect((await refusals(restoreEntry(world.scope, { entryId })))[0]?.code).toBe('ENTRY_EXISTS');
    await removeEntry(world.scope, { entryId: again.entryId });
    await restoreEntry(world.scope, { entryId });
    expect(await getEntries(world.scope, { ids: [entryId] })).toHaveLength(1);
    // The list limit.
    await pipeline(world);
    expect((await refusals(pipeline(world)))[0]?.code).toBe('LIMIT_REACHED');
    // A record of another object can't go in.
    const ada = await newPerson(world, 'Ada');
    expect((await refusals(addEntry(world.scope, { listId, recordId: ada })))[0]?.code).toBe('CONFIG_INVALID');
  });
});

describe('deletion', () => {
  it('hides a trashed record and its entries from history reads too (AC-8)', async () => {
    const world = await workspace();
    const { listId, stage, intro } = await pipeline(world);
    const deal = await newDeal(world, 'Big deal');
    const { entryId } = await addEntry(world.scope, { listId, recordId: deal, values: { [stage]: intro } });
    await deleteRecord(world.scope, { recordId: deal });
    const reads = [
      () => getHistory(world.scope, { recordId: deal, attributeId: world.deal('name') }),
      () => getValuesAsOf(world.scope, { recordId: deal, at: new Date().toISOString() }),
      () => getHistory(world.scope, { entryId, attributeId: stage }),
      () => getTimeInStages(world.scope, { entryId, attributeId: stage }),
    ];
    for (const read of reads) expect((await refusals(read()))[0]?.code).toBe('RECORD_DELETED');
  });

  it('hides a record with its links and entries, and a restore brings all three back (AC-8)', async () => {
    const world = await workspace();
    const acme = await newCompany(world, 'Acme');
    const ada = await newPerson(world, 'Ada', {});
    const deal = await newDeal(world, 'Big deal');
    await setValues(world.scope, {
      recordId: ada,
      values: { [world.person('company')]: { value: { objectId: world.companies, recordId: acme } } },
    });
    const { listId } = await pipeline(world);
    await setValues(world.scope, {
      recordId: deal,
      values: { [world.deal('associated_people')]: { value: [{ objectId: world.people, recordId: ada }] } },
    });
    const { entryId } = await addEntry(world.scope, { listId, recordId: deal });
    const acmeBefore = (await getRecords(world.scope, { ids: [acme] }))[0]?.updatedAt;

    await deleteRecord(world.scope, { recordId: ada });
    await deleteRecord(world.scope, { recordId: deal });
    expect(await getRecords(world.scope, { ids: [ada, deal] })).toEqual([]);
    expect(await valueOf(world.scope, acme, world.company('team'))).toEqual([]);
    expect(await getEntries(world.scope, { ids: [entryId] })).toEqual([]);
    expect((await getRecords(world.scope, { ids: [acme] }))[0]?.updatedAt).toBe(acmeBefore);
    expect(
      (
        await refusals(
          setValues(world.scope, { recordId: ada, values: { [world.person('job_title')]: { value: 'CTO' } } }),
        )
      )[0]?.code,
    ).toBe('RECORD_DELETED');

    await restoreRecord(world.scope, { recordId: ada });
    await restoreRecord(world.scope, { recordId: deal });
    expect(await valueOf(world.scope, acme, world.company('team'))).toEqual([
      { objectId: world.people, recordId: ada },
    ]);
    expect(await valueOf(world.scope, deal, world.deal('associated_people'))).toEqual([
      { objectId: world.people, recordId: ada },
    ]);
    expect(await getEntries(world.scope, { ids: [entryId] })).toHaveLength(1);
  });

  it('refuses a restore whose unique values were taken meanwhile, listing them (AC-8, AC-10)', async () => {
    const world = await workspace();
    const emails = world.person('email_addresses');
    const ada = await newPerson(world, 'Ada', { [emails]: ['ada@example.com'] });
    await deleteRecord(world.scope, { recordId: ada });
    await newPerson(world, 'Other Ada', { [emails]: ['ada@example.com'] });
    const [conflict] = await refusals(restoreRecord(world.scope, { recordId: ada }));
    expect(conflict?.code).toBe('UNIQUE_CONFLICT');
    expect(conflict?.message).toContain('ada@example.com');
  });

  it('gives back the record slot on delete, and refuses a restore past the limit or the 30 days (AC-8, AC-16)', async () => {
    const world = await workspace({ liveRecords: 1 });
    const first = await newCompany(world, 'First');
    await deleteRecord(world.scope, { recordId: first });
    await newCompany(world, 'Second');
    expect((await refusals(restoreRecord(world.scope, { recordId: first })))[0]?.code).toBe('LIMIT_REACHED');
    await db.withWorkspace(world.scope.workspaceId, (tx) =>
      tx.execute(sql`update records set deleted_at = now() - interval '31 days' where id = ${first}`),
    );
    expect((await refusals(restoreRecord(world.scope, { recordId: first })))[0]?.code).toBe('NOT_FOUND');
  });

  it('lets a save racing a delete land first or be refused, never after (AC-3, AC-8)', async () => {
    const world = await workspace();
    const ada = await newPerson(world, 'Ada');
    const save = setValues(world.scope, { recordId: ada, values: { [world.person('job_title')]: { value: 'CTO' } } });
    const remove = deleteRecord(world.scope, { recordId: ada });
    const [saved] = await Promise.allSettled([save, remove]);
    const after = await rowCount(
      world.scope,
      sql`select count(*)::int as n from "values" v join records r on r.id = v.record_id
        where v.record_id = ${ada} and v.active_from > r.deleted_at`,
    );
    expect(after).toBe(0);
    if (saved.status === 'rejected')
      expect(isRefusal(saved.reason) && saved.reason.refusal.code).toBe('RECORD_DELETED');
  });

  it('purges records deleted before the cutoff with their values, links and entries, and counts them (AC-8)', async () => {
    const world = await workspace();
    const acme = await newCompany(world, 'Acme');
    const ada = await newPerson(world, 'Ada');
    const deal = await newDeal(world, 'Big deal');
    const { listId } = await pipeline(world);
    await addEntry(world.scope, { listId, recordId: deal });
    await setValues(world.scope, {
      recordId: ada,
      values: { [world.person('company')]: { value: { objectId: world.companies, recordId: acme } } },
    });
    await deleteRecord(world.scope, { recordId: ada });
    await deleteRecord(world.scope, { recordId: deal });
    // Deleted now: a purge leaves them for the 30 days, even when asked for a later cutoff.
    expect(await purgeDeleted(world.scope)).toEqual({ records: 0, entries: 0, values: 0, links: 0 });
    expect(await purgeDeleted(world.scope, { cutoff: new Date(Date.now() + 60_000).toISOString() })).toEqual({
      records: 0,
      entries: 0,
      values: 0,
      links: 0,
    });
    await db.withWorkspace(world.scope.workspaceId, (tx) =>
      tx.execute(sql`update records set deleted_at = now() - interval '31 days' where id in (${ada}, ${deal})`),
    );
    const counts = await purgeDeleted(world.scope, { batchSize: 1 });
    expect(counts.records).toBe(2);
    expect(counts.entries).toBe(1);
    expect(counts.links).toBe(1);
    expect(counts.values).toBeGreaterThanOrEqual(3);
    expect(await rowCount(world.scope, sql`select count(*)::int as n from records where id in (${ada}, ${deal})`)).toBe(
      0,
    );
    expect(await rowCount(world.scope, sql`select entry_count as n from lists where id = ${listId}`)).toBe(0);
    expect(await getRecords(world.scope, { ids: [acme] })).toHaveLength(1);
  });

  it('erases every value and past version of one record, and tells the hooks (AC-18)', async () => {
    const world = await workspace();
    const ada = await newPerson(world, 'Ada');
    await setValues(world.scope, { recordId: ada, values: { [world.person('job_title')]: { value: 'CTO' } } });
    await setValues(world.scope, { recordId: ada, values: { [world.person('job_title')]: { value: 'CEO' } } });
    const seen: Change[] = [];
    const counts = await eraseRecord(world.scope, { recordId: ada }, [
      (change) => {
        seen.push(change);
        return Promise.resolve();
      },
    ]);
    expect(counts.records).toBe(1);
    expect(counts.values).toBeGreaterThanOrEqual(3);
    expect(await rowCount(world.scope, sql`select count(*)::int as n from "values" where owner_id = ${ada}`)).toBe(0);
    const ref = { recordId: ada, objectId: world.people };
    expect(seen[0]).toMatchObject({ kind: 'erasure', deletedRecords: [ref], purgedRecords: [ref] });
  });

  it('tells the hooks every record, entry and reference a delete, restore, purge or erasure shows or hides (AC-17)', async () => {
    const world = await workspace();
    const ada = await newPerson(world, 'Ada');
    const deal = await newDeal(world, 'Big deal');
    await setValues(world.scope, {
      recordId: deal,
      values: { [world.deal('associated_people')]: { value: [{ objectId: world.people, recordId: ada }] } },
    });
    const { listId } = await pipeline(world);
    const { entryId } = await addEntry(world.scope, { listId, recordId: deal });
    const seen: Change[] = [];
    const hook: AfterWrite = (change) => {
      seen.push(change);
      return Promise.resolve();
    };
    const dealRef = { recordId: deal, objectId: world.deals };
    const adaSees = [{ recordId: ada, objectId: world.people, attributeId: world.person('associated_deals') }];

    await deleteRecord(world.scope, { recordId: deal }, [hook]);
    expect(seen[0]).toMatchObject({ deletedRecords: [dealRef], hiddenEntries: [entryId], references: adaSees });
    await restoreRecord(world.scope, { recordId: deal }, [hook]);
    expect(seen[1]).toMatchObject({ restoredRecords: [dealRef], shownEntries: [entryId], references: adaSees });

    await deleteRecord(world.scope, { recordId: deal });
    await db.withWorkspace(world.scope.workspaceId, (tx) =>
      tx.execute(sql`update records set deleted_at = now() - interval '31 days' where id = ${deal}`),
    );
    await purgeDeleted(world.scope, {}, [hook]);
    // Hidden since the delete: the purge removes them for good, and nothing on screen changes.
    expect(seen[2]).toMatchObject({ purgedRecords: [dealRef], purgedEntries: [entryId], references: [] });

    const other = await newDeal(world, 'Other deal');
    await setValues(world.scope, {
      recordId: other,
      values: { [world.deal('associated_people')]: { value: [{ objectId: world.people, recordId: ada }] } },
    });
    await eraseRecord(world.scope, { recordId: ada }, [hook]);
    expect(seen.at(-1)?.references).toEqual([
      { recordId: other, objectId: world.deals, attributeId: world.deal('associated_people') },
    ]);
  });
});
