// A view's calculations (the CRM flow pass, `records.aggregate` and
// `records.aggregateGroups`): counts as a view counts, amounts exact from the
// stored keys (a currency per currency), a whole footer in one call agreeing
// with each ask alone, the whole object and a filtered view agreeing with
// plain arithmetic, a filtered view past the cap and a column past its
// currencies answering tooMany rather than a part, a board's column totals in
// one call (stored keys, a filter, a checkbox, a record rule), and the access
// door: a hidden attribute refused, a hidden object not found, a record rule
// narrowing every figure, another workspace's ids answering nothing.
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, type Database } from '@crm/db';
import type { AggregateFn, FilterGroup } from '@crm/contracts/values';
import { defineAttribute, defineObject } from '../definitions.ts';
import { defineOption } from '../options.ts';
import { createRecord } from '../records.ts';
import { isRefusal } from '../refusals.ts';
import type { EngineScope } from '../scope.ts';
import { createWorkspace } from '../workspaces.ts';
import { aggregateGroups, aggregateMatches, type Aggregate } from './page.ts';
import { rescope, testScope } from '../../testing.ts';

const { appUrl } = inject('testDatabase');
let db: Database;
let scope: EngineScope;
let deals = '';
let memberId = '';
const a: Record<string, string> = {};
const o: Record<string, string> = {};
const STAGES = ['lead', 'won'] as const;
interface Seeded {
  readonly amount: number | null;
  readonly price: { readonly amount: number; readonly currency: string } | null;
  readonly stage: (typeof STAGES)[number] | null;
  readonly done: boolean;
  readonly mine: boolean;
}
const seeded: Seeded[] = [];
// Another workspace, with its own object and attribute: never readable from the first.
let otherObject = '';
let otherAttribute = '';

const id = (slug: string): string => {
  const value = a[slug];
  if (value === undefined) throw new Error(`No ${slug}.`);
  return value;
};
const opt = (label: string): string => {
  const value = o[label];
  if (value === undefined) throw new Error(`No ${label}.`);
  return value;
};

beforeAll(async () => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-aggregate-tests' });
  const created = await createWorkspace(db, {
    name: 'Sums',
    slug: `sums-${String(Date.now())}`,
    firstMember: { name: 'Sam', email: 'sam@example.com' },
  });
  memberId = created.memberId;
  scope = testScope({ db, workspaceId: created.workspaceId, actor: { type: 'member', id: memberId } });
  ({ objectId: deals } = await defineObject(scope, {
    apiSlug: 'sums',
    singularName: 'Sum',
    pluralName: 'Sums',
    icon: 'rocket',
    hue: 'blue',
  }));
  for (const [slug, type, extra] of [
    ['title', 'text', {}],
    ['amount', 'number', {}],
    ['price', 'currency', { config: { defaultCurrency: 'USD' } }],
    ['stage', 'status', {}],
    ['done', 'checkbox', {}],
    ['owner', 'actor_reference', {}],
  ] as const) {
    a[slug] = (
      await defineAttribute(scope, { objectId: deals, apiSlug: slug, title: slug, type, ...extra })
    ).attributeId;
  }
  for (const label of STAGES) {
    o[label] = (await defineOption(scope, { attributeId: id('stage'), label, hue: 'blue' })).optionId;
  }
  // 12 records: amounts 0.5 to 5.5 with every fourth empty, prices in two currencies with every fifth empty,
  // stages in turn with every third empty, every other one done, and every third one the member's own.
  for (let n = 0; n < 12; n += 1) {
    const amount = n % 4 === 3 ? null : n / 2 + 0.5;
    const price = n % 5 === 4 ? null : { amount: (n + 1) * 100, currency: n % 2 === 0 ? 'USD' : 'EUR' };
    const stage = n % 3 === 2 ? null : (STAGES[n % 2] ?? null);
    const done = n % 2 === 1;
    const mine = n % 3 === 0;
    await createRecord(scope, {
      objectId: deals,
      values: {
        [id('title')]: `Sum ${String(n)}`,
        ...(amount === null ? {} : { [id('amount')]: String(amount) }),
        ...(price === null ? {} : { [id('price')]: { amount: String(price.amount), currency: price.currency } }),
        ...(stage === null ? {} : { [id('stage')]: opt(stage) }),
        [id('done')]: done,
        ...(mine ? { [id('owner')]: { type: 'member', id: memberId } } : {}),
      },
    });
    seeded.push({ amount, price, stage, done, mine });
  }
  const other = await createWorkspace(db, {
    name: 'Elsewhere',
    slug: `elsewhere-${String(Date.now())}`,
    firstMember: { name: 'Eve', email: 'eve@example.com' },
  });
  const otherScope = testScope({ db, workspaceId: other.workspaceId, actor: { type: 'member', id: other.memberId } });
  ({ objectId: otherObject } = await defineObject(otherScope, {
    apiSlug: 'secrets',
    singularName: 'Secret',
    pluralName: 'Secrets',
    icon: 'rocket',
    hue: 'red',
  }));
  otherAttribute = (
    await defineAttribute(otherScope, { objectId: otherObject, apiSlug: 'worth', title: 'Worth', type: 'number' })
  ).attributeId;
  await createRecord(otherScope, { objectId: otherObject, values: { [otherAttribute]: '999' } });
});

afterAll(async () => {
  await db.close();
});

const refusalOf = async (work: Promise<unknown>) => {
  try {
    await work;
  } catch (error) {
    if (isRefusal(error)) return error.refusals[0];
    throw error;
  }
  throw new Error('Expected a refusal.');
};

/** One ask alone, as a footer cell would. */
const one = async (
  as: EngineScope,
  ask: { readonly attributeId: string; readonly fn: AggregateFn; readonly filter?: FilterGroup },
  tuning: { readonly cap?: number; readonly currencies?: number } = {},
): Promise<Aggregate | undefined> => {
  const { filter, ...rest } = ask;
  const { answers } = await aggregateMatches(
    as,
    { objectId: deals, asks: [rest], ...(filter === undefined ? {} : { filter }) },
    undefined,
    tuning,
  );
  return answers[0];
};

const ownOnly = (): EngineScope =>
  rescope(scope, {
    role: 'member',
    rules: {
      levels: [],
      records: [{ subject: { type: 'role', role: 'member' }, objectId: deals, kind: 'own', attributeId: id('owner') }],
    },
  });

const amounts = (records: readonly Seeded[] = seeded) =>
  records.flatMap((each) => (each.amount === null ? [] : [each.amount]));

/** A currency's sums by currency, sorted, as the answer names them. */
const pricesBy = (records: readonly Seeded[]) => {
  const totals = new Map<string, number>();
  for (const each of records) {
    if (each.price === null) continue;
    totals.set(each.price.currency, (totals.get(each.price.currency) ?? 0) + each.price.amount);
  }
  return [...totals]
    .sort(([x], [y]) => x.localeCompare(y))
    .map(([currency, value]) => ({ value: String(value), currency }));
};
const sortedAmounts = (answer: Aggregate | undefined) =>
  [...(answer?.amounts ?? [])].sort((x, y) => (x.currency ?? '').localeCompare(y.currency ?? ''));

const atLeastTwo: FilterGroup = {
  conjunction: 'and',
  conditions: [{ attributeId: 'amount', operator: 'gte', value: '2' }],
};
const withAmount = (filter: FilterGroup): FilterGroup => ({
  ...filter,
  conditions: filter.conditions.map((condition) =>
    'attributeId' in condition && condition.attributeId === 'amount'
      ? { ...condition, attributeId: id('amount') }
      : condition,
  ),
});

describe('records.aggregate', () => {
  it('counts the filled and the empty as a view counts', async () => {
    expect(await one(scope, { attributeId: id('amount'), fn: 'count' })).toEqual({
      count: amounts().length,
      atLeast: false,
    });
    expect(await one(scope, { attributeId: id('amount'), fn: 'count_empty' })).toEqual({
      count: seeded.length - amounts().length,
      atLeast: false,
    });
  });

  it('works out a whole object’s sum, average, least and most exactly', async () => {
    const of = (fn: 'sum' | 'avg' | 'min' | 'max') =>
      one(scope, { attributeId: id('amount'), fn }).then((answer) => answer?.amounts);
    const values = amounts();
    const sum = values.reduce((total, each) => total + each, 0);
    expect(await of('sum')).toEqual([{ value: String(sum) }]);
    expect(await of('avg')).toEqual([{ value: String(Math.round((sum / values.length) * 10_000) / 10_000) }]);
    expect(await of('min')).toEqual([{ value: String(Math.min(...values)) }]);
    expect(await of('max')).toEqual([{ value: String(Math.max(...values)) }]);
  });

  it('sums a currency per currency, whole and over a filtered view', async () => {
    expect(sortedAmounts(await one(scope, { attributeId: id('price'), fn: 'sum' }))).toEqual(pricesBy(seeded));
    const filter = withAmount(atLeastTwo);
    expect(sortedAmounts(await one(scope, { attributeId: id('price'), fn: 'sum', filter }))).toEqual(
      pricesBy(seeded.filter((each) => each.amount !== null && each.amount >= 2)),
    );
  });

  it('answers a whole footer in one call, each ask as it answers alone, in the order asked', async () => {
    const filter = withAmount(atLeastTwo);
    const asks = [
      { attributeId: id('price'), fn: 'max' },
      { attributeId: id('amount'), fn: 'count' },
      { attributeId: id('amount'), fn: 'sum' },
      { attributeId: id('price'), fn: 'sum' },
      { attributeId: id('title'), fn: 'count_empty' },
      { attributeId: id('amount'), fn: 'avg' },
    ] as const;
    for (const view of [{}, { filter }]) {
      const { answers } = await aggregateMatches(scope, { objectId: deals, asks, ...view });
      const alone = await Promise.all(asks.map((ask) => one(scope, { ...ask, ...view })));
      expect(answers.map(sortedAmountsOrSelf)).toEqual(alone.map(sortedAmountsOrSelf));
    }
  });

  it('answers tooMany for amounts past the cap, never a part, while counts still count', async () => {
    const filter: FilterGroup = {
      conjunction: 'and',
      conditions: [{ attributeId: id('title'), operator: 'is_not_empty' }],
    };
    const { answers } = await aggregateMatches(
      scope,
      {
        objectId: deals,
        filter,
        asks: [
          { attributeId: id('amount'), fn: 'sum' },
          { attributeId: id('amount'), fn: 'count' },
        ],
      },
      undefined,
      { cap: 3 },
    );
    expect(answers).toEqual([{ tooMany: true }, { count: 3, atLeast: true }]);
  });

  it('answers tooMany for a currency column holding more currencies than an amount names', async () => {
    expect(await one(scope, { attributeId: id('price'), fn: 'sum' }, { currencies: 1 })).toEqual({ tooMany: true });
    const filter = withAmount(atLeastTwo);
    expect(await one(scope, { attributeId: id('price'), fn: 'sum', filter }, { currencies: 1 })).toEqual({
      tooMany: true,
    });
  });

  it('refuses a sum of text, a hidden attribute, and answers a hidden object as not found', async () => {
    expect((await refusalOf(one(scope, { attributeId: id('title'), fn: 'sum' })))?.code).toBe('FILTER_INVALID');
    const hiddenAmount = rescope(scope, {
      role: 'member',
      rules: {
        levels: [
          {
            subject: { type: 'role', role: 'member' },
            target: { type: 'attribute', objectId: deals, attributeId: id('amount') },
            level: 'hidden',
          },
        ],
        records: [],
      },
    });
    for (const fn of ['sum', 'count'] as const) {
      expect((await refusalOf(one(hiddenAmount, { attributeId: id('amount'), fn })))?.code).toBe('FILTER_INVALID');
    }
    // One hidden ask refuses the whole call: nothing else comes back beside it.
    expect(
      (
        await refusalOf(
          aggregateMatches(hiddenAmount, {
            objectId: deals,
            asks: [
              { attributeId: id('price'), fn: 'sum' },
              { attributeId: id('amount'), fn: 'sum' },
            ],
          }),
        )
      )?.code,
    ).toBe('FILTER_INVALID');
    const hiddenObject = rescope(scope, {
      role: 'member',
      rules: {
        levels: [
          { subject: { type: 'role', role: 'member' }, target: { type: 'object', objectId: deals }, level: 'none' },
        ],
        records: [],
      },
    });
    expect((await refusalOf(one(hiddenObject, { attributeId: id('amount'), fn: 'max' })))?.code).toBe('NOT_FOUND');
  });

  it('works out every figure over only the member’s own records under an own records rule', async () => {
    const own = ownOnly();
    const mine = seeded.filter((each) => each.mine);
    const values = amounts(mine);
    for (const filter of [undefined, withAmount(atLeastTwo)]) {
      const kept = filter === undefined ? values : values.filter((value) => value >= 2);
      const view = filter === undefined ? {} : { filter };
      const { answers } = await aggregateMatches(own, {
        objectId: deals,
        asks: [
          { attributeId: id('amount'), fn: 'sum' },
          { attributeId: id('amount'), fn: 'max' },
          { attributeId: id('amount'), fn: 'count' },
          { attributeId: id('price'), fn: 'sum' },
        ],
        ...view,
      });
      expect(answers[0]).toEqual({ amounts: [{ value: String(kept.reduce((total, each) => total + each, 0)) }] });
      expect(answers[1]).toEqual({ amounts: [{ value: String(Math.max(...kept)) }] });
      expect(answers[2]).toEqual({ count: kept.length, atLeast: false });
      expect(sortedAmounts(answers[3])).toEqual(
        pricesBy(mine.filter((each) => filter === undefined || (each.amount !== null && each.amount >= 2))),
      );
    }
  });

  it('answers another workspace’s object as not found, and its attribute as unknown, with no amounts', async () => {
    const elsewhere = await refusalOf(
      aggregateMatches(scope, { objectId: otherObject, asks: [{ attributeId: otherAttribute, fn: 'sum' }] }),
    );
    expect(elsewhere?.code).toBe('NOT_FOUND');
    const borrowed = await refusalOf(
      aggregateMatches(scope, { objectId: deals, asks: [{ attributeId: otherAttribute, fn: 'sum' }] }),
    );
    expect(borrowed?.code).toBe('FILTER_INVALID');
    expect(JSON.stringify([elsewhere, borrowed])).not.toContain('999');
  });
});

/** An answer with its amounts in currency order, so two answers compare whatever order ties came in. */
function sortedAmountsOrSelf(answer: Aggregate | undefined): Aggregate | undefined {
  return answer?.amounts === undefined ? answer : { ...answer, amounts: sortedAmounts(answer) };
}

describe('records.aggregateGroups', () => {
  const stageColumns = () => [null, opt('lead'), opt('won')];
  const expectedByStage = (records: readonly Seeded[]) =>
    [null, 'lead', 'won'].map((stage) => pricesBy(records.filter((each) => each.stage === stage)));
  const totals = (groups: readonly { readonly answers: readonly Aggregate[] }[]) =>
    groups.map((group) => sortedAmounts(group.answers[0]));

  it('totals each option column from the stored keys, in one call, in the order asked', async () => {
    const { groups } = await aggregateGroups(scope, {
      objectId: deals,
      groupBy: id('stage'),
      groupIds: stageColumns(),
      asks: [{ attributeId: id('price'), fn: 'sum' }],
    });
    expect(groups.map((group) => group.id)).toEqual(stageColumns());
    expect(totals(groups)).toEqual(expectedByStage(seeded));
  });

  it('totals each column under the view’s filter, and a checkbox’s two columns', async () => {
    const filter = withAmount(atLeastTwo);
    const filtered = await aggregateGroups(scope, {
      objectId: deals,
      groupBy: id('stage'),
      groupIds: stageColumns(),
      asks: [{ attributeId: id('price'), fn: 'sum' }],
      filter,
    });
    expect(totals(filtered.groups)).toEqual(
      expectedByStage(seeded.filter((each) => each.amount !== null && each.amount >= 2)),
    );
    const checkbox = await aggregateGroups(scope, {
      objectId: deals,
      groupBy: id('done'),
      groupIds: ['unchecked', 'checked'],
      asks: [{ attributeId: id('amount'), fn: 'sum' }],
    });
    const sumOf = (done: boolean) =>
      amounts(seeded.filter((each) => each.done === done)).reduce((total, each) => total + each, 0);
    expect(checkbox.groups.map((group) => group.answers[0])).toEqual([
      { amounts: [{ value: String(sumOf(false)) }] },
      { amounts: [{ value: String(sumOf(true)) }] },
    ]);
  });

  it('totals only the member’s own records under an own records rule', async () => {
    const { groups } = await aggregateGroups(ownOnly(), {
      objectId: deals,
      groupBy: id('stage'),
      groupIds: stageColumns(),
      asks: [{ attributeId: id('price'), fn: 'sum' }],
    });
    expect(totals(groups)).toEqual(expectedByStage(seeded.filter((each) => each.mine)));
  });

  it('answers tooMany in every column past the cap, and past the currencies an amount names', async () => {
    const filter = withAmount({
      conjunction: 'and',
      conditions: [{ attributeId: 'amount', operator: 'gte', value: '0' }],
    });
    const query = {
      objectId: deals,
      groupBy: id('stage'),
      groupIds: stageColumns(),
      asks: [{ attributeId: id('price'), fn: 'sum' }] as const,
    };
    const capped = await aggregateGroups(scope, { ...query, filter }, undefined, { cap: 3 });
    expect(capped.groups.map((group) => group.answers)).toEqual(stageColumns().map(() => [{ tooMany: true }]));
    // Each stage column holds both currencies: one currency an amount is too few, on either path.
    for (const view of [{}, { filter }]) {
      const { groups } = await aggregateGroups(scope, { ...query, ...view }, undefined, { currencies: 1 });
      const both = expectedByStage(seeded).map((column) => column.length > 1);
      expect(groups.map((group) => group.answers[0]?.tooMany === true)).toEqual(both);
    }
  });

  it('refuses a count, a field that can’t group, and a hidden object', async () => {
    expect(
      await refusalOf(
        aggregateGroups(scope, {
          objectId: deals,
          groupBy: id('title'),
          groupIds: [null],
          asks: [{ attributeId: id('price'), fn: 'sum' }],
        }),
      ),
    ).toMatchObject({ code: 'CONFIG_INVALID' });
    await expect(
      aggregateGroups(scope, {
        objectId: deals,
        groupBy: id('stage'),
        groupIds: [null],
        asks: [{ attributeId: id('price'), fn: 'count' }],
      }),
    ).rejects.toThrow('A board column totals amounts only.');
    expect(
      (
        await refusalOf(
          aggregateGroups(scope, {
            objectId: otherObject,
            groupBy: id('stage'),
            groupIds: [null],
            asks: [{ attributeId: otherAttribute, fn: 'sum' }],
          }),
        )
      )?.code,
    ).toBe('NOT_FOUND');
  });
});
