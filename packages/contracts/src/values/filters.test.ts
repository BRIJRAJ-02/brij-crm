import { describe, expect, it } from 'vitest';
import {
  FilterGroup,
  MAX_FILTER_CONDITIONS,
  MAX_GROUP_CONDITIONS,
  MAX_THROUGH_HOPS,
  type FilterCondition,
} from './filters.ts';

const leaf: FilterCondition = { attributeId: 'a', operator: 'is_empty' };
const through = (path: readonly string[], condition: FilterCondition): FilterCondition => ({
  operator: 'through',
  path,
  condition,
});

describe('FilterGroup', () => {
  it('takes a group at its caps', () => {
    const full = { conjunction: 'and', conditions: Array.from({ length: MAX_GROUP_CONDITIONS }, () => leaf) };
    expect(FilterGroup.safeParse(full).success).toBe(true);
    const twoHops = { conjunction: 'and', conditions: [through(['x', 'y'], leaf)] };
    expect(FilterGroup.safeParse(twoHops).success).toBe(true);
  });

  it('refuses one group with too many conditions', () => {
    const over = { conjunction: 'and', conditions: Array.from({ length: MAX_GROUP_CONDITIONS + 1 }, () => leaf) };
    expect(FilterGroup.safeParse(over).success).toBe(false);
  });

  it('refuses too many conditions across groups', () => {
    const inner = { conjunction: 'or', conditions: Array.from({ length: 40 }, () => leaf) };
    const over = { conjunction: 'and', conditions: [inner, inner, inner] };
    expect(3 * 40).toBeGreaterThan(MAX_FILTER_CONDITIONS);
    expect(FilterGroup.safeParse(over).success).toBe(false);
  });

  it(`refuses a path past ${String(MAX_THROUGH_HOPS)} relationships, nested ones counted`, () => {
    const long = { conjunction: 'and', conditions: [through(['x', 'y', 'z'], leaf)] };
    expect(FilterGroup.safeParse(long).success).toBe(false);
    const nested = { conjunction: 'and', conditions: [through(['x'], through(['y', 'z'], leaf))] };
    expect(FilterGroup.safeParse(nested).success).toBe(false);
  });
});
