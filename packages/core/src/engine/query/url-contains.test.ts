// A url "contains" with a handle typed with @ (polish item 8): "@ada" finds
// the profile link it is stored as (https://x.com/ada) in the compiled SQL
// and in the reference evaluator alike. Pure: no database.
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import type { FilterGroup } from '@crm/contracts/values';
import { SYSTEM_ACCESS } from '../../access/policy.ts';
import { newId } from '../ids.ts';
import { SYSTEM_ACTOR } from '../scope.ts';
import type { AttributeDef } from '../values.ts';
import { baseLevel, compileFilter, searchTermsOf, type CompileContext } from './compile.ts';
import { evaluate, type EvaluateContext, type PlainRecord } from './evaluate.ts';

const objectId = newId();
const twitter: AttributeDef = {
  id: newId(),
  objectId,
  listId: null,
  apiSlug: 'twitter',
  objectKey: 'people',
  title: 'Twitter',
  type: 'url',
  isMulti: false,
  isRequired: false,
  isUnique: false,
  isSystem: false,
  systemColumn: null,
  archivedAt: null,
  archivedBy: null,
  config: {},
  defaultValue: null,
  relationshipId: null,
  position: 0,
  ruleCount: 0,
  rulesVersion: 0,
};
const attributes = new Map([[twitter.id, twitter]]);

const contains = (value: string, operator: 'contains' | 'does_not_contain' = 'contains'): FilterGroup => ({
  conjunction: 'and',
  conditions: [{ attributeId: twitter.id, operator, value }],
});

const row = (id: string, link: string | undefined): PlainRecord => ({
  id,
  createdAt: '2026-10-01 00:00:00+00',
  updatedAt: '2026-10-01 00:00:00+00',
  values: link === undefined ? {} : { [twitter.id]: link },
});

const rows = [
  row('ada', 'https://x.com/ada'),
  row('adam', 'https://x.com/AdamS'),
  row('tube', 'https://youtube.com/@ada'),
  row('grace', 'https://x.com/grace'),
  row('none', undefined),
];

const evaluateContext: EvaluateContext = {
  attributes,
  records: new Map(),
  primaryAttributes: new Map(),
  optionPositions: new Map(),
  memberNames: new Map(),
  now: '2026-10-22T00:00:00.000Z',
  timeZone: 'UTC',
  weekStart: 'monday',
  actor: SYSTEM_ACTOR,
};

const compileContext: CompileContext = {
  attributes,
  relationships: new Map(),
  clock: {},
  actor: SYSTEM_ACTOR,
  access: SYSTEM_ACCESS,
};

const compiled = (group: FilterGroup) =>
  new PgDialect().sqlToQuery(compileFilter(compileContext, baseLevel({ objectId }), group));

describe('a url contains with an @ handle', () => {
  it('matches the stored profile link in the evaluator, and the text as typed too', () => {
    expect(evaluate(evaluateContext, rows, contains('@ada'), [])).toEqual(['ada', 'adam', 'tube']);
    expect(evaluate(evaluateContext, rows, contains('@ADA'), [])).toEqual(['ada', 'adam', 'tube']);
    expect(evaluate(evaluateContext, rows, contains('ada'), [])).toEqual(['ada', 'adam', 'tube']);
    expect(evaluate(evaluateContext, rows, contains('@grace'), [])).toEqual(['grace']);
    expect(evaluate(evaluateContext, rows, contains('@ada', 'does_not_contain'), [])).toEqual(['grace', 'none']);
  });

  it('compiles to a LIKE on each needle, and searches for the handle alone (a superset each hit is checked on)', () => {
    const { sql, params } = compiled(contains('@Ada'));
    expect(params).toEqual(expect.arrayContaining(['%@ada%', '%/ada%']));
    expect(sql).toMatch(/like \$\d+ or lower\(left\(v\.text_value, 2048\)\) like \$\d+/);
    expect(searchTermsOf(compileContext, contains('@ada'))).toEqual([
      expect.objectContaining({ attributeId: twitter.id, text: 'ada' }),
    ]);
  });

  it('leaves a plain contains as one LIKE the search can answer', () => {
    const { params } = compiled(contains('grace'));
    expect(params).toEqual(expect.arrayContaining(['%grace%']));
    expect(params).not.toEqual(expect.arrayContaining(['%/grace%']));
    expect(searchTermsOf(compileContext, contains('grace'))).toEqual([
      expect.objectContaining({ attributeId: twitter.id, text: 'grace' }),
    ]);
  });
});
