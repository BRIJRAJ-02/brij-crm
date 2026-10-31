// The formula language's table driven test (spec 0015, AC-335): every
// operator and function on typed values, empty inputs and errors, exact
// decimals, the currency rule, text compared ignoring case, the limits, and
// where errors are.
import { describe, expect, it } from 'vitest';
import {
  checkFormulaSource,
  evaluateFormula,
  formulaErrorText,
  parseFormula,
  type FormulaAttribute,
  type FormulaInput,
} from './index.ts';

const ATTRIBUTES: readonly FormulaAttribute[] = [
  {
    id: 'a-value',
    apiSlug: 'value',
    title: 'Value',
    type: 'currency',
    isMulti: false,
    isArchived: false,
    defaultCurrency: 'USD',
  },
  {
    id: 'a-eur',
    apiSlug: 'eur',
    title: 'Euro value',
    type: 'currency',
    isMulti: false,
    isArchived: false,
    defaultCurrency: 'EUR',
  },
  { id: 'a-prob', apiSlug: 'probability', title: 'Probability', type: 'number', isMulti: false, isArchived: false },
  { id: 'a-count', apiSlug: 'count', title: 'Count', type: 'number', isMulti: false, isArchived: false },
  { id: 'a-stage', apiSlug: 'stage', title: 'Stage', type: 'status', isMulti: false, isArchived: false },
  { id: 'a-name', apiSlug: 'name', title: 'Name', type: 'text', isMulti: false, isArchived: false },
  { id: 'a-close', apiSlug: 'close_date', title: 'Close date', type: 'date', isMulti: false, isArchived: false },
  { id: 'a-created', apiSlug: 'created_at', title: 'Created at', type: 'timestamp', isMulti: false, isArchived: false },
  { id: 'a-done', apiSlug: 'done', title: 'Done', type: 'checkbox', isMulti: false, isArchived: false },
  { id: 'a-tags', apiSlug: 'tags', title: 'Tags', type: 'select', isMulti: true, isArchived: false },
  { id: 'a-owner', apiSlug: 'owner', title: 'Owner', type: 'actor_reference', isMulti: false, isArchived: false },
  { id: 'a-old', apiSlug: 'old', title: 'Old', type: 'text', isMulti: false, isArchived: true },
];
const BY_SLUG = new Map(ATTRIBUTES.map((attribute) => [attribute.apiSlug, attribute]));

const RECORD: ReadonlyMap<string, FormulaInput> = new Map([
  ['a-value', { type: 'currency', value: { amount: '1200.5', currency: 'USD' } }],
  ['a-eur', { type: 'currency', value: { amount: '10', currency: 'EUR' } }],
  ['a-prob', { type: 'number', value: '25' }],
  ['a-count', { type: 'number', value: '0' }],
  ['a-stage', { type: 'status', value: 'opt-won' }],
  ['a-name', { type: 'text', value: 'Ada' }],
  ['a-close', { type: 'date', value: '2026-11-30' }],
  ['a-created', { type: 'timestamp', value: '2026-10-01T23:30:00.000Z' }],
  ['a-done', { type: 'checkbox', value: true }],
]);
const EMPTY: ReadonlyMap<string, FormulaInput> = new Map([
  ['a-value', { type: 'currency', value: null }],
  ['a-prob', { type: 'number', value: null }],
  ['a-name', { type: 'text', value: null }],
  ['a-close', { type: 'date', value: null }],
  ['a-done', { type: 'checkbox', value: false }],
]);
const LABELS = new Map([['opt-won', 'Won']]);

/** Checks and evaluates a formula over a record, failing the test on a check error. */
function run(source: string, inputs: ReadonlyMap<string, FormulaInput> = RECORD): unknown {
  const checked = checkFormulaSource(source, BY_SLUG);
  if (!checked.ok) throw new Error(formulaErrorText(checked.error));
  return evaluateFormula(checked.ast, inputs, LABELS, checked.type);
}

/** The first check error's text. */
function refusal(source: string): string {
  const checked = checkFormulaSource(source, BY_SLUG);
  if (checked.ok) throw new Error(`${source} checked.`);
  return formulaErrorText(checked.error);
}

describe('values', () => {
  it.each([
    ['{{value}} * {{probability}} / 100', { amount: '300.125', currency: 'USD' }],
    ['0.1 + 0.2', '0.3'],
    ['1 / 3', '0.3333'],
    ['2 / 3', '0.6667'],
    ['-2.5 * 1', '-2.5'],
    ['ROUND(2.5)', '3'],
    ['ROUND(-2.5)', '-3'],
    ['ROUND(1.23456, 2)', '1.23'],
    ['ABS(-4)', '4'],
    ['MIN(3, 1, 2)', '1'],
    ['MAX(3, 1, 2)', '3'],
    ['AMOUNT({{value}})', '1200.5'],
    ['CURRENCY(5, "EUR")', { amount: '5', currency: 'EUR' }],
    ['{{value}} + {{value}}', { amount: '2401', currency: 'USD' }],
    ['{{value}} / {{value}}', '1'],
    ['LEN({{name}})', '3'],
    ['UPPER({{name}})', 'ADA'],
    ['LOWER({{name}})', 'ada'],
    ['TRIM("  a ")', 'a'],
    ['{{name}} & " " & 1.50', 'Ada 1.5'],
    ['CONCAT({{name}}, "-", TRUE)', 'Ada-Yes'],
    ['TEXT({{value}})', 'USD 1200.5'],
    ['TEXT({{close_date}})', '2026-11-30'],
    ['TEXT({{created_at}})', '2026-10-01T23:30:00.000Z'],
    ['DATE({{created_at}})', '2026-10-01'],
    ['DAYS({{close_date}}, DATE({{created_at}}))', '60'],
    ['{{close_date}} - DATE({{created_at}})', '60'],
    ['ADD_DAYS({{close_date}}, 2)', '2026-12-02'],
    ['{{close_date}} + 1', '2026-12-01'],
    ['YEAR({{close_date}})', '2026'],
    ['MONTH({{close_date}})', '11'],
    ['DAY({{close_date}})', '30'],
    ['IF({{stage}} = "won", "Closed", "Open")', 'Closed'],
    ['IF({{probability}} > 50, "High")', null],
    ['{{stage}}', 'Won'],
    ['COALESCE(BLANK(), {{name}})', 'Ada'],
    ['{{done}}', true],
    ['NOT({{done}})', null],
    ['AND({{done}}, {{probability}} >= 25)', true],
    ['OR(FALSE, false)', null],
    ['CONTAINS({{name}}, "AD")', true],
    ['ISBLANK({{name}})', null],
    ['"won" = "Won"', true],
    ['"a" < "B"', true],
    ['{{close_date}} > DATE({{created_at}})', true],
  ])('%s', (source, expected) => {
    expect(run(source)).toEqual(expected);
  });
});

describe('empty values', () => {
  it.each([
    ['{{value}} * {{probability}} / 100', null],
    ['{{probability}} + 1', null],
    ['-{{probability}}', null],
    ['{{name}} & "!"', '!'],
    ['ISBLANK({{name}})', true],
    ['{{name}} = ""', true],
    ['{{name}} = BLANK()', true],
    ['{{probability}} = 0', null],
    ['IF({{probability}} > 1, 1, 2)', '2'],
    ['{{done}}', null],
    ['MIN({{probability}}, 4)', '4'],
    ['ADD_DAYS({{close_date}}, 1)', null],
  ])('%s', (source, expected) => {
    expect(run(source, EMPTY)).toEqual(expected);
  });
});

describe('evaluation errors give empty', () => {
  it.each([
    ['1 / {{count}}', null],
    ['{{value}} + {{eur}}', null],
    ['{{value}} > {{eur}}', null],
    ['99999999999999 * 10', null],
    ['ADD_DAYS({{close_date}}, 0.5)', null],
    ['ADD_DAYS({{close_date}}, 3000000)', null],
  ])('%s', (source, expected) => {
    expect(run(source)).toEqual(expected);
  });
});

describe('check errors', () => {
  it.each([
    ['{{stage_x}} + 1', 'Unknown attribute {{stage_x}} at character 1.'],
    ['1 + {{stage_x}}', 'Unknown attribute {{stage_x}} at character 5.'],
    ['{{old}}', '{{old}} is archived at character 1.'],
    ['{{tags}}', "Formulas can't use attributes that hold several values yet at character 1."],
    ['{{owner}}', "Formulas can't use Member attributes yet at character 1."],
    ['{{name}} + 1', "Can't add text and a number at character 10."],
    ['{{close_date}} * 2', "Can't multiply a date and a number at character 16."],
    ['1 < 2 < 3', 'Compare two values at a time. Use AND() to join comparisons at character 7.'],
    ['FOO(1)', 'Unknown function FOO at character 1.'],
    ['NOT(1, 2)', 'NOT takes 1 argument at character 1.'],
    ['AND()', 'AND takes 1 to 10 arguments at character 1.'],
    ['LEN(1)', 'LEN needs text as its first argument, not a number at character 5.'],
    ['ROUND(1, 9)', 'ROUND takes a whole number from 0 to 4 as its second argument at character 10.'],
    [
      'CURRENCY(1, "XXX")',
      'CURRENCY needs a currency code in quotes, like "USD", as its second argument at character 13.',
    ],
    ['{{created_at}}', "A formula can't give a date and time yet. Use DATE() at character 1."],
    ['BLANK()', 'A formula must give a value at character 1.'],
    ['"open', 'This text has no closing quote at character 1.'],
    ['(1 + 2', 'Close the bracket with ) at character 7.'],
    ['1 2', "Something's missing before this. Join values with an operator at character 3."],
    ['', 'Write a formula at character 1.'],
  ])('%s', (source, expected) => {
    expect(refusal(source)).toBe(expected);
  });

  it('takes the first referenced currency, else a CURRENCY() literal, else refuses', () => {
    const fromAttribute = checkFormulaSource('{{eur}} + {{value}}', BY_SLUG);
    expect(fromAttribute.ok && fromAttribute.currency).toBe('EUR');
    const fromLiteral = checkFormulaSource('CURRENCY({{probability}}, "GBP")', BY_SLUG);
    expect(fromLiteral.ok && fromLiteral.currency).toBe('GBP');
  });

  it('answers the result type and the ids it reads', () => {
    const checked = checkFormulaSource('IF({{stage}} = "Won", {{probability}}, 0)', BY_SLUG);
    expect(checked.ok && checked.type).toBe('number');
    expect(checked.ok && checked.references).toEqual(['a-stage', 'a-prob']);
    expect(checked.ok && checked.optionReferences).toEqual(['a-stage']);
  });
});

describe('limits', () => {
  it('refuses a source over 2,000 characters', () => {
    const parsed = parseFormula(`${'1 + '.repeat(500)}1`);
    expect(parsed.ok).toBe(false);
  });

  it('refuses more than 200 parts', () => {
    const parsed = parseFormula(Array.from({ length: 120 }, () => '1').join(' + '));
    expect(!parsed.ok && parsed.error.message).toBe('This formula is too long. Split it into two formula attributes.');
  });

  it('refuses nesting more than 20 deep', () => {
    const parsed = parseFormula(`${'ABS('.repeat(22)}1${')'.repeat(22)}`);
    expect(!parsed.ok && parsed.error.message).toBe('This formula nests too deeply.');
  });

  it('refuses more than 20 attributes', () => {
    const many = new Map(
      Array.from({ length: 21 }, (_, index) => [
        `n${String(index)}`,
        {
          id: `n${String(index)}`,
          apiSlug: `n${String(index)}`,
          title: 'N',
          type: 'number',
          isMulti: false,
          isArchived: false,
        },
      ]),
    );
    const source = [...many.keys()].map((slug) => `{{${slug}}}`).join(' + ');
    const checked = checkFormulaSource(source, many);
    expect(!checked.ok && checked.error.message).toBe('A formula can use at most 20 attributes.');
  });
});
