import { describe, expect, it } from 'vitest';
import { ruleKindsFor } from '../validation/kinds.ts';
import type { AttributeType } from './attribute-values.ts';
import {
  checkRuleSettings,
  RULE_SETTINGS_WORDS as W,
  type ConditionAttribute,
  type RuleKind,
} from './validation-rules.ts';

const STAGE = '00000000-0000-7000-8000-000000000003';
const CREATED = '00000000-0000-7000-8000-000000000004';
const attributes = new Map<string, ConditionAttribute>([
  [STAGE, { type: 'status', isSystem: false }],
  [CREATED, { type: 'timestamp', isSystem: true }],
]);

// A stand in for RE2: refuses look behind, as RE2 does.
const compile = (source: string) => {
  if (source.includes('(?<=')) throw new Error('error parsing regexp: invalid named capture: `(?<=a)`');
  return new RegExp(source);
};

const settings = (
  type: AttributeType,
  kind: RuleKind,
  params: Record<string, unknown>,
  extra: { isMulti?: boolean; condition?: unknown; message?: string } = {},
) =>
  checkRuleSettings(
    {
      kind,
      params,
      ...(extra.condition === undefined ? {} : { condition: extra.condition as never }),
      ...(extra.message === undefined ? {} : { message: extra.message }),
    },
    { attribute: { type, isMulti: extra.isMulti ?? false }, attributes, compile },
  );

const problems = (result: ReturnType<typeof settings>) => (result.ok ? [] : result.problems);

describe('checkRuleSettings', () => {
  it('takes good settings and makes them canonical', () => {
    expect(settings('number', 'range', { min: '0010.50', max: 20 })).toEqual({
      ok: true,
      rule: { kind: 'range', params: { min: '10.5', max: '20' } },
    });
    expect(settings('email', 'email_domain', { mode: 'allow', domains: [' Acme.COM ', 'acme.com'] })).toEqual({
      ok: true,
      rule: { kind: 'email_domain', params: { mode: 'allow', domains: ['acme.com'] } },
    });
    expect(settings('phone', 'phone_country', { countries: ['gb'] }, { message: '  Only UK.  ' })).toEqual({
      ok: true,
      rule: { kind: 'phone_country', params: { countries: ['GB'] }, message: 'Only UK.' },
    });
  });

  it('refuses each row of the settings refusals, on its field', () => {
    expect(problems(settings('text', 'length', { min: 5, max: 2 }))).toEqual([{ field: 'min', message: W.minOverMax }]);
    expect(problems(settings('text', 'length', {}))).toEqual([{ field: 'min', message: W.noBound }]);
    expect(problems(settings('text', 'length', { max: 501 }))).toEqual([{ field: 'max', message: W.textLimit }]);
    expect(problems(settings('long_text', 'length', { max: 10_001 }))).toEqual([
      { field: 'max', message: W.longTextLimit },
    ]);
    expect(problems(settings('rating', 'range', { max: 6 }))).toEqual([{ field: 'max', message: W.rating }]);
    expect(problems(settings('select', 'count', { min: 0 }, { isMulti: true }))).toEqual([
      { field: 'min', message: W.count },
    ]);
    expect(
      problems(settings('text', 'pattern', { preset: 'custom', regex: 'a'.repeat(201), ignoreCase: false })),
    ).toEqual([{ field: 'regex', message: W.patternLong }]);
    expect(problems(settings('text', 'pattern', { preset: 'custom', regex: '(?<=a)b', ignoreCase: false }))).toEqual([
      { field: 'regex', message: 'That pattern can’t be used: invalid named capture: `(?<=a)`.' },
    ]);
    expect(problems(settings('text', 'pattern', { preset: 'starts_with', text: '', ignoreCase: false }))).toEqual([
      { field: 'text', message: W.affix },
    ]);
    expect(problems(settings('email', 'email_domain', { mode: 'allow', domains: ['not a domain'] }))).toEqual([
      { field: 'domains', message: W.domain('not a domain') },
    ]);
    expect(
      problems(
        settings('email', 'email_domain', {
          mode: 'allow',
          domains: Array.from({ length: 51 }, (_, i) => `d${String(i)}.com`),
        }),
      ),
    ).toEqual([{ field: 'domains', message: W.domains }]);
    expect(problems(settings('phone', 'phone_country', { countries: ['ZZ'] }))).toEqual([
      { field: 'countries', message: W.country('ZZ') },
    ]);
    expect(problems(settings('currency', 'currency_in', { codes: [] }))).toEqual([
      { field: 'codes', message: W.currencies },
    ]);
    expect(problems(settings('date', 'date_range', { min: { daysFromToday: 40_000 } }))).toEqual([
      { field: 'min', message: W.days },
    ]);
    expect(problems(settings('text', 'length', { max: 3 }, { message: 'x'.repeat(201) }))).toEqual([
      { field: 'message', message: W.message },
    ]);
  });

  it('refuses a kind the type doesn’t take', () => {
    expect(problems(settings('number', 'length', { max: 3 }))).toEqual([{ field: 'kind', message: W.kind }]);
    expect(problems(settings('email', 'count', { max: 3 }))).toEqual([{ field: 'kind', message: W.kind }]);
  });

  it('refuses a condition that leaves the object, names a system attribute, or is too big', () => {
    const leaf = { attributeId: STAGE, operator: 'is_empty' };
    const through = { operator: 'through', path: [STAGE], condition: leaf };
    expect(
      problems(settings('text', 'length', { max: 3 }, { condition: { conjunction: 'and', conditions: [through] } })),
    ).toEqual([{ field: 'condition', message: W.ownAttributes }]);
    const created = { attributeId: CREATED, operator: 'is_not_empty' };
    expect(
      problems(settings('text', 'length', { max: 3 }, { condition: { conjunction: 'and', conditions: [created] } })),
    ).toEqual([{ field: 'condition', message: W.ownAttributes }]);
    const other = { attributeId: '00000000-0000-7000-8000-0000000000ff', operator: 'is_empty' };
    expect(
      problems(settings('text', 'length', { max: 3 }, { condition: { conjunction: 'and', conditions: [other] } })),
    ).toEqual([{ field: 'condition', message: W.ownAttributes }]);
    const eleven = { conjunction: 'and', conditions: Array.from({ length: 11 }, () => leaf) };
    expect(problems(settings('text', 'length', { max: 3 }, { condition: eleven }))).toEqual([
      { field: 'condition', message: W.conditionSize },
    ]);
    const deep = {
      conjunction: 'and',
      conditions: [{ conjunction: 'or', conditions: [{ conjunction: 'and', conditions: [leaf] }] }],
    };
    expect(problems(settings('text', 'length', { max: 3 }, { condition: deep }))).toEqual([
      { field: 'condition', message: W.conditionSize },
    ]);
    const twoDeep = { conjunction: 'and', conditions: [{ conjunction: 'or', conditions: [leaf, leaf] }] };
    expect(settings('text', 'length', { max: 3 }, { condition: twoDeep }).ok).toBe(true);
  });

  it('offers the kinds each type takes', () => {
    expect(ruleKindsFor({ type: 'text', isMulti: false })).toEqual(['length', 'pattern']);
    expect(ruleKindsFor({ type: 'email', isMulti: true })).toEqual(['pattern', 'email_domain', 'count']);
    expect(ruleKindsFor({ type: 'number', isMulti: false })).toEqual(['range', 'integer']);
    expect(ruleKindsFor({ type: 'checkbox', isMulti: false })).toEqual([]);
  });
});
