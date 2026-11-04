import type { AttributeDefinition } from '@crm/data';
import { describe, expect, it } from 'vitest';
import { columnsBlock, requiredTone, unmatchedRequired } from './required.ts';

const attribute = (id: string, position: number, extra: Readonly<Record<string, unknown>> = {}) =>
  ({
    id,
    position,
    title: id,
    type: 'text',
    isRequired: true,
    isSystem: false,
    isArchived: false,
    ...extra,
  }) as unknown as AttributeDefinition;

describe('unmatchedRequired', () => {
  it('names the required attributes no column fills and no default fills, in order', () => {
    const attributes = [
      attribute('stage', 2),
      attribute('name', 1, { type: 'personal_name' }),
      attribute('owner', 3, { defaultValue: { kind: 'current_user' } }),
      attribute('note', 4, { isRequired: false }),
      attribute('done', 5, { type: 'checkbox' }),
      attribute('created', 6, { isSystem: true }),
    ];
    expect(unmatchedRequired(attributes, []).map((each) => each.id)).toEqual(['name', 'stage']);
    // A name part fills its name.
    expect(
      unmatchedRequired(attributes, [{ attributeId: 'name', part: 'first' }, undefined]).map((each) => each.id),
    ).toEqual(['stage']);
  });
});

describe('columnsBlock and requiredTone (checked at Continue only)', () => {
  const name = attribute('name', 1);
  it('stops for no matched column first, then for a required field with none', () => {
    expect(columnsBlock(0, [name], true)).toBe('no-column');
    expect(columnsBlock(2, [name], true)).toBe('required');
    expect(columnsBlock(2, [], true)).toBeUndefined();
  });

  it('lets updating only go on without the required fields', () => {
    expect(columnsBlock(2, [name], false)).toBeUndefined();
  });

  it('reads an unmatched required field quietly until Continue was pressed', () => {
    expect(requiredTone(false)).toBe('info');
    expect(requiredTone(true)).toBe('danger');
  });
});
