import { describe, expect, it } from 'vitest';
import {
  addDays,
  bucketFilter,
  defaultReport,
  forecastOf,
  groupChoices,
  instantOfDay,
  localDay,
  mainCurrency,
  periodEndOf,
  periodStartOf,
  periodStarts,
  pipelineReport,
  planReport,
  reportProblem,
  withConditions,
  type ReportAttribute,
  type ReportContext,
} from './report-model.ts';
import type { ReportConfig } from './reports.ts';

const attribute = (over: Partial<ReportAttribute> & Pick<ReportAttribute, 'id' | 'type'>): ReportAttribute => ({
  apiSlug: over.id,
  title: over.id,
  isMulti: false,
  isSystem: false,
  isPrimary: false,
  isArchived: false,
  position: 0,
  ...over,
});

const stages = ['lead', 'won', 'lost'].map((id, position) => ({
  id: `stage-${id}`,
  label: id,
  hue: 'blue',
  position,
  isArchived: false,
  outcome: id === 'won' ? ('won' as const) : id === 'lost' ? ('lost' as const) : ('open' as const),
}));

const ATTRIBUTES: readonly ReportAttribute[] = [
  attribute({ id: 'name', type: 'text', isPrimary: true }),
  attribute({ id: 'stage', type: 'status', position: 1, options: stages }),
  attribute({ id: 'value', type: 'currency', position: 2 }),
  attribute({ id: 'seats', type: 'number', position: 3 }),
  attribute({ id: 'owner', type: 'actor_reference', position: 4 }),
  attribute({ id: 'closes', type: 'date', position: 5 }),
  attribute({ id: 'created', type: 'timestamp', isSystem: true, apiSlug: 'created_at', position: 6 }),
  attribute({ id: 'updated', type: 'timestamp', isSystem: true, apiSlug: 'updated_at', position: 7 }),
  attribute({ id: 'notes', type: 'long_text', position: 8 }),
];

const CONTEXT: ReportContext = {
  objectId: 'deals',
  attributes: ATTRIBUTES,
  members: [
    { id: 'ada', name: 'Ada' },
    { id: 'bea', name: 'Bea' },
  ],
  now: '2026-10-31T10:00:00.000Z',
  timeZone: 'Europe/London',
  weekStart: 'monday',
};

const planOf = (config: ReportConfig, context: ReportContext = CONTEXT) => {
  const result = planReport(config, context);
  if ('problem' in result) throw new Error(result.problem);
  return result.plan;
};

describe('days and periods', () => {
  it('moves a day across months and leap years', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2028-03-01', -1)).toBe('2028-02-29');
  });

  it('reads the reader’s day from an instant', () => {
    expect(localDay('2026-10-31T23:30:00.000Z', 'Asia/Kolkata')).toBe('2026-11-01');
    expect(localDay('2026-10-31T23:30:00.000Z', 'UTC')).toBe('2026-10-31');
  });

  it('finds a period’s first and last days', () => {
    expect(periodStartOf('month', '2026-10-31', 'monday')).toBe('2026-10-01');
    // 31 October 2026 is a Saturday.
    expect(periodStartOf('week', '2026-10-31', 'monday')).toBe('2026-10-26');
    expect(periodStartOf('week', '2026-10-31', 'sunday')).toBe('2026-10-25');
    expect(periodStartOf('week', '2026-10-31', 'saturday')).toBe('2026-10-31');
    expect(periodStartOf('week', '2026-10-30', 'saturday')).toBe('2026-10-24');
    expect(periodEndOf('month', '2026-12-01')).toBe('2027-01-01');
    expect(periodEndOf('month', '2026-10-01')).toBe('2026-11-01');
    expect(periodEndOf('week', '2026-10-26')).toBe('2026-11-02');
  });

  it('lists the last twelve periods, oldest first, ending with the current one', () => {
    const months = periodStarts('month', '2026-10-31', 'monday');
    expect(months).toHaveLength(12);
    expect(months[0]).toBe('2025-11-01');
    expect(months.at(-1)).toBe('2026-10-01');
    const weeks = periodStarts('week', '2026-10-31', 'monday');
    expect(weeks).toHaveLength(12);
    expect(weeks.at(-1)).toBe('2026-10-26');
    expect(weeks.at(-2)).toBe('2026-10-19');
    expect(new Set(weeks).size).toBe(12);
  });

  it('finds the instant a day begins in a zone, across daylight saving', () => {
    expect(instantOfDay('2026-07-01', 'Europe/London')).toBe('2026-06-30T23:00:00.000Z');
    expect(instantOfDay('2026-10-31', 'Europe/London')).toBe('2026-10-31T00:00:00.000Z');
    expect(instantOfDay('2026-10-31', 'Asia/Kolkata')).toBe('2026-10-30T18:30:00.000Z');
    // New York springs forward on 8 March 2026 at 2am: that midnight is still winter time, the next is summer.
    expect(instantOfDay('2026-03-08', 'America/New_York')).toBe('2026-03-08T05:00:00.000Z');
    expect(instantOfDay('2026-03-09', 'America/New_York')).toBe('2026-03-09T04:00:00.000Z');
  });
});

describe('bucketFilter', () => {
  it('bounds a date by the day before and the day after the period', () => {
    expect(bucketFilter({ id: 'closes', type: 'date' }, '2026-10-01', '2026-11-01', 'UTC')).toEqual([
      { attributeId: 'closes', operator: 'after', value: '2026-09-30' },
      { attributeId: 'closes', operator: 'before', value: '2026-11-01' },
    ]);
  });

  it('bounds a timestamp by the reader’s midnights, the lower one a millisecond early', () => {
    expect(bucketFilter({ id: 'created', type: 'timestamp' }, '2026-07-01', '2026-08-01', 'Europe/London')).toEqual([
      { attributeId: 'created', operator: 'after', value: '2026-06-30T22:59:59.999Z' },
      { attributeId: 'created', operator: 'before', value: '2026-07-31T23:00:00.000Z' },
    ]);
  });
});

describe('withConditions', () => {
  const extra = [{ attributeId: 'x', operator: 'is_empty' as const }];
  it('and-s onto no filter, an and filter (flat) and an or filter (nested)', () => {
    expect(withConditions(undefined, extra)).toEqual({ conjunction: 'and', conditions: extra });
    const and = { conjunction: 'and' as const, conditions: [{ attributeId: 'a', operator: 'is_empty' as const }] };
    expect(withConditions(and, extra).conditions).toHaveLength(2);
    const or = { conjunction: 'or' as const, conditions: [{ attributeId: 'a', operator: 'is_empty' as const }] };
    expect(withConditions(or, extra)).toEqual({ conjunction: 'and', conditions: [or, ...extra] });
  });
});

describe('what a report may group and measure by', () => {
  it('lists statuses first, then members, then each date by month and week', () => {
    expect(groupChoices(ATTRIBUTES).map((choice) => choice.key)).toEqual([
      'stage',
      'owner',
      'closes:month',
      'closes:week',
      'created:month',
      'created:week',
    ]);
  });

  it('draws a first report: the first status as bars, else a count', () => {
    expect(defaultReport(ATTRIBUTES)).toEqual({
      measure: { fn: 'count' },
      groupBy: { attributeId: 'stage' },
      chart: 'bar',
    });
    expect(defaultReport([attribute({ id: 'name', type: 'text', isPrimary: true })])).toEqual({
      measure: { fn: 'count' },
      chart: 'number',
    });
  });

  it('starts a pipeline from the first currency field and the stage', () => {
    expect(pipelineReport(ATTRIBUTES)).toEqual({
      measure: { fn: 'sum', attributeId: 'value' },
      groupBy: { attributeId: 'stage' },
      chart: 'bar',
    });
    expect(pipelineReport(ATTRIBUTES.filter((each) => each.id !== 'stage'))).toBeUndefined();
    expect(
      pipelineReport(ATTRIBUTES.filter((each) => each.type !== 'currency' && each.type !== 'number')),
    ).toBeUndefined();
  });

  it('refuses configs that can’t run, in a sentence', () => {
    const base: ReportConfig = { measure: { fn: 'count' }, groupBy: { attributeId: 'stage' }, chart: 'bar' };
    expect(reportProblem(base, ATTRIBUTES)).toBeUndefined();
    expect(reportProblem({ ...base, measure: { fn: 'sum', attributeId: 'notes' } }, ATTRIBUTES)).toMatch(
      /number or currency/,
    );
    expect(reportProblem({ ...base, groupBy: { attributeId: 'notes' } }, ATTRIBUTES)).toMatch(/Group by a status/);
    expect(reportProblem({ ...base, groupBy: { attributeId: 'stage', bucket: 'month' } }, ATTRIBUTES)).toMatch(
      /date field/,
    );
    expect(reportProblem({ ...base, chart: 'line' }, ATTRIBUTES)).toMatch(/line needs a date/);
    expect(reportProblem({ measure: { fn: 'count' }, chart: 'bar' }, ATTRIBUTES)).toMatch(/Bars need/);
    expect(reportProblem({ ...base, groupBy: { attributeId: 'gone' } }, ATTRIBUTES)).toMatch(/not a field/);
    expect(
      reportProblem({ measure: { fn: 'count' }, chart: 'number' }, [attribute({ id: 'x', type: 'text' })]),
    ).toMatch(/nothing to count/);
  });
});

describe('planReport', () => {
  it('counts per stage with one filtered question each, the empty stage last', () => {
    const plan = planOf({ measure: { fn: 'count' }, groupBy: { attributeId: 'stage' }, chart: 'bar' });
    expect(plan.unit).toBe('count');
    expect(plan.slices.map((slice) => slice.id)).toEqual(['stage-lead', 'stage-won', 'stage-lost', null]);
    expect(plan.slices.map((slice) => slice.label)).toEqual(['lead', 'won', 'lost', undefined]);
    expect(plan.questions).toHaveLength(4);
    expect(plan.questions[0]).toEqual({
      objectId: 'deals',
      filter: { conjunction: 'and', conditions: [{ attributeId: 'stage', operator: 'is', value: 'stage-lead' }] },
      asks: [{ attributeId: 'created', fn: 'count' }],
    });
    expect(plan.questions[3]?.filter?.conditions).toEqual([{ attributeId: 'stage', operator: 'is_empty' }]);
    expect(plan.slices[1]?.question).toBe(1);
    expect(plan.truncated).toBe(false);
  });

  it('keeps the saved filter on every question, flat when it is an and', () => {
    const filter = {
      conjunction: 'and' as const,
      conditions: [{ attributeId: 'seats', operator: 'gt' as const, value: 3 }],
    };
    const plan = planOf({ measure: { fn: 'count' }, groupBy: { attributeId: 'stage' }, filter, chart: 'bar' });
    expect(plan.questions[0]?.filter?.conditions).toEqual([
      { attributeId: 'seats', operator: 'gt', value: 3 },
      { attributeId: 'stage', operator: 'is', value: 'stage-lead' },
    ]);
  });

  it('sums per stage in one grouped question', () => {
    const plan = planOf({
      measure: { fn: 'sum', attributeId: 'value' },
      groupBy: { attributeId: 'stage' },
      chart: 'bar',
    });
    expect(plan.unit).toBe('amount');
    expect(plan.measureAttributeId).toBe('value');
    expect(plan.questions).toEqual([
      {
        objectId: 'deals',
        asks: [{ attributeId: 'value', fn: 'sum' }],
        groupBy: 'stage',
        groupIds: ['stage-lead', 'stage-won', 'stage-lost', null],
      },
    ]);
    expect(plan.slices.map((slice) => [slice.groupId, slice.outcome])).toEqual([
      ['stage-lead', 'open'],
      ['stage-won', 'won'],
      ['stage-lost', 'lost'],
      [null, undefined],
    ]);
  });

  it('groups by member, each by name, and by a checkbox with no empty column', () => {
    const members = planOf({ measure: { fn: 'count' }, groupBy: { attributeId: 'owner' }, chart: 'bar' });
    expect(members.slices.map((slice) => [slice.id, slice.label])).toEqual([
      ['ada', 'Ada'],
      ['bea', 'Bea'],
      [null, undefined],
    ]);
    expect(members.questions[0]?.filter?.conditions).toEqual([{ attributeId: 'owner', operator: 'is', value: 'ada' }]);
    const checks = planOf(
      { measure: { fn: 'count' }, groupBy: { attributeId: 'done' }, chart: 'bar' },
      { ...CONTEXT, attributes: [...ATTRIBUTES, attribute({ id: 'done', type: 'checkbox' })] },
    );
    expect(checks.slices.map((slice) => slice.id)).toEqual(['unchecked', 'checked']);
    expect(checks.groupKind).toBe('checkbox');
  });

  it('caps the groups a chart draws and says so', () => {
    const many = Array.from({ length: 15 }, (_, position) => ({
      id: `o${String(position)}`,
      label: `Option ${String(position)}`,
      hue: 'blue',
      position,
      isArchived: false,
    }));
    const plan = planOf(
      { measure: { fn: 'count' }, groupBy: { attributeId: 'tier' }, chart: 'bar' },
      { ...CONTEXT, attributes: [...ATTRIBUTES, attribute({ id: 'tier', type: 'select', options: many })] },
    );
    expect(plan.slices).toHaveLength(13);
    expect(plan.truncated).toBe(true);
  });

  it('asks one question per period for a date group, each bounded to its period', () => {
    const plan = planOf({
      measure: { fn: 'sum', attributeId: 'value' },
      groupBy: { attributeId: 'closes', bucket: 'month' },
      chart: 'line',
    });
    expect(plan.questions).toHaveLength(12);
    expect(plan.slices[0]?.start).toBe('2025-11-01');
    expect(plan.slices.at(-1)?.start).toBe('2026-10-01');
    expect(plan.questions.at(-1)).toEqual({
      objectId: 'deals',
      filter: {
        conjunction: 'and',
        conditions: [
          { attributeId: 'closes', operator: 'after', value: '2026-09-30' },
          { attributeId: 'closes', operator: 'before', value: '2026-11-01' },
        ],
      },
      asks: [{ attributeId: 'value', fn: 'sum' }],
    });
  });

  it('asks one question for a number, ignoring a group', () => {
    const plan = planOf({
      measure: { fn: 'avg', attributeId: 'seats' },
      groupBy: { attributeId: 'stage' },
      chart: 'number',
    });
    expect(plan.questions).toEqual([{ objectId: 'deals', asks: [{ attributeId: 'seats', fn: 'avg' }] }]);
    expect(plan.slices).toHaveLength(1);
  });

  it('answers the problem for a config it can’t plan', () => {
    expect(planReport({ measure: { fn: 'count' }, chart: 'bar' }, CONTEXT)).toEqual({
      problem: 'Bars need a field to group by.',
    });
  });
});

describe('forecast and currency', () => {
  const stagesOf = [
    { id: 'lead', value: 100, outcome: 'open' as const },
    { id: 'talk', value: 200, outcome: 'open' as const },
    { id: 'won', value: 50, outcome: 'won' as const },
    { id: 'lost', value: 70, outcome: 'lost' as const },
    { id: null, value: 10 },
  ];

  it('claims no forecast until an open stage has a chance', () => {
    expect(forecastOf(stagesOf, {})).toEqual({ open: 310, won: 50, weighted: undefined });
  });

  it('adds won in full and each open stage at its chance, lost never', () => {
    expect(forecastOf(stagesOf, { lead: 10, talk: 50, lost: 100 })).toEqual({ open: 310, won: 50, weighted: 160 });
    expect(forecastOf(stagesOf, { talk: 0 }).weighted).toBe(50);
  });

  it('draws in the currency most groups hold and names the rest', () => {
    expect(mainCurrency([['USD'], ['USD', 'EUR'], ['EUR'], ['USD']])).toEqual({ main: 'USD', others: ['EUR'] });
    expect(mainCurrency([[undefined], []])).toEqual({ main: undefined, others: [] });
    expect(mainCurrency([['EUR'], ['USD']])).toEqual({ main: 'EUR', others: ['USD'] });
  });
});
