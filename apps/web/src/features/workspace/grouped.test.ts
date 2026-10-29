// Why a grouped table shows its rows ungrouped (late trap #30): a 51st option ungrouped every grouped table quietly.
import type { AttributeDefinition } from '@crm/data';
import { describe, expect, it } from 'vitest';
import { groupingGap } from './grouped.ts';

const stage = (options: number, changes: Partial<AttributeDefinition> = {}) =>
  ({
    id: 'stage',
    title: 'Stage',
    type: 'status',
    isMulti: false,
    isArchived: false,
    isPrimary: false,
    position: 1,
    options: Array.from({ length: options }, (_, index) => ({
      id: `o${String(index)}`,
      label: `Option ${String(index)}`,
      hue: 'gray',
      isArchived: false,
    })),
    ...changes,
  }) as unknown as AttributeDefinition;

describe('groupingGap', () => {
  it('says nothing while the table groups, or when the view asks for no grouping', () => {
    expect(groupingGap([stage(5)], 'stage')).toBeUndefined();
    expect(groupingGap([stage(51)], undefined)).toBeUndefined();
  });

  it('names the field past 50 options, and an archived one', () => {
    expect(groupingGap([stage(51)], 'stage')).toBe('Not grouped: Stage has 51 options (max 50)');
    expect(groupingGap([stage(5, { isArchived: true })], 'stage')).toBe('Not grouped: Stage is archived');
    expect(groupingGap([stage(5, { type: 'select', isMulti: true })], 'stage')).toBe(
      'Not grouped: Stage can’t group a table',
    );
  });

  it('never names a field the reader can’t see', () => {
    expect(groupingGap([], 'stage')).toBe('Not grouped: field unavailable');
  });
});
