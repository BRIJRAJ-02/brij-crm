// Milestone 2 of spec 0004: every type, options, defaults, required, unique,
// limits, history reads and batches, against a real Postgres.
import { setTimeout as delay } from 'node:timers/promises';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, type Database } from '@crm/db';
import type { EngineRefusal } from '@crm/contracts/values';
import {
  archiveAttribute,
  defineAttribute,
  defineObject,
  listAttributes,
  setObjectArchived,
  updateAttribute,
  updateObject,
} from './definitions.ts';
import { purgeDeleted } from './deletion.ts';
import { addEntry, defineList, getEntries, readEntriesById } from './lists.ts';
import { defineRelationship } from './relationships.ts';
import { canonicalKeys, newId } from './ids.ts';
import { getHistory, getTimeInStages, getValuesAsOf } from './history.ts';
import { defineOption, listOptions, updateOption } from './options.ts';
import { createRecord, getRecords, setValues, setValuesBatch } from './records.ts';
import { isRefusal } from './refusals.ts';
import { SYSTEM_ACTOR, type EngineScope } from './scope.ts';
import { createWorkspace } from './workspaces.ts';
import type { AfterWrite, Change } from './write.ts';
import { rescope, testScope } from '../testing.ts';

const { appUrl } = inject('testDatabase');
let db: Database;

beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-rules-tests' });
});
afterAll(async () => {
  await db.close();
});

let count = 0;
async function workspace(limits?: EngineScope['limits']) {
  count += 1;
  const created = await createWorkspace(db, {
    name: 'Rules',
    slug: `rules-${String(count)}-${String(Date.now())}`,
    firstMember: { name: 'Ada', email: 'ada@example.com' },
  });
  const scope = testScope({
    db,
    workspaceId: created.workspaceId,
    actor: { type: 'member', id: created.memberId },
    ...(limits === undefined ? {} : { limits }),
  });
  return { ...created, scope };
}

async function slugs(scope: EngineScope, objectId: string): Promise<Record<string, string>> {
  const rows = await db.withWorkspace(scope.workspaceId, (tx) =>
    tx.execute<{ id: string; api_slug: string }>(
      sql`select id, api_slug from attributes where object_id = ${objectId}`,
    ),
  );
  return Object.fromEntries(rows.rows.map((row) => [row.api_slug, row.id]));
}

async function optionIds(scope: EngineScope, attributeId: string): Promise<Record<string, string>> {
  const rows = await db.withWorkspace(scope.workspaceId, (tx) =>
    tx.execute<{ id: string; label: string }>(
      sql`select id, label from attribute_options where attribute_id = ${attributeId}`,
    ),
  );
  return Object.fromEntries(rows.rows.map((row) => [row.label, row.id]));
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

const id = (value: string | undefined): string => {
  if (value === undefined) throw new Error('Missing id.');
  return value;
};

describe('every type', () => {
  it('stores and reads back each value as its schema parses it (AC-2)', async () => {
    const { scope, memberId } = await workspace();
    const { objectId } = await defineObject(scope, {
      apiSlug: 'samples',
      singularName: 'Sample',
      pluralName: 'Samples',
      icon: 'box',
      hue: 'gray',
    });
    const types = [
      ['long_text', 'long_text', {}],
      ['number', 'number', {}],
      ['currency', 'currency', { config: { defaultCurrency: 'EUR' } }],
      ['date', 'date', {}],
      ['checkbox', 'checkbox', {}],
      ['select', 'select', { isMulti: true }],
      ['status', 'status', {}],
      ['rating', 'rating', {}],
      ['email', 'email', { isMulti: true }],
      ['phone', 'phone', {}],
      ['domain', 'domain', {}],
      ['url', 'url', {}],
      ['location', 'location', {}],
      ['personal_name', 'personal_name', {}],
      ['actor_reference', 'actor_reference', {}],
      ['file', 'file', {}],
    ] as const;
    const ids: Record<string, string> = {};
    for (const [slug, type, extra] of types) {
      ids[slug] = (await defineAttribute(scope, { objectId, apiSlug: slug, title: slug, type, ...extra })).attributeId;
    }
    const red = (await defineOption(scope, { attributeId: id(ids.select), label: 'Red', hue: 'red' })).optionId;
    const blue = (await defineOption(scope, { attributeId: id(ids.select), label: 'Blue', hue: 'blue' })).optionId;
    const open = (await defineOption(scope, { attributeId: id(ids.status), label: 'Open', hue: 'sky' })).optionId;
    const input: Record<string, unknown> = {
      long_text: 'Line one\nLine two',
      number: '0012.50',
      currency: { amount: '1999.9', currency: 'EUR' },
      date: '2026-10-08',
      checkbox: true,
      select: [blue, red],
      status: open,
      rating: 4,
      email: ['ADA@Example.com', 'b@example.com'],
      phone: { number: '+447700900123', country: 'GB' },
      domain: 'Example.com',
      url: 'https://example.com/a?b=1',
      location: { locality: 'London', countryCode: 'gb' },
      personal_name: { firstName: 'Ada', lastName: 'Lovelace' },
      actor_reference: { type: 'member', id: memberId },
      file: { fileId: 'file_1', name: 'deck.pdf', size: 1024, contentType: 'application/pdf' },
    };
    const { recordId } = await createRecord(scope, {
      objectId,
      values: Object.fromEntries(Object.entries(input).map(([slug, value]) => [id(ids[slug]), value])),
    });
    const [record] = await getRecords(scope, { ids: [recordId] });
    const read = (slug: string) => record?.values[id(ids[slug])];
    expect(read('number')).toBe('12.5');
    expect(read('currency')).toEqual({ amount: '1999.9', currency: 'EUR' });
    expect(read('date')).toBe('2026-10-08');
    expect(read('checkbox')).toBe(true);
    expect(read('select')).toEqual([blue, red]);
    expect(read('status')).toBe(open);
    expect(read('rating')).toBe(4);
    expect(read('email')).toEqual(['ada@example.com', 'b@example.com']);
    expect(read('phone')).toEqual({ number: '+447700900123', country: 'GB' });
    expect(read('domain')).toBe('example.com');
    expect(read('location')).toMatchObject({ locality: 'London', countryCode: 'GB' });
    expect(read('personal_name')).toEqual({ firstName: 'Ada', lastName: 'Lovelace', fullName: 'Ada Lovelace' });
    expect(read('actor_reference')).toEqual({ type: 'member', id: memberId });
    expect(read('file')).toEqual(input.file);
    expect(read('long_text')).toBe('Line one\nLine two');

    // Unchecking stores nothing: unchecked has no row.
    await setValues(scope, { recordId, values: { [id(ids.checkbox)]: { value: false } } });
    const [after] = await getRecords(scope, { ids: [recordId] });
    expect(after?.values[id(ids.checkbox)]).toBe(false);
  });

  it('refuses a currency attribute without its default currency, and a default the type cannot take', async () => {
    const { scope, objects } = await workspace();
    const objectId = id(objects.people);
    expect(
      (await refusals(defineAttribute(scope, { objectId, apiSlug: 'money', title: 'Money', type: 'currency' })))[0]
        ?.code,
    ).toBe('CONFIG_INVALID');
    expect(
      (
        await refusals(
          defineAttribute(scope, {
            objectId,
            apiSlug: 'when',
            title: 'When',
            type: 'text',
            defaultValue: { kind: 'offset', duration: 'P1M' },
          }),
        )
      )[0]?.code,
    ).toBe('CONFIG_INVALID');
  });
});

describe('options', () => {
  it('renames, reorders and archives an option without touching a value row (AC-4)', async () => {
    const { scope, objects } = await workspace();
    const deals = await slugs(scope, id(objects.deals));
    const stage = id(deals.stage);
    const stages = await optionIds(scope, stage);
    const created = await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        createRecord(scope, { objectId: id(objects.deals), values: { [id(deals.name)]: `Deal ${String(index)}` } }),
      ),
    );
    const before = await db.withWorkspace(scope.workspaceId, (tx) =>
      tx.execute<{ n: number; latest: string }>(
        sql`select count(*)::int as n, max(active_from)::text as latest from "values"`,
      ),
    );
    await updateOption(scope, { optionId: id(stages.Lead), label: 'New lead', hue: 'purple', position: 3 });
    await updateOption(scope, { optionId: id(stages['In progress']), archived: true });
    const after = await db.withWorkspace(scope.workspaceId, (tx) =>
      tx.execute<{ n: number; latest: string }>(
        sql`select count(*)::int as n, max(active_from)::text as latest from "values"`,
      ),
    );
    expect(after.rows[0]).toEqual(before.rows[0]);

    const order = await db.withWorkspace(scope.workspaceId, (tx) =>
      tx.execute<{ label: string }>(
        sql`select label from attribute_options where attribute_id = ${stage} order by position`,
      ),
    );
    expect(order.rows.map((row) => row.label)).toEqual(['In progress', 'Won', 'Lost', 'New lead']);

    const recordId = id(created[0]?.recordId);
    const refused = await refusals(
      setValues(scope, { recordId, values: { [stage]: { value: stages['In progress'] } } }),
    );
    expect(refused[0]?.code).toBe('OPTION_ARCHIVED');
  });
});

describe('defaults and required', () => {
  it('fills a deal with its first stage and its creator, and refuses one with no name (AC-11)', async () => {
    const { scope, objects, memberId } = await workspace();
    const deals = await slugs(scope, id(objects.deals));
    const stages = await optionIds(scope, id(deals.stage));
    const missing = await refusals(createRecord(scope, { objectId: id(objects.deals) }));
    expect(missing.map((refusal) => [refusal.code, refusal.attributeId])).toEqual([['VALUE_REQUIRED', deals.name]]);

    const { recordId } = await createRecord(scope, {
      objectId: id(objects.deals),
      values: { [id(deals.name)]: 'Big deal' },
    });
    const [record] = await getRecords(scope, { ids: [recordId] });
    expect(record?.values[id(deals.stage)]).toBe(stages.Lead);
    expect(record?.values[id(deals.owner)]).toEqual({ type: 'member', id: memberId });

    const cleared = await refusals(setValues(scope, { recordId, values: { [id(deals.name)]: { value: null } } }));
    expect(cleared[0]?.code).toBe('VALUE_REQUIRED');
  });

  it('keeps creating deals when the default stage is archived, from the next live stage (AC-4, AC-11)', async () => {
    const { scope, objects } = await workspace();
    const dealsObject = id(objects.deals);
    const deals = await slugs(scope, dealsObject);
    const stage = id(deals.stage);
    const stages = await optionIds(scope, stage);
    const newDeal = async () => {
      const { recordId } = await createRecord(scope, { objectId: dealsObject, values: { [id(deals.name)]: 'Deal' } });
      const [record] = await getRecords(scope, { ids: [recordId] });
      return record?.values[stage];
    };
    await updateOption(scope, { optionId: id(stages.Lead), archived: true });
    expect(await newDeal()).toBe(stages['In progress']);
    await updateOption(scope, { optionId: id(stages.Lead), archived: false });
    expect(await newDeal()).toBe(stages.Lead);

    // An optional select whose default option is archived just starts empty.
    const { attributeId: tier } = await defineAttribute(scope, {
      objectId: dealsObject,
      apiSlug: 'tier',
      title: 'Tier',
      type: 'select',
    });
    const gold = (await defineOption(scope, { attributeId: tier, label: 'Gold', hue: 'yellow' })).optionId;
    await defineOption(scope, { attributeId: tier, label: 'Silver', hue: 'gray' });
    await updateAttribute(scope, { attributeId: tier, defaultValue: { kind: 'static', value: gold } });
    await updateOption(scope, { optionId: gold, archived: true });
    const { recordId } = await createRecord(scope, { objectId: dealsObject, values: { [id(deals.name)]: 'Deal' } });
    const [record] = await getRecords(scope, { ids: [recordId] });
    expect(record?.values[tier]).toBeNull();
    expect((await listOptions(scope, tier)).find((option) => option.id === gold)?.archived).toBe(true);
  });

  it("applies a date offset in the creator's time zone, and leaves old empty records alone when made required", async () => {
    const { scope, objects } = await workspace();
    const objectId = id(objects.companies);
    const { attributeId } = await defineAttribute(scope, {
      objectId,
      apiSlug: 'renewal',
      title: 'Renewal',
      type: 'date',
      defaultValue: { kind: 'offset', duration: 'P1M' },
    });
    const { recordId: empty } = await createRecord(scope, { objectId, values: { [attributeId]: null } });
    const { recordId } = await createRecord(scope, { objectId, timeZone: 'Pacific/Kiritimati' });
    const [record] = await getRecords(scope, { ids: [recordId] });
    const expected = await db.withWorkspace(scope.workspaceId, (tx) =>
      tx.execute<{ day: string }>(
        sql`select ((now() at time zone 'Pacific/Kiritimati') + interval 'P1M')::date::text as day`,
      ),
    );
    expect(record?.values[attributeId]).toBe(expected.rows[0]?.day);

    await updateAttribute(scope, { attributeId, isRequired: true });
    const [old] = await getRecords(scope, { ids: [empty] });
    expect(old?.values[attributeId]).toBeNull();
  });
});

describe('unique', () => {
  it('refuses the second of two concurrent writes of one email (AC-10)', async () => {
    const { scope, objects } = await workspace();
    const people = await slugs(scope, id(objects.people));
    const email = id(people.email_addresses);
    const results = await Promise.allSettled([
      createRecord(scope, { objectId: id(objects.people), values: { [email]: ['same@example.com'] } }),
      createRecord(scope, { objectId: id(objects.people), values: { [email]: ['SAME@example.com'] } }),
    ]);
    const rejected = results.filter((result) => result.status === 'rejected');
    expect(rejected).toHaveLength(1);
    const reason: unknown = rejected[0]?.status === 'rejected' ? rejected[0].reason : undefined;
    expect(isRefusal(reason) ? reason.refusal.code : reason).toBe('UNIQUE_CONFLICT');
    // One sentence that reads the same for any title, a plural one included.
    expect(isRefusal(reason) ? reason.refusal.message : reason).toBe(
      'Another record already has this value for Email addresses.',
    );
  });

  it('refuses turning Unique on over duplicates, and frees keys when turned off or archived', async () => {
    const { scope, objects } = await workspace();
    const objectId = id(objects.companies);
    const { attributeId } = await defineAttribute(scope, { objectId, apiSlug: 'code', title: 'Code', type: 'text' });
    await createRecord(scope, { objectId, values: { [attributeId]: 'ABC' } });
    await createRecord(scope, { objectId, values: { [attributeId]: 'abc ' } });
    const refused = await refusals(updateAttribute(scope, { attributeId, isUnique: true }));
    expect(refused[0]?.code).toBe('UNIQUE_HAS_DUPLICATES');
    expect(refused[0]?.message).toContain('abc (2 records)');

    const { attributeId: other } = await defineAttribute(scope, {
      objectId,
      apiSlug: 'ref',
      title: 'Ref',
      type: 'text',
      isUnique: true,
    });
    await createRecord(scope, { objectId, values: { [other]: 'R1' } });
    expect((await refusals(createRecord(scope, { objectId, values: { [other]: 'r1' } })))[0]?.code).toBe(
      'UNIQUE_CONFLICT',
    );
    await updateAttribute(scope, { attributeId: other, isUnique: false });
    await createRecord(scope, { objectId, values: { [other]: 'r1' } });
    const keys = await db.withWorkspace(scope.workspaceId, (tx) =>
      tx.execute<{ n: number }>(
        sql`select count(*)::int as n from "values" where attribute_id = ${other} and unique_key is not null`,
      ),
    );
    expect(keys.rows[0]?.n).toBe(0);

    const { attributeId: third } = await defineAttribute(scope, {
      objectId,
      apiSlug: 'tag',
      title: 'Tag',
      type: 'text',
      isUnique: true,
    });
    await createRecord(scope, { objectId, values: { [third]: 'T' } });
    await archiveAttribute(scope, third);
    const held = await db.withWorkspace(scope.workspaceId, (tx) =>
      tx.execute<{ n: number }>(
        sql`select count(*)::int as n from "values" where attribute_id = ${third} and unique_key is not null`,
      ),
    );
    expect(held.rows[0]?.n).toBe(0);
  });
});

describe('unique against definition changes', () => {
  /** Runs a definition change that waits inside its transaction, holding its locks, until released. */
  async function paused(start: (hook: AfterWrite) => Promise<unknown>) {
    const entered = Promise.withResolvers<undefined>();
    const release = Promise.withResolvers<undefined>();
    const done = start(async () => {
      entered.resolve(undefined);
      await release.promise;
    });
    await entered.promise;
    return {
      release: () => {
        release.resolve(undefined);
      },
      done,
    };
  }

  /** Whether a save is still waiting after a moment. */
  async function waiting(save: Promise<unknown>): Promise<boolean> {
    const state = await Promise.race([
      save.then(
        () => 'settled',
        () => 'settled',
      ),
      delay(300).then(() => 'waiting'),
    ]);
    return state === 'waiting';
  }

  it('makes a save wait while Unique is turned on, then checks it against the new keys (AC-10)', async () => {
    const { scope, objects } = await workspace();
    const objectId = id(objects.companies);
    const { attributeId } = await defineAttribute(scope, { objectId, apiSlug: 'code', title: 'Code', type: 'text' });
    await createRecord(scope, { objectId, values: { [attributeId]: 'A1' } });
    const { recordId } = await createRecord(scope, { objectId });

    const change = await paused((hook) => updateAttribute(scope, { attributeId, isUnique: true }, [hook]));
    const save = setValues(scope, { recordId, values: { [attributeId]: { value: 'a1' } } });
    expect(await waiting(save)).toBe(true);
    change.release();
    await change.done;
    expect((await refusals(save))[0]?.code).toBe('UNIQUE_CONFLICT');
    const unkeyed = await db.withWorkspace(scope.workspaceId, (tx) =>
      tx.execute<{ n: number }>(
        sql`select count(*)::int as n from "values" where attribute_id = ${attributeId} and active_until is null and not is_cleared and unique_key is null`,
      ),
    );
    expect(unkeyed.rows[0]?.n).toBe(0);
  });

  it('makes a save wait while a unique attribute is archived, then refuses it (AC-10)', async () => {
    const { scope, objects } = await workspace();
    const objectId = id(objects.companies);
    const { attributeId } = await defineAttribute(scope, {
      objectId,
      apiSlug: 'ref',
      title: 'Ref',
      type: 'text',
      isUnique: true,
    });
    const { recordId } = await createRecord(scope, { objectId });

    const change = await paused((hook) => archiveAttribute(scope, attributeId, [hook]));
    const save = setValues(scope, { recordId, values: { [attributeId]: { value: 'R1' } } });
    expect(await waiting(save)).toBe(true);
    change.release();
    await change.done;
    expect((await refusals(save))[0]?.code).toBe('ATTRIBUTE_READ_ONLY');
    const keyed = await db.withWorkspace(scope.workspaceId, (tx) =>
      tx.execute<{ n: number }>(
        sql`select count(*)::int as n from "values" where attribute_id = ${attributeId} and unique_key is not null`,
      ),
    );
    expect(keyed.rows[0]?.n).toBe(0);
  });
});

describe('actor values', () => {
  it("refuses a member who isn't in this workspace, one record at a time in a batch (AC-13)", async () => {
    const { scope, objects, memberId } = await workspace();
    const elsewhere = await workspace();
    const dealsObject = id(objects.deals);
    const deals = await slugs(scope, dealsObject);
    const owner = id(deals.owner);
    const [first, second] = await Promise.all(
      ['A', 'B'].map((name) => createRecord(scope, { objectId: dealsObject, values: { [id(deals.name)]: name } })),
    );
    const firstId = id(first?.recordId);
    const secondId = id(second?.recordId);
    for (const stranger of [elsewhere.memberId, newId(), 'not-a-member']) {
      const refused = await refusals(
        setValues(scope, { recordId: firstId, values: { [owner]: { value: { type: 'member', id: stranger } } } }),
      );
      expect(refused.map((refusal) => [refusal.code, refusal.attributeId])).toEqual([
        ['ATTRIBUTE_VALUE_INVALID', owner],
      ]);
    }
    const results = await setValuesBatch(scope, {
      items: [
        { recordId: firstId, values: { [owner]: { value: { type: 'member', id: elsewhere.memberId } } } },
        { recordId: secondId, values: { [owner]: { value: { type: 'member', id: memberId } } } },
      ],
    });
    expect(results.map((result) => result.ok)).toEqual([false, true]);
  });

  it('refuses an API key, an automation or the system from a member, malformed ids one record at a time (AC-13)', async () => {
    const { scope, objects, memberId } = await workspace();
    const companiesObject = id(objects.companies);
    const companies = await slugs(scope, companiesObject);
    const owner = id(companies.owner);
    const created = await Promise.all(
      ['A', 'B', 'C'].map((name) =>
        createRecord(scope, { objectId: companiesObject, values: { [id(companies.name)]: name } }),
      ),
    );
    const [first, second, third] = created.map((each) => each.recordId);
    const set = (actor: unknown) => ({ [owner]: { value: actor } });
    for (const actor of [
      { type: 'system', id: null },
      { type: 'api_key', id: newId() },
      { type: 'automation', id: newId() },
    ]) {
      const refused = await refusals(setValues(scope, { recordId: id(first), values: set(actor) }));
      expect(refused.map((refusal) => [refusal.code, refusal.attributeId])).toEqual([
        ['ATTRIBUTE_VALUE_INVALID', owner],
      ]);
    }
    // A malformed id is refused before it reaches the uuid column, so the batch goes on without that record.
    const results = await setValuesBatch(scope, {
      items: [
        { recordId: id(first), values: set({ type: 'member', id: memberId }) },
        { recordId: id(second), values: set({ type: 'api_key', id: 'not-a-uuid' }) },
        { recordId: id(third), values: set({ type: 'member', id: memberId }) },
      ],
    });
    expect(results.map((result) => (result.ok ? 'ok' : result.refusals[0]?.code))).toEqual([
      'ok',
      'ATTRIBUTE_VALUE_INVALID',
      'ok',
    ]);
    const records = await getRecords(scope, { ids: [id(first), id(second), id(third)] });
    expect(records.map((record) => record.values[owner])).toEqual([
      { type: 'member', id: memberId },
      null,
      { type: 'member', id: memberId },
    ]);

    // An API key may name itself (a record it made), and only itself.
    const key = newId();
    const asKey: EngineScope = rescope(scope, { actor: { type: 'api_key', id: key } });
    await setValues(asKey, { recordId: id(second), values: set({ type: 'api_key', id: key }) });
    expect((await getRecords(scope, { ids: [id(second)] }))[0]?.values[owner]).toEqual({ type: 'api_key', id: key });
    const other = await refusals(
      setValues(asKey, { recordId: id(third), values: set({ type: 'api_key', id: newId() }) }),
    );
    expect(other.map((refusal) => refusal.code)).toEqual(['ATTRIBUTE_VALUE_INVALID']);
  });

  it('lets only the system write an interaction or a timestamp, checking its by like an actor value (AC-13)', async () => {
    const { scope, objects, memberId } = await workspace();
    const elsewhere = await workspace();
    const asSystem: EngineScope = rescope(scope, { actor: SYSTEM_ACTOR });
    const companiesObject = id(objects.companies);
    const companies = await slugs(scope, companiesObject);
    const { attributeId: touch } = await defineAttribute(scope, {
      objectId: companiesObject,
      apiSlug: 'last_touch',
      title: 'Last touch',
      type: 'interaction',
    });
    const { attributeId: seen } = await defineAttribute(scope, {
      objectId: companiesObject,
      apiSlug: 'last_seen',
      title: 'Last seen',
      type: 'timestamp',
    });
    const { recordId } = await createRecord(scope, {
      objectId: companiesObject,
      values: { [id(companies.name)]: 'A' },
    });
    const by = (actor: unknown) => ({
      [touch]: { value: { kind: 'email', at: '2026-10-01T09:30:00.000Z', by: actor } },
    });

    // A member never writes either type, whoever the interaction names, on a create or a save.
    for (const actor of [
      { type: 'member', id: memberId },
      { type: 'system', id: null },
    ]) {
      const refused = await refusals(setValues(scope, { recordId, values: by(actor) }));
      expect(refused.map((refusal) => [refusal.code, refusal.attributeId])).toEqual([['ATTRIBUTE_READ_ONLY', touch]]);
    }
    const stamp = { [seen]: { value: '2026-10-01T09:30:00.000Z' } };
    expect((await refusals(setValues(scope, { recordId, values: stamp }))).map((refusal) => refusal.code)).toEqual([
      'ATTRIBUTE_READ_ONLY',
    ]);
    const created = await refusals(
      createRecord(scope, {
        objectId: companiesObject,
        values: { [id(companies.name)]: 'B', [seen]: '2026-10-01T09:30:00.000Z' },
      }),
    );
    expect(created.map((refusal) => [refusal.code, refusal.attributeId])).toEqual([['ATTRIBUTE_READ_ONLY', seen]]);

    // The system does, and its by is checked: an active member of this workspace, or the system itself.
    for (const actor of [
      { type: 'member', id: elsewhere.memberId },
      { type: 'member', id: newId() },
      { type: 'member', id: 'not-a-uuid' },
      { type: 'api_key', id: newId() },
    ]) {
      const refused = await refusals(setValues(asSystem, { recordId, values: by(actor) }));
      expect(refused.map((refusal) => [refusal.code, refusal.attributeId])).toEqual([
        ['ATTRIBUTE_VALUE_INVALID', touch],
      ]);
    }
    await setValues(asSystem, { recordId, values: by({ type: 'member', id: memberId }) });
    expect((await getRecords(scope, { ids: [recordId] }))[0]?.values[touch]).toMatchObject({
      by: { type: 'member', id: memberId },
    });
    await setValues(asSystem, { recordId, values: { ...by({ type: 'system', id: null }), ...stamp } });
    const [record] = await getRecords(scope, { ids: [recordId] });
    expect(record?.values[touch]).toMatchObject({ by: { type: 'system', id: null } });
    expect(record?.values[seen]).toBe('2026-10-01T09:30:00.000Z');
  });

  it("fills a timestamp's default for a member's create: a default is the system's", async () => {
    const { scope, objects } = await workspace();
    const companiesObject = id(objects.companies);
    const companies = await slugs(scope, companiesObject);
    const { attributeId: due } = await defineAttribute(scope, {
      objectId: companiesObject,
      apiSlug: 'follow_up',
      title: 'Follow up',
      type: 'timestamp',
      defaultValue: { kind: 'offset', duration: 'P7D' },
    });
    const { recordId } = await createRecord(scope, {
      objectId: companiesObject,
      values: { [id(companies.name)]: 'A' },
    });
    const [record] = await getRecords(scope, { ids: [recordId] });
    expect(typeof record?.values[due]).toBe('string');
  });
});

describe('limits', () => {
  it('leaves exactly one of two concurrent creates at the record limit (AC-16)', async () => {
    const { scope, objects } = await workspace({ liveRecords: 1 });
    const results = await Promise.allSettled([
      createRecord(scope, { objectId: id(objects.companies) }),
      createRecord(scope, { objectId: id(objects.companies) }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const reason: unknown = results.find((result) => result.status === 'rejected')?.reason;
    expect(isRefusal(reason) ? reason.refusal.code : reason).toBe('LIMIT_REACHED');
  });

  it('refuses a custom object, an attribute and an option past their limits', async () => {
    const { scope, objects } = await workspace({ customObjects: 0, attributesPerParent: 0, optionsPerAttribute: 4 });
    const look = { icon: 'box', hue: 'gray' } as const;
    expect(
      (
        await refusals(defineObject(scope, { apiSlug: 'extra', singularName: 'Extra', pluralName: 'Extras', ...look }))
      )[0]?.code,
    ).toBe('LIMIT_REACHED');
    expect(
      (
        await refusals(
          defineAttribute(scope, { objectId: id(objects.people), apiSlug: 'more', title: 'More', type: 'text' }),
        )
      )[0]?.code,
    ).toBe('LIMIT_REACHED');
    const deals = await slugs(scope, id(objects.deals));
    expect(
      (await refusals(defineOption(scope, { attributeId: id(deals.stage), label: 'Fifth', hue: 'gray' })))[0]?.code,
    ).toBe('LIMIT_REACHED');
  });
});

describe('history', () => {
  it('lists every version, reads values as of a moment, and counts every visit to each stage (AC-3)', async () => {
    const { scope, objects } = await workspace();
    const deals = await slugs(scope, id(objects.deals));
    const stage = id(deals.stage);
    const stages = await optionIds(scope, stage);
    const { recordId } = await createRecord(scope, {
      objectId: id(objects.deals),
      values: { [id(deals.name)]: 'Alpha' },
    });
    const moment = await db.withWorkspace(scope.workspaceId, (tx) =>
      tx.execute<{ at: string }>(
        sql`select to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as at`,
      ),
    );
    await new Promise((resolve) => setTimeout(resolve, 5));
    await setValues(scope, {
      recordId,
      values: { [stage]: { value: stages['In progress'] }, [id(deals.name)]: { value: 'Beta' } },
    });
    await setValues(scope, { recordId, values: { [stage]: { value: stages.Lead } } });

    const names = await getHistory(scope, { recordId, attributeId: id(deals.name) });
    expect(names.map((version) => version.value)).toEqual(['Alpha', 'Beta']);
    expect(names[0]?.activeUntil).toBe(names[1]?.activeFrom);
    expect(names[1]?.setBy).toEqual(scope.actor);

    const past = await getValuesAsOf(scope, { recordId, at: moment.rows[0]?.at ?? '' });
    expect(past[id(deals.name)]).toBe('Alpha');
    expect(past[stage]).toBe(stages.Lead);

    const visits = await getTimeInStages(scope, { recordId, attributeId: stage });
    const lead = visits.find((entry) => entry.optionId === stages.Lead);
    expect(lead?.visits).toHaveLength(2);
    expect(lead?.visits[1]?.leftAt).toBeNull();
    expect(visits.find((entry) => entry.optionId === stages['In progress'])?.visits).toHaveLength(1);
  });
});

describe('batches', () => {
  it('writes the good records, lists the bad ones, and shows the hooks only what landed (AC-13)', async () => {
    const { scope, objects } = await workspace();
    const people = await slugs(scope, id(objects.people));
    const email = id(people.email_addresses);
    const ids = await Promise.all(
      Array.from({ length: 5 }, () => createRecord(scope, { objectId: id(objects.people) })),
    );
    const seen: Change[] = [];
    const watch: AfterWrite = (change) => {
      seen.push(change);
      return Promise.resolve();
    };
    const results = await setValuesBatch(
      scope,
      {
        items: ids.map(({ recordId }, index) => ({
          recordId,
          values: { [email]: { value: [index % 2 === 0 ? `p${String(index)}@example.com` : 'not an email'] } },
        })),
      },
      [watch],
    );
    expect(results.map((result) => result.ok)).toEqual([true, false, true, false, true]);
    expect(seen[0]?.values.map((value) => value.ownerId)).toEqual([
      ids[0]?.recordId,
      ids[2]?.recordId,
      ids[4]?.recordId,
    ]);
    const written = await db.withWorkspace(scope.workspaceId, (tx) =>
      tx.execute<{ n: number }>(sql`select count(*)::int as n from "values" where attribute_id = ${email}`),
    );
    expect(written.rows[0]?.n).toBe(3);
  });
});

describe('malformed ids', () => {
  it('refuses a malformed id at every write and history read as not found, before it reaches Postgres', async () => {
    const { scope, objects } = await workspace();
    const deals = await slugs(scope, id(objects.deals));
    const { recordId } = await createRecord(scope, { objectId: id(objects.deals), values: { [id(deals.name)]: 'D' } });
    for (const attempt of [
      () => createRecord(scope, { objectId: 'x' }),
      () => defineList(scope, { objectId: 'x', apiSlug: 'pipeline', name: 'Pipeline' }),
      () => defineAttribute(scope, { objectId: 'x', apiSlug: 'notes', title: 'Notes', type: 'text' }),
      () => defineAttribute(scope, { listId: 'x', apiSlug: 'notes', title: 'Notes', type: 'text' }),
      () => defineOption(scope, { attributeId: 'x', label: 'One', hue: 'red' }),
      () => updateAttribute(scope, { attributeId: 'x', title: 'Renamed' }),
      () => archiveAttribute(scope, 'x'),
      () => updateObject(scope, { objectId: 'x', singularName: 'Thing' }),
      () => setObjectArchived(scope, { objectId: 'x', archived: true }),
      () => updateOption(scope, { optionId: 'x', label: 'Renamed' }),
      () =>
        defineRelationship(scope, {
          cardinality: 'many_to_many',
          from: { objectId: id(objects.deals), apiSlug: 'refs', title: 'Refs' },
          targetObjectIds: ['x'],
        }),
      () => getHistory(scope, { recordId, attributeId: 'x' }),
      () => getTimeInStages(scope, { recordId, attributeId: 'x' }),
    ]) {
      expect((await refusals(attempt())).map((refusal) => refusal.code)).toEqual(['NOT_FOUND']);
    }
  });

  it('leaves malformed ids out of reads by id, as it leaves out missing ones', async () => {
    const { scope, objects } = await workspace();
    const deals = await slugs(scope, id(objects.deals));
    const { recordId } = await createRecord(scope, { objectId: id(objects.deals), values: { [id(deals.name)]: 'D' } });
    const read = await getRecords(scope, { ids: ['x', recordId], attributeIds: ['x', id(deals.name)] });
    expect(read.map((record) => [record.id, Object.keys(record.values)])).toEqual([[recordId, [id(deals.name)]]]);
    expect(await getRecords(scope, { ids: ['x'] })).toEqual([]);
    expect(await getEntries(scope, { ids: ['x'] })).toEqual([]);
    expect(await listAttributes(scope, 'x')).toEqual([]);
    expect(await listOptions(scope, 'x')).toEqual([]);
  });

  it('refuses malformed option and record ids inside a value, naming the attribute, one record at a time', async () => {
    const { scope, objects } = await workspace();
    const deals = await slugs(scope, id(objects.deals));
    const companiesObject = id(objects.companies);
    const companies = await slugs(scope, companiesObject);
    const parent = id(companies.parent_company);
    const { recordId: deal } = await createRecord(scope, {
      objectId: id(objects.deals),
      values: { [id(deals.name)]: 'D' },
    });
    for (const [attributeId, value] of [
      [id(deals.stage), 'x'],
      [id(deals.source), 'x'],
      [id(deals.associated_company), { objectId: companiesObject, recordId: 'x' }],
      [id(deals.associated_company), { objectId: 'x', recordId: newId() }],
    ] as const) {
      const refused = await refusals(setValues(scope, { recordId: deal, values: { [attributeId]: { value } } }));
      expect(refused.map((refusal) => [refusal.code, refusal.attributeId])).toEqual([
        ['ATTRIBUTE_VALUE_INVALID', attributeId],
      ]);
    }

    // In a batch, the record with the malformed link is refused and the others land.
    const company = async (name: string) =>
      (await createRecord(scope, { objectId: companiesObject, values: { [id(companies.name)]: name } })).recordId;
    const holding = await company('Holding');
    const children = [await company('A'), await company('B'), await company('C')];
    const results = await setValuesBatch(scope, {
      items: children.map((recordId, index) => ({
        recordId,
        values: { [parent]: { value: { objectId: companiesObject, recordId: index === 1 ? 'not-a-uuid' : holding } } },
      })),
    });
    expect(results.map((result) => (result.ok ? 'ok' : result.refusals[0]?.code))).toEqual([
      'ok',
      'ATTRIBUTE_VALUE_INVALID',
      'ok',
    ]);
    const read = await getRecords(scope, { ids: children, attributeIds: [parent] });
    expect(read.map((record) => record.values[parent])).toEqual([
      { objectId: companiesObject, recordId: holding },
      null,
      { objectId: companiesObject, recordId: holding },
    ]);
  });
});

describe('upper case ids', () => {
  it('refuses a record as its own parent however its id is spelt', async () => {
    const { scope, objects } = await workspace();
    const companiesObject = id(objects.companies);
    const companies = await slugs(scope, companiesObject);
    const parent = id(companies.parent_company);
    const { recordId: acme } = await createRecord(scope, {
      objectId: companiesObject,
      values: { [id(companies.name)]: 'Acme' },
    });
    for (const [owner, target] of [
      [acme.toUpperCase(), acme],
      [acme, acme.toUpperCase()],
      [acme.toUpperCase(), acme.toUpperCase()],
    ] as const) {
      const refused = await refusals(
        setValues(scope, {
          recordId: owner,
          values: { [parent]: { value: { objectId: companiesObject.toUpperCase(), recordId: target } } },
        }),
      );
      expect(refused.map((refusal) => [refusal.code, refusal.attributeId])).toEqual([
        ['ATTRIBUTE_VALUE_INVALID', parent],
      ]);
    }
    const [read] = await getRecords(scope, { ids: [acme], attributeIds: [parent] });
    expect(read?.values[parent]).toBeNull();
  });

  it('writes an upper case id as the lower case one: in the change, the batch result and unchanged values', async () => {
    const { scope, objects } = await workspace();
    const companiesObject = id(objects.companies);
    const companies = await slugs(scope, companiesObject);
    const deals = await slugs(scope, id(objects.deals));
    const stages = await optionIds(scope, id(deals.stage));
    const lead = id(stages.Lead);
    const { recordId: acme } = await createRecord(scope, {
      objectId: companiesObject,
      values: { [id(companies.name)]: 'Acme' },
    });
    const { recordId: holding } = await createRecord(scope, {
      objectId: companiesObject,
      values: { [id(companies.name)]: 'Holding' },
    });
    const seen: Change[] = [];
    const watch: AfterWrite = (change) => {
      seen.push(change);
      return Promise.resolve();
    };
    await setValues(
      scope,
      {
        recordId: acme.toUpperCase(),
        values: {
          [id(companies.name).toUpperCase()]: { value: 'Acme Ltd' },
          [id(companies.parent_company).toUpperCase()]: {
            value: { objectId: companiesObject.toUpperCase(), recordId: holding.toUpperCase() },
          },
        },
      },
      [watch],
    );
    const values = seen[0]?.values.map((value) => [value.ownerId, value.attributeId]);
    expect(values).toEqual([
      [acme, id(companies.name)],
      [acme, id(companies.parent_company)],
      [holding, id(companies.subsidiaries)],
    ]);
    expect(seen[0]?.values.every((value) => value.ownerKind === 'record' && value.objectId === companiesObject)).toBe(
      true,
    );

    // Reads by upper case ids come back in the order asked, with the canonical ids.
    const read = await getRecords(scope, { ids: [holding.toUpperCase(), acme.toUpperCase()] });
    expect(read.map((record) => record.id)).toEqual([holding, acme]);
    expect(read[1]?.values[id(companies.parent_company)]).toEqual({ objectId: companiesObject, recordId: holding });

    // Two spellings of one attribute in one write are refused, not silently merged.
    const twice = await refusals(
      setValues(scope, {
        recordId: acme,
        values: { [id(companies.name)]: { value: 'A' }, [id(companies.name).toUpperCase()]: { value: 'B' } },
      }),
    );
    expect(twice.map((refusal) => refusal.code)).toEqual(['CONFIG_INVALID']);

    // An option id in upper case is the stored option: writing it again in lower case changes nothing.
    const { recordId: deal } = await createRecord(scope, {
      objectId: id(objects.deals),
      values: { [id(deals.name)]: 'Deal' },
    });
    const [batch] = await setValuesBatch(scope, {
      items: [{ recordId: deal.toUpperCase(), values: { [id(deals.stage)]: { value: lead.toUpperCase() } } }],
    });
    expect(batch?.recordId).toBe(deal);
    const again = await setValues(scope, { recordId: deal, values: { [id(deals.stage)]: { value: lead } } });
    expect(again[id(deals.stage)]).toEqual({});
  });

  it("stores an interaction's by id in lower case, so the same actor in either spelling is no new version", async () => {
    const { scope, objects, memberId } = await workspace();
    const asSystem: EngineScope = rescope(scope, { actor: SYSTEM_ACTOR });
    const companiesObject = id(objects.companies);
    const companies = await slugs(scope, companiesObject);
    const { attributeId: touch } = await defineAttribute(scope, {
      objectId: companiesObject,
      apiSlug: 'last_touch',
      title: 'Last touch',
      type: 'interaction',
    });
    const { recordId } = await createRecord(scope, {
      objectId: companiesObject,
      values: { [id(companies.name)]: 'A' },
    });
    const touched = (memberIdSpelt: string) => ({
      [touch]: { value: { kind: 'email', at: '2026-10-01T09:30:00.000Z', by: { type: 'member', id: memberIdSpelt } } },
    });
    const first = await setValues(asSystem, { recordId, values: touched(memberId.toUpperCase()) });
    expect(first[touch]?.versionId).toBeTruthy();
    expect((await getRecords(scope, { ids: [recordId] }))[0]?.values[touch]).toEqual({
      kind: 'email',
      at: '2026-10-01T09:30:00.000Z',
      by: { type: 'member', id: memberId },
    });
    expect(await setValues(asSystem, { recordId, values: touched(memberId) })).toEqual({ [touch]: {} });
    expect(await setValues(asSystem, { recordId, values: touched(memberId.toUpperCase()) })).toEqual({ [touch]: {} });
  });

  it('reads a base version id in upper case as the version it names: no replaced version (AC-12)', async () => {
    const { scope, objects } = await workspace();
    const companiesObject = id(objects.companies);
    const companies = await slugs(scope, companiesObject);
    const name = id(companies.name);
    const parent = id(companies.parent_company);
    const make = async (title: string) =>
      (await createRecord(scope, { objectId: companiesObject, values: { [name]: title } })).recordId;
    const acme = await make('Acme');
    const holding = await make('Holding');
    const group = await make('Group');

    // A value: the edit started from the current version, spelt in upper case.
    const named = await setValues(scope, { recordId: acme, values: { [name]: { value: 'Acme Ltd' } } });
    const base = id(named[name]?.versionId);
    const renamed = await setValues(scope, {
      recordId: acme,
      values: { [name]: { value: 'Acme Group', baseVersionId: base.toUpperCase() } },
    });
    expect(renamed[name]?.versionId).toBeTruthy();
    expect(renamed[name]?.replaced).toBeUndefined();

    // A record reference, the same way.
    const linked = await setValues(scope, {
      recordId: acme,
      values: { [parent]: { value: { objectId: companiesObject, recordId: holding } } },
    });
    const linkBase = id(linked[parent]?.versionId);
    const relinked = await setValues(scope, {
      recordId: acme,
      values: {
        [parent]: { value: { objectId: companiesObject, recordId: group }, baseVersionId: linkBase.toUpperCase() },
      },
    });
    expect(relinked[parent]?.versionId).toBeTruthy();
    expect(relinked[parent]?.replaced).toBeUndefined();

    // An older version still reads as replaced, whatever its spelling.
    const stale = await setValues(scope, {
      recordId: acme,
      values: { [name]: { value: 'Acme Holdings', baseVersionId: base.toUpperCase() } },
    });
    expect(stale[name]?.replaced?.versionId).toBe(renamed[name]?.versionId);
  });

  it('reads entries by upper case ids with their canonical ids, in the order asked', async () => {
    const { scope, objects } = await workspace();
    const deals = await slugs(scope, id(objects.deals));
    const { listId } = await defineList(scope, {
      objectId: id(objects.deals),
      apiSlug: 'pipeline',
      name: 'Pipeline',
      allowsDuplicates: true,
    });
    const entries: string[] = [];
    for (const title of ['One', 'Two']) {
      const { recordId } = await createRecord(scope, {
        objectId: id(objects.deals),
        values: { [id(deals.name)]: title },
      });
      entries.push((await addEntry(scope, { listId, recordId })).entryId);
    }
    const [one, two] = entries.map((entry) => id(entry));
    const read = await getEntries(scope, { ids: [id(two).toUpperCase(), id(one).toUpperCase(), 'not-an-id'] });
    expect(read.map((entry) => entry.id).sort()).toEqual([id(one), id(two)].sort());
    const ordered = await db.withWorkspace(scope.workspaceId, (tx) =>
      readEntriesById(tx, [id(two).toUpperCase(), id(one).toUpperCase()]),
    );
    expect(ordered.map((entry) => entry.id)).toEqual([two, one]);
  });
});

describe('a __proto__ key', () => {
  it('stays an own key of the canonical map, never its prototype', () => {
    const attribute = newId();
    const given = JSON.parse(`{"__proto__": {"${attribute}": "x"}, "${attribute.toUpperCase()}": "y"}`) as Record<
      string,
      unknown
    >;
    const keys = canonicalKeys(given);
    expect(Object.getPrototypeOf(keys)).toBeNull();
    expect(Object.hasOwn(keys, '__proto__')).toBe(true);
    expect(Object.keys(keys).sort()).toEqual(['__proto__', attribute].sort());
    expect(keys[attribute]).toBe('y');
  });

  it('is refused as no attribute on a create and a save, and never hides a default or a required value', async () => {
    const { scope, objects } = await workspace();
    const companiesObject = id(objects.companies);
    const companies = await slugs(scope, companiesObject);
    const { attributeId: tier } = await defineAttribute(scope, {
      objectId: companiesObject,
      apiSlug: 'tier',
      title: 'Tier',
      type: 'text',
      defaultValue: { kind: 'static', value: 'Standard' },
    });
    const name = id(companies.name);
    // Parsed the way a request body is: `__proto__` is an own key, here naming the default attribute inside.
    const values = JSON.parse(`{"${name}": "Acme", "__proto__": {"${tier}": "Gold"}}`) as Record<string, unknown>;
    const created = await refusals(createRecord(scope, { objectId: companiesObject, values }));
    expect(created.map((refusal) => [refusal.code, refusal.attributeId])).toEqual([['NOT_FOUND', '__proto__']]);

    const { recordId } = await createRecord(scope, { objectId: companiesObject, values: { [name]: 'Acme' } });
    expect((await getRecords(scope, { ids: [recordId] }))[0]?.values[tier]).toBe('Standard');
    const saved = await refusals(
      setValues(scope, {
        recordId,
        values: JSON.parse(`{"__proto__": {"value": "x"}}`) as Record<string, { value: unknown }>,
      }),
    );
    expect(saved.map((refusal) => [refusal.code, refusal.attributeId])).toEqual([['NOT_FOUND', '__proto__']]);
  });
});

describe('moments and timestamp defaults', () => {
  it('reads values as of a full ISO instant with its zone, and refuses anything less', async () => {
    const { scope, objects } = await workspace();
    const deals = await slugs(scope, id(objects.deals));
    const { recordId } = await createRecord(scope, {
      objectId: id(objects.deals),
      values: { [id(deals.name)]: 'Alpha' },
    });
    for (const at of ['2026', '2026-10', '+002026-10-01T00:00:00Z', '2026-10-01T00:00:00', '0000-01-01T00:00:00Z']) {
      expect((await refusals(getValuesAsOf(scope, { recordId, at })))[0]?.code, at).toBe('CONFIG_INVALID');
      expect((await refusals(purgeDeleted(scope, { cutoff: at })))[0]?.code, at).toBe('CONFIG_INVALID');
    }
    // An offset names the same instant as its UTC form.
    const later = new Date(Date.now() + 60 * 60 * 1000);
    const local = `${later.toISOString().slice(0, 19)}+00:00`;
    expect((await getValuesAsOf(scope, { recordId, at: local }))[id(deals.name)]).toBe('Alpha');
    expect((await getValuesAsOf(scope, { recordId, at: '2000-01-01T01:00:00+01:00' }))[id(deals.name)]).toBe(undefined);
  });

  it('refuses a static default for a timestamp, a type only the system writes', async () => {
    const { scope, objects } = await workspace();
    const companiesObject = id(objects.companies);
    const refused = await refusals(
      defineAttribute(scope, {
        objectId: companiesObject,
        apiSlug: 'checked_at',
        title: 'Checked at',
        type: 'timestamp',
        defaultValue: { kind: 'static', value: '2026-10-01T09:30:00.000Z' },
      }),
    );
    expect(refused.map((refusal) => refusal.code)).toEqual(['CONFIG_INVALID']);
    const { attributeId } = await defineAttribute(scope, {
      objectId: companiesObject,
      apiSlug: 'checked_at',
      title: 'Checked at',
      type: 'timestamp',
    });
    expect(
      (
        await refusals(
          updateAttribute(scope, {
            attributeId,
            defaultValue: { kind: 'static', value: '2026-10-01T09:30:00.000Z' },
          }),
        )
      ).map((refusal) => refusal.code),
    ).toEqual(['CONFIG_INVALID']);
    await updateAttribute(scope, { attributeId, defaultValue: { kind: 'offset', duration: 'P1D' } });
  });
});
