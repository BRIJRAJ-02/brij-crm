import type { AttributeDefinition, ObjectSummary } from '@crm/data';
import { describe, expect, it } from 'vitest';
import { createEditors } from './create-editors.ts';

const attribute = (id: string, position: number, overrides: Partial<AttributeDefinition> = {}): AttributeDefinition =>
  ({
    id,
    title: id,
    type: 'text',
    position,
    isRequired: false,
    isSystem: false,
    isArchived: false,
    isMulti: false,
    ...overrides,
  }) as AttributeDefinition;

const link = (targets: readonly string[]) =>
  ({
    relationship: {
      id: 'r',
      cardinality: 'many_to_one',
      side: 'from',
      targetObjectIds: [...targets],
      farHoldsOne: false,
    },
  }) as Pick<AttributeDefinition, 'relationship'>;

const deals = { id: 'deals', primaryAttributeId: 'name' } as ObjectSummary;

describe('createEditors', () => {
  it('asks the name, the required ones, then each link to one; links to many and the rest wait behind more', () => {
    const editors = createEditors(deals, [
      attribute('people', 1, { type: 'record_reference', isMulti: true, ...link(['people']) }),
      attribute('company', 2, { type: 'record_reference', ...link(['companies']) }),
      attribute('stage', 3, { type: 'status', isRequired: true }),
      attribute('note', 4),
      attribute('name', 5),
      attribute('parent', 6, { type: 'record_reference', ...link(['deals']) }),
    ] as AttributeDefinition[]);
    expect(editors.first.map((each) => each.id)).toEqual(['name', 'stage', 'company']);
    // A link to one of its own kind (a parent) is rarer: it waits behind more.
    expect(editors.more.map((each) => each.id)).toEqual(['people', 'note', 'parent']);
  });

  it('leaves out a reference that can’t link from here, and system values', () => {
    const editors = createEditors(deals, [
      attribute('name', 1),
      attribute('hidden', 2, { type: 'record_reference', ...link([]) }),
      attribute('made', 3, { type: 'timestamp', isSystem: true }),
    ] as AttributeDefinition[]);
    expect([...editors.first, ...editors.more].map((each) => each.id)).toEqual(['name']);
  });
});
