// The open policy costs nothing (spec 0009, AC-149): with no rule, every
// statement a page, a count and a search send is the text they sent before
// the access model reached the engine's choke points. Each query of a small
// copy of the benchmark grid runs with every statement on the wire recorded
// (text and parameters, ids replaced by their order of first use), and the
// whole transcript is compared with the one recorded before milestone 2.
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, type Database } from '@crm/db';
import { recordStatements } from '@crm/db/testing';
import type { FilterGroup, SortRule } from '@crm/contracts/values';
import { addEntry, defineList } from '../engine/lists.ts';
import { defineAttribute } from '../engine/definitions.ts';
import { defineOption } from '../engine/options.ts';
import { countMatches, queryPage, type PageQuery } from '../engine/query/page.ts';
import { createRecord, getRecords } from '../engine/records.ts';
import { createWorkspace } from '../engine/workspaces.ts';
import { testScope } from '../testing.ts';
import type { EngineScope } from './mint.ts';

const { appUrl } = inject('testDatabase');
let db: Database;
let scope: EngineScope;
const ids: Record<string, string> = {};
const id = (key: string): string => {
  const value = ids[key];
  if (value === undefined) throw new Error(`No ${key}.`);
  return value;
};

beforeAll(async () => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-open-sql-tests' });
  const created = await createWorkspace(db, {
    name: 'Open',
    slug: `open-sql-${String(Date.now())}`,
    firstMember: { name: 'Ada', email: 'ada@example.com' },
  });
  scope = testScope({ db, workspaceId: created.workspaceId, actor: { type: 'member', id: created.memberId } });
  ids.deals = created.objects.deals ?? '';
  ids.companies = created.objects.companies ?? '';
  const slugs = await db.withWorkspace(scope.workspaceId, (tx) =>
    tx.execute<{ id: string; slug: string }>(sql`
      select a.id::text, o.api_slug || '.' || a.api_slug as slug from attributes a join objects o on o.id = a.object_id
    `),
  );
  for (const row of slugs.rows) ids[row.slug] = row.id;
  const options = await db.withWorkspace(scope.workspaceId, (tx) =>
    tx.execute<{ id: string; label: string }>(sql`select id::text, label from attribute_options`),
  );
  for (const row of options.rows) ids[`option.${row.label}`] = row.id;
  ids['option.Technology'] = (
    await defineOption(scope, { attributeId: id('companies.categories'), label: 'Technology', hue: 'green' })
  ).optionId;
  const companyA = await createRecord(scope, {
    objectId: id('companies'),
    values: { [id('companies.name')]: 'Acme', [id('companies.categories')]: [id('option.Technology')] },
  });
  const deal = (name: string, extra: Record<string, unknown> = {}) =>
    createRecord(scope, { objectId: id('deals'), values: { [id('deals.name')]: name, ...extra } });
  await deal('Zephyr expansion', {
    [id('deals.probability')]: '40',
    [id('deals.associated_company')]: { objectId: id('companies'), recordId: companyA.recordId },
  });
  await deal('Apollo renewal', { [id('deals.next_step')]: 'Call' });
  await deal('Gemini expansion', { [id('deals.probability')]: '70' });
  await deal('Mercury');
  const { listId } = await defineList(scope, { objectId: id('deals'), apiSlug: 'pipeline', name: 'Pipeline' });
  ids.list = listId;
  ids.listStage = (
    await defineAttribute(scope, { listId, apiSlug: 'stage', title: 'Stage', type: 'status' })
  ).attributeId;
  ids.due = (await defineAttribute(scope, { listId, apiSlug: 'due', title: 'Due', type: 'date' })).attributeId;
  ids.qualified = (
    await defineOption(scope, { attributeId: id('listStage'), label: 'Qualified', hue: 'blue' })
  ).optionId;
  const page = await queryPage(scope, { objectId: id('deals'), limit: 1 });
  const recordId = page.records[0]?.id ?? '';
  await addEntry(scope, {
    listId,
    recordId,
    values: { [id('listStage')]: id('qualified'), [id('due')]: '2026-11-01' },
  });
});

afterAll(async () => {
  await db.close();
});

const and = (...conditions: FilterGroup['conditions']): FilterGroup => ({ conjunction: 'and', conditions });
const by = (key: string, direction: SortRule['direction'] = 'ascending'): SortRule => ({
  attributeId: id(key),
  direction,
});

/** Every statement sent while `work` runs, as text and parameters, with ids in order of first use. */
async function transcript(work: () => Promise<unknown>): Promise<string> {
  const sent = (await recordStatements(work)).map(
    (statement) => `${statement.text}\n  ${JSON.stringify(statement.params)}`,
  );
  const seen = new Map<string, string>();
  return sent
    .map((line) =>
      line.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, (uuid) => {
        const key = uuid.toLowerCase();
        const label = seen.get(key) ?? `<id ${String(seen.size + 1)}>`;
        seen.set(key, label);
        return label;
      }),
    )
    .join('\n\n');
}

const grid = (): { name: string; run: () => Promise<unknown> }[] => {
  const page = (query: Omit<PageQuery, 'objectId'> & { objectId?: string }) => () =>
    queryPage(scope, { objectId: id('deals'), ...query });
  return [
    { name: '1. no filter, sort by name', run: page({ sorts: [by('deals.name')] }) },
    { name: '1b. the same at position 2', run: page({ sorts: [by('deals.name')], position: 2 }) },
    {
      name: '2. source is any of, sort by created at',
      run: page({
        filter: and({ attributeId: id('deals.source'), operator: 'is_any_of', values: [id('option.Inbound')] }),
        sorts: [by('deals.created_at', 'descending')],
      }),
    },
    {
      name: '3. name contains, probability between, deal type is; close date then name',
      run: page({
        filter: and(
          { attributeId: id('deals.name'), operator: 'contains', value: 'expansion' },
          { attributeId: id('deals.probability'), operator: 'between', from: 20, to: 60 },
          { attributeId: id('deals.deal_type'), operator: 'is', value: id('option.New business') },
        ),
        sorts: [by('deals.close_date'), by('deals.name')],
      }),
    },
    {
      name: '4. through the company: its category, sort by name',
      run: page({
        filter: and({
          operator: 'through',
          path: [id('deals.associated_company')],
          condition: {
            attributeId: id('companies.categories'),
            operator: 'contains_any_of',
            values: [id('option.Technology')],
          },
        }),
        sorts: [by('deals.name')],
      }),
    },
    {
      name: '5. next step is empty, sort by stage',
      run: page({
        filter: and({ attributeId: id('deals.next_step'), operator: 'is_empty' }),
        sorts: [by('deals.stage')],
      }),
    },
    {
      name: '6. a list: entry stage is Qualified, sort by due',
      run: () =>
        queryPage(scope, {
          listId: id('list'),
          filter: and({ attributeId: id('listStage'), operator: 'is', value: id('qualified') }),
          sorts: [by('due')],
        }),
    },
    {
      name: '7. sort by name, the page after a cursor',
      run: async () => {
        const first = await queryPage(scope, { objectId: id('deals'), sorts: [by('deals.name')], limit: 1 });
        return queryPage(scope, {
          objectId: id('deals'),
          sorts: [by('deals.name')],
          limit: 1,
          ...(first.nextCursor === undefined ? {} : { cursor: first.nextCursor }),
        });
      },
    },
    { name: '10. sort by stage, then by name', run: page({ sorts: [by('deals.stage'), by('deals.name')] }) },
    {
      name: '11. a rare contains, sort by name',
      run: page({
        filter: and({ attributeId: id('deals.name'), operator: 'contains', value: 'zephyr' }),
        sorts: [by('deals.name')],
      }),
    },
    {
      name: '12. a sort by the linked company',
      run: page({ sorts: [by('deals.associated_company')] }),
    },
    { name: 'count: everything', run: () => countMatches(scope, { objectId: id('deals') }) },
    {
      name: 'count: a filter and a contains',
      run: () =>
        countMatches(scope, {
          objectId: id('deals'),
          filter: and(
            { attributeId: id('deals.name'), operator: 'contains', value: 'expansion' },
            { attributeId: id('deals.next_step'), operator: 'is_empty' },
          ),
        }),
    },
    { name: 'count: a list', run: () => countMatches(scope, { listId: id('list') }) },
    {
      name: 'read: records by id',
      run: async () => {
        const all = await queryPage(scope, { objectId: id('deals') });
        return getRecords(scope, { ids: all.records.map((record) => record.id) });
      },
    },
  ];
};

describe('the open policy (AC-149)', () => {
  it('sends the same statements for every page, count, search and read as before the access model', async () => {
    const parts: string[] = [];
    for (const { name, run } of grid()) parts.push(`=== ${name}\n\n${await transcript(run)}`);
    await expect(`${parts.join('\n\n')}\n`).toMatchFileSnapshot('./__snapshots__/open-policy.sql.txt');
  });
});
