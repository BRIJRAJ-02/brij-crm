import { describe, expect, it } from 'vitest';
import type { FilterGroup } from '../values/filters.ts';
import { checkRules, type CheckRulesInput, type RuleAttribute, type ValidationRule } from './check.ts';
import { formatDay, type RuleClock } from './clock.ts';
import { compareDecimal } from './decimal.ts';
import { matchesCondition } from './condition.ts';
import { HIDDEN_CONDITION, HIDDEN_FAILURE, MANY_CONDITIONS, summarizeCondition } from './messages.ts';

// The browser's RegExp stands in for RE2 here: these patterns mean the same in both. Core's tests run re2js.
const pattern = (source: string, ignoreCase: boolean) => {
  const compiled = new RegExp(source, ignoreCase ? 'iu' : 'u');
  return { test: (text: string) => compiled.test(text) };
};

const ID = {
  name: '00000000-0000-7000-8000-000000000001',
  email: '00000000-0000-7000-8000-000000000002',
  stage: '00000000-0000-7000-8000-000000000003',
  amount: '00000000-0000-7000-8000-000000000004',
  close: '00000000-0000-7000-8000-000000000005',
  phone: '00000000-0000-7000-8000-000000000006',
  tags: '00000000-0000-7000-8000-000000000007',
  secret: '00000000-0000-7000-8000-000000000008',
  value: '00000000-0000-7000-8000-000000000009',
  rating: '00000000-0000-7000-8000-00000000000a',
  code: '00000000-0000-7000-8000-00000000000b',
};
const WON = '00000000-0000-7000-8000-0000000000a1';
const OPEN = '00000000-0000-7000-8000-0000000000a2';

const attribute = (
  type: RuleAttribute['type'],
  title: string,
  position: number,
  extra: Partial<RuleAttribute> = {},
): RuleAttribute => ({ type, title, position, isMulti: false, visible: true, archived: false, ...extra });

const ATTRIBUTES = new Map<string, RuleAttribute>([
  [ID.name, attribute('text', 'Name', 0)],
  [ID.email, attribute('email', 'Email', 1, { isMulti: true })],
  [
    ID.stage,
    attribute('status', 'Stage', 2, {
      options: [
        { id: WON, label: 'Won' },
        { id: OPEN, label: 'Open' },
      ],
    }),
  ],
  [ID.amount, attribute('currency', 'Amount', 3)],
  [ID.close, attribute('date', 'Close date', 4)],
  [ID.phone, attribute('phone', 'Phone', 5)],
  [ID.tags, attribute('select', 'Tags', 6, { isMulti: true })],
  [ID.secret, attribute('text', 'Secret', 7, { visible: false })],
  [ID.value, attribute('number', 'Value', 8)],
  [ID.rating, attribute('rating', 'Rating', 9)],
  [ID.code, attribute('long_text', 'Code', 10)],
]);

const CLOCK: RuleClock = { now: '2026-10-08T14:30:00.000Z', timeZone: 'Europe/London', weekStart: 'monday' };

let next = 0;
const rule = (
  attributeId: string,
  kind: ValidationRule['kind'],
  params: Record<string, unknown> = {},
  extra: Partial<ValidationRule> = {},
): ValidationRule => {
  next += 1;
  return { id: `rule-${String(next)}`, attributeId, kind, params, position: 0, ...extra };
};

const check = (
  rules: readonly ValidationRule[],
  values: Record<string, unknown>,
  written?: readonly string[],
  more: Partial<CheckRulesInput> = {},
) =>
  checkRules({
    rules,
    attributes: ATTRIBUTES,
    values,
    written: new Set(written ?? Object.keys(values)),
    clock: CLOCK,
    pattern,
    ...more,
  });

const messages = (failures: readonly { message: string }[]) => failures.map((failure) => failure.message);

const stageIsWon: FilterGroup = {
  conjunction: 'and',
  conditions: [{ attributeId: ID.stage, operator: 'is', value: WON }],
};

describe('checkRules, each kind', () => {
  it('checks a length, by characters, with the generated messages', () => {
    const both = rule(ID.name, 'length', { min: 2, max: 4 });
    expect(check([both], { [ID.name]: 'Ada' })).toEqual([]);
    expect(messages(check([both], { [ID.name]: 'A' }))).toEqual(['Name needs 2 to 4 characters.']);
    expect(messages(check([rule(ID.name, 'length', { min: 3 })], { [ID.name]: 'Al' }))).toEqual([
      'Name needs at least 3 characters.',
    ]);
    expect(messages(check([rule(ID.name, 'length', { max: 3 })], { [ID.name]: 'Grace' }))).toEqual([
      'Name can have at most 3 characters.',
    ]);
    // Characters, not UTF-16 units: four emoji are four characters.
    expect(check([rule(ID.name, 'length', { max: 4 })], { [ID.name]: '😀😀😀😀' })).toEqual([]);
  });

  it('checks each preset and a custom pattern against the whole value, with or without case', () => {
    const cases: [Record<string, unknown>, string, string, string][] = [
      [{ preset: 'digits', ignoreCase: false }, '12345', '12a45', 'Name can only contain digits.'],
      [{ preset: 'letters', ignoreCase: false }, 'Zoë Ann', 'Zoë 2', 'Name can only contain letters.'],
      [{ preset: 'letters_digits', ignoreCase: false }, 'Ab 12', 'Ab-12', 'Name can only contain letters and digits.'],
      [{ preset: 'no_spaces', ignoreCase: false }, 'a-b', 'a b', 'Name can’t contain spaces.'],
      [{ preset: 'starts_with', text: 'ID.', ignoreCase: false }, 'ID.42', 'IDx42', 'Name must start with “ID.”.'],
      [{ preset: 'ends_with', text: '(x)', ignoreCase: false }, 'a(x)', 'ax', 'Name must end with “(x)”.'],
      [
        { preset: 'custom', regex: '[A-Z]{2}-\\d+', ignoreCase: false },
        'AB-12',
        'xAB-12',
        'Name isn’t in the required format.',
      ],
      [{ preset: 'custom', regex: '[a-z]+', ignoreCase: true }, 'ABC', 'AB1', 'Name isn’t in the required format.'],
    ];
    for (const [params, good, bad, message] of cases) {
      const each = rule(ID.name, 'pattern', params);
      expect(check([each], { [ID.name]: good })).toEqual([]);
      expect(messages(check([each], { [ID.name]: bad }))).toEqual([message]);
    }
  });

  it('fails a list when one item fails, and allows or blocks email domains', () => {
    const allow = rule(ID.email, 'email_domain', { mode: 'allow', domains: ['acme.com', 'acme.co.uk'] });
    expect(check([allow], { [ID.email]: ['ada@acme.com', 'g@acme.co.uk'] })).toEqual([]);
    expect(messages(check([allow], { [ID.email]: ['ada@acme.com', 'g@gmail.com'] }))).toEqual([
      'Email must be an address at acme.com or acme.co.uk.',
    ]);
    const many = rule(ID.email, 'email_domain', { mode: 'allow', domains: ['a.com', 'b.com', 'c.com', 'd.com'] });
    expect(messages(check([many], { [ID.email]: ['x@e.com'] }))).toEqual([
      'Email must be an address at one of the 4 allowed domains.',
    ]);
    const block = rule(ID.email, 'email_domain', { mode: 'block', domains: ['gmail.com'] });
    expect(messages(check([block], { [ID.email]: ['ada@acme.com', 'g@gmail.com'] }))).toEqual([
      'Email can’t be an address at gmail.com.',
    ]);
  });

  it('checks phone countries, currencies, ranges and whole numbers', () => {
    const phone = rule(ID.phone, 'phone_country', { countries: ['GB', 'IE'] });
    expect(check([phone], { [ID.phone]: { number: '+447700900123', country: 'GB' } })).toEqual([]);
    expect(messages(check([phone], { [ID.phone]: { number: '+12025550123', country: 'US' } }))).toEqual([
      'Phone must be a number from United Kingdom or Ireland.',
    ]);
    const currency = rule(ID.amount, 'currency_in', { codes: ['USD', 'EUR', 'GBP'] });
    expect(messages(check([currency], { [ID.amount]: { amount: '5', currency: 'JPY' } }))).toEqual([
      'Amount must be in USD, EUR or GBP.',
    ]);
    const range = rule(ID.amount, 'range', { min: '10', max: '10000.5' });
    expect(check([range], { [ID.amount]: { amount: '10000.5', currency: 'JPY' } })).toEqual([]);
    expect(messages(check([range], { [ID.amount]: { amount: '10000.51', currency: 'USD' } }))).toEqual([
      'Amount must be between 10 and 10000.5.',
    ]);
    // Exact past what a double holds.
    const exact = rule(ID.value, 'range', { max: '12345678901234.1234' });
    expect(check([exact], { [ID.value]: '12345678901234.1234' })).toEqual([]);
    expect(check([exact], { [ID.value]: '12345678901234.1235' })).toHaveLength(1);
    expect(messages(check([rule(ID.rating, 'range', { min: '3' })], { [ID.rating]: 2 }))).toEqual([
      'Rating must be at least 3.',
    ]);
    const whole = rule(ID.value, 'integer');
    expect(check([whole], { [ID.value]: '-42' })).toEqual([]);
    expect(messages(check([whole], { [ID.value]: '4.5' }))).toEqual(['Value must be a whole number.']);
  });

  it('checks a date range against fixed days and days from today in the writer’s time zone', () => {
    const fixed = rule(ID.close, 'date_range', { min: { date: '2026-10-01' }, max: { date: '2026-12-31' } });
    expect(check([fixed], { [ID.close]: '2026-10-01' })).toEqual([]);
    expect(messages(check([fixed], { [ID.close]: '2027-01-01' }))).toEqual([
      'Close date must be between 1 October 2026 and 31 December 2026.',
    ]);
    const fromToday = rule(ID.close, 'date_range', { min: { daysFromToday: 0 } });
    expect(check([fromToday], { [ID.close]: '2026-10-08' })).toEqual([]);
    expect(messages(check([fromToday], { [ID.close]: '2026-10-07' }))).toEqual([
      'Close date must be on or after today.',
    ]);
    // 23:30 in Los Angeles on 7 October is 8 October in UTC: "today" is the writer's.
    const late = { now: '2026-10-08T06:30:00.000Z', timeZone: 'America/Los_Angeles', weekStart: 'monday' } as const;
    expect(check([fromToday], { [ID.close]: '2026-10-07' }, undefined, { clock: late })).toEqual([]);
    expect(
      messages(check([rule(ID.close, 'date_range', { max: { daysFromToday: -3 } })], { [ID.close]: '2026-10-08' })),
    ).toEqual(['Close date must be on or before 3 days before today.']);
    expect(
      messages(check([rule(ID.close, 'date_range', { min: { daysFromToday: 2 } })], { [ID.close]: '2026-10-08' })),
    ).toEqual(['Close date must be on or after 2 days from today.']);
  });

  it('counts a list’s values', () => {
    const count = rule(ID.tags, 'count', { min: 2, max: 3 });
    expect(check([count], { [ID.tags]: [WON, OPEN] })).toEqual([]);
    expect(messages(check([count], { [ID.tags]: [WON] }))).toEqual(['Tags needs 2 to 3 values.']);
    expect(messages(check([rule(ID.tags, 'count', { max: 1 })], { [ID.tags]: [WON, OPEN] }))).toEqual([
      'Tags can hold at most 1 values.',
    ]);
  });
});

describe('checkRules, which rules run', () => {
  it('never looks at an empty value, except Required When', () => {
    const rules = [
      rule(ID.name, 'length', { min: 3 }),
      rule(ID.email, 'email_domain', { mode: 'allow', domains: ['acme.com'] }),
      rule(ID.tags, 'count', { min: 2 }),
    ];
    expect(check(rules, { [ID.name]: null, [ID.email]: [], [ID.tags]: null })).toEqual([]);
    const required = rule(ID.close, 'required_when', {}, { condition: stageIsWon });
    expect(messages(check([required], { [ID.close]: null, [ID.stage]: WON }))).toEqual([
      'Close date is required when Stage is Won.',
    ]);
    expect(check([required], { [ID.close]: null, [ID.stage]: OPEN })).toEqual([]);
    expect(check([required], { [ID.close]: '2026-10-08', [ID.stage]: WON })).toEqual([]);
  });

  it('runs only the rules a write touches: its attribute, or one its condition names', () => {
    const email = rule(ID.email, 'email_domain', { mode: 'allow', domains: ['acme.com'] });
    const values = { [ID.email]: ['x@gmail.com'], [ID.phone]: { number: '+447700900123', country: 'GB' } };
    // A record already breaking the rule changes its phone fine: never retroactive.
    expect(check([email], values, [ID.phone])).toEqual([]);
    expect(check([email], values, [ID.email])).toHaveLength(1);
    const required = rule(ID.close, 'required_when', {}, { condition: stageIsWon });
    // Moving the stage to Won touches Close date's rule through its condition.
    expect(messages(check([required], { [ID.close]: null, [ID.stage]: WON }, [ID.stage]))).toEqual([
      'Close date is required when Stage is Won.',
    ]);
  });

  it('applies a condition to any kind, and says so in the message', () => {
    const big = rule(ID.amount, 'range', { max: '100' }, { condition: stageIsWon });
    expect(check([big], { [ID.amount]: { amount: '500', currency: 'USD' }, [ID.stage]: OPEN })).toEqual([]);
    expect(messages(check([big], { [ID.amount]: { amount: '500', currency: 'USD' }, [ID.stage]: WON }))).toEqual([
      'Amount must be at most 100 when Stage is Won.',
    ]);
  });

  it('leaves a rule whose inputs it doesn’t hold to the server', () => {
    const required = rule(ID.close, 'required_when', {}, { condition: stageIsWon });
    expect(check([required], { [ID.close]: null }, [ID.close])).toEqual([]);
  });

  it('reads an archived attribute in a condition as empty, and never runs a rule on one', () => {
    const archived = new Map(ATTRIBUTES);
    archived.set(ID.stage, { ...attribute('status', 'Stage', 2), archived: true });
    const required = rule(ID.close, 'required_when', {}, { condition: stageIsWon });
    expect(check([required], { [ID.close]: null, [ID.stage]: WON }, [ID.close], { attributes: archived })).toEqual([]);
    const onArchived = rule(ID.stage, 'required_when', {}, { condition: stageIsWon });
    expect(check([onArchived], { [ID.close]: null }, [ID.close, ID.stage], { attributes: archived })).toEqual([]);
  });

  it('uses the rule’s own message, and names nothing hidden from the writer', () => {
    const own = rule(ID.name, 'length', { min: 3 }, { message: 'Use the full name.' });
    expect(messages(check([own], { [ID.name]: 'Al' }))).toEqual(['Use the full name.']);
    const hidden = rule(ID.secret, 'length', { min: 3 }, { message: 'Secret needs 3.' });
    expect(check([hidden], { [ID.secret]: 'x' })).toEqual([{ ruleId: hidden.id, message: HIDDEN_FAILURE }]);
    const namesHidden = rule(
      ID.name,
      'length',
      { min: 3 },
      {
        condition: { conjunction: 'and', conditions: [{ attributeId: ID.secret, operator: 'is', value: 'x' }] },
      },
    );
    expect(messages(check([namesHidden], { [ID.name]: 'Al', [ID.secret]: 'x' }))).toEqual([
      `Name needs at least 3 characters when ${HIDDEN_CONDITION}.`,
    ]);
    // A rule's own words may name the hidden field: the generated message stands in.
    const ownNamesHidden = { ...namesHidden, id: 'own-hidden', message: 'Secret x needs a long name.' };
    expect(messages(check([ownNamesHidden], { [ID.name]: 'Al', [ID.secret]: 'x' }))).toEqual([
      `Name needs at least 3 characters when ${HIDDEN_CONDITION}.`,
    ]);
  });

  it('lists every failure, in attribute position then rule position', () => {
    const rules = [
      rule(ID.amount, 'range', { max: '1' }, { position: 0 }),
      rule(ID.name, 'pattern', { preset: 'digits', ignoreCase: false }, { position: 1 }),
      rule(ID.name, 'length', { min: 5 }, { position: 0 }),
    ];
    const failures = check(rules, { [ID.name]: 'ab', [ID.amount]: { amount: '5', currency: 'USD' } });
    expect(failures.map((failure) => failure.ruleId)).toEqual([rules[2]?.id, rules[1]?.id, rules[0]?.id]);
    expect(failures.every((failure) => failure.attributeId !== undefined)).toBe(true);
  });

  it('compiles each pattern once per check', () => {
    let compiled = 0;
    const counting = (source: string, ignoreCase: boolean) => {
      compiled += 1;
      return pattern(source, ignoreCase);
    };
    const rules = [
      rule(ID.name, 'pattern', { preset: 'digits', ignoreCase: false }),
      rule(ID.code, 'pattern', { preset: 'digits', ignoreCase: false }),
    ];
    check(rules, { [ID.name]: '1', [ID.code]: '2' }, undefined, { pattern: counting });
    expect(compiled).toBe(1);
  });
});

describe('summarizeCondition', () => {
  it('reads one, two or three conditions, and more as its conditions', () => {
    const won = { attributeId: ID.stage, operator: 'is', value: WON } as const;
    const empty = { attributeId: ID.close, operator: 'is_empty' } as const;
    const atLeast = { attributeId: ID.value, operator: 'at_least', value: '10000' } as const;
    expect(summarizeCondition({ conjunction: 'and', conditions: [won] }, ATTRIBUTES)).toBe('Stage is Won');
    expect(summarizeCondition({ conjunction: 'or', conditions: [won, empty] }, ATTRIBUTES)).toBe(
      'Stage is Won or Close date is empty',
    );
    expect(summarizeCondition({ conjunction: 'and', conditions: [won, empty, atLeast] }, ATTRIBUTES)).toBe(
      'Stage is Won, Close date is empty and Value is at least 10000',
    );
    expect(summarizeCondition({ conjunction: 'and', conditions: [won, empty, atLeast, won] }, ATTRIBUTES)).toBe(
      MANY_CONDITIONS,
    );
    expect(
      summarizeCondition(
        { conjunction: 'and', conditions: [won, { conjunction: 'or', conditions: [empty] }] },
        ATTRIBUTES,
      ),
    ).toBe(MANY_CONDITIONS);
  });

  it('words operands by type: dates, amounts, lists and ranges', () => {
    const read = (condition: FilterGroup['conditions'][number]) =>
      summarizeCondition({ conjunction: 'and', conditions: [condition] }, ATTRIBUTES);
    expect(read({ attributeId: ID.close, operator: 'before', value: '2026-10-08' })).toBe(
      'Close date is before 8 October 2026',
    );
    expect(read({ attributeId: ID.amount, operator: 'gt', value: { amount: '1200.5', currency: 'USD' } })).toBe(
      'Amount is more than USD 1200.5',
    );
    expect(read({ attributeId: ID.stage, operator: 'is_any_of', values: [WON, OPEN] })).toBe(
      'Stage is any of Won or Open',
    );
    expect(read({ attributeId: ID.close, operator: 'within_last', range: { amount: 7, unit: 'day' } })).toBe(
      'Close date is within the last 7 days',
    );
    expect(read({ attributeId: ID.value, operator: 'between', from: '1', to: '5' })).toBe('Value is between 1 and 5');
  });
});

describe('matchesCondition', () => {
  const input = (values: Record<string, unknown>) => ({ values, attributes: ATTRIBUTES, clock: CLOCK });
  it('negates by its positive form, so an empty value is not "is not" anything but met by is not', () => {
    const isNot: FilterGroup = {
      conjunction: 'and',
      conditions: [{ attributeId: ID.stage, operator: 'is_not', value: WON }],
    };
    expect(matchesCondition(isNot, input({ [ID.stage]: null }))).toBe(true);
    expect(matchesCondition(isNot, input({ [ID.stage]: WON }))).toBe(false);
  });
  it('resolves a relative range in the writer’s time zone, weeks from Monday', () => {
    const thisWeek: FilterGroup = {
      conjunction: 'and',
      conditions: [{ attributeId: ID.close, operator: 'within', range: 'this_week' }],
    };
    expect(matchesCondition(thisWeek, input({ [ID.close]: '2026-10-05' }))).toBe(true);
    expect(matchesCondition(thisWeek, input({ [ID.close]: '2026-10-04' }))).toBe(false);
  });
  it('is total: an unknown attribute or a through condition is no match', () => {
    const odd: FilterGroup = {
      conjunction: 'or',
      conditions: [
        { attributeId: 'nope', operator: 'is_not_empty' },
        { operator: 'through', path: [ID.stage], condition: { attributeId: ID.name, operator: 'is_not_empty' } },
      ],
    };
    expect(matchesCondition(odd, input({ [ID.name]: 'x' }))).toBe(false);
  });
});

describe('helpers', () => {
  it('formats days in English, in UTC', () => {
    expect(formatDay('2026-10-08')).toBe('8 October 2026');
  });
  it('compares decimals exactly', () => {
    expect(compareDecimal('-1.5', '-1.25')).toBeLessThan(0);
    expect(compareDecimal('0010', '10.000')).toBe(0);
    expect(compareDecimal('99999999999999.9999', '99999999999999.9998')).toBeGreaterThan(0);
    expect(compareDecimal('x', '1')).toBeUndefined();
  });
});
