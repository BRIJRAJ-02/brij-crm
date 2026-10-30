import type { RecordAggregate } from '@crm/contracts';
import type { ReportPlan, ReportQuestion } from '@crm/contracts/reports';
import { describe, expect, it } from 'vitest';
import { aggregateKey, type AggregateSource, type AggregateState } from '../records/aggregate-source.ts';
import { createFiguresSource, figuresOf, stateOf } from './figures.ts';

const COUNT = 'created';

const countPlan: ReportPlan = {
  unit: 'count',
  truncated: false,
  questions: [
    { objectId: 'deals', asks: [{ attributeId: COUNT, fn: 'count' }] },
    { objectId: 'deals', asks: [{ attributeId: COUNT, fn: 'count' }] },
    { objectId: 'deals', asks: [{ attributeId: COUNT, fn: 'count' }] },
  ],
  slices: [
    { id: 'lead', label: 'Lead', question: 0, attributeId: COUNT, fn: 'count' },
    { id: 'won', label: 'Won', outcome: 'won', question: 1, attributeId: COUNT, fn: 'count' },
    { id: null, question: 2, attributeId: COUNT, fn: 'count' },
  ],
};

const countAnswer = (count: number, atLeast = false): ReadonlyMap<string, RecordAggregate> =>
  new Map([[aggregateKey(COUNT, 'count'), { count, atLeast }]]);

const sumPlan: ReportPlan = {
  unit: 'amount',
  measureAttributeId: 'value',
  truncated: false,
  questions: [
    {
      objectId: 'deals',
      asks: [{ attributeId: 'value', fn: 'sum' }],
      groupBy: 'stage',
      groupIds: ['lead', 'won', null],
    },
  ],
  slices: [
    { id: 'lead', question: 0, attributeId: 'value', fn: 'sum', groupId: 'lead' },
    { id: 'won', outcome: 'won', question: 0, attributeId: 'value', fn: 'sum', groupId: 'won' },
    { id: null, question: 0, attributeId: 'value', fn: 'sum', groupId: null },
  ],
};

describe('figuresOf', () => {
  it('makes a point of each count, noting one stopped at its cap', () => {
    const figures = figuresOf(countPlan, [countAnswer(4), countAnswer(10_000, true), countAnswer(0)]);
    expect(figures.points.map((point) => [point.id, point.value, point.atLeast])).toEqual([
      ['lead', 4, false],
      ['won', 10_000, true],
      [null, 0, false],
    ]);
    expect(figures.points[1]).toMatchObject({ label: 'Won', outcome: 'won' });
    expect(figures.total).toBe(10_004);
    expect(figures.hasData).toBe(true);
    expect(figures.currency).toBeUndefined();
  });

  it('says there is no data when every count is zero', () => {
    const figures = figuresOf(countPlan, [countAnswer(0), countAnswer(0), countAnswer(0)]);
    expect(figures.hasData).toBe(false);
  });

  it('reads a sum per stage under its column key, in the currency most groups hold', () => {
    const answers = new Map<string, RecordAggregate>([
      [aggregateKey('value', 'sum', 'lead'), { amounts: [{ value: '1200.5', currency: 'USD' }] }],
      [
        aggregateKey('value', 'sum', 'won'),
        {
          amounts: [
            { value: '300', currency: 'USD' },
            { value: '90', currency: 'EUR' },
          ],
        },
      ],
      [aggregateKey('value', 'sum', null), { amounts: [{ value: '70', currency: 'EUR' }] }],
    ]);
    const figures = figuresOf(sumPlan, [answers]);
    expect(figures.currency).toBe('USD');
    expect(figures.otherCurrencies).toEqual(['EUR']);
    expect(figures.points.map((point) => point.value)).toEqual([1200.5, 300, 0]);
    expect(figures.total).toBe(1500.5);
    expect(figures.isAverage).toBe(false);
  });

  it('reads plain numbers with no currency, and an average with no total', () => {
    const plan: ReportPlan = {
      unit: 'amount',
      measureAttributeId: 'seats',
      truncated: false,
      questions: [{ objectId: 'deals', asks: [{ attributeId: 'seats', fn: 'avg' }] }],
      slices: [{ question: 0, attributeId: 'seats', fn: 'avg' }],
    };
    const figures = figuresOf(plan, [new Map([[aggregateKey('seats', 'avg'), { amounts: [{ value: '4.25' }] }]])]);
    expect(figures.points[0]?.value).toBe(4.25);
    expect(figures.currency).toBeUndefined();
    expect(figures.total).toBeUndefined();
    expect(figures.isAverage).toBe(true);
  });

  it('draws nothing rather than a part when the engine says too many', () => {
    const answers = new Map<string, RecordAggregate>([[aggregateKey('value', 'sum', 'lead'), { tooMany: true }]]);
    const figures = figuresOf(sumPlan, [answers]);
    expect(figures.tooMany).toBe(true);
    expect(figures.hasData).toBe(false);
  });
});

const ready = (answers: ReadonlyMap<string, RecordAggregate>): AggregateState => ({ status: 'ready', answers });

describe('stateOf', () => {
  it('is loading until every question has answers, and an error as soon as one failed', () => {
    expect(stateOf(countPlan, [ready(countAnswer(1)), { status: 'loading' }, ready(countAnswer(1))])).toEqual({
      status: 'loading',
    });
    expect(stateOf(countPlan, [ready(countAnswer(1)), { status: 'error' }, { status: 'loading' }])).toEqual({
      status: 'error',
    });
    const state = stateOf(countPlan, [ready(countAnswer(1)), ready(countAnswer(2)), ready(countAnswer(3))]);
    expect(state.status).toBe('ready');
  });

  it('keeps the answers shown while a newer read is out and says it is refreshing', () => {
    const refreshing: AggregateState = { status: 'ready', answers: countAnswer(1), isRefreshing: true };
    const state = stateOf(countPlan, [refreshing, ready(countAnswer(2)), ready(countAnswer(3))]);
    expect(state).toMatchObject({ status: 'ready', isRefreshing: true });
  });
});

/** A source whose state a test moves, counting its holds. */
function fakeSource(initial: AggregateState) {
  let state = initial;
  let holds = 0;
  const listeners = new Set<() => void>();
  const source: AggregateSource = {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => state,
    retain: () => {
      holds += 1;
      return () => {
        holds -= 1;
      };
    },
  };
  return {
    source,
    holds: () => holds,
    set: (next: AggregateState) => {
      state = next;
      for (const listener of listeners) listener();
    },
  };
}

/** The fake each of the count plan's questions is held through. */
const through = (fakes: readonly ReturnType<typeof fakeSource>[]) => (question: ReportQuestion) => {
  const fake = fakes[countPlan.questions.indexOf(question)];
  if (fake === undefined) throw new Error('No source.');
  return fake.source;
};

describe('createFiguresSource', () => {
  it('holds every question while held, and lets them all go together', () => {
    const fakes = countPlan.questions.map(() => fakeSource({ status: 'loading' }));
    const source = createFiguresSource(countPlan, through(fakes));
    const first = source.retain();
    const second = source.retain();
    expect(fakes.map((fake) => fake.holds())).toEqual([1, 1, 1]);
    first();
    expect(fakes.map((fake) => fake.holds())).toEqual([1, 1, 1]);
    second();
    expect(fakes.map((fake) => fake.holds())).toEqual([0, 0, 0]);
  });

  it('hands back the same state until a question moves, and tells listeners when one does', () => {
    const fakes = countPlan.questions.map(() => fakeSource({ status: 'loading' }));
    const source = createFiguresSource(countPlan, through(fakes));
    let heard = 0;
    source.subscribe(() => {
      heard += 1;
    });
    const loading = source.getSnapshot();
    expect(loading).toEqual({ status: 'loading' });
    expect(source.getSnapshot()).toBe(loading);
    fakes.forEach((fake, index) => {
      fake.set(ready(countAnswer(index + 1)));
    });
    expect(heard).toBe(3);
    const done = source.getSnapshot();
    expect(done.status).toBe('ready');
    expect(source.getSnapshot()).toBe(done);
  });

  it('holds each question anew on retry, so a failed one reads again, and lets the old holds go', () => {
    const fakes = countPlan.questions.map(() => fakeSource({ status: 'error' }));
    const source = createFiguresSource(countPlan, through(fakes));
    const release = source.retain();
    source.retry();
    expect(fakes.map((fake) => fake.holds())).toEqual([1, 1, 1]);
    release();
    expect(fakes.map((fake) => fake.holds())).toEqual([0, 0, 0]);
  });
});
