// Milestone 3 of spec 0004: relationships, lists and entries, and deletion
// (delete, restore, purge, erasure), against a real Postgres.
import { setTimeout as delay } from 'node:timers/promises';
import { sql, type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, type Database, type WorkspaceTx } from '@crm/db';
import type { EngineRefusal } from '@crm/contracts/values';
import { defineAttribute, defineObject, updateAttribute } from './definitions.ts';
import {
  deleteEntryValues,
  deleteRecord,
  deleteRecordValues,
  eraseRecord,
  farReferencesQuery,
  purgeDeleted,
  restoreRecord,
  type RemovedCounts,
} from './deletion.ts';
import { getHistory, getTimeInStages, getValuesAsOf } from './history.ts';
import { addEntry, defineList, getEntries, getRecordEntries, removeEntry, restoreEntry } from './lists.ts';
import { defineOption } from './options.ts';
import { createRecord, getRecords, setValues } from './records.ts';
import { isRefusal, postgresError } from './refusals.ts';
import { defineRelationship } from './relationships.ts';
import { SYSTEM_ACTOR, type EngineScope } from './scope.ts';
import { createWorkspace } from './workspaces.ts';
import { CHANGE_CAP, capChange, type AfterWrite, type Change } from './write.ts';

const { appUrl, ownerUrl } = inject('testDatabase');
const APP_NAME = 'crm-links-tests';
let db: Database;
/** The owner, for what the app role may not do: table locks and analyze. */
let owner: Database;

beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: APP_NAME });
  owner = createDatabase({ url: ownerUrl, applicationName: 'crm-links-tests-owner' });
});
afterAll(async () => {
  await db.close();
  await owner.close();
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

const at = (world: World, companyId: string) => ({ objectId: world.companies, recordId: companyId });
const person = (world: World, personId: string) => ({ objectId: world.people, recordId: personId });

/** A hook that keeps every change it sees. */
const watch =
  (seen: Change[]): AfterWrite =>
  (change) => {
    seen.push(change);
    return Promise.resolve();
  };

/** Acme with Ada and Bob on its team, and Cy at no company. */
async function team() {
  const world = await workspace();
  const acme = await newCompany(world, 'Acme');
  const ada = await newPerson(world, 'Ada', { [world.person('company')]: at(world, acme) });
  const bob = await newPerson(world, 'Bob', { [world.person('company')]: at(world, acme) });
  const cy = await newPerson(world, 'Cy');
  return { world, acme, ada, bob, cy };
}

/**
 * The test database, but each transaction pauses once, at the first link
 * write's version stamp (after the write read its end's links, before it ends
 * any), to run `meanwhile` on other connections and let it commit. Counts the
 * stamps, so a test sees whether the write started again.
 */
function pausingAtStamp(meanwhile: () => Promise<void>): { readonly db: Database; readonly stamps: () => number } {
  const dialect = new PgDialect();
  let stamps = 0;
  const pausing = (tx: WorkspaceTx): WorkspaceTx =>
    new Proxy(tx, {
      get(target, property, receiver) {
        if (property !== 'execute') return Reflect.get(target, property, receiver) as unknown;
        return async (query: Parameters<WorkspaceTx['execute']>[0]) => {
          const text = typeof query === 'string' ? query : dialect.sqlToQuery(query.getSQL()).sql;
          if (text.includes('as version')) {
            stamps += 1;
            if (stamps === 1) await meanwhile();
          }
          return target.execute(query);
        };
      },
    });
  return {
    db: { ...db, withWorkspace: (workspaceId, work) => db.withWorkspace(workspaceId, (tx) => work(pausing(tx))) },
    stamps: () => stamps,
  };
}

/**
 * Every link the member ended on `ownerId`'s side names a far record the
 * write reported, unless the write linked it again (`kept`): no far record
 * loses a link without its screen hearing of it.
 */
async function expectEveryEndedFarRecordReported(
  world: World,
  ownerId: string,
  kept: readonly string[],
  changed: ReadonlySet<string>,
) {
  const ended = await db.withWorkspace(world.scope.workspaceId, (tx) =>
    tx.execute<{ far: string }>(sql`
      select (case when from_record_id = ${ownerId} then to_record_id else from_record_id end)::text as far
      from record_links
      where (from_record_id = ${ownerId} or to_record_id = ${ownerId}) and ended_by_type = 'member'
    `),
  );
  const lost = ended.rows.map((row) => row.far).filter((far) => !kept.includes(far));
  expect(lost.length).toBeGreaterThan(0);
  for (const far of lost) expect(changed, far).toContain(far);
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

  it("reports the far record when a link changes, without writing it, and names each record's object (AC-7, AC-17)", async () => {
    const world = await workspace();
    const acme = await newCompany(world, 'Acme');
    const ada = await newPerson(world, 'Ada');
    const [acmeBefore] = await getRecords(world.scope, { ids: [acme] });
    const before = await rowCount(
      world.scope,
      sql`select extract(epoch from updated_at)::float8 * 1000000 as n from records where id = ${acme}`,
    );
    // Someone else makes the link, so a moved updated_by would show.
    const other = { ...world.scope, actor: { type: 'system' as const, id: null } };
    const seen: Change[] = [];
    await setValues(
      other,
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
    // The far record is reported, so screens showing it read its references again...
    expect(seen[0]?.values.map((change) => [change.ownerId, 'objectId' in change && change.objectId])).toEqual([
      [ada, world.people],
      [acme, world.companies],
    ]);
    // ...but never written: the link row keeps its own who and when.
    const after = await rowCount(
      world.scope,
      sql`select extract(epoch from updated_at)::float8 * 1000000 as n from records where id = ${acme}`,
    );
    expect(after).toBe(before);
    const [acmeView, adaView] = await getRecords(world.scope, { ids: [acme, ada] });
    expect(acmeView?.updatedBy).toEqual(acmeBefore?.updatedBy);
    expect(acmeView?.updatedAt).toBe(acmeBefore?.updatedAt);
    expect(adaView?.updatedBy).toEqual(other.actor);
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

  it('never ends a link the far end added between its read and its update, and needs no new attempt (AC-3, AC-5, AC-17)', async () => {
    const { world, acme, ada, bob, cy } = await team();
    const asSystem: EngineScope = { ...world.scope, actor: SYSTEM_ACTOR };
    // Cy joins Acme on another connection, after the write read Acme's team and before it ends any of it.
    const pause = pausingAtStamp(async () => {
      await setValues(asSystem, { recordId: cy, values: { [world.person('company')]: { value: at(world, acme) } } });
    });
    const seen: Change[] = [];
    await setValues(
      { ...world.scope, db: pause.db },
      { recordId: acme, values: { [world.company('team')]: { value: [person(world, ada)] } } },
      [watch(seen)],
    );
    expect(pause.stamps()).toBe(1);
    // Cy's link was never read, so it stays: the team is Ada and Cy, and Cy's Company is still Acme.
    expect(await valueOf(world.scope, acme, world.company('team'))).toEqual([person(world, ada), person(world, cy)]);
    expect(await valueOf(world.scope, cy, world.person('company'))).toEqual(at(world, acme));
    expect(await valueOf(world.scope, bob, world.person('company'))).toBeNull();
    const changed = new Set(seen[0]?.values.map((value) => value.ownerId));
    expect(changed).toEqual(new Set([acme, bob]));
    await expectEveryEndedFarRecordReported(world, acme, [ada], changed);
  });

  it('starts again when the far end ends a link it read, and reports every far record whose link it ends (AC-3, AC-5, AC-17)', async () => {
    const { world, acme, ada, bob, cy } = await team();
    const asSystem: EngineScope = { ...world.scope, actor: SYSTEM_ACTOR };
    // An add and an end land together between the read and the update: Cy joins Acme and Bob leaves it. A
    // statement that ended whatever is current would end Cy's link in place of Bob's with the same count, and
    // Cy's screen would never hear of it.
    const pause = pausingAtStamp(async () => {
      await setValues(asSystem, { recordId: cy, values: { [world.person('company')]: { value: at(world, acme) } } });
      await setValues(asSystem, { recordId: bob, values: { [world.person('company')]: { value: null } } });
    });
    const seen: Change[] = [];
    await setValues(
      { ...world.scope, db: pause.db },
      { recordId: acme, values: { [world.company('team')]: { value: [person(world, ada)] } } },
      [watch(seen)],
    );
    // The first attempt found Bob's link already ended and started again; the second read Cy's link and ended it.
    expect(pause.stamps()).toBe(2);
    expect(await valueOf(world.scope, acme, world.company('team'))).toEqual([person(world, ada)]);
    expect(await valueOf(world.scope, cy, world.person('company'))).toBeNull();
    const changed = new Set(seen[0]?.values.map((value) => value.ownerId));
    expect(changed).toEqual(new Set([acme, cy]));
    await expectEveryEndedFarRecordReported(world, acme, [ada], changed);
  });

  it('reads values as of a moment to the microsecond, between two link versions 100 microseconds apart (AC-3)', async () => {
    const world = await workspace();
    const acme = await newCompany(world, 'Acme');
    const beta = await newCompany(world, 'Beta');
    const ada = await newPerson(world, 'Ada', { [world.person('company')]: at(world, acme) });
    await setValues(world.scope, {
      recordId: ada,
      values: { [world.person('company')]: { value: at(world, beta) } },
    });
    // Pinned as the owner, so the boundary is exact: Acme until .000100, Beta from then on.
    await owner.withWorkspace(world.scope.workspaceId, async (tx) => {
      await tx.execute(sql`update records set created_at = '2025-01-01T00:00:00Z' where id = ${ada}`);
      await tx.execute(sql`
        update record_links set active_from = '2026-01-01T00:00:00Z', active_until = '2026-01-01T00:00:00.000100Z'
        where ${ada} in (from_record_id, to_record_id) and ${acme} in (from_record_id, to_record_id)
      `);
      await tx.execute(sql`
        update record_links set active_from = '2026-01-01T00:00:00.000100Z'
        where ${ada} in (from_record_id, to_record_id) and ${beta} in (from_record_id, to_record_id)
      `);
    });
    const companyAt = async (moment: string) =>
      (await getValuesAsOf(world.scope, { recordId: ada, at: moment }))[world.person('company')];
    expect(await companyAt('2026-01-01T00:00:00.000099Z')).toEqual(at(world, acme));
    // A millisecond Date would read this as .000, before the boundary, and answer Acme.
    expect(await companyAt('2026-01-01T00:00:00.000100Z')).toEqual(at(world, beta));
    expect(await companyAt('2026-01-01T02:00:00.000100+02:00')).toEqual(at(world, beta));
    expect(await companyAt('2026-01-01T01:00:00.000099+01:00')).toEqual(at(world, acme));
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

  it('numbers a far end past 32,767 links, and refuses a link past the largest position (AC-5, AC-16)', async () => {
    const world = await workspace();
    const acme = await newCompany(world, 'Acme');
    const team = world.company('team');
    const link = (recordId: string) =>
      setValues(world.scope, {
        recordId,
        values: { [world.person('company')]: { value: { objectId: world.companies, recordId: acme } } },
      });
    const ada = await newPerson(world, 'Ada');
    await link(ada);
    // Acme's end as if it already held 32,768 links, without making them.
    const setLast = (position: number) =>
      owner.withWorkspace(world.scope.workspaceId, (tx) =>
        tx.execute(sql`
          update record_links set to_position = ${position}
          where to_record_id = ${acme} and active_until is null
            and to_position = (select max(to_position) from record_links where to_record_id = ${acme} and active_until is null)
        `),
      );
    await setLast(32_767);
    const grace = await newPerson(world, 'Grace');
    await link(grace);
    const positions = await db.withWorkspace(world.scope.workspaceId, (tx) =>
      tx.execute<{ from_record_id: string; to_position: number }>(sql`
        select from_record_id, to_position from record_links
        where to_record_id = ${acme} and active_until is null order by to_position
      `),
    );
    expect(positions.rows.map((row) => [row.from_record_id, row.to_position])).toEqual([
      [ada, 32_767],
      [grace, 32_768],
    ]);
    expect(await valueOf(world.scope, acme, team)).toEqual([
      { objectId: world.people, recordId: ada },
      { objectId: world.people, recordId: grace },
    ]);

    // At the largest integer there is no next position: a clean refusal, not an out of range error.
    await setLast(2_147_483_647);
    const hopper = await newPerson(world, 'Hopper');
    const refused = await refusals(link(hopper));
    expect(refused.map((refusal) => [refusal.code, refusal.attributeId])).toEqual([
      ['LIMIT_REACHED', world.person('company')],
    ]);
    expect(await valueOf(world.scope, hopper, world.person('company'))).toBeNull();
  });

  it('clears a multi end holding 70,000 links with one statement (AC-5)', { timeout: 120_000 }, async () => {
    const world = await workspace();
    const acme = await newCompany(world, 'Acme');
    const ada = await newPerson(world, 'Ada');
    await setValues(world.scope, {
      recordId: ada,
      values: { [world.person('company')]: { value: { objectId: world.companies, recordId: acme } } },
    });
    // 70,000 more people at Acme, in bulk as the owner: past Postgres's 65,535 bind parameters if each link
    // were its own parameter. Each copies the real link's relationship and cardinality flags.
    const people = 70_000;
    await owner.withWorkspace(world.scope.workspaceId, (tx) =>
      tx.execute(sql`
        with first as (
          select relationship_id, from_single, to_single from record_links
          where from_record_id = ${ada} and active_until is null
        ), added as (
          insert into records (workspace_id, object_id, created_by_type, updated_by_type)
          select ${world.scope.workspaceId}::uuid, ${world.people}::uuid, 'system', 'system'
          from generate_series(1, ${people}::int)
          returning id
        )
        insert into record_links (workspace_id, version_id, relationship_id, from_record_id, to_record_id,
          position, to_position, from_single, to_single, active_from, set_by_type)
        select ${world.scope.workspaceId}::uuid, uuidv7(), first.relationship_id, added.id, ${acme}::uuid,
          0, row_number() over (), first.from_single, first.to_single, now() - interval '1 minute', 'system'
        from added, first
      `),
    );
    let seen: Change | undefined;
    const hook: AfterWrite = (change) => {
      seen = change;
      return Promise.resolve();
    };
    const started = performance.now();
    const results = await setValues(
      world.scope,
      { recordId: acme, values: { [world.company('team')]: { value: null } } },
      [hook],
    );
    const took = performance.now() - started;
    expect(results[world.company('team')]?.versionId).toBeTruthy();
    expect(
      await rowCount(
        world.scope,
        sql`select count(*)::int as n from record_links where to_record_id = ${acme} and active_until is null`,
      ),
    ).toBe(0);
    expect(await valueOf(world.scope, acme, world.company('team'))).toEqual([]);
    // Acme's own change, then one for every person whose Company it was.
    expect(seen?.values).toHaveLength(people + 2);
    expect(took).toBeLessThan(30_000);
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

  /** Makes `n` people at once, straight in SQL, each linked to the company through its `company` reference. */
  async function staff(world: World, companyId: string, n: number): Promise<void> {
    await db.withWorkspace(world.scope.workspaceId, (tx) =>
      tx.execute(sql`
        with rel as (
          select id, from_attribute_id = ${world.person('company')} as person_is_from,
            cardinality in ('one_to_one', 'many_to_one') as from_single,
            cardinality in ('one_to_one', 'one_to_many') as to_single
          from relationships
          where from_attribute_id = ${world.person('company')} or to_attribute_id = ${world.person('company')}
        ), people as (
          insert into records (workspace_id, object_id, created_by_type, updated_by_type)
          select ${world.scope.workspaceId}, ${world.people}, 'system', 'system' from generate_series(1, ${n})
          returning id
        )
        insert into record_links (workspace_id, version_id, relationship_id, from_record_id, to_record_id,
          position, to_position, from_single, to_single, active_from, set_by_type)
        select ${world.scope.workspaceId}, uuidv7(), rel.id,
          case when rel.person_is_from then p.id else ${companyId}::uuid end,
          case when rel.person_is_from then ${companyId}::uuid else p.id end,
          0, 0, rel.from_single, rel.to_single, now(), 'system'
        from people p cross join rel
      `),
    );
  }

  it('hands the hooks every record, and the outbox cap names an object coarse past 1,000 (AC-17)', async () => {
    const world = await workspace();
    const acme = await newCompany(world, 'Acme');
    await staff(world, acme, CHANGE_CAP + 1);
    const seen: Change[] = [];
    const hook: AfterWrite = (change) => {
      seen.push(change);
      return Promise.resolve();
    };
    const of = (change: Change | undefined): Change => {
      if (change === undefined) throw new Error('The hook saw no change.');
      return change;
    };

    // The hooks see every reference (the audit log names them all); capChange, for the outbox, cuts them.
    await deleteRecord(world.scope, { recordId: acme }, [hook]);
    const deleted = of(seen[0]);
    expect(deleted.deletedRecords).toEqual([{ recordId: acme, objectId: world.companies }]);
    expect(deleted.references).toHaveLength(CHANGE_CAP + 1);
    expect(new Set(deleted.references.map((ref) => ref.recordId)).size).toBe(CHANGE_CAP + 1);
    const capped = capChange(deleted);
    expect(capped.references).toEqual([]);
    expect(capped.deletedRecords).toEqual([{ recordId: acme, objectId: world.companies }]);
    expect(capped.coarse).toEqual([{ objectId: world.people }]);

    // At the cap, every id is still listed.
    const globex = await newCompany(world, 'Globex');
    await staff(world, globex, CHANGE_CAP);
    await deleteRecord(world.scope, { recordId: globex }, [hook]);
    const atCap = capChange(of(seen[1]));
    expect(atCap.references).toHaveLength(CHANGE_CAP);
    expect(atCap.coarse).toEqual([]);

    // A purge of more than 1,000 records of one object lists them all, and the cap names the object.
    await db.withWorkspace(world.scope.workspaceId, (tx) =>
      tx.execute(sql`update records set deleted_at = now() - interval '31 days', deleted_by_type = 'system'
        where object_id = ${world.people}`),
    );
    await purgeDeleted(world.scope, { batchSize: 5_000 }, [hook]);
    const purged = of(seen.at(-1));
    expect(purged.purgedRecords.filter((ref) => ref.objectId === world.people)).toHaveLength(2 * CHANGE_CAP + 1);
    const cappedPurge = capChange(purged);
    expect(cappedPurge.purgedRecords.filter((ref) => ref.objectId === world.people)).toEqual([]);
    expect(cappedPurge.coarse).toEqual([{ objectId: world.people }]);
  });

  it('merges record lists, references and values per object when it caps (AC-17)', () => {
    const objectId = '0190f0f0-0000-7000-8000-000000000001';
    const other = '0190f0f0-0000-7000-8000-000000000002';
    const ids = Array.from({ length: CHANGE_CAP + 1 }, (_, index) => `rec-${String(index)}`);
    const half = Math.floor(ids.length / 2);
    const change: Change = {
      kind: 'write',
      workspaceId: 'ws',
      actor: { type: 'system', id: null },
      createdRecords: ids.slice(0, half).map((recordId) => ({ recordId, objectId })),
      deletedRecords: [{ recordId: 'kept', objectId: other }],
      restoredRecords: [],
      purgedRecords: [],
      createdEntries: [],
      removedEntries: [],
      restoredEntries: [],
      hiddenEntries: [],
      shownEntries: [],
      purgedEntries: [],
      values: ids.slice(half).map((ownerId) => ({
        ownerId,
        ownerKind: 'record' as const,
        objectId,
        attributeId: 'a',
        versionId: 'v',
      })),
      references: [],
    };
    // Neither list passes the cap alone; together they do.
    const capped = capChange(change);
    expect(capped.coarse).toEqual([{ objectId }]);
    expect(capped.createdRecords).toEqual([]);
    expect(capped.values).toEqual([]);
    expect(capped.deletedRecords).toEqual([{ recordId: 'kept', objectId: other }]);
    expect(capChange({ ...change, values: change.values.slice(1) }).coarse).toEqual([]);
  });

  /**
   * Holds row locks on the rows `rows` selects, in the test's own workspace,
   * until `release`: a write that updates or deletes one of them waits there.
   * Row locks, not a table lock, so the other test files sharing this
   * database never wait on it.
   */
  async function holdRows(world: World, rows: SQL) {
    const locked = Promise.withResolvers<undefined>();
    const release = Promise.withResolvers<undefined>();
    const holder = owner.withWorkspace(world.scope.workspaceId, async (tx) => {
      const held = await tx.execute(sql`${rows} for update`);
      if (held.rows.length === 0) throw new Error('Nothing to hold.');
      locked.resolve(undefined);
      await release.promise;
    });
    // A holder that fails before it locks fails the wait too, instead of hanging it.
    await Promise.race([locked.promise, holder]);
    return {
      release: async () => {
        release.resolve(undefined);
        await holder;
      },
    };
  }

  /** Waits until `n` of this file's app connections are waiting on a lock. */
  async function waitForWaiters(world: World, n: number, what: string): Promise<void> {
    for (let tries = 0; ; tries += 1) {
      const result = await owner.withWorkspace(world.scope.workspaceId, (tx) =>
        tx.execute<{ n: number }>(sql`
          select count(distinct l.pid)::int as n from pg_locks l join pg_stat_activity a on a.pid = l.pid
          where not l.granted and a.application_name = ${APP_NAME}
        `),
      );
      if ((result.rows[0]?.n ?? 0) >= n) return;
      if (tries > 1_000) throw new Error(`${what} never waited.`);
      await delay(10);
    }
  }

  /** Whether another transaction could take the workspace counter row right now. */
  async function counterState(world: World): Promise<'free' | 'held'> {
    return db
      .withWorkspace(world.scope.workspaceId, (tx) =>
        tx.execute(
          sql`select 1 from workspace_counters where workspace_id = ${world.scope.workspaceId} for update nowait`,
        ),
      )
      .then(
        () => 'free' as const,
        (error: unknown) => {
          if (postgresError(error)?.code === '55P03') return 'held' as const;
          throw error;
        },
      );
  }

  /** The scope with its transactions counted: more than one means `runWrite` retried a deadlock or conflict. */
  function counted(scope: EngineScope): { scope: EngineScope; attempts: () => number } {
    let attempts = 0;
    return {
      scope: {
        ...scope,
        db: {
          ...scope.db,
          withWorkspace: (workspaceId, work) => {
            attempts += 1;
            return scope.db.withWorkspace(workspaceId, work);
          },
        },
      },
      attempts: () => attempts,
    };
  }

  it('reads the links and entries before it takes the workspace counter, so creates are not held (AC-16, AC-17)', async () => {
    const world = await workspace();
    const acme = await newCompany(world, 'Acme');
    const ada = await newPerson(world, 'Ada', {
      [world.person('company')]: { objectId: world.companies, recordId: acme },
    });
    const seen: Change[] = [];
    const hook: AfterWrite = (change) => {
      seen.push(change);
      return Promise.resolve();
    };
    // Stops the delete at its sort keys, after its entries and far references reads and before its slot.
    const hold = await holdRows(world, sql`select 1 from sort_keys where record_id = ${acme}`);
    let deleting: Promise<unknown> | undefined;
    try {
      deleting = deleteRecord(world.scope, { recordId: acme }, [hook]);
      await waitForWaiters(world, 1, 'The delete');
      expect(await counterState(world)).toBe('free');
      await hold.release();
      expect(await deleting).toEqual({ recordId: acme, state: 'deleted' });
      expect(seen[0]?.references).toEqual([
        { recordId: ada, objectId: world.people, attributeId: world.person('company') },
      ]);
    } finally {
      await hold.release();
      await deleting?.catch(() => undefined);
    }
  });

  it('erases a record with many links without holding the workspace counter while it deletes (AC-16, AC-18)', async () => {
    const world = await workspace();
    const acme = await newCompany(world, 'Acme');
    await staff(world, acme, 300);
    const seen: Change[] = [];
    const hook: AfterWrite = (change) => {
      seen.push(change);
      return Promise.resolve();
    };
    // Stops the erasure in its heavy step, at the links it deletes.
    const hold = await holdRows(
      world,
      sql`select 1 from record_links where to_record_id = ${acme} or from_record_id = ${acme} limit 1`,
    );
    let erasing: Promise<RemovedCounts> | undefined;
    try {
      erasing = eraseRecord(world.scope, { recordId: acme }, [hook]);
      await waitForWaiters(world, 1, 'The erasure');
      expect(await counterState(world)).toBe('free');
      await hold.release();
      expect((await erasing).links).toBe(300);
      expect(seen[0]?.references).toHaveLength(300);
    } finally {
      await hold.release();
      await erasing?.catch(() => undefined);
    }
  });

  it('lets a create take the unique value a concurrent delete gives up, with no deadlock (AC-8, AC-10, AC-16)', async () => {
    const world = await workspace();
    const emails = world.person('email_addresses');
    const ada = await newPerson(world, 'Ada', { [emails]: ['ada@example.com'] });
    const deleter = counted(world.scope);
    const creator = counted(world.scope);
    // Stops the delete after it moved Ada's unique keys aside and before its slot.
    const hold = await holdRows(world, sql`select 1 from sort_keys where record_id = ${ada}`);
    let deleting: Promise<unknown> | undefined;
    let creating: Promise<unknown> | undefined;
    try {
      deleting = deleteRecord(deleter.scope, { recordId: ada });
      await waitForWaiters(world, 1, 'The delete');
      // The create waits on the delete's key change; it has not taken the counter, so the delete can.
      creating = createRecord(creator.scope, {
        objectId: world.people,
        values: { [world.person('name')]: { firstName: 'New Ada' }, [emails]: ['ada@example.com'] },
      });
      await waitForWaiters(world, 2, 'The create');
      expect(await counterState(world)).toBe('free');
      await hold.release();
      const [deleted, created] = await Promise.allSettled([deleting, creating]);
      expect(deleted.status).toBe('fulfilled');
      expect(created.status).toBe('fulfilled');
      // One transaction each: no deadlock (40P01) or conflict was retried.
      expect([deleter.attempts(), creator.attempts()]).toEqual([1, 1]);
    } finally {
      await hold.release();
      await Promise.allSettled([deleting, creating]);
    }
  });

  it('refuses a malformed record id as not found, before any query (AC-8, AC-18)', async () => {
    const world = await workspace();
    const quiet = counted(world.scope);
    for (const attempt of [
      () => deleteRecord(quiet.scope, { recordId: 'not-a-uuid' }),
      () => restoreRecord(quiet.scope, { recordId: "1'; select 1" }),
      () => eraseRecord(quiet.scope, { recordId: '' }),
    ]) {
      expect((await refusals(attempt()))[0]?.code).toBe('NOT_FOUND');
    }
    // Refused before they open a transaction at all.
    expect(quiet.attempts()).toBe(0);
    // The siblings that cast a record id refuse it the same way, not with a failed cast.
    for (const attempt of [
      () => setValues(world.scope, { recordId: 'nope', values: {} }),
      () => getHistory(world.scope, { recordId: 'nope', attributeId: world.person('name') }),
      () => getValuesAsOf(world.scope, { recordId: 'nope', at: new Date().toISOString() }),
      () => getRecordEntries(world.scope, { recordId: 'nope' }),
    ]) {
      expect((await refusals(attempt()))[0]?.code).toBe('NOT_FOUND');
    }
  });

  it('purges and erases values through the owner index, never a scan of values (AC-8, AC-18)', async () => {
    const world = await workspace();
    const deal = await newDeal(world, 'Big deal');
    const { listId } = await pipeline(world);
    const { entryId } = await addEntry(world.scope, { listId, recordId: deal });
    // Enough history on another record that the planner weighs the table as it would in production.
    const filler = await newDeal(world, 'Filler');
    await db.withWorkspace(world.scope.workspaceId, (tx) =>
      tx.execute(sql`
        insert into "values" (workspace_id, version_id, attribute_id, record_id, owner_id, position, text_value,
          active_from, active_until, set_by_type)
        select workspace_id, uuidv7(), attribute_id, record_id, owner_id, 0, 'Filler ' || g,
          now() - make_interval(days => g + 1), now() - make_interval(days => g), 'system'
        from "values", generate_series(1, 20000) g
        where owner_id = ${filler} and attribute_id = ${world.deal('name')} and active_until is null
      `),
    );
    await owner.vacuumAnalyze(['values']);

    const scans = async (statement: SQL) => {
      const result = await db.withWorkspace(world.scope.workspaceId, (tx) =>
        tx.execute<{ 'QUERY PLAN': readonly { Plan: PlanNode }[] }>(sql`explain (format json) ${statement}`),
      );
      const nodes: PlanNode[] = [];
      const walk = (node: PlanNode) => {
        nodes.push(node);
        for (const child of node.Plans ?? []) walk(child);
      };
      const plan = result.rows[0]?.['QUERY PLAN'][0]?.Plan;
      if (plan === undefined) throw new Error('No plan.');
      walk(plan);
      return {
        seqScansOfValues: nodes.filter(
          (node) => node['Node Type'] === 'Seq Scan' && node['Relation Name'] === 'values',
        ),
        valueIndexes: nodes.flatMap((node) => (node['Index Name']?.startsWith('values_') ? [node['Index Name']] : [])),
      };
    };
    for (const statement of [deleteRecordValues([deal]), deleteEntryValues([entryId])]) {
      const plan = await scans(statement);
      expect(plan.seqScansOfValues).toEqual([]);
      expect(plan.valueIndexes).toContain('values_history');
    }
  });

  it("finds a record's far references by index, never a scan of records or record_links (AC-8, AC-17, AC-18)", async () => {
    const world = await workspace();
    const holding = await newCompany(world, 'Holding');
    // Links on both of its ends: people at the company (it is the to end), and its own parent (the from end).
    const parent = await newCompany(world, 'Parent');
    await setValues(world.scope, {
      recordId: holding,
      values: { [world.company('parent_company')]: { value: { objectId: world.companies, recordId: parent } } },
    });
    for (let index = 0; index < 30; index += 1) {
      await newPerson(world, `P${String(index)}`, {
        [world.person('company')]: { objectId: world.companies, recordId: index % 3 === 0 ? holding : parent },
      });
    }
    // Bulk, as the owner: 2,000 more people at Holding (a record with many links, where a plain join became a
    // hash join over a scan of all of records), and 20,000 at Parent, so Holding's links are a few of many.
    const bulk = (count: number, company: string) =>
      owner.withWorkspace(world.scope.workspaceId, (tx) =>
        tx.execute(sql`
          with first as (
            select l.relationship_id, l.from_single, l.to_single from record_links l
            join attributes a on a.workspace_id = l.workspace_id and a.relationship_id = l.relationship_id
            where a.id = ${world.person('company')} and l.active_until is null limit 1
          ), added as (
            insert into records (workspace_id, object_id, created_by_type, updated_by_type)
            select ${world.scope.workspaceId}::uuid, ${world.people}::uuid, 'system', 'system'
            from generate_series(1, ${count}::int)
            returning id
          )
          insert into record_links (workspace_id, version_id, relationship_id, from_record_id, to_record_id,
            position, to_position, from_single, to_single, active_from, set_by_type)
          select ${world.scope.workspaceId}::uuid, uuidv7(), first.relationship_id, added.id, ${company}::uuid,
            0, 100 + row_number() over (), first.from_single, first.to_single, now(), 'system'
          from added, first
        `),
      );
    await bulk(2_000, holding);
    await bulk(20_000, parent);
    // Fresh statistics and every scan allowed: the plan the server would really pick.
    await owner.vacuumAnalyze(['record_links', 'records']);
    const nodes = await db.withWorkspace(world.scope.workspaceId, async (tx) => {
      const result = await tx.execute<{ 'QUERY PLAN': readonly { Plan: PlanNode }[] }>(
        sql`explain (format json) ${farReferencesQuery(holding, world.companies)}`,
      );
      const found: PlanNode[] = [];
      const walk = (node: PlanNode) => {
        found.push(node);
        for (const child of node.Plans ?? []) walk(child);
      };
      const plan = result.rows[0]?.['QUERY PLAN'][0]?.Plan;
      if (plan === undefined) throw new Error('No plan.');
      walk(plan);
      return found;
    });
    expect(
      nodes.filter(
        (node) =>
          node['Node Type'] === 'Seq Scan' &&
          (node['Relation Name'] === 'record_links' || node['Relation Name'] === 'records'),
      ),
    ).toEqual([]);
    // No hash join and no sort: each far record is a primary key probe, and the rows are sorted in JS.
    expect(nodes.filter((node) => node['Node Type'] === 'Hash Join' || node['Node Type'] === 'Sort')).toEqual([]);
    expect(nodes.some((node) => node['Relation Name'] === 'records' && node['Index Name'] === 'records_pkey')).toBe(
      true,
    );
    // Each end's branch seeks its links by the record (whichever record_links index the planner picks).
    const seeks = nodes.flatMap((node) =>
      node['Index Name']?.startsWith('record_links_') === true ? [node['Index Cond'] ?? ''] : [],
    );
    expect(seeks.some((condition) => condition.includes('from_record_id ='))).toBe(true);
    expect(seeks.some((condition) => condition.includes('to_record_id ='))).toBe(true);

    // And the read itself: the 2,010 people (through their Company) and the parent (through its Subsidiaries).
    const rows = await db.withWorkspace(world.scope.workspaceId, (tx) =>
      tx.execute<{ record_id: string; attribute_id: string }>(farReferencesQuery(holding, world.companies)),
    );
    expect(
      rows.rows.filter((row) => row.attribute_id === world.company('subsidiaries')).map((row) => row.record_id),
    ).toEqual([parent]);
    expect(rows.rows.filter((row) => row.attribute_id === world.person('company'))).toHaveLength(2_010);
  });
});

/** The parts of an `explain (format json)` node the plan tests read. */
interface PlanNode {
  readonly 'Node Type': string;
  readonly 'Relation Name'?: string;
  readonly 'Index Name'?: string;
  readonly 'Index Cond'?: string;
  readonly Plans?: readonly PlanNode[];
}
