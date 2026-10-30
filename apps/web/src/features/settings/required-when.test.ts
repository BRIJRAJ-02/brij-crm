import { describe, expect, it } from 'vitest';
import { conditionAttributeIdsOf, requiredWhenLine } from './required-when.ts';

const STAGE = 'stage';
const AMOUNT = 'amount';
const attributes = [
  { id: STAGE, title: 'Stage' },
  { id: AMOUNT, title: 'Amount' },
];
const condition = {
  conjunction: 'and',
  conditions: [
    { attributeId: STAGE, operator: 'is', value: 'won' },
    { conjunction: 'or', conditions: [{ attributeId: AMOUNT, operator: 'is_empty' }] },
    { attributeId: STAGE, operator: 'is_not_empty' },
  ],
};
const withRules = (rules: { kind: string; condition?: unknown }[]) =>
  ({
    validation: {
      required: 'when',
      rules: rules.map((rule, position) => ({ id: `r${String(position)}`, params: {}, position, ...rule })),
    },
  }) as unknown as Parameters<typeof requiredWhenLine>[0];

describe('the Required When line (a rule the dialog never edits)', () => {
  it('names every attribute its condition looks at, once, through nested groups', () => {
    expect(conditionAttributeIdsOf(condition)).toEqual([STAGE, AMOUNT]);
    expect(requiredWhenLine(withRules([{ kind: 'length' }, { kind: 'required_when', condition }]), attributes)).toBe(
      'Required when Stage and Amount match (set through the API).',
    );
  });

  it('says nothing for an attribute without one, and names no attribute the reader can’t see', () => {
    expect(requiredWhenLine(withRules([{ kind: 'length' }]), attributes)).toBeUndefined();
    expect(requiredWhenLine(undefined, attributes)).toBeUndefined();
    expect(requiredWhenLine(withRules([{ kind: 'required_when', condition }]), [])).toBe(
      'Required when a condition holds (set through the API).',
    );
  });
});
