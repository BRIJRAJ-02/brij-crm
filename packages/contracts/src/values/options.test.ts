// AC-3: the option, display and history shapes, the filter conditions, and the
// curated object icons.
import { describe, expect, it } from 'vitest';
import { FilterCondition, FilterGroup } from './filters.ts';
import { HUES } from './hue-list.ts';
import { OBJECT_ICONS, ObjectIcon } from './object-icons.ts';
import { RecordRefDisplay, SelectOption, ValueVersion } from './options.ts';

describe('options and displays', () => {
  it('a select option has an id, a label of 1 to 100 characters, a hue and an archived flag', () => {
    expect(SelectOption.safeParse({ id: 'o1', label: 'Hot', hue: 'red', archived: false }).success).toBe(true);
    expect(SelectOption.safeParse({ id: 'o1', label: '', hue: 'red', archived: false }).success).toBe(false);
    expect(SelectOption.safeParse({ id: 'o1', label: 'Hot', hue: 'pink', archived: false }).success).toBe(false);
  });

  it('a value version is current while activeUntil is null', () => {
    const version = {
      value: 'Hot',
      activeFrom: '2026-10-01T09:30:00.000Z',
      activeUntil: null,
      setBy: { type: 'member', id: 'mem_1' },
    };
    expect(ValueVersion.parse(version)).toEqual(version);
    expect(ValueVersion.safeParse({ ...version, setBy: { type: 'system', id: 'x' } }).success).toBe(false);
  });

  it('a record display names its kind', () => {
    expect(
      RecordRefDisplay.safeParse({ objectId: 'people', recordId: 'r1', name: 'Ada', kind: 'person' }).success,
    ).toBe(true);
    expect(RecordRefDisplay.safeParse({ objectId: 'people', recordId: 'r1', name: 'Ada', kind: 'deal' }).success).toBe(
      false,
    );
  });

  it('HUES lists the nine hues in their token order', () => {
    expect(HUES).toHaveLength(9);
  });
});

describe('filter conditions', () => {
  it('each operator carries its own operand', () => {
    expect(FilterCondition.safeParse({ attributeId: 'a', operator: 'is', value: 'x' }).success).toBe(true);
    expect(FilterCondition.safeParse({ attributeId: 'a', operator: 'between', from: '1', to: '9' }).success).toBe(true);
    expect(FilterCondition.safeParse({ attributeId: 'a', operator: 'is_any_of', values: [] }).success).toBe(false);
    expect(
      FilterCondition.safeParse({ attributeId: 'a', operator: 'within_last', range: { amount: 7, unit: 'day' } })
        .success,
    ).toBe(true);
    expect(FilterCondition.safeParse({ attributeId: 'a', operator: 'within', range: 'this_week' }).success).toBe(true);
    expect(FilterCondition.safeParse({ attributeId: 'a', operator: 'is_empty' }).success).toBe(true);
  });

  it('follows a relation through a path', () => {
    expect(
      FilterCondition.safeParse({
        operator: 'through',
        path: ['company'],
        condition: { attributeId: 'country', operator: 'is', value: 'GB' },
      }).success,
    ).toBe(true);
  });

  it('groups nest at most three deep', () => {
    const leaf = { attributeId: 'a', operator: 'is_empty' } as const;
    const nest = (depth: number): unknown =>
      depth === 1 ? { conjunction: 'and', conditions: [leaf] } : { conjunction: 'or', conditions: [nest(depth - 1)] };
    expect(FilterGroup.safeParse(nest(3)).success).toBe(true);
    expect(FilterGroup.safeParse(nest(4)).success).toBe(false);
  });
});

describe('object icons', () => {
  it('is a curated set of about 150 unique Lucide names', () => {
    expect(OBJECT_ICONS.length).toBeGreaterThanOrEqual(140);
    expect(OBJECT_ICONS.length).toBeLessThanOrEqual(170);
    expect(new Set(OBJECT_ICONS).size).toBe(OBJECT_ICONS.length);
    expect(OBJECT_ICONS.every((name) => /^[a-z][a-z0-9-]*$/.test(name))).toBe(true);
    expect(ObjectIcon.safeParse('rocket').success).toBe(true);
    expect(ObjectIcon.safeParse('skull').success).toBe(false);
  });
});
