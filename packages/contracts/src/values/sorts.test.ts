// A view's sorts (spec 0003): an attribute and a direction each, at most five, each attribute once.
import { describe, expect, it } from 'vitest';
import { MAX_ATTRIBUTE_ID_LENGTH } from './filters.ts';
import { MAX_SORTS, SortRules } from './sorts.ts';

describe('SortRules', () => {
  it('takes sorts in order', () => {
    const rules = [
      { attributeId: 'stage', direction: 'ascending' },
      { attributeId: 'value', direction: 'descending' },
    ];
    expect(SortRules.parse(rules)).toEqual(rules);
  });

  it('refuses an attribute twice, an unknown direction, and more than five', () => {
    expect(
      SortRules.safeParse([
        { attributeId: 'a', direction: 'ascending' },
        { attributeId: 'a', direction: 'descending' },
      ]).success,
    ).toBe(false);
    expect(SortRules.safeParse([{ attributeId: 'a', direction: 'up' }]).success).toBe(false);
    const many = Array.from({ length: MAX_SORTS + 1 }, (_, index) => ({
      attributeId: `a${String(index)}`,
      direction: 'ascending',
    }));
    expect(SortRules.safeParse(many).success).toBe(false);
  });

  it('refuses an attribute id past its length cap', () => {
    const long = 'a'.repeat(MAX_ATTRIBUTE_ID_LENGTH + 1);
    expect(SortRules.safeParse([{ attributeId: long, direction: 'ascending' }]).success).toBe(false);
    expect(SortRules.safeParse([{ attributeId: long.slice(1), direction: 'ascending' }]).success).toBe(true);
  });
});
