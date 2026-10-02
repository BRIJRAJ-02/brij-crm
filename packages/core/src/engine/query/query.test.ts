// The query compiler against the reference evaluator (spec 0004, AC-6, AC-14):
// every operator each type offers, negatives matching empties, multi valued
// items, nested groups, filters through one and two relationships, relative
// dates in a time zone, every sort with empties last in both directions, list
// views over entry and record attributes, keyset paging, position jumps and
// the exact count.
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, type Database } from '@crm/db';
import type { FilterCondition, FilterGroup, SortRule } from '@crm/contracts/values';
import { deleteRecord } from '../deletion.ts';
import { defineAttribute, defineObject } from '../definitions.ts';
import { addEntry, defineList, getEntries, removeEntry } from '../lists.ts';
import { defineOption } from '../options.ts';
import { createRecord, getRecords } from '../records.ts';
import { isRefusal } from '../refusals.ts';
import { defineRelationship } from '../relationships.ts';
import type { EngineScope } from '../scope.ts';
import { loadAttributesById, type AttributeDef } from '../values.ts';
import { createWorkspace } from '../workspaces.ts';
import { evaluate, type EvaluateContext, type PlainRecord } from './evaluate.ts';
import { countMatches, queryPage, type PageQuery, type ViewSource } from './page.ts';

const { appUrl, ownerUrl } = inject('testDatabase');
const NOW = '2026-10-15T14:00:00.000Z';
const ZONE = 'America/New_York';
let db: Database;
let scope: EngineScope;
let missions: string;
let companiesObject: string;
let listId: string;
let context: EvaluateContext;
let rows: PlainRecord[];
let entryRows: PlainRecord[];
const a: Record<string, string> = {};
const option: Record<string, string> = {};
const members: string[] = [];
const companyIds: string[] = [];

/** A small, repeatable sequence, so a failure reproduces. */
function* sequence(seed: number) {
  let state = seed;
  for (;;) {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    yield state;
  }
}
const random = sequence(11);
// The high bits: an LCG's low bits repeat with a short period.
const next = (n: number) => Math.floor((random.next().value ?? 0) / 65_536) % n;
const pick = <T>(items: readonly T[]): T => items[next(items.length)] as T;
const maybe = <T>(value: T): T | undefined => (next(5) === 0 ? undefined : value);
const day = (offset: number) =>
  new Date(Date.parse('2026-10-15T00:00:00Z') + offset * 86_400_000).toISOString().slice(0, 10);
const moment = (hours: number) => new Date(Date.parse(NOW) + hours * 3_600_000).toISOString();

const WORDS = ['apollo', 'Apollo', 'gemini', 'mercury', 'Artemis', 'voyager', 'Voyager two', 'skylab', 'a_b%c'];
const id = (key: string): string => {
  const value = a[key] ?? option[key];
  if (value === undefined) throw new Error(`No ${key}.`);
  return value;
};

async function attribute(
  objectOrList: { objectId: string } | { listId: string },
  apiSlug: string,
  type: AttributeDef['type'],
  extra: Record<string, unknown> = {},
) {
  a[apiSlug] = (await defineAttribute(scope, { ...objectOrList, apiSlug, title: apiSlug, type, ...extra })).attributeId;
}

async function options(attributeKey: string, labels: readonly string[]) {
  for (const label of labels) {
    option[label] = (await defineOption(scope, { attributeId: id(attributeKey), label, hue: 'blue' })).optionId;
  }
}

beforeAll(async () => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-query-tests' });
  const created = await createWorkspace(db, {
    name: 'Query',
    slug: `query-${String(Date.now())}`,
    firstMember: { name: 'Quinn', email: 'q@example.com' },
  });
  scope = { db, workspaceId: created.workspaceId, actor: { type: 'member', id: created.memberId } };
  members.push(created.memberId);
  for (const name of ['ada', 'Bob']) {
    const inserted = await db.withWorkspace(scope.workspaceId, (tx) =>
      tx.execute<{ id: string }>(
        sql`insert into members (workspace_id, name, email, created_by_type, updated_by_type) values (${scope.workspaceId}, ${name}, ${`${name}@example.com`}, 'system', 'system') returning id::text`,
      ),
    );
    members.push(inserted.rows[0]?.id ?? '');
  }
  const companies = created.objects.companies ?? '';
  companiesObject = companies;
  ({ objectId: missions } = await defineObject(scope, {
    apiSlug: 'missions',
    singularName: 'Mission',
    pluralName: 'Missions',
    icon: 'rocket',
    hue: 'purple',
  }));
  const on = { objectId: missions };
  await attribute(on, 'notes', 'long_text');
  await attribute(on, 'site', 'url');
  await attribute(on, 'contacts', 'email', { isMulti: true });
  await attribute(on, 'budget', 'number');
  await attribute(on, 'price', 'currency', { config: { defaultCurrency: 'USD' } });
  await attribute(on, 'launch', 'date');
  await attribute(on, 'landed', 'timestamp');
  await attribute(on, 'crewed', 'checkbox');
  await attribute(on, 'tags', 'select', { isMulti: true });
  await attribute(on, 'phase', 'status');
  await attribute(on, 'score', 'rating');
  await attribute(on, 'hotline', 'phone');
  await attribute(on, 'base', 'location');
  await attribute(on, 'lead', 'personal_name');
  await attribute(on, 'owner', 'actor_reference');
  await attribute(on, 'patch', 'file');
  await attribute(on, 'contact', 'interaction');
  await options('tags', ['red', 'green', 'blue']);
  await options('phase', ['plan', 'build', 'fly']);
  const link = await defineRelationship(scope, {
    cardinality: 'many_to_one',
    from: { objectId: missions, apiSlug: 'company', title: 'Company' },
    to: { objectId: companies, apiSlug: 'missions', title: 'Missions' },
  });
  a.company = link.fromAttributeId;
  const companyAttributes = await db.withWorkspace(scope.workspaceId, (tx) =>
    tx.execute<{ id: string; api_slug: string }>(
      sql`select id::text, api_slug from attributes where object_id = ${companies}`,
    ),
  );
  for (const row of companyAttributes.rows) a[`company_${row.api_slug}`] = row.id;
  const missionAttributes = await db.withWorkspace(scope.workspaceId, (tx) =>
    tx.execute<{ id: string; api_slug: string }>(
      sql`select id::text, api_slug from attributes where object_id = ${missions}`,
    ),
  );
  for (const row of missionAttributes.rows) a[row.api_slug] ??= row.id;

  // Companies: a parent chain, a country each.
  for (const [index, name] of ['Acme', 'acme labs', 'Globex', 'Initech', 'Umbrella'].entries()) {
    const parent = index > 0 && index % 2 === 1 ? companyIds[0] : companyIds[index - 1];
    const { recordId } = await createRecord(scope, {
      objectId: companies,
      values: {
        [id('company_name')]: name,
        [id('company_primary_location')]: {
          locality: pick(['London', 'Paris']),
          countryCode: pick(['GB', 'FR', 'US']),
        },
        ...(parent === undefined || index === 4
          ? {}
          : { [id('company_parent_company')]: { objectId: companies, recordId: parent } }),
      },
    });
    companyIds.push(recordId);
  }

  ({ listId } = await defineList(scope, { objectId: missions, apiSlug: 'pipeline', name: 'Pipeline' }));
  await attribute({ listId }, 'stage', 'status');
  await attribute({ listId }, 'due', 'date');
  await options('stage', ['intro', 'signed']);

  const missionIds: string[] = [];
  for (let index = 0; index < 70; index += 1) {
    const amount = String(next(2000) - 200) + (next(2) === 0 ? '.5' : '');
    const values: Record<string, unknown> = {
      [id('name')]: maybe(pick(WORDS)),
      [id('notes')]: maybe(`${pick(WORDS)} notes`),
      [id('site')]: maybe(`https://${pick(['alpha', 'beta', 'gamma'])}.example.com`),
      [id('contacts')]: maybe(
        [...new Set([pick(['ann', 'ben', 'cat']), pick(['ann', 'dan'])])].map((n) => `${n}@example.com`),
      ),
      [id('budget')]: maybe(amount),
      [id('price')]: maybe({ amount, currency: pick(['USD', 'EUR']) }),
      [id('launch')]: maybe(day(next(120) - 60)),
      [id('landed')]: maybe(moment(next(24 * 80) - 24 * 40)),
      [id('crewed')]: next(2) === 0,
      [id('tags')]: maybe(
        [...new Set([pick(['red', 'green', 'blue']), pick(['red', 'blue'])])].map((label) => id(label)),
      ),
      [id('phase')]: maybe(id(pick(['plan', 'build', 'fly']))),
      [id('score')]: maybe(next(5) + 1),
      [id('hotline')]: maybe({
        number: pick(['+447700900123', '+14155550100', '+33612345678']),
        country: pick(['GB', 'US', 'FR']),
      }),
      [id('base')]: maybe({
        locality: pick(['Houston', 'houston', 'Baikonur', 'Kourou']),
        region: pick(['Texas', 'Guiana']),
        countryCode: pick(['US', 'KZ', 'GF']),
      }),
      [id('lead')]: maybe({
        firstName: pick(['Sally', 'Yuri', 'Neil']),
        lastName: pick(['Ride', 'Gagarin', 'Armstrong']),
      }),
      [id('owner')]: maybe({ type: 'member', id: pick(members) }),
      [id('patch')]: maybe({
        fileId: `file_${String(index)}`,
        name: `${pick(WORDS)}.png`,
        size: 10,
        contentType: 'image/png',
      }),
      [id('contact')]: maybe({
        kind: pick(['email', 'meeting']),
        at: moment(next(24 * 20) - 24 * 10),
        by: { type: 'member', id: members[0] },
      }),
      [id('company')]: maybe({ objectId: companies, recordId: pick(companyIds) }),
    };
    const { recordId } = await createRecord(scope, {
      objectId: missions,
      values: Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined)),
    });
    missionIds.push(recordId);
  }
  const entryIds: string[] = [];
  for (const recordId of missionIds.filter((_, index) => index % 3 !== 0)) {
    const values = { [id('stage')]: maybe(id(pick(['intro', 'signed']))), [id('due')]: maybe(day(next(40) - 20)) };
    const { entryId } = await addEntry(scope, {
      listId,
      recordId,
      values: Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined)),
    });
    entryIds.push(entryId);
  }

  const views = await getRecords(scope, { ids: [...missionIds, ...companyIds] });
  const times = await db.withWorkspace(scope.workspaceId, (tx) =>
    tx.execute<{ id: string; created: string; updated: string }>(
      sql`select id::text, created_at::text as created, updated_at::text as updated from records`,
    ),
  );
  const timeById = new Map(times.rows.map((row) => [row.id, row]));
  const plain = views.map((view) => ({
    id: view.id,
    recordId: view.id,
    objectId: view.objectId,
    createdAt: timeById.get(view.id)?.created ?? '',
    updatedAt: timeById.get(view.id)?.updated ?? '',
    createdBy: view.createdBy,
    updatedBy: view.updatedBy,
    values: view.values,
  }));
  const byId = new Map(plain.map((row) => [row.id, row]));
  rows = plain.filter((row) => row.objectId === missions);
  entryRows = (await getEntries(scope, { ids: entryIds })).map((entry) => {
    const record = byId.get(entry.recordId);
    if (record === undefined) throw new Error('Missing record.');
    return { ...record, id: entry.id, values: { ...record.values, ...entry.values } };
  });
  const attributes = await db.withWorkspace(scope.workspaceId, async (tx) => {
    const ids = await tx.execute<{ id: string }>(sql`select id::text from attributes`);
    return loadAttributesById(
      tx,
      ids.rows.map((row) => row.id),
    );
  });
  const positions = await db.withWorkspace(scope.workspaceId, (tx) =>
    tx.execute<{ id: string; position: number }>(sql`select id::text, position from attribute_options`),
  );
  const names = await db.withWorkspace(scope.workspaceId, (tx) =>
    tx.execute<{ id: string; name: string }>(sql`select id::text, name from members`),
  );
  const primaries = await db.withWorkspace(scope.workspaceId, (tx) =>
    tx.execute<{ id: string; primary: string }>(
      sql`select id::text, primary_attribute_id::text as primary from objects`,
    ),
  );
  // Fresh stats for the sample. The other suites fill the same tables at once, and stats taken while the
  // tables were nearly empty make every estimate 1 row, so a two hop filter loops over whole tables.
  const maintenance = createDatabase({ url: ownerUrl, applicationName: 'crm-query-tests-analyze' });
  await maintenance.vacuumAnalyze(['records', 'values', 'record_links', 'list_entries', 'sort_keys']);
  await maintenance.close();
  context = {
    attributes,
    records: byId,
    primaryAttributes: new Map(primaries.rows.map((row) => [row.id, row.primary])),
    optionPositions: new Map(positions.rows.map((row) => [row.id, row.position])),
    memberNames: new Map(names.rows.map((row) => [row.id, row.name])),
    now: NOW,
    timeZone: ZONE,
    weekStart: 'sunday',
    actor: scope.actor,
  };
});

afterAll(async () => {
  await db.close();
});

const clock = { now: NOW, timeZone: ZONE, weekStart: 'sunday' } as const;

/** Every page of a view, followed by cursor, as one list of row ids. */
async function allPages(
  source: ViewSource,
  filter: FilterGroup | undefined,
  sorts: SortRule[],
  limit = 9,
  candidates?: number,
): Promise<string[]> {
  const ids: string[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 100; page += 1) {
    const query: PageQuery = {
      ...source,
      ...clock,
      ...(filter === undefined ? {} : { filter }),
      sorts,
      limit,
      ...(cursor === undefined ? {} : { cursor }),
    };
    const result = await queryPage(scope, query, candidates === undefined ? {} : { candidates });
    ids.push(...(result.entries ?? result.records).map((row) => row.id));
    if (result.nextCursor === undefined) return ids;
    cursor = result.nextCursor;
  }
  throw new Error('Paging never ended.');
}

const and = (...conditions: FilterGroup['conditions']): FilterGroup => ({ conjunction: 'and', conditions });
const or = (...conditions: FilterGroup['conditions']): FilterGroup => ({ conjunction: 'or', conditions });
const is = (key: string, operator: string, value?: unknown): FilterCondition =>
  ({ attributeId: id(key), operator, ...(value === undefined ? {} : { value }) }) as FilterCondition;
const list = (key: string, operator: string, values: readonly unknown[]): FilterCondition =>
  ({ attributeId: id(key), operator, values }) as FilterCondition;
const range = (key: string, operator: 'within' | 'within_last', value: unknown): FilterCondition =>
  ({ attributeId: id(key), operator, range: value }) as FilterCondition;
const between = (key: string, from: unknown, to: unknown): FilterCondition => ({
  attributeId: id(key),
  operator: 'between',
  from,
  to,
});
const through = (path: readonly string[], condition: FilterCondition): FilterCondition => ({
  operator: 'through',
  path: path.map(id),
  condition,
});
const by = (key: string, direction: SortRule['direction'] = 'ascending'): SortRule => ({
  attributeId: id(key),
  direction,
});

describe('the compiler matches the reference evaluator', () => {
  const filters: [string, () => FilterGroup][] = [
    ['text is, any case', () => and(is('name', 'is', 'APOLLO'))],
    ['text is not (matches empties)', () => and(is('name', 'is_not', 'apollo'))],
    ['text contains a literal wildcard', () => and(is('name', 'contains', 'a_b%'))],
    ['long text does not contain', () => and(is('notes', 'does_not_contain', 'oyag'))],
    ['url is', () => and(is('site', 'is', 'https://beta.example.com'))],
    ['multi email contains any item', () => and(is('contacts', 'contains', 'dan'))],
    ['multi email is', () => and(is('contacts', 'is', 'ANN@example.com'))],
    [
      'number comparisons',
      () => or(is('budget', 'gt', '1000'), is('budget', 'lte', -100), is('budget', 'eq', '500.5')),
    ],
    [
      'number neq (matches empties)',
      () =>
        and(
          is(
            'budget',
            'neq',
            rows.map((row) => row.values[id('budget')]).find((value) => value !== null),
          ),
        ),
    ],
    ['number between', () => and(between('budget', 100, '900.5'))],
    ['currency within one code', () => and(is('price', 'gte', { amount: '1000', currency: 'EUR' }))],
    [
      'currency between',
      () => and(between('price', { amount: '0', currency: 'USD' }, { amount: '800', currency: 'USD' })),
    ],
    [
      'date is, before, after',
      () => or(is('launch', 'is', day(3)), is('launch', 'before', day(-40)), is('launch', 'after', day(45))),
    ],
    ['date within the next 2 weeks', () => and(range('launch', 'within', { amount: 2, unit: 'week' }))],
    ['date within the last month', () => and(range('launch', 'within_last', { amount: 1, unit: 'month' }))],
    ['date this week (Sunday start, New York)', () => and(range('launch', 'within', 'this_week'))],
    [
      'date this month and last month',
      () => or(range('launch', 'within', 'this_month'), range('launch', 'within', 'last_month')),
    ],
    [
      'timestamp before and after',
      () => or(is('landed', 'before', moment(-24 * 30)), is('landed', 'after', moment(24 * 30))),
    ],
    ['timestamp within the last 10 days', () => and(range('landed', 'within_last', { amount: 10, unit: 'day' }))],
    ['timestamp this month in New York', () => and(range('landed', 'within', 'this_month'))],
    ['checkbox checked', () => and(is('crewed', 'is_checked'))],
    ['checkbox not checked', () => and(is('crewed', 'is_not_checked'))],
    ['multi select contains any of', () => and(list('tags', 'contains_any_of', [id('green')]))],
    ['multi select contains all of', () => and(list('tags', 'contains_all_of', [id('red'), id('blue')]))],
    ['multi select contains none of', () => and(list('tags', 'contains_none_of', [id('red')]))],
    ['status is, is not, is any of', () => or(is('phase', 'is', id('plan')), list('phase', 'is_any_of', [id('fly')]))],
    ['status is not', () => and(is('phase', 'is_not', id('build')))],
    ['rating at least and at most', () => or(is('score', 'at_least', 5), is('score', 'at_most', 1))],
    [
      'phone is, contains, country is',
      () =>
        or(is('hotline', 'is', '+14155550100'), is('hotline', 'contains', '7700'), is('hotline', 'country_is', 'fr')),
    ],
    [
      'location country, locality, region',
      () => or(is('base', 'country_is', 'kz'), is('base', 'locality_is', 'HOUSTON'), is('base', 'region_is', 'guiana')),
    ],
    [
      'personal name contains, first, last',
      () =>
        or(
          is('lead', 'contains', 'sally r'),
          is('lead', 'first_name_is', 'YURI'),
          is('lead', 'last_name_is', 'armstrong'),
        ),
    ],
    [
      'actor is, is me, is any of',
      () => or(is('owner', 'is_me'), is('owner', 'is', { type: 'member', id: members[1] })),
    ],
    ['actor is any of', () => and(list('owner', 'is_any_of', [members[2]]))],
    [
      'file name contains, has files',
      () => or(is('patch', 'name_contains', 'gem'), and(is('patch', 'has_files'), is('name', 'is_empty'))),
    ],
    [
      'interaction kind and within the last',
      () => and(is('contact', 'kind_is', 'meeting'), range('contact', 'within_last', { amount: 5, unit: 'day' })),
    ],
    ['interaction before', () => and(is('contact', 'before', NOW))],
    [
      'record reference is any of',
      () => and(list('company', 'is_any_of', [{ objectId: 'x', recordId: companyIds[1] }, companyIds[2]])),
    ],
    ['record reference is empty', () => and(is('company', 'is_empty'))],
    ['through one hop', () => and(through(['company'], is('company_name', 'contains', 'acme')))],
    [
      'through one hop, negative means no linked record matches',
      () => and(through(['company'], is('company_name', 'is_not', 'globex'))),
    ],
    [
      'through one hop to a location',
      () => and(through(['company'], is('company_primary_location', 'country_is', 'GB'))),
    ],
    ['through two hops', () => and(through(['company', 'company_parent_company'], is('company_name', 'is', 'acme')))],
    [
      'system: created by me, record id',
      () =>
        or(
          and(is('created_by', 'is_me'), is('budget', 'gt', 1000)),
          list('record_id', 'is_any_of', [rows[0]?.id, rows[1]?.id]),
        ),
    ],
    [
      'system: created within the last 30 days',
      () => and(range('created_at', 'within_last', { amount: 30, unit: 'day' }), is('name', 'is_not_empty')),
    ],
    [
      'nesting three deep',
      () =>
        or(
          is('site', 'is_empty'),
          and(is('name', 'is_not_empty'), or(is('crewed', 'is_checked'), is('score', 'at_least', 4))),
        ),
    ],
  ];

  it.each(filters)('%s', async (_, filter) => {
    const expected = evaluate(context, rows, filter(), [by('name')]);
    // A filter that keeps everything or nothing would prove little.
    expect(expected.length).toBeGreaterThan(0);
    expect(expected.length).toBeLessThan(rows.length);
    expect(await allPages({ objectId: missions }, filter(), [by('name')])).toEqual(expected);
  });

  const sorts: [string, () => SortRule[]][] = [
    ['text ascending', () => [by('name')]],
    ['text descending', () => [by('name', 'descending')]],
    ['number', () => [by('budget')]],
    ['currency: code then amount', () => [by('price', 'descending')]],
    ['date then text', () => [by('launch'), by('name', 'descending')]],
    ['timestamp', () => [by('landed', 'descending')]],
    ['checkbox', () => [by('crewed')]],
    ['multi select by first option order', () => [by('tags'), by('budget')]],
    ['status by option order', () => [by('phase', 'descending'), by('name')]],
    ['rating', () => [by('score')]],
    ['phone, location, personal name', () => [by('hotline'), by('base'), by('lead')]],
    ['member name', () => [by('owner')]],
    ['file name', () => [by('patch')]],
    ['interaction', () => [by('contact')]],
    ['linked record name', () => [by('company'), by('name')]],
    ['system columns', () => [by('created_by'), by('created_at', 'descending')]],
  ];

  it.each(sorts)('sorts by %s, empties last', async (_, sort) => {
    expect(await allPages({ objectId: missions }, undefined, sort())).toEqual(
      evaluate(context, rows, undefined, sort()),
    );
  });

  it.each(filters)('with a first pass capped at 3 rows: %s', async (_, filter) => {
    // A tiny cap makes every page fall back, or cut a group of equal keys, so those paths are proved too.
    const sorts = [by('launch'), by('name', 'descending')];
    expect(await allPages({ objectId: missions }, filter(), sorts, 4, 3)).toEqual(
      evaluate(context, rows, filter(), sorts),
    );
  });

  it('pages the same at any page size', async () => {
    const sort = [by('budget', 'descending'), by('name')];
    expect(await allPages({ objectId: missions }, undefined, sort, 1)).toEqual(
      await allPages({ objectId: missions }, undefined, sort, 200),
    );
  });
});

describe('list views', () => {
  const cases: [string, () => FilterGroup | undefined, () => SortRule[]][] = [
    ['entry status, by entry date', () => and(is('stage', 'is', id('signed'))), () => [by('due')]],
    [
      'entry and record attributes together',
      () => and(is('stage', 'is_not', id('intro')), is('crewed', 'is_checked')),
      () => [by('name'), by('due', 'descending')],
    ],
    [
      'through the record',
      () => and(through(['company'], is('company_name', 'contains', 'acme'))),
      () => [by('stage')],
    ],
    ['no filter, by record created at', () => undefined, () => [by('created_at')]],
  ];
  it.each(cases)('%s', async (_, filter, sorts) => {
    const expected = evaluate(context, entryRows, filter(), sorts());
    expect(expected.length).toBeGreaterThan(0);
    expect(await allPages({ listId }, filter(), sorts())).toEqual(expected);
    expect(await allPages({ listId }, filter(), sorts(), 4, 3)).toEqual(expected);
  });
});

describe('positions and counts', () => {
  it('jumps to a position on an unfiltered view with one sort', async () => {
    const order = evaluate(context, rows, undefined, [by('budget')]);
    const page = await queryPage(scope, { objectId: missions, sorts: [by('budget')], position: 30, limit: 10 });
    expect(page.records.map((record) => record.id)).toEqual(order.slice(30, 40));
    const after = await queryPage(scope, {
      objectId: missions,
      sorts: [by('budget')],
      limit: 10,
      ...(page.nextCursor === undefined ? {} : { cursor: page.nextCursor }),
    });
    expect(after.records.map((record) => record.id)).toEqual(order.slice(40, 50));
    // A position past every row with a value lands among the empties, in id order.
    const late = await queryPage(scope, {
      objectId: missions,
      sorts: [by('budget', 'descending')],
      position: 64,
      limit: 10,
    });
    expect(late.records.map((record) => record.id)).toEqual(
      evaluate(context, rows, undefined, [by('budget', 'descending')]).slice(64, 74),
    );
  });

  it('refuses a jump on a filtered view', async () => {
    const attempt = queryPage(scope, {
      objectId: missions,
      filter: and(is('crewed', 'is_checked')),
      position: 5,
    });
    await expect(attempt).rejects.toMatchObject({ refusal: { code: 'FILTER_INVALID' } });
  });

  it('counts exactly what the filter matches, for objects and lists', async () => {
    const filter = or(is('name', 'contains', 'o'), list('tags', 'contains_any_of', [id('blue')]));
    expect(await countMatches(scope, { objectId: missions, filter, ...clock })).toBe(
      evaluate(context, rows, filter, []).length,
    );
    const entries = and(is('stage', 'is_empty'));
    expect(await countMatches(scope, { listId, filter: entries, ...clock })).toBe(
      evaluate(context, entryRows, entries, []).length,
    );
  });

  it('refuses a count already cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(countMatches(scope, { objectId: missions }, controller.signal)).rejects.toMatchObject({
      refusal: { code: 'QUERY_CANCELLED' },
    });
  });

  it('cancels a running count when the signal aborts (AC-15)', async () => {
    // Another transaction holds the records table, so the count waits until it is cancelled.
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let locked: () => void = () => undefined;
    const isLocked = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const holder = scope.db.withWorkspace(scope.workspaceId, async (tx) => {
      await tx.execute(sql`lock table records in access exclusive mode`);
      locked();
      await held;
    });
    await isLocked;
    const controller = new AbortController();
    const counting = countMatches(scope, { objectId: missions }, controller.signal);
    await new Promise((resolve) => setTimeout(resolve, 300));
    controller.abort();
    await expect(counting).rejects.toMatchObject({ refusal: { code: 'QUERY_CANCELLED' } });
    release();
    await holder;
  });
});

describe('refusals', () => {
  it('refuses operators a type does not offer, bad operands, too many hops and bad cursors', async () => {
    const attempts: (() => Promise<unknown>)[] = [
      () => queryPage(scope, { objectId: missions, filter: and(is('notes', 'is', 'x')) }),
      () => queryPage(scope, { objectId: missions, filter: and(is('budget', 'gt', 'lots')) }),
      () => queryPage(scope, { objectId: missions, filter: and(is('crewed', 'is_empty')) }),
      () =>
        queryPage(scope, {
          objectId: missions,
          filter: and(
            through(['company', 'company_parent_company', 'company_parent_company'], is('company_name', 'is', 'x')),
          ),
        }),
      () => queryPage(scope, { objectId: missions, filter: and(through(['company'], is('name', 'is', 'x'))) }),
      () => queryPage(scope, { objectId: missions, sorts: [by('notes')] }),
      () => queryPage(scope, { objectId: missions, cursor: 'not a cursor' }),
      () => queryPage(scope, { objectId: missions, limit: 500 }),
      () => queryPage(scope, { objectId: missions, filter: and({ attributeId: 'nope', operator: 'is_empty' }) }),
      () => queryPage(scope, { objectId: missions, timeZone: 'Mars/Olympus' }),
    ];
    const codes: string[] = [];
    for (const attempt of attempts) {
      try {
        await attempt();
        codes.push('none');
      } catch (error) {
        codes.push(isRefusal(error) ? error.refusal.code : String(error));
      }
    }
    expect(codes).toEqual(attempts.map(() => 'FILTER_INVALID'));
  });
});

describe('hidden rows', () => {
  // Their own object, so deleting rows here leaves the sample above untouched.
  let probes: string;
  let probeList: string;
  const live: string[] = [];
  const liveEntries: string[] = [];

  beforeAll(async () => {
    ({ objectId: probes } = await defineObject(scope, {
      apiSlug: 'probes',
      singularName: 'Probe',
      pluralName: 'Probes',
      icon: 'rocket',
      hue: 'blue',
    }));
    await attribute({ objectId: probes }, 'probe_score', 'number');
    await attribute({ objectId: probes }, 'probe_kind', 'select');
    await options('probe_kind', ['orbiter', 'lander']);
    const firm = await defineRelationship(scope, {
      cardinality: 'many_to_one',
      from: { objectId: probes, apiSlug: 'firm', title: 'Firm' },
      to: { objectId: companiesObject, apiSlug: 'probes', title: 'Probes' },
    });
    a.firm = firm.fromAttributeId;
    const gone = await createRecord(scope, {
      objectId: companiesObject,
      values: { [id('company_name')]: 'Gone corp' },
    });
    ({ listId: probeList } = await defineList(scope, { objectId: probes, apiSlug: 'probe_list', name: 'Probes' }));
    const deleted: string[] = [];
    for (let index = 0; index < 12; index += 1) {
      const { recordId } = await createRecord(scope, {
        objectId: probes,
        values: {
          // Every fourth has no score, so the empties branch has rows to hide too.
          ...(index % 4 === 3 ? {} : { [id('probe_score')]: String(index % 5) }),
          [id('probe_kind')]: id(index % 2 === 0 ? 'orbiter' : 'lander'),
          ...(index % 3 === 0 ? { [id('firm')]: { objectId: companiesObject, recordId: gone.recordId } } : {}),
        },
      });
      const { entryId } = await addEntry(scope, { listId: probeList, recordId });
      // Delete a third of them (scored and unscored), and remove another third's entries.
      if (index % 3 === 1) deleted.push(recordId);
      else live.push(recordId);
      if (index % 3 === 2) await removeEntry(scope, { entryId });
      else if (index % 3 !== 1) liveEntries.push(entryId);
    }
    for (const recordId of deleted) await deleteRecord(scope, { recordId });
    await deleteRecord(scope, { recordId: gone.recordId });
  });

  const sorted = (ids: readonly string[]) => [...ids].sort();

  it('never returns a deleted record from the index first pass, the empties or filter first', async () => {
    for (const sorts of [
      [by('probe_score')],
      [by('probe_score', 'descending')],
      [by('probe_kind')],
      [by('probe_kind'), by('probe_score')],
    ]) {
      // The usual cap, a cap of 3 (rounds that cut groups), and a cap of 1 (always falls back to filter first).
      for (const candidates of [undefined, 3, 1]) {
        const ids = await allPages({ objectId: probes }, undefined, sorts, 2, candidates);
        expect(sorted(ids)).toEqual(sorted(live));
        const crewed = await allPages(
          { objectId: probes },
          and(is('probe_kind', 'is', id('orbiter'))),
          sorts,
          2,
          candidates,
        );
        expect(crewed.every((recordId) => live.includes(recordId))).toBe(true);
      }
    }
  });

  it('never returns a removed entry, or the entry of a deleted record', async () => {
    for (const candidates of [undefined, 3, 1]) {
      const ids = await allPages({ listId: probeList }, undefined, [by('probe_score')], 2, candidates);
      expect(sorted(ids)).toEqual(sorted(liveEntries));
    }
    expect(await countMatches(scope, { listId: probeList })).toBe(liveEntries.length);
  });

  it('never matches through a deleted far record', async () => {
    const filter = and(through(['firm'], is('company_name', 'is', 'Gone corp')));
    for (const candidates of [undefined, 3, 1]) {
      expect(await allPages({ objectId: probes }, filter, [by('probe_score')], 2, candidates)).toEqual([]);
    }
    expect(await countMatches(scope, { objectId: probes, filter })).toBe(0);
    // Its negative matches every live probe, linked or not.
    const negative = and(through(['firm'], is('company_name', 'is_not', 'Gone corp')));
    expect(sorted(await allPages({ objectId: probes }, negative, [by('probe_score')], 2))).toEqual(sorted(live));
  });
});

describe('other workspaces', () => {
  it("refuses another workspace's object and list as missing, and reads nothing of theirs", async () => {
    const other = await createWorkspace(db, {
      name: 'Other',
      slug: `other-${String(Date.now())}`,
      firstMember: { name: 'Olive', email: 'o@example.com' },
    });
    const otherScope: EngineScope = {
      db,
      workspaceId: other.workspaceId,
      actor: { type: 'member', id: other.memberId },
    };
    const { listId: theirList } = await defineList(otherScope, {
      objectId: other.objects.deals ?? '',
      apiSlug: 'theirs',
      name: 'Theirs',
    });
    const refusalOf = async (attempt: Promise<unknown>) => {
      try {
        await attempt;
        return 'none';
      } catch (error) {
        return isRefusal(error) ? error.refusal.code : String(error);
      }
    };
    // Their ids, asked from this workspace, get the same refusal as ids that never existed.
    expect(await refusalOf(queryPage(scope, { objectId: other.objects.deals ?? '' }))).toBe('NOT_FOUND');
    expect(await refusalOf(queryPage(scope, { listId: theirList }))).toBe('NOT_FOUND');
    expect(await refusalOf(countMatches(scope, { objectId: other.objects.deals ?? '' }))).toBe('NOT_FOUND');
    expect(await refusalOf(countMatches(scope, { listId: theirList }))).toBe('NOT_FOUND');
    const theirName = await db.withWorkspace(other.workspaceId, (tx) =>
      tx.execute<{ id: string }>(
        sql`select id::text from attributes where object_id = ${other.objects.deals ?? ''} and api_slug = 'name'`,
      ),
    );
    const theirAttribute = theirName.rows[0]?.id ?? '';
    // Their attribute in this workspace's filter or sort is unknown here.
    expect(
      await refusalOf(
        queryPage(scope, { objectId: missions, filter: and({ attributeId: theirAttribute, operator: 'is_empty' }) }),
      ),
    ).toBe('FILTER_INVALID');
    expect(
      await refusalOf(
        queryPage(scope, { objectId: missions, sorts: [{ attributeId: theirAttribute, direction: 'ascending' }] }),
      ),
    ).toBe('FILTER_INVALID');
  });
});

describe('caps and timeouts', () => {
  it('refuses a filter too large, a path too long, and a tampered cursor key', async () => {
    const many = and(...Array.from({ length: 51 }, () => is('crewed', 'is_checked')));
    const wide = or(
      ...Array.from({ length: 3 }, () => and(...Array.from({ length: 40 }, () => is('crewed', 'is_checked')))),
    );
    const nested: FilterCondition = through(
      ['company'],
      through(['company_parent_company', 'company_parent_company'], is('company_name', 'is', 'x')),
    );
    const first = await queryPage(scope, { objectId: missions, sorts: [by('launch')], limit: 5 });
    const decoded = JSON.parse(Buffer.from(first.nextCursor ?? '', 'base64url').toString('utf8')) as {
      id: string;
      keys: string[];
    };
    const tampered = (key: string) => Buffer.from(JSON.stringify({ ...decoded, keys: [key] })).toString('base64url');
    const attempts: (() => Promise<unknown>)[] = [
      () => queryPage(scope, { objectId: missions, filter: many }),
      () => queryPage(scope, { objectId: missions, filter: wide }),
      () => queryPage(scope, { objectId: missions, filter: and(nested) }),
      () => queryPage(scope, { objectId: missions, sorts: [by('launch')], cursor: tampered('abc') }),
      () => queryPage(scope, { objectId: missions, sorts: [by('launch')], cursor: tampered('2026-02-30') }),
      () => countMatches(scope, { objectId: missions, filter: many }),
    ];
    const codes: string[] = [];
    for (const attempt of attempts) {
      try {
        await attempt();
        codes.push('none');
      } catch (error) {
        codes.push(isRefusal(error) ? error.refusal.code : String(error));
      }
    }
    expect(codes).toEqual(attempts.map(() => 'FILTER_INVALID'));
  });

  it('cancels a page that runs past its timeout with QUERY_CANCELLED', async () => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let locked: () => void = () => undefined;
    const isLocked = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const holder = scope.db.withWorkspace(scope.workspaceId, async (tx) => {
      await tx.execute(sql`lock table records in access exclusive mode`);
      locked();
      await held;
    });
    await isLocked;
    const reading = queryPage(scope, { objectId: missions }, { timeout: '200ms' });
    await expect(reading).rejects.toMatchObject({ refusal: { code: 'QUERY_CANCELLED' } });
    release();
    await holder;
  });
});
