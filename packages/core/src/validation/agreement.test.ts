// The rule checker's conditions agree with the engine's reference evaluator
// (spec 0013, "The checker"): both run every operator of every type on the
// same records, and must keep the same ones. The evaluator in turn agrees
// with the SQL compiler (spec 0004, AC-14), so a rule's condition means what
// the same filter means in a view.
import type { FilterCondition, FilterGroup } from '@crm/contracts/values';
import { matchesCondition, type ConditionAttributeShape } from '@crm/contracts/validation';
import { describe, expect, it } from 'vitest';
import { evaluate, type EvaluateContext, type PlainRecord } from '../engine/query/evaluate.ts';
import type { AttributeDef } from '../engine/values.ts';

const OBJECT = '00000000-0000-7000-8000-00000000ffff';
const ME = '00000000-0000-7000-8000-0000000000e1';
const OTHER = '00000000-0000-7000-8000-0000000000e2';
const OPTION_A = '00000000-0000-7000-8000-0000000000a1';
const OPTION_B = '00000000-0000-7000-8000-0000000000a2';
const FAR = '00000000-0000-7000-8000-0000000000f1';

let counter = 0;
const def = (type: AttributeDef['type'], isMulti = false): AttributeDef => {
  counter += 1;
  return {
    id: `00000000-0000-7000-8000-${String(counter).padStart(12, '0')}`,
    objectId: OBJECT,
    listId: null,
    apiSlug: `a${String(counter)}`,
    objectKey: null,
    title: type,
    type,
    isMulti,
    isRequired: false,
    isUnique: false,
    isSystem: false,
    systemColumn: null,
    archivedAt: null,
    archivedBy: null,
    config: {},
    defaultValue: null,
    relationshipId: null,
    position: counter,
    ruleCount: 0,
    rulesVersion: 0,
  };
};

const A = {
  text: def('text'),
  number: def('number'),
  currency: def('currency'),
  date: def('date'),
  timestamp: def('timestamp'),
  checkbox: def('checkbox'),
  select: def('select', true),
  status: def('status'),
  rating: def('rating'),
  email: def('email', true),
  phone: def('phone'),
  location: def('location'),
  name: def('personal_name'),
  member: def('actor_reference', true),
  reference: def('record_reference', true),
  file: def('file', true),
};

/** Values per attribute, one list of samples each; record i holds sample i (or none past the end). */
const SAMPLES: Readonly<Record<keyof typeof A, readonly unknown[]>> = {
  text: ['Ada Lovelace', 'ada lovelace', 'Grace', null],
  number: ['10', '10.5', '-3', '1234567890.1234', null],
  currency: [
    { amount: '100', currency: 'USD' },
    { amount: '100', currency: 'EUR' },
    { amount: '99.99', currency: 'USD' },
    null,
  ],
  date: ['2026-10-08', '2026-10-05', '2026-10-04', '2026-09-30', '2026-11-01', '2025-10-08', null],
  timestamp: ['2026-10-08T10:00:00.000Z', '2026-10-01T23:30:00.000Z', '2026-10-07T23:30:00.000Z', null],
  checkbox: [true, false, true],
  select: [[OPTION_A], [OPTION_A, OPTION_B], [OPTION_B], null],
  status: [OPTION_A, OPTION_B, null],
  rating: [1, 3, 5, null],
  email: [['ada@acme.com'], ['ada@acme.com', 'g@gmail.com'], null],
  phone: [{ number: '+447700900123', country: 'GB' }, { number: '+12025550123', country: 'US' }, null],
  location: [
    { locality: 'London', region: 'England', countryCode: 'GB' },
    { locality: 'Paris', countryCode: 'FR' },
    null,
  ],
  name: [{ firstName: 'Ada', lastName: 'Lovelace', fullName: 'Ada Lovelace' }, { fullName: 'Grace Hopper' }, null],
  member: [[{ type: 'member', id: ME }], [{ type: 'member', id: OTHER }], null],
  reference: [[{ objectId: OBJECT, recordId: FAR }], null],
  file: [[{ fileId: 'f', name: 'a.pdf', size: 1, contentType: 'application/pdf' }], null],
};

const RECORDS = 7;
const rows: PlainRecord[] = Array.from({ length: RECORDS }, (_, index) => ({
  id: `00000000-0000-7000-8000-0000000001${String(index).padStart(2, '0')}`,
  createdAt: '2026-10-01 00:00:00+00',
  updatedAt: '2026-10-01 00:00:00+00',
  values: Object.fromEntries(
    Object.entries(A).map(([key, attribute]) => [
      attribute.id,
      SAMPLES[key as keyof typeof A][index] ?? (attribute.type === 'checkbox' ? false : null),
    ]),
  ),
}));

const NOW = '2026-10-08T14:30:00.000Z';
const ZONES = ['Europe/London', 'America/Los_Angeles', 'Asia/Tokyo'];

const contextIn = (timeZone: string): EvaluateContext => ({
  attributes: new Map(Object.values(A).map((attribute) => [attribute.id, attribute])),
  records: new Map(),
  primaryAttributes: new Map(),
  optionPositions: new Map(),
  memberNames: new Map(),
  now: NOW,
  timeZone,
  weekStart: 'monday',
  actor: { type: 'member', id: ME },
});

const shapes = new Map<string, ConditionAttributeShape>(
  Object.values(A).map((attribute) => [
    attribute.id,
    { type: attribute.type, isMulti: attribute.isMulti, archived: false },
  ]),
);

const c = (attribute: AttributeDef, condition: Omit<FilterCondition, 'attributeId'> & Record<string, unknown>) =>
  ({ attributeId: attribute.id, ...condition }) as FilterCondition;

const each = (attribute: AttributeDef, operators: readonly string[]): FilterCondition[] =>
  operators.map((operator) => c(attribute, { operator } as never));

/** Every operator of every type the filters offer, with operands that land both ways. */
const CONDITIONS: readonly FilterCondition[] = [
  ...each(A.text, ['is_empty', 'is_not_empty']),
  c(A.text, { operator: 'is', value: 'ADA LOVELACE' }),
  c(A.text, { operator: 'is_not', value: 'grace' }),
  c(A.text, { operator: 'contains', value: 'love' }),
  c(A.text, { operator: 'does_not_contain', value: 'Gr' }),
  ...['eq', 'neq', 'gt', 'gte', 'lt', 'lte'].map((operator) => c(A.number, { operator, value: '10' } as never)),
  c(A.number, { operator: 'between', from: '-3', to: '10' }),
  // Past what a double holds, the evaluator (Number) and the checker part: the checker compares exactly, as the
  // compiled SQL does (numeric), so no sample goes past 15 significant digits here.
  ...each(A.number, ['is_empty', 'is_not_empty']),
  c(A.currency, { operator: 'gte', value: { amount: '100', currency: 'USD' } }),
  c(A.currency, { operator: 'lt', value: { amount: '100', currency: 'USD' } }),
  c(A.currency, {
    operator: 'between',
    from: { amount: '50', currency: 'EUR' },
    to: { amount: '150', currency: 'EUR' },
  }),
  c(A.date, { operator: 'is', value: '2026-10-08' }),
  c(A.date, { operator: 'before', value: '2026-10-05' }),
  c(A.date, { operator: 'after', value: '2026-10-05' }),
  ...(['today', 'this_week', 'this_month', 'last_month'] as const).map((range) =>
    c(A.date, { operator: 'within', range }),
  ),
  c(A.date, { operator: 'within_last', range: { amount: 7, unit: 'day' } }),
  c(A.date, { operator: 'within_last', range: { amount: 1, unit: 'year' } }),
  c(A.date, { operator: 'within', range: { amount: 1, unit: 'month' } }),
  c(A.date, { operator: 'within', range: { amount: 2, unit: 'week' } }),
  c(A.timestamp, { operator: 'before', value: '2026-10-07T00:00:00.000Z' }),
  c(A.timestamp, { operator: 'within', range: 'today' }),
  c(A.timestamp, { operator: 'within', range: 'this_week' }),
  c(A.timestamp, { operator: 'within_last', range: { amount: 1, unit: 'day' } }),
  ...each(A.checkbox, ['is_checked', 'is_not_checked']),
  c(A.select, { operator: 'contains_any_of', values: [OPTION_B] }),
  c(A.select, { operator: 'contains_all_of', values: [OPTION_A, OPTION_B] }),
  c(A.select, { operator: 'contains_none_of', values: [OPTION_A] }),
  ...each(A.select, ['is_empty', 'is_not_empty']),
  c(A.status, { operator: 'is', value: OPTION_A }),
  c(A.status, { operator: 'is_not', value: OPTION_A }),
  c(A.status, { operator: 'is_any_of', values: [OPTION_A, OPTION_B] }),
  c(A.rating, { operator: 'at_least', value: 3 }),
  c(A.rating, { operator: 'at_most', value: 3 }),
  c(A.rating, { operator: 'is', value: 5 }),
  c(A.email, { operator: 'is', value: 'G@GMAIL.COM' }),
  c(A.email, { operator: 'contains', value: 'acme' }),
  c(A.phone, { operator: 'is', value: { number: '+447700900123', country: 'GB' } }),
  c(A.phone, { operator: 'country_is', value: 'us' }),
  c(A.location, { operator: 'country_is', value: 'gb' }),
  c(A.location, { operator: 'locality_is', value: 'PARIS' }),
  c(A.location, { operator: 'region_is', value: 'england' }),
  c(A.name, { operator: 'first_name_is', value: 'ada' }),
  c(A.name, { operator: 'last_name_is', value: 'LOVELACE' }),
  c(A.name, { operator: 'name_contains', value: 'hop' }),
  c(A.member, { operator: 'is_me' }),
  c(A.member, { operator: 'contains_any_of', values: [{ type: 'member', id: OTHER }] }),
  c(A.reference, { operator: 'contains_any_of', values: [{ objectId: OBJECT, recordId: FAR }] }),
  ...each(A.reference, ['is_empty', 'is_not_empty']),
  ...each(A.file, ['has_files', 'is_empty']),
];

describe('matchesCondition agrees with the reference evaluator', () => {
  for (const timeZone of ZONES) {
    it(`on every operator of every type, in ${timeZone}`, () => {
      const context = contextIn(timeZone);
      for (const condition of CONDITIONS) {
        for (const conjunction of ['and', 'or'] as const) {
          const group: FilterGroup = { conjunction, conditions: [condition] };
          const expected = new Set(evaluate(context, rows, group, []));
          const found = rows
            .filter((row) =>
              matchesCondition(group, {
                values: row.values,
                attributes: shapes,
                clock: { now: NOW, timeZone, weekStart: 'monday' },
                actor: { type: 'member', id: ME },
              }),
            )
            .map((row) => row.id);
          expect(new Set(found), JSON.stringify(condition)).toEqual(expected);
        }
      }
    });
  }

  it('on groups nested two deep', () => {
    const context = contextIn('Europe/London');
    const group: FilterGroup = {
      conjunction: 'or',
      conditions: [
        { conjunction: 'and', conditions: [CONDITIONS[2] as FilterCondition, CONDITIONS[10] as FilterCondition] },
        c(A.status, { operator: 'is', value: OPTION_B }),
      ],
    };
    const expected = new Set(evaluate(context, rows, group, []));
    const found = rows.filter((row) =>
      matchesCondition(group, {
        values: row.values,
        attributes: shapes,
        clock: { now: NOW, timeZone: 'Europe/London', weekStart: 'monday' },
      }),
    );
    expect(new Set(found.map((row) => row.id))).toEqual(expected);
  });
});
