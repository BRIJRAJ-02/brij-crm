// The filter builder's pure core (spec 0003, filter conditions): new
// conditions per operand, completeness, and edits by path, nested three deep.
import type { FilterGroup } from '@crm/contracts/values';
import { describe, expect, it } from 'vitest';
import { attributeOf } from '../../workbench/attributes.ts';
import {
  addItem,
  canNest,
  completeFilters,
  conditionOn,
  countFilters,
  groupAt,
  isComplete,
  leafOf,
  operatorsFor,
  removeItem,
  setConjunction,
  throughPath,
  updateItem,
} from './filter-model.ts';

const stage = attributeOf('status', 'Stage');
const value = attributeOf('currency', 'Value');
const owner = attributeOf('actor_reference', 'Owner');
const company = attributeOf('record_reference', 'Company', { cardinality: 'one' });
const country = attributeOf('location', 'Location');

describe('new conditions', () => {
  it('start with the type’s first operator and an empty operand of the right shape', () => {
    expect(conditionOn(stage)).toEqual({ attributeId: 'stage', operator: 'is', value: undefined });
    expect(conditionOn(value, 'between')).toEqual({
      attributeId: 'value',
      operator: 'between',
      from: undefined,
      to: undefined,
    });
    expect(conditionOn(stage, 'is_any_of')).toEqual({ attributeId: 'stage', operator: 'is_any_of', values: [] });
    expect(conditionOn(attributeOf('date', 'Close date'), 'within')).toEqual({
      attributeId: 'close_date',
      operator: 'within',
      range: 'this_week',
    });
    expect(conditionOn(owner, 'is_me')).toEqual({ attributeId: 'owner', operator: 'is_me' });
  });

  it('offer no "through": relations are followed from the attribute picker', () => {
    expect(operatorsFor(company).map((each) => each.operator)).not.toContain('through');
  });

  it('read a path through relations, and build one', () => {
    const leaf = conditionOn(country, 'country_is');
    const condition = throughPath(['company'], leaf);
    expect(condition).toEqual({ operator: 'through', path: ['company'], condition: leaf });
    expect(leafOf(condition)).toEqual({ path: ['company'], leaf });
    expect(throughPath([], leaf)).toBe(leaf);
  });
});

describe('completeness', () => {
  it('needs the operand, all of it', () => {
    expect(isComplete({ attributeId: 'stage', operator: 'is', value: undefined })).toBe(false);
    expect(isComplete({ attributeId: 'stage', operator: 'is', value: 'won' })).toBe(true);
    expect(isComplete({ attributeId: 'value', operator: 'between', from: '1', to: undefined })).toBe(false);
    expect(isComplete({ attributeId: 'stage', operator: 'is_any_of', values: [] })).toBe(false);
    expect(isComplete({ attributeId: 'owner', operator: 'is_me' })).toBe(true);
    expect(isComplete(throughPath(['company'], { attributeId: 'name', operator: 'contains', value: '' }))).toBe(false);
  });

  it('drops what can’t filter yet, and the groups that leaves empty', () => {
    const group: FilterGroup = {
      conjunction: 'and',
      conditions: [
        { attributeId: 'stage', operator: 'is', value: 'won' },
        { attributeId: 'stage', operator: 'is', value: undefined },
        { conjunction: 'or', conditions: [{ attributeId: 'owner', operator: 'is', value: undefined }] },
      ],
    };
    expect(completeFilters(group)).toEqual({
      conjunction: 'and',
      conditions: [{ attributeId: 'stage', operator: 'is', value: 'won' }],
    });
    expect(countFilters(group)).toBe(1);
  });
});

describe('edits by path', () => {
  const top: FilterGroup = {
    conjunction: 'and',
    conditions: [
      { attributeId: 'stage', operator: 'is', value: 'won' },
      { conjunction: 'or', conditions: [{ attributeId: 'owner', operator: 'is_me' }] },
    ],
  };

  it('adds, updates and joins inside a nested group', () => {
    const added = addItem(top, [1], { attributeId: 'value', operator: 'gt', value: '100' });
    expect(groupAt(added, [1])?.conditions).toHaveLength(2);
    const updated = updateItem(added, [1, 1], () => ({ attributeId: 'value', operator: 'lt', value: '5' }));
    expect(groupAt(updated, [1])?.conditions[1]).toEqual({ attributeId: 'value', operator: 'lt', value: '5' });
    expect(setConjunction(updated, [1], 'and').conditions[1]).toMatchObject({ conjunction: 'and' });
    expect(setConjunction(top, [], 'or').conjunction).toBe('or');
  });

  it('removes a condition, and a nested group with its last one', () => {
    expect(removeItem(top, [0]).conditions).toHaveLength(1);
    expect(removeItem(top, [1, 0]).conditions).toEqual([{ attributeId: 'stage', operator: 'is', value: 'won' }]);
  });

  it('nests groups at most three deep', () => {
    expect(canNest([])).toBe(true);
    expect(canNest([1])).toBe(true);
    expect(canNest([1, 0])).toBe(false);
  });
});
