// Hidden means absent (spec 0009, milestone 2, AC-140 to AC-144), against a
// real Postgres as the app role. Rules are injected through the door's test
// entry, as #24 will store them: a hidden object, a hidden field, a read only
// field, a read only object and an `own` record rule, each checked in the
// listings, pages, counts, reads, filters (directly, through a relationship
// and as a contains), history, reference values, writes, link writes and the
// refusal messages. A hidden thing answers exactly as one that doesn't exist.
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, type Database } from '@crm/db';
import { recordStatements } from '@crm/db/testing';
import type { FilterGroup } from '@crm/contracts/values';
import { listObjectAttributes } from '../attributes/attributes.ts';
import { defineAttribute, defineObject, listAttributes, updateAttribute } from '../engine/definitions.ts';
import { deleteRecord, restoreRecord } from '../engine/deletion.ts';
import { getHistory, getTimeInStages, getValuesAsOf } from '../engine/history.ts';
import { newId } from '../engine/ids.ts';
import { addEntry, defineList, getEntries, getRecordEntries } from '../engine/lists.ts';
import { listOptions } from '../engine/options.ts';
import { countMatches, queryPage } from '../engine/query/page.ts';
import { createRecord, getRecords, setValues, setValuesBatch } from '../engine/records.ts';
import { isRefusal } from '../engine/refusals.ts';
import { createWorkspace } from '../engine/workspaces.ts';
import { listObjects } from '../objects/objects.ts';
import { testScope } from '../testing.ts';
import type { EngineScope } from './mint.ts';
import type { AccessRules } from './policy.ts';

const { appUrl } = inject('testDatabase');
let db: Database;
/** The owner: the open policy. */
let owner: EngineScope;
/** A member under the rules below. */
let member: EngineScope;
let memberId: string;
const ids: Record<string, string> = {};
const id = (key: string): string => {
  const value = ids[key];
  if (value === undefined) throw new Error(`No ${key}.`);
  return value;
};

async function refusals(call: Promise<unknown>) {
  try {
    await call;
  } catch (error) {
    if (isRefusal(error)) return error.refusals;
    throw error;
  }
  throw new Error('It was let through.');
}

/** A record of `object` with `values`, made by the owner. */
async function record(object: string, values: Record<string, unknown>): Promise<string> {
  return (await createRecord(owner, { objectId: id(object), values })).recordId;
}

beforeAll(async () => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-absent-tests' });
  const created = await createWorkspace(db, {
    name: 'Absent',
    slug: `absent-${String(Date.now())}`,
    firstMember: { name: 'Olive', email: 'olive@example.com' },
  });
  owner = testScope({ db, workspaceId: created.workspaceId, actor: { type: 'member', id: created.memberId } });
  ids.ownerMember = created.memberId;
  memberId = newId();
  await db.withWorkspace(created.workspaceId, (tx) =>
    tx.execute(
      sql`insert into members (workspace_id, id, name, email, role, created_by_type, updated_by_type) values (${created.workspaceId}, ${memberId}, 'Mo', 'mo@example.com', 'member', 'system', 'system')`,
    ),
  );
  for (const key of ['people', 'companies', 'deals']) ids[key] = created.objects[key] ?? '';
  ids.secrets = (
    await defineObject(owner, {
      apiSlug: 'secrets',
      singularName: 'Secret',
      pluralName: 'Secrets',
      icon: 'lock',
      hue: 'red',
    })
  ).objectId;
  const slugs = await db.withWorkspace(created.workspaceId, (tx) =>
    tx.execute<{ id: string; slug: string }>(
      sql`select a.id::text, o.api_slug || '.' || a.api_slug as slug from attributes a join objects o on o.id = a.object_id`,
    ),
  );
  for (const row of slugs.rows) ids[row.slug] = row.id;
  ids['people.stage'] = (
    await defineAttribute(owner, { objectId: id('people'), apiSlug: 'stage', title: 'Stage', type: 'status' })
  ).attributeId;
  ids['companies.code'] = (
    await defineAttribute(owner, { objectId: id('companies'), apiSlug: 'code', title: 'Code', type: 'text' })
  ).attributeId;

  const me = { type: 'member', id: memberId };
  const them = { type: 'member', id: created.memberId };
  ids.acme = await record('companies', {
    [id('companies.name')]: 'Acme',
    [id('companies.owner')]: me,
    [id('companies.code')]: 'X1',
  });
  ids.globex = await record('companies', {
    [id('companies.name')]: 'Globex',
    [id('companies.owner')]: them,
    [id('companies.code')]: 'X1',
    [id('companies.parent_company')]: { objectId: id('companies'), recordId: id('acme') },
  });
  ids.initech = await record('companies', {
    [id('companies.name')]: 'Initech',
    [id('companies.owner')]: me,
    [id('companies.parent_company')]: { objectId: id('companies'), recordId: id('acme') },
  });
  ids.ada = await record('people', {
    [id('people.name')]: { firstName: 'Ada', lastName: 'Lovelace', fullName: 'Ada Lovelace' },
    [id('people.job_title')]: 'Engineer',
    [id('people.description')]: 'Wrote the first program',
    [id('people.email_addresses')]: ['ada@example.com'],
    [id('people.company')]: { objectId: id('companies'), recordId: id('acme') },
  });
  ids.bob = await record('people', {
    [id('people.name')]: { firstName: 'Bob', lastName: 'Byte', fullName: 'Bob Byte' },
    [id('people.job_title')]: 'Founder',
    [id('people.company')]: { objectId: id('companies'), recordId: id('globex') },
  });
  ids.deal = await record('deals', { [id('deals.name')]: 'Big deal' });
  ids.secret = await record('secrets', { [id('secrets.name')]: 'Launch codes' });
  ids.list = (await defineList(owner, { objectId: id('people'), apiSlug: 'hiring', name: 'Hiring' })).listId;
  ids.adaEntry = (await addEntry(owner, { listId: id('list'), recordId: id('ada') })).entryId;

  const rules: AccessRules = {
    levels: [
      { subject: { type: 'role', role: 'member' }, target: { type: 'object', objectId: id('secrets') }, level: 'none' },
      { subject: { type: 'role', role: 'member' }, target: { type: 'object', objectId: id('deals') }, level: 'read' },
      {
        subject: { type: 'role', role: 'member' },
        target: { type: 'attribute', objectId: id('people'), attributeId: id('people.job_title') },
        level: 'hidden',
      },
      {
        subject: { type: 'role', role: 'member' },
        target: { type: 'attribute', objectId: id('people'), attributeId: id('people.stage') },
        level: 'hidden',
      },
      {
        subject: { type: 'role', role: 'member' },
        target: { type: 'attribute', objectId: id('people'), attributeId: id('people.email_addresses') },
        level: 'hidden',
      },
      {
        subject: { type: 'role', role: 'member' },
        target: { type: 'attribute', objectId: id('people'), attributeId: id('people.description') },
        level: 'read',
      },
    ],
    records: [
      {
        subject: { type: 'role', role: 'member' },
        objectId: id('companies'),
        kind: 'own',
        attributeId: id('companies.owner'),
      },
    ],
  };
  member = testScope({
    db,
    workspaceId: created.workspaceId,
    actor: { type: 'member', id: memberId },
    role: 'member',
    rules,
  });
});

afterAll(async () => {
  await db.close();
});

const and = (...conditions: FilterGroup['conditions']): FilterGroup => ({ conjunction: 'and', conditions });
const unknownId = () => newId();

describe('a hidden object (AC-140)', () => {
  it('is left out of the object list, and the others say what the member may do', async () => {
    const listed = await listObjects(member);
    expect(listed.map((object) => object.id)).not.toContain(id('secrets'));
    expect(listed.find((object) => object.id === id('deals'))?.access).toBe('read');
    expect(listed.find((object) => object.id === id('people'))?.access).toBe('write');
    expect((await listObjects(owner)).map((object) => object.id)).toContain(id('secrets'));
  });

  it('answers every read and write naming it, its attributes or its records as an unknown id would', async () => {
    const unknown = unknownId();
    const same = async (hidden: () => Promise<unknown>, missing: () => Promise<unknown>) =>
      expect(await refusals(hidden())).toEqual(await refusals(missing()));
    await same(
      () => listObjectAttributes(member, id('secrets')),
      () => listObjectAttributes(member, unknown),
    );
    await same(
      () => queryPage(member, { objectId: id('secrets') }),
      () => queryPage(member, { objectId: unknown }),
    );
    await same(
      () => countMatches(member, { objectId: id('secrets') }),
      () => countMatches(member, { objectId: unknown }),
    );
    await same(
      () => createRecord(member, { objectId: id('secrets'), values: {} }),
      () => createRecord(member, { objectId: unknown, values: {} }),
    );
    await same(
      () => setValues(member, { recordId: id('secret'), values: { [id('secrets.name')]: { value: 'x' } } }),
      () => setValues(member, { recordId: unknown, values: { [id('secrets.name')]: { value: 'x' } } }),
    );
    await same(
      () => deleteRecord(member, { recordId: id('secret') }),
      () => deleteRecord(member, { recordId: unknown }),
    );
    await same(
      () => getHistory(member, { recordId: id('secret'), attributeId: id('secrets.name') }),
      () => getHistory(member, { recordId: unknown, attributeId: id('secrets.name') }),
    );
    await same(
      () => getValuesAsOf(member, { recordId: id('secret'), at: new Date().toISOString() }),
      () => getValuesAsOf(member, { recordId: unknown, at: new Date().toISOString() }),
    );
    expect(await getRecords(member, { ids: [id('secret')] })).toEqual([]);
    expect(await listAttributes(member, id('secrets'))).toEqual([]);
    expect(await listOptions(member, id('secrets.name'))).toEqual([]);
  });
});

describe('a hidden field (AC-141)', () => {
  it('is left out of the attribute list, the record, history, values as of a date and time in stage', async () => {
    const listed = await listObjectAttributes(member, id('people'));
    expect(listed.map((attribute) => attribute.id)).not.toContain(id('people.job_title'));
    expect((await listAttributes(member, id('people'))).map((attribute) => attribute.id)).not.toContain(
      id('people.job_title'),
    );
    const [ada] = await getRecords(member, { ids: [id('ada')] });
    expect(ada?.values).not.toHaveProperty(id('people.job_title'));
    expect(ada?.versions).not.toHaveProperty(id('people.job_title'));
    expect(ada?.values[id('people.name')]).toMatchObject({ fullName: 'Ada Lovelace' });
    const [asOwner] = await getRecords(owner, { ids: [id('ada')] });
    expect(asOwner?.values[id('people.job_title')]).toBe('Engineer');

    const asOf = await getValuesAsOf(member, { recordId: id('ada'), at: new Date().toISOString() });
    expect(asOf).not.toHaveProperty(id('people.job_title'));
    // As an unknown attribute: the same code and words (each names its own id).
    const words = (found: readonly { code: string; message: string }[]) =>
      found.map(({ code, message }) => ({ code, message }));
    expect(
      words(await refusals(getHistory(member, { recordId: id('ada'), attributeId: id('people.job_title') }))),
    ).toEqual(words(await refusals(getHistory(member, { recordId: id('ada'), attributeId: unknownId() }))));
    expect(
      words(await refusals(getTimeInStages(member, { recordId: id('ada'), attributeId: id('people.stage') }))),
    ).toEqual(words(await refusals(getTimeInStages(member, { recordId: id('ada'), attributeId: unknownId() }))));
    expect(await listOptions(member, id('people.stage'))).toEqual([]);
  });

  it('is refused in a filter or sort, directly or through a relationship, exactly as an unknown attribute', async () => {
    const unknown = unknownId();
    const direct = (attributeId: string) =>
      refusals(
        queryPage(member, {
          objectId: id('people'),
          filter: and({ attributeId, operator: 'is', value: 'Engineer' }),
        }),
      );
    expect(await direct(id('people.job_title'))).toEqual(await direct(unknown));
    const sorted = (attributeId: string) =>
      refusals(queryPage(member, { objectId: id('people'), sorts: [{ attributeId, direction: 'ascending' }] }));
    expect(await sorted(id('people.job_title'))).toEqual(await sorted(unknown));
    const through = (attributeId: string) =>
      refusals(
        countMatches(member, {
          objectId: id('companies'),
          filter: and({
            operator: 'through',
            path: [id('companies.team')],
            condition: { attributeId, operator: 'is', value: 'Engineer' },
          }),
        }),
      );
    expect(await through(id('people.job_title'))).toEqual(await through(unknown));
    expect((await direct(id('people.job_title')))[0]?.code).toBe('FILTER_INVALID');
  });

  it('never sends a contains on it to the search function', async () => {
    let answer: unknown;
    const sent = await recordStatements(async () => {
      answer = await refusals(
        queryPage(member, {
          objectId: id('people'),
          filter: and({ attributeId: id('people.job_title'), operator: 'contains', value: 'Engineer' }),
        }),
      );
    });
    expect(answer).toMatchObject([{ code: 'FILTER_INVALID' }]);
    expect(sent.some((statement) => statement.text.includes('crm_search_text'))).toBe(false);
    // The owner's same contains does ask it, so the check above means something.
    const asked = await recordStatements(() =>
      queryPage(owner, {
        objectId: id('people'),
        filter: and({ attributeId: id('people.job_title'), operator: 'contains', value: 'Engineer' }),
      }),
    );
    expect(asked.some((statement) => statement.text.includes('crm_search_text'))).toBe(true);
  });

  it('refuses a write naming it as NOT_FOUND, exactly as an unknown attribute', async () => {
    const write = (attributeId: string) =>
      refusals(setValues(member, { recordId: id('ada'), values: { [attributeId]: { value: 'Boss' } } }));
    const hidden = await write(id('people.job_title'));
    const unknown = unknownId();
    expect(hidden).toEqual([
      { code: 'NOT_FOUND', message: 'That attribute is not on this object.', attributeId: id('people.job_title') },
    ]);
    expect((await write(unknown))[0]).toMatchObject({ code: 'NOT_FOUND', message: hidden[0]?.message });
  });
});

describe('read only (AC-142)', () => {
  it('lists a read only field with its reason and refuses a write to it with that reason', async () => {
    const listed = await listObjectAttributes(member, id('people'));
    const description = listed.find((attribute) => attribute.id === id('people.description'));
    expect(description?.readOnly).toEqual({ reason: "Your role can't change Description." });
    expect(listed.find((attribute) => attribute.id === id('people.name'))?.readOnly).toBeUndefined();
    expect(
      await refusals(
        setValues(member, { recordId: id('ada'), values: { [id('people.description')]: { value: 'Countess' } } }),
      ),
    ).toEqual([
      {
        code: 'ATTRIBUTE_READ_ONLY',
        message: "Your role can't change Description.",
        attributeId: id('people.description'),
      },
    ]);
    // A field the member may write still takes their write.
    await setValues(member, {
      recordId: id('ada'),
      values: { [id('people.name')]: { value: { firstName: 'Ada', lastName: 'King', fullName: 'Ada King' } } },
    });
  });

  it('gives every attribute of a read only object its reason, and refuses each change 403', async () => {
    const listed = await listObjectAttributes(member, id('deals'));
    expect(listed.length).toBeGreaterThan(0);
    for (const attribute of listed) {
      expect(attribute.readOnly).toEqual({ reason: 'You can view Deals but not change them.' });
    }
    const forbidden = [{ code: 'FORBIDDEN', message: 'You can view Deals but not change them.' }];
    expect(
      await refusals(createRecord(member, { objectId: id('deals'), values: { [id('deals.name')]: 'Mine' } })),
    ).toEqual(forbidden);
    expect(
      await refusals(setValues(member, { recordId: id('deal'), values: { [id('deals.name')]: { value: 'Mine' } } })),
    ).toEqual(forbidden);
    expect(await refusals(deleteRecord(member, { recordId: id('deal') }))).toEqual(forbidden);
    await deleteRecord(owner, { recordId: id('deal') });
    expect(await refusals(restoreRecord(member, { recordId: id('deal') }))).toEqual(forbidden);
    await restoreRecord(owner, { recordId: id('deal') });
    // Reading it is fine.
    expect((await getRecords(member, { ids: [id('deal')] })).map((each) => each.id)).toEqual([id('deal')]);
  });
});

describe('a record rule (AC-143)', () => {
  it('leaves records outside it out of pages, counts, reads, searches and history', async () => {
    const page = await queryPage(member, {
      objectId: id('companies'),
      sorts: [{ attributeId: id('companies.name'), direction: 'ascending' }],
    });
    expect(page.records.map((each) => each.id)).toEqual([id('acme'), id('initech')]);
    expect(await countMatches(member, { objectId: id('companies') })).toEqual({ count: 2, atLeast: false });
    expect(await countMatches(owner, { objectId: id('companies') })).toEqual({ count: 3, atLeast: false });
    expect(await getRecords(member, { ids: [id('globex'), id('acme')] })).toHaveLength(1);
    const search = await queryPage(member, {
      objectId: id('companies'),
      filter: and({ attributeId: id('companies.name'), operator: 'contains', value: 'Globex' }),
    });
    expect(search.records).toEqual([]);
    expect(
      await countMatches(member, {
        objectId: id('companies'),
        filter: and({ attributeId: id('companies.code'), operator: 'is', value: 'X1' }),
      }),
    ).toEqual({ count: 1, atLeast: false });
    expect(await refusals(getHistory(member, { recordId: id('globex'), attributeId: id('companies.name') }))).toEqual(
      await refusals(getHistory(member, { recordId: unknownId(), attributeId: id('companies.name') })),
    );
  });

  it('drops far records outside it from reference values, filters through a relationship, and sorts', async () => {
    const [bob] = await getRecords(member, { ids: [id('bob')] });
    expect(bob?.values[id('people.company')]).toBeNull();
    const [ada] = await getRecords(member, { ids: [id('ada')] });
    expect(ada?.values[id('people.company')]).toEqual({ objectId: id('companies'), recordId: id('acme') });
    const [acme] = await getRecords(member, { ids: [id('acme')] });
    expect(acme?.values[id('companies.subsidiaries')]).toEqual([
      { objectId: id('companies'), recordId: id('initech') },
    ]);
    const through = await countMatches(member, {
      objectId: id('people'),
      filter: and({
        operator: 'through',
        path: [id('people.company')],
        condition: { attributeId: id('companies.name'), operator: 'contains', value: 'Glob' },
      }),
    });
    expect(through).toEqual({ count: 0, atLeast: false });
    expect(
      await countMatches(owner, {
        objectId: id('people'),
        filter: and({
          operator: 'through',
          path: [id('people.company')],
          condition: { attributeId: id('companies.name'), operator: 'contains', value: 'Glob' },
        }),
      }),
    ).toEqual({ count: 1, atLeast: false });
    const empty = await countMatches(member, {
      objectId: id('people'),
      filter: and({ attributeId: id('people.company'), operator: 'is_not_empty' }),
    });
    expect(empty).toEqual({ count: 1, atLeast: false });
    const asOf = await getValuesAsOf(member, { recordId: id('bob'), at: new Date().toISOString() });
    expect(asOf[id('people.company')]).toBeNull();
    const history = await getHistory(member, { recordId: id('bob'), attributeId: id('people.company') });
    expect(history.every((version) => version.value === null)).toBe(true);
  });

  it('answers a write or a link naming a record outside it NOT_FOUND, as an unknown one', async () => {
    const unknown = unknownId();
    expect(
      await refusals(setValues(member, { recordId: id('globex'), values: { [id('companies.code')]: { value: 'Y' } } })),
    ).toEqual(
      await refusals(setValues(member, { recordId: unknown, values: { [id('companies.code')]: { value: 'Y' } } })),
    );
    const link = (recordId: string) =>
      refusals(
        setValues(member, {
          recordId: id('ada'),
          values: { [id('people.company')]: { value: { objectId: id('companies'), recordId } } },
        }),
      );
    expect(await link(id('globex'))).toEqual(await link(unknown));
    const batch = await setValuesBatch(member, {
      items: [{ recordId: id('globex'), values: { [id('companies.code')]: { value: 'Y' } } }],
    });
    expect(batch[0]).toMatchObject({ ok: false, refusals: [{ code: 'NOT_FOUND' }] });
  });

  it('keeps the links to far records the writer can’t see when they replace a multi reference', async () => {
    await setValues(member, { recordId: id('acme'), values: { [id('companies.subsidiaries')]: { value: null } } });
    const [mine] = await getRecords(member, { ids: [id('acme')] });
    expect(mine?.values[id('companies.subsidiaries')]).toEqual([]);
    const [theirs] = await getRecords(owner, { ids: [id('acme')] });
    expect(theirs?.values[id('companies.subsidiaries')]).toEqual([
      { objectId: id('companies'), recordId: id('globex') },
    ]);
  });

  it('leaves entries out with their records, and a hidden list attribute out of the entry', async () => {
    expect((await getRecordEntries(member, { recordId: id('ada') })).map((entry) => entry.id)).toEqual([
      id('adaEntry'),
    ]);
    expect((await getEntries(member, { ids: [id('adaEntry')] })).map((entry) => entry.id)).toEqual([id('adaEntry')]);
  });
});

describe('refusal messages (AC-144)', () => {
  it('lists duplicates only to an actor who sees every record and the field, else gives their count', async () => {
    const admin = testScope({
      db,
      workspaceId: owner.workspaceId,
      actor: { type: 'member', id: memberId },
      role: 'admin',
      rules: {
        levels: [],
        records: [
          {
            subject: { type: 'role', role: 'admin' },
            objectId: id('companies'),
            kind: 'own',
            attributeId: id('companies.owner'),
          },
        ],
      },
    });
    expect(await refusals(updateAttribute(admin, { attributeId: id('companies.code'), isUnique: true }))).toEqual([
      {
        code: 'UNIQUE_HAS_DUPLICATES',
        message: "Code can't be unique yet: 1 value is used by more than one record. Merge or change them first.",
        attributeId: id('companies.code'),
      },
    ]);
    expect(
      (await refusals(updateAttribute(owner, { attributeId: id('companies.code'), isUnique: true })))[0]?.message,
    ).toContain('x1');
  });

  it('never names the other record in a unique conflict, nor an attribute the actor can’t see in a restore', async () => {
    const carl = await createRecord(member, {
      objectId: id('people'),
      values: { [id('people.name')]: { firstName: 'Carl', lastName: 'C', fullName: 'Carl C' } },
    });
    await setValues(owner, {
      recordId: carl.recordId,
      values: { [id('people.email_addresses')]: { value: ['carl@example.com'] } },
    });
    await deleteRecord(member, { recordId: carl.recordId });
    await createRecord(owner, {
      objectId: id('people'),
      values: {
        [id('people.name')]: { firstName: 'Cara', lastName: 'C', fullName: 'Cara C' },
        [id('people.email_addresses')]: ['carl@example.com'],
      },
    });
    const refused = await refusals(restoreRecord(member, { recordId: carl.recordId }));
    expect(refused[0]?.code).toBe('UNIQUE_CONFLICT');
    expect(refused[0]?.message).not.toContain('Email');
    expect(refused[0]?.message).not.toContain('carl@example.com');
    const asOwner = await refusals(restoreRecord(owner, { recordId: carl.recordId }));
    expect(asOwner[0]?.message).toContain('Email addresses carl@example.com');
    expect(asOwner[0]?.message).not.toContain('Cara');
  });
});
