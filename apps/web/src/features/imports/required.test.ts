import type { AttributeDefinition } from '@crm/data';
import { describe, expect, it } from 'vitest';
import { unmatchedRequired } from './required.ts';

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
