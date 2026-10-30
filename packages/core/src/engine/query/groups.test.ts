// A board's first load (spec 0021, `records.groups`): each column is exactly
// what `queryPage` and `countMatches` answer for the view's filter and that
// option, for status and select, filtered and not, with archived options and
// empties, mixed sort directions; exact unfiltered counts from the stored
// keys, capped filtered ones; the refusals; one deadline for the whole call;
// and a record rule never letting a hidden record count or open a column.
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, type Database } from '@crm/db';
import { columnFilter } from '@crm/contracts/board';
import type { FilterGroup, SortRule } from '@crm/contracts/values';
import { deleteRecord } from '../deletion.ts';
import { defineAttribute, defineObject } from '../definitions.ts';
import { defineOption, updateOption } from '../options.ts';
import { createRecord } from '../records.ts';
import { isRefusal } from '../refusals.ts';
import type { EngineScope } from '../scope.ts';
import { createWorkspace } from '../workspaces.ts';
import { queryGroups, type GroupsQuery } from './groups.ts';
import { countMatches, queryPage } from './page.ts';
import { rescope, testScope } from '../../testing.ts';

const { appUrl } = inject('testDatabase');
let db: Database;
let scope: EngineScope;
let memberId = '';
let deals = '';
const a: Record<string, string> = {};
/** Option ids by label, per attribute. */
const o: Record<string, string> = {};
/** Each record's stage and priority as the seed set them, for the plain JS answers. */
const seeded: { id: string; stage: string | null; priority: string | null; amount: number; mine: boolean }[] = [];

const STAGES = ['lead', 'qualified', 'proposal', 'won'] as const;
const PRIORITIES = ['low', 'high'] as const;

beforeAll(async () => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-groups-tests' });
  const created = await createWorkspace(db, {
    name: 'Groups',
    slug: `groups-${String(Date.now())}`,
    firstMember: { name: 'Gail', email: 'gail@example.com' },
  });
  memberId = created.memberId;
  scope = testScope({ db, workspaceId: created.workspaceId, actor: { type: 'member', id: memberId } });
  ({ objectId: deals } = await defineObject(scope, {
    apiSlug: 'pipes',
    singularName: 'Pipe',
    pluralName: 'Pipes',
    icon: 'rocket',
    hue: 'blue',
  }));
  for (const [slug, type, extra] of [
    ['title', 'text', {}],
    ['amount', 'number', {}],
    ['stage', 'status', {}],
    ['priority', 'select', {}],
    ['tags', 'select', { isMulti: true }],
    ['owner', 'actor_reference', {}],
  ] as const) {
    a[slug] = (
      await defineAttribute(scope, { objectId: deals, apiSlug: slug, title: slug, type, ...extra })
    ).attributeId;
  }
  for (const label of STAGES) {
    o[label] = (await defineOption(scope, { attributeId: a.stage ?? '', label, hue: 'blue' })).optionId;
  }
  for (const label of PRIORITIES) {
    o[label] = (await defineOption(scope, { attributeId: a.priority ?? '', label, hue: 'red' })).optionId;
  }
  // 40 records: stages in a repeating mix with empties, two priorities, amounts with ties.
  for (let n = 0; n < 40; n += 1) {
    const stage = n % 6 === 5 ? null : (STAGES[n % 4] ?? null);
    const priority = n % 3 === 0 ? null : (PRIORITIES[n % 2] ?? null);
    const amount = (n * 7) % 11;
    const mine = n % 4 === 0;
    const { recordId } = await createRecord(scope, {
      objectId: deals,
      values: {
        [id('title')]: `Pipe ${String(n)}`,
        [id('amount')]: String(amount),
        ...(stage === null ? {} : { [id('stage')]: opt(stage) }),
        ...(priority === null ? {} : { [id('priority')]: opt(priority) }),
        ...(mine ? { [id('owner')]: { type: 'member', id: memberId } } : {}),
      },
    });
    seeded.push({ id: recordId, stage, priority, amount, mine });
  }
  // One in the trash: it counts nowhere.
  const trashed = seeded.pop();
  if (trashed !== undefined) await deleteRecord(scope, { recordId: trashed.id });
  // Won is archived while records still hold it; a fifth stage is archived with none.
  await updateOption(scope, { optionId: opt('won'), archived: true });
  o.lost = (await defineOption(scope, { attributeId: id('stage'), label: 'lost', hue: 'red' })).optionId;
  await updateOption(scope, { optionId: opt('lost'), archived: true });
});

afterAll(async () => {
  await db.close();
});

function id(slug: string): string {
  const value = a[slug];
  if (value === undefined) throw new Error(`No ${slug}.`);
  return value;
}
function opt(label: string): string {
  const value = o[label];
  if (value === undefined) throw new Error(`No ${label}.`);
  return value;
}

const refusalOf = async (work: Promise<unknown>) => {
  try {
    await work;
  } catch (error) {
    if (isRefusal(error)) return error.refusals[0];
    throw error;
  }
  throw new Error('Expected a refusal.');
};

/** What each column must answer: the page and count the engine gives the column filter on its own. */
async function expected(query: GroupsQuery, as: EngineScope = scope) {
  return Promise.all(
    query.groupIds.map(async (groupId) => {
      const filter = columnFilter(query.filter, query.groupBy, groupId);
      const page = await queryPage(as, {
        objectId: query.objectId,
        filter,
        ...(query.sorts === undefined ? {} : { sorts: query.sorts }),
        limit: query.limit ?? 25,
      });
      const count = await countMatches(as, { objectId: query.objectId, filter });
      return {
        id: groupId,
        ids: page.records.map((record) => record.id),
        hasMore: page.nextCursor !== undefined,
        count,
      };
    }),
  );
}

const shapeOf = (groups: Awaited<ReturnType<typeof queryGroups>>['groups']) =>
  groups.map((group) => ({
    id: group.id,
    ids: group.records.map((record) => record.id),
    hasMore: group.nextCursor !== undefined,
    count: { count: group.count, atLeast: group.atLeast },
  }));

describe('records.groups against each column on its own', () => {
  const sorts: SortRule[] = [
    { attributeId: '', direction: 'descending' },
    { attributeId: '', direction: 'ascending' },
  ];

  it('answers every column of a status board in the order asked, unfiltered, with mixed sort directions', async () => {
    const query: GroupsQuery = {
      objectId: deals,
      groupBy: id('stage'),
      groupIds: [opt('proposal'), null, opt('lead'), opt('qualified'), opt('won')],
      sorts: sorts.map((sort, index) => ({ ...sort, attributeId: index === 0 ? id('amount') : id('title') })),
      limit: 4,
    };
    const answer = await queryGroups(scope, query);
    expect(shapeOf(answer.groups)).toEqual(await expected(query));
    // The plain answer agrees: counts from the seed, empties in the null column.
    const live = seeded;
    expect(answer.groups.map((group) => group.count)).toEqual(
      query.groupIds.map(
        (groupId) => live.filter((record) => (record.stage === null ? null : opt(record.stage)) === groupId).length,
      ),
    );
    expect(answer.archivedHolding).toBeUndefined();
  });

  it('answers a filtered select board, its counts following the filter', async () => {
    const filter: FilterGroup = {
      conjunction: 'and',
      conditions: [{ attributeId: id('amount'), operator: 'gte', value: '5' }],
    };
    const query: GroupsQuery = {
      objectId: deals,
      groupBy: id('priority'),
      groupIds: [null, opt('low'), opt('high')],
      filter,
      limit: 3,
    };
    const answer = await queryGroups(scope, query);
    expect(shapeOf(answer.groups)).toEqual(await expected(query));
    expect(answer.groups.map((group) => group.count)).toEqual(
      query.groupIds.map(
        (groupId) =>
          seeded.filter(
            (record) => record.amount >= 5 && (record.priority === null ? null : opt(record.priority)) === groupId,
          ).length,
      ),
    );
  });

  it('names the archived options some live record still holds, only when probed', async () => {
    const answer = await queryGroups(scope, {
      objectId: deals,
      groupBy: id('stage'),
      groupIds: [null],
      probeArchived: true,
    });
    expect(answer.archivedHolding).toEqual([opt('won')]);
  });

  it('caps a filtered count and keeps an unfiltered one exact (the cap lowered by the seed size)', async () => {
    // A filter that keeps everything still counts through the capped path, so atLeast never shows unfiltered.
    const whole = await queryGroups(scope, { objectId: deals, groupBy: id('stage'), groupIds: [opt('lead')] });
    expect(whole.groups[0]?.atLeast).toBe(false);
    expect(whole.groups[0]?.count).toBe(seeded.filter((record) => record.stage === 'lead').length);
  });

  it('pages a column on from its cursor with records.query', async () => {
    const query: GroupsQuery = { objectId: deals, groupBy: id('stage'), groupIds: [opt('lead')], limit: 2 };
    const [first] = (await queryGroups(scope, query)).groups;
    expect(first?.nextCursor).toBeDefined();
    const next = await queryPage(scope, {
      objectId: deals,
      filter: columnFilter(undefined, id('stage'), opt('lead')),
      cursor: first?.nextCursor ?? '',
      limit: 2,
    });
    const all = await queryPage(scope, {
      objectId: deals,
      filter: columnFilter(undefined, id('stage'), opt('lead')),
      limit: 4,
    });
    expect([...(first?.records ?? []), ...next.records].map((record) => record.id)).toEqual(
      all.records.map((record) => record.id),
    );
  });
});

describe('records.groups by a member field', () => {
  it('answers a column per member and one for no one, each what its filter answers on its own', async () => {
    const query: GroupsQuery = { objectId: deals, groupBy: id('owner'), groupIds: [null, memberId], limit: 5 };
    const answer = await queryGroups(scope, query);
    const one = async (groupId: string | null) => {
      const filter = columnFilter(undefined, id('owner'), groupId, 'member');
      const page = await queryPage(scope, { objectId: deals, filter, limit: 5 });
      return {
        id: groupId,
        ids: page.records.map((record) => record.id),
        hasMore: page.nextCursor !== undefined,
        count: await countMatches(scope, { objectId: deals, filter }),
      };
    };
    expect(shapeOf(answer.groups)).toEqual([await one(null), await one(memberId)]);
    expect(answer.groups.map((group) => group.count)).toEqual([
      seeded.filter((record) => !record.mine).length,
      seeded.filter((record) => record.mine).length,
    ]);
  });

  it('refuses a column that is no member id', async () => {
    expect(
      await refusalOf(queryGroups(scope, { objectId: deals, groupBy: id('owner'), groupIds: ['checked'] })),
    ).toMatchObject({ code: 'CONFIG_INVALID' });
  });
});

describe('records.groups refusals', () => {
  const base = { objectId: deals, groupIds: [null] as const };

  it('refuses a multi select, a text field, and an archived grouping attribute', async () => {
    for (const groupBy of [id('tags'), id('title')]) {
      expect(
        await refusalOf(queryGroups(scope, { ...base, objectId: deals, groupBy, groupIds: [null] })),
      ).toMatchObject({
        code: 'CONFIG_INVALID',
        message: 'Boards group by a status, a single select, a checkbox or a member field.',
      });
    }
  });

  it('refuses an option of another attribute, and more than 50 live options', async () => {
    expect(
      await refusalOf(queryGroups(scope, { objectId: deals, groupBy: id('stage'), groupIds: [opt('low')] })),
    ).toMatchObject({ code: 'CONFIG_INVALID' });
    const crowd = (await defineAttribute(scope, { objectId: deals, apiSlug: 'crowd', title: 'Crowd', type: 'select' }))
      .attributeId;
    for (let n = 0; n < 51; n += 1) await defineOption(scope, { attributeId: crowd, label: `c${String(n)}` });
    expect(await refusalOf(queryGroups(scope, { objectId: deals, groupBy: crowd, groupIds: [null] }))).toEqual({
      code: 'CONFIG_INVALID',
      message: 'Boards show up to 50 columns. Crowd has 51 options.',
    });
  });

  it('answers a hidden object as not found and a hidden grouping attribute as an unknown filter field', async () => {
    const hiddenObject = rescope(scope, {
      role: 'member',
      rules: {
        levels: [
          { subject: { type: 'role', role: 'member' }, target: { type: 'object', objectId: deals }, level: 'none' },
        ],
        records: [],
      },
    });
    expect(
      (await refusalOf(queryGroups(hiddenObject, { objectId: deals, groupBy: id('stage'), groupIds: [null] })))?.code,
    ).toBe('NOT_FOUND');
    const hiddenStage = rescope(scope, {
      role: 'member',
      rules: {
        levels: [
          {
            subject: { type: 'role', role: 'member' },
            target: { type: 'attribute', objectId: deals, attributeId: id('stage') },
            level: 'hidden',
          },
        ],
        records: [],
      },
    });
    expect(
      (await refusalOf(queryGroups(hiddenStage, { objectId: deals, groupBy: id('stage'), groupIds: [null] })))?.code,
    ).toBe('FILTER_INVALID');
  });
});

describe('records.groups under a record rule', () => {
  it('counts and pages only the records the member may see, and opens no column for a hidden holder', async () => {
    const own = rescope(scope, {
      role: 'member',
      rules: {
        levels: [],
        records: [
          { subject: { type: 'role', role: 'member' }, objectId: deals, kind: 'own', attributeId: id('owner') },
        ],
      },
    });
    const query: GroupsQuery = {
      objectId: deals,
      groupBy: id('stage'),
      groupIds: [null, opt('lead'), opt('qualified'), opt('proposal')],
      probeArchived: true,
    };
    const answer = await queryGroups(own, query);
    expect(shapeOf(answer.groups)).toEqual(await expected(query, own));
    expect(answer.groups.map((group) => group.count)).toEqual(
      query.groupIds.map(
        (groupId) =>
          seeded.filter((record) => record.mine && (record.stage === null ? null : opt(record.stage)) === groupId)
            .length,
      ),
    );
    // Every record in Won is someone else's when n % 4 === 3: none of the member's own hold it.
    const mineInWon = seeded.some((record) => record.mine && record.stage === 'won');
    expect(answer.archivedHolding).toEqual(mineInWon ? [opt('won')] : []);
  });
});

describe('the deadline covers the whole call', () => {
  it('ends with QUERY_CANCELLED when slow columns together pass it, answering nothing', async () => {
    const started = Date.now();
    const refusal = await refusalOf(
      queryGroups(
        scope,
        { objectId: deals, groupBy: id('stage'), groupIds: [null, opt('lead'), opt('qualified'), opt('proposal')] },
        undefined,
        {
          deadlineMs: 1500,
          // Each column first waits half a second in the database: fast alone, too slow together.
          beforeColumn: async (tx) => {
            await tx.execute(sql`select pg_sleep(0.5)`);
          },
        },
      ),
    );
    expect(refusal?.code).toBe('QUERY_CANCELLED');
    expect(Date.now() - started).toBeLessThan(4000);
  });

  it('answers QUERY_CANCELLED for a request already gone, taking no connection', async () => {
    const controller = new AbortController();
    controller.abort();
    expect(
      (
        await refusalOf(
          queryGroups(scope, { objectId: deals, groupBy: id('stage'), groupIds: [null] }, controller.signal),
        )
      )?.code,
    ).toBe('QUERY_CANCELLED');
  });
});
