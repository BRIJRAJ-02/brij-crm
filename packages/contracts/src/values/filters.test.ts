import { describe, expect, it } from 'vitest';
import {
  FilterCondition,
  FilterGroup,
  MAX_ATTRIBUTE_ID_LENGTH,
  MAX_FILTER_CONDITIONS,
  MAX_FILTER_DEPTH,
  MAX_FILTER_NESTING,
  MAX_GROUP_CONDITIONS,
  MAX_THROUGH_HOPS,
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

  it(`takes groups nested ${String(MAX_FILTER_DEPTH)} deep, and refuses a fourth level with the depth message`, () => {
    const nest = (levels: number) => {
      let group: unknown = { conjunction: 'and', conditions: [leaf] };
      for (let level = 1; level < levels; level += 1) group = { conjunction: 'or', conditions: [leaf, group] };
      return group;
    };
    expect(FilterGroup.safeParse(nest(MAX_FILTER_DEPTH)).success).toBe(true);
    const deeper = FilterGroup.safeParse(nest(MAX_FILTER_DEPTH + 1));
    expect(deeper.error?.issues.map((issue) => issue.message)).toEqual([
      `Groups can nest at most ${String(MAX_FILTER_DEPTH)} deep.`,
    ]);
  });

  it('refuses a filter nested a thousand deep as bad input, without overflowing the stack', () => {
    let group: unknown = { conjunction: 'and', conditions: [] };
    for (let level = 0; level < 1_000; level += 1) group = { conjunction: 'and', conditions: [group] };
    const parsed = FilterGroup.safeParse(group);
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.message).toBe(`Groups can nest at most ${String(MAX_FILTER_DEPTH)} deep.`);

    let condition: unknown = leaf;
    for (let level = 0; level < 5_000; level += 1) condition = through(['x'], condition as FilterCondition);
    const hops = `A filter follows at most ${String(MAX_THROUGH_HOPS)} relationships.`;
    expect(FilterCondition.safeParse(condition).error?.issues[0]?.message).toBe(hops);
    expect(FilterGroup.safeParse({ conjunction: 'and', conditions: [condition] }).error?.issues[0]?.message).toBe(hops);
  });

  it('refuses an attribute id past its length cap', () => {
    const long = 'a'.repeat(MAX_ATTRIBUTE_ID_LENGTH + 1);
    expect(FilterCondition.safeParse({ attributeId: long, operator: 'is_empty' }).success).toBe(false);
    expect(FilterCondition.safeParse({ attributeId: long.slice(1), operator: 'is_empty' }).success).toBe(true);
  });

  it('walks every key of a node shaped as both a group and a through, so a chain hidden in it is refused', () => {
    let chain: unknown = leaf;
    for (let level = 0; level < 2_000; level += 1) chain = through(['x'], chain as FilterCondition);
    const mixed = { conjunction: 'and', conditions: [], operator: 'through', path: ['x'], condition: chain };
    const parsed = FilterGroup.safeParse(mixed);
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.message).toBe(
      `A filter follows at most ${String(MAX_THROUGH_HOPS)} relationships.`,
    );
    // Depth hidden under any other key is refused too, before a schema recurses into it.
    let deep: unknown = 'x';
    for (let level = 0; level < 3_000; level += 1) deep = [deep];
    const valued = { conjunction: 'and', conditions: [{ attributeId: 'a', operator: 'is', value: deep }] };
    expect(FilterGroup.safeParse(valued).error?.issues[0]?.message).toBe('This filter is nested too deep.');
    const hidden = { conjunction: 'and', conditions: [], extra: deep };
    expect(FilterGroup.safeParse(hidden).error?.issues[0]?.message).toBe('This filter is nested too deep.');
  });

  it(`takes the deepest real filter, inside ${String(MAX_FILTER_NESTING)} levels`, () => {
    const references = Array.from({ length: 3 }, () => ({ objectId: 'o', recordId: 'r' }));
    const deepest = through(['x'], through(['y'], { attributeId: 'a', operator: 'is_any_of', values: references }));
    const nested = {
      conjunction: 'and',
      conditions: [{ conjunction: 'or', conditions: [{ conjunction: 'and', conditions: [deepest] }] }],
    };
    expect(FilterGroup.safeParse(nested).success).toBe(true);
  });
});
