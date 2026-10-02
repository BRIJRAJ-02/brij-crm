// The query compiler against the reference evaluator (spec 0004, AC-14), for
// the milestone 1 slice: text operators, is empty, nested groups, text and
// time sorts in both directions, and keyset paging across pages.
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, type Database } from '@crm/db';
import type { FilterGroup, SortRule } from '@crm/contracts/values';
import { defineAttribute, defineObject } from '../definitions.ts';
import { createRecord, getRecords } from '../records.ts';
import { isRefusal } from '../refusals.ts';
import type { EngineScope } from '../scope.ts';
import { loadAttributes, type AttributeDef } from '../values.ts';
import { createWorkspace } from '../workspaces.ts';
import { evaluate, type PlainRecord } from './evaluate.ts';
import { queryPage } from './page.ts';

const { appUrl } = inject('testDatabase');
let db: Database;
let scope: EngineScope;
let objectId: string;
let attributes: ReadonlyMap<string, AttributeDef>;
let plain: PlainRecord[];
const slug: Record<string, string> = {};

const WORDS = ['apollo', 'Apollo', 'gemini', 'mercury', 'Artemis', 'voyager', 'Voyager two', 'skylab', 'a_b%c', ''];

/** A small, repeatable sequence, so a failure reproduces. */
function* sequence(seed: number) {
  let state = seed;
  for (;;) {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    yield state;
  }
}

beforeAll(async () => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-query-tests' });
  const created = await createWorkspace(db, {
    name: 'Query',
    slug: `query-${String(Date.now())}`,
    firstMember: { name: 'Q', email: 'q@example.com' },
  });
  scope = { db, workspaceId: created.workspaceId, actor: { type: 'member', id: created.memberId } };
  ({ objectId } = await defineObject(scope, {
    apiSlug: 'missions',
    singularName: 'Mission',
    pluralName: 'Missions',
    icon: 'rocket',
    hue: 'purple',
  }));
  for (const [apiSlug, type, isMulti] of [
    ['notes', 'long_text', false],
    ['site', 'url', false],
    ['contacts', 'email', true],
  ] as const) {
    slug[apiSlug] = (await defineAttribute(scope, { objectId, apiSlug, title: apiSlug, type, isMulti })).attributeId;
  }
  attributes = await db.withWorkspace(scope.workspaceId, (tx) => loadAttributes(tx, objectId));
  for (const attribute of attributes.values()) slug[attribute.apiSlug] = attribute.id;

  const random = sequence(7);
  const pick = () => WORDS[(random.next().value ?? 0) % WORDS.length] ?? '';
  const ids: string[] = [];
  for (let index = 0; index < 60; index += 1) {
    const name = pick();
    const notes = pick();
    const site = pick();
    const contacts = [pick(), pick()].filter((word) => /^[a-z]+$/i.test(word)).map((word) => `${word}@example.com`);
    const { recordId } = await createRecord(scope, {
      objectId,
      values: {
        ...(name === '' ? {} : { [slug.name ?? '']: name }),
        ...(notes === '' ? {} : { [slug.notes ?? '']: `${notes} notes` }),
        ...(site === '' || !/^[a-z]+$/i.test(site)
          ? {}
          : { [slug.site ?? '']: `https://${site.toLowerCase()}.example.com` }),
        ...(contacts.length === 0
          ? {}
          : { [slug.contacts ?? '']: [...new Set(contacts.map((each) => each.toLowerCase()))] }),
      },
    });
    ids.push(recordId);
  }
  const views = await getRecords(scope, { ids });
  const times = await db.withWorkspace(scope.workspaceId, (tx) =>
    tx.execute<{ id: string; created: string; updated: string }>(
      sql`select id::text, created_at::text as created, updated_at::text as updated from records`,
    ),
  );
  const timeById = new Map(times.rows.map((row) => [row.id, row]));
  plain = views.map((view) => ({
    id: view.id,
    createdAt: timeById.get(view.id)?.created ?? '',
    updatedAt: timeById.get(view.id)?.updated ?? '',
    values: view.values,
  }));
});

afterAll(async () => {
  await db.close();
});

/** Every page of a view, followed by cursor, as one list of ids. */
async function allPages(filter: FilterGroup | undefined, sorts: SortRule[], limit = 7): Promise<string[]> {
  const ids: string[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 100; page += 1) {
    const result = await queryPage(scope, {
      objectId,
      ...(filter === undefined ? {} : { filter }),
      sorts,
      limit,
      ...(cursor === undefined ? {} : { cursor }),
    });
    ids.push(...result.records.map((record) => record.id));
    if (result.nextCursor === undefined) return ids;
    cursor = result.nextCursor;
  }
  throw new Error('Paging never ended.');
}

const and = (...conditions: FilterGroup['conditions']): FilterGroup => ({ conjunction: 'and', conditions });
const or = (...conditions: FilterGroup['conditions']): FilterGroup => ({ conjunction: 'or', conditions });

describe('the compiler matches the reference evaluator', () => {
  const cases: [string, () => FilterGroup | undefined, () => SortRule[]][] = [
    ['no filter, by name', () => undefined, () => [{ attributeId: slug.name ?? '', direction: 'ascending' }]],
    [
      'no filter, by name descending',
      () => undefined,
      () => [{ attributeId: slug.name ?? '', direction: 'descending' }],
    ],
    ['name is (any case)', () => and({ attributeId: slug.name ?? '', operator: 'is', value: 'APOLLO' }), () => []],
    ['name is not', () => and({ attributeId: slug.name ?? '', operator: 'is_not', value: 'apollo' }), () => []],
    [
      'notes contain a literal wildcard',
      () => and({ attributeId: slug.notes ?? '', operator: 'contains', value: 'a_b%' }),
      () => [],
    ],
    [
      'notes do not contain',
      () => and({ attributeId: slug.notes ?? '', operator: 'does_not_contain', value: 'oyag' }),
      () => [],
    ],
    [
      'multi valued contains any item',
      () => and({ attributeId: slug.contacts ?? '', operator: 'contains', value: 'gemini' }),
      () => [],
    ],
    [
      'empty and not empty',
      () =>
        or(
          { attributeId: slug.site ?? '', operator: 'is_empty' },
          and(
            { attributeId: slug.name ?? '', operator: 'is_not_empty' },
            { attributeId: slug.notes ?? '', operator: 'is_empty' },
          ),
        ),
      () => [{ attributeId: slug.site ?? '', direction: 'ascending' }],
    ],
    [
      'two sorts, mixed directions',
      () => undefined,
      () => [
        { attributeId: slug.site ?? '', direction: 'descending' },
        { attributeId: slug.name ?? '', direction: 'ascending' },
      ],
    ],
    [
      'by created at',
      () => and({ attributeId: slug.name ?? '', operator: 'contains', value: 'o' }),
      () => [{ attributeId: slug.created_at ?? '', direction: 'descending' }],
    ],
  ];

  it.each(cases)('%s', async (_, filter, sorts) => {
    const expected = evaluate(attributes, plain, filter(), sorts());
    // A filter that keeps everything or nothing would prove little.
    if (filter() !== undefined) expect(expected.length).toBeGreaterThan(0);
    if (filter() !== undefined) expect(expected.length).toBeLessThan(plain.length);
    expect(await allPages(filter(), sorts())).toEqual(expected);
  });

  it('pages the same at any page size', async () => {
    const sorts: SortRule[] = [{ attributeId: slug.name ?? '', direction: 'ascending' }];
    expect(await allPages(undefined, sorts, 1)).toEqual(await allPages(undefined, sorts, 200));
  });
});

describe('refusals', () => {
  it('refuses an operator the type does not offer, a bad cursor and a bad page size', async () => {
    const codes: string[] = [];
    for (const attempt of [
      () => queryPage(scope, { objectId, filter: and({ attributeId: slug.notes ?? '', operator: 'is', value: 'x' }) }),
      () => queryPage(scope, { objectId, cursor: 'not a cursor' }),
      () => queryPage(scope, { objectId, limit: 500 }),
      () => queryPage(scope, { objectId, filter: and({ attributeId: crypto.randomUUID(), operator: 'is_empty' }) }),
    ]) {
      try {
        await attempt();
        codes.push('none');
      } catch (error) {
        codes.push(isRefusal(error) ? error.refusal.code : 'unexpected');
      }
    }
    expect(codes).toEqual(['FILTER_INVALID', 'FILTER_INVALID', 'FILTER_INVALID', 'FILTER_INVALID']);
  });
});
