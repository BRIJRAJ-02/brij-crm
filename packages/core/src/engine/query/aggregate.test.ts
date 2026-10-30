// A column's calculation (the CRM flow pass, `records.aggregate`): counts as a
// view counts, amounts exact from the stored keys (a currency per currency),
// the whole object and a filtered view agreeing with plain arithmetic, a
// filtered view past the cap answering tooMany rather than a part, and the
// access door: a hidden attribute refused, a hidden object not found.
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, type Database } from '@crm/db';
import type { FilterGroup } from '@crm/contracts/values';
import { defineAttribute, defineObject } from '../definitions.ts';
import { createRecord } from '../records.ts';
import { isRefusal } from '../refusals.ts';
import type { EngineScope } from '../scope.ts';
import { createWorkspace } from '../workspaces.ts';
import { aggregateMatches } from './page.ts';
import { rescope, testScope } from '../../testing.ts';

const { appUrl } = inject('testDatabase');
let db: Database;
let scope: EngineScope;
let deals = '';
const a: Record<string, string> = {};
const seeded: { amount: number | null; price: { amount: number; currency: string } | null }[] = [];

const id = (slug: string): string => {
  const value = a[slug];
  if (value === undefined) throw new Error(`No ${slug}.`);
  return value;
};

beforeAll(async () => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-aggregate-tests' });
  const created = await createWorkspace(db, {
    name: 'Sums',
    slug: `sums-${String(Date.now())}`,
    firstMember: { name: 'Sam', email: 'sam@example.com' },
  });
  scope = testScope({ db, workspaceId: created.workspaceId, actor: { type: 'member', id: created.memberId } });
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
  ] as const) {
    a[slug] = (
      await defineAttribute(scope, { objectId: deals, apiSlug: slug, title: slug, type, ...extra })
    ).attributeId;
  }
  // 12 records: amounts 0.5 to 5.5 with every fourth empty, prices in two currencies with every fifth empty.
  for (let n = 0; n < 12; n += 1) {
    const amount = n % 4 === 3 ? null : n / 2 + 0.5;
    const price = n % 5 === 4 ? null : { amount: (n + 1) * 100, currency: n % 2 === 0 ? 'USD' : 'EUR' };
    await createRecord(scope, {
      objectId: deals,
      values: {
        [id('title')]: `Sum ${String(n)}`,
        ...(amount === null ? {} : { [id('amount')]: String(amount) }),
        ...(price === null ? {} : { [id('price')]: { amount: String(price.amount), currency: price.currency } }),
      },
    });
    seeded.push({ amount, price });
  }
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

const amounts = () => seeded.flatMap((each) => (each.amount === null ? [] : [each.amount]));

describe('records.aggregate', () => {
  it('counts the filled and the empty as a view counts', async () => {
    const filled = await aggregateMatches(scope, { objectId: deals, attributeId: id('amount'), fn: 'count' });
    const empty = await aggregateMatches(scope, { objectId: deals, attributeId: id('amount'), fn: 'count_empty' });
    expect(filled).toEqual({ count: amounts().length, atLeast: false });
    expect(empty).toEqual({ count: seeded.length - amounts().length, atLeast: false });
  });

  it('works out a whole object’s sum, average, least and most exactly', async () => {
    const of = (fn: 'sum' | 'avg' | 'min' | 'max') =>
      aggregateMatches(scope, { objectId: deals, attributeId: id('amount'), fn }).then((answer) => answer.amounts);
    const values = amounts();
    const sum = values.reduce((total, each) => total + each, 0);
    expect(await of('sum')).toEqual([{ value: String(sum) }]);
    expect(await of('avg')).toEqual([{ value: String(Math.round((sum / values.length) * 10_000) / 10_000) }]);
    expect(await of('min')).toEqual([{ value: String(Math.min(...values)) }]);
    expect(await of('max')).toEqual([{ value: String(Math.max(...values)) }]);
  });

  it('sums a currency per currency, over a filtered view', async () => {
    const filter: FilterGroup = {
      conjunction: 'and',
      conditions: [{ attributeId: id('amount'), operator: 'gte', value: '2' }],
    };
    const answer = await aggregateMatches(scope, { objectId: deals, attributeId: id('price'), fn: 'sum', filter });
    const expected = new Map<string, number>();
    for (const each of seeded) {
      if (each.amount === null || each.amount < 2 || each.price === null) continue;
      expected.set(each.price.currency, (expected.get(each.price.currency) ?? 0) + each.price.amount);
    }
    expect([...(answer.amounts ?? [])].sort((x, y) => (x.currency ?? '').localeCompare(y.currency ?? ''))).toEqual(
      [...expected]
        .sort(([x], [y]) => x.localeCompare(y))
        .map(([currency, value]) => ({ value: String(value), currency })),
    );
  });

  it('answers tooMany for a filtered view past the cap, never a part', async () => {
    const filter: FilterGroup = {
      conjunction: 'and',
      conditions: [{ attributeId: id('title'), operator: 'is_not_empty' }],
    };
    expect(
      await aggregateMatches(scope, { objectId: deals, attributeId: id('amount'), fn: 'sum', filter }, undefined, {
        cap: 3,
      }),
    ).toEqual({ tooMany: true });
  });

  it('refuses a sum of text, a hidden attribute, and answers a hidden object as not found', async () => {
    expect(
      (await refusalOf(aggregateMatches(scope, { objectId: deals, attributeId: id('title'), fn: 'sum' })))?.code,
    ).toBe('FILTER_INVALID');
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
      expect(
        (await refusalOf(aggregateMatches(hiddenAmount, { objectId: deals, attributeId: id('amount'), fn })))?.code,
      ).toBe('FILTER_INVALID');
    }
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
      (await refusalOf(aggregateMatches(hiddenObject, { objectId: deals, attributeId: id('amount'), fn: 'max' })))
        ?.code,
    ).toBe('NOT_FOUND');
  });
});
