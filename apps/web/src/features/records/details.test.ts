// What the record page shows (spec 0017): which attributes Details lists, the
// header's name as it is typed, and which addresses name a tab or a record.
import type { AttributeDefinition, ObjectSummary, RecordView } from '@crm/data';
import { describe, expect, it } from 'vitest';
import { detailAttributes, recordHref, recordName, refsOf, relatedSides } from './details.ts';
import { isRecordId, isRecordTab } from './params.ts';

const attribute = (overrides: Partial<AttributeDefinition>): AttributeDefinition => ({
  id: '0199a6f2-0000-7000-8000-000000000001',
  objectId: '0199a6f2-0000-7000-8000-00000000000a',
  isPrimary: false,
  isArchived: false,
  apiSlug: 'a',
  title: 'A',
  type: 'text',
  isMulti: false,
  isRequired: false,
  isUnique: false,
  isSystem: false,
  config: {},
  position: 0,
  ...overrides,
});

const PEOPLE: ObjectSummary = {
  id: '0199a6f2-0000-7000-8000-00000000000a',
  apiSlug: 'people',
  singularName: 'Person',
  pluralName: 'People',
  icon: 'user',
  hue: 'blue',
  primaryAttributeId: 'name',
  access: 'write',
  position: 0,
  isStandard: true,
  isArchived: false,
};

const record = (values: Record<string, unknown>, name = 'Grace Hopper'): RecordView => ({
  id: '0199a6f2-0000-7000-8000-0000000000aa',
  objectId: PEOPLE.id,
  createdAt: '2026-10-08T09:00:00.000Z',
  createdBy: { type: 'system', id: null },
  updatedAt: '2026-10-08T09:00:00.000Z',
  updatedBy: { type: 'system', id: null },
  display: { objectId: PEOPLE.id, recordId: '0199a6f2-0000-7000-8000-0000000000aa', name, kind: 'person' },
  revision: 0,
  values,
  versions: {},
  linkTotals: {},
});

describe('detailAttributes', () => {
  it('lists non system attributes that hold one value or one record, in attribute order', () => {
    const listed = detailAttributes([
      attribute({ id: 'c', position: 3 }),
      attribute({ id: 'system', position: 0, isSystem: true }),
      attribute({ id: 'team', position: 1, type: 'record_reference', isMulti: true }),
      attribute({ id: 'company', position: 2, type: 'record_reference' }),
      attribute({ id: 'emails', position: 1, type: 'email', isMulti: true }),
    ]);
    expect(listed.map((each) => each.id)).toEqual(['emails', 'company', 'c']);
  });
});

describe('recordName', () => {
  it('follows the primary value as the store holds it, else the display name, else Unnamed', () => {
    expect(recordName(record({ name: { firstName: 'Amazing', lastName: 'Grace' } }), PEOPLE, 'Unnamed person')).toBe(
      'Amazing Grace',
    );
    expect(recordName(record({ name: { fullName: 'Grace B. Hopper' } }), PEOPLE, 'Unnamed person')).toBe(
      'Grace B. Hopper',
    );
    expect(recordName(record({}), PEOPLE, 'Unnamed person')).toBe('Grace Hopper');
    expect(recordName(record({ name: null }, ''), PEOPLE, 'Unnamed person')).toBe('Unnamed person');
  });
});

describe('addresses', () => {
  it('names the tabs and record ids it knows, and builds a record page address', () => {
    expect(isRecordTab('overview') && isRecordTab('activity') && isRecordTab('notes') && isRecordTab('tasks')).toBe(
      true,
    );
    expect(isRecordTab('files')).toBe(true);
    expect(isRecordTab('settings')).toBe(false);
    expect(isRecordId('0199a6f2-0000-7000-8000-0000000000aa')).toBe(true);
    expect(isRecordId('not-an-id')).toBe(false);
    expect(recordHref('acme', 'people', 'r1', 'activity')).toBe('/w/acme/objects/people/r1/activity');
    expect(refsOf({ objectId: 'o', recordId: 'r' })).toEqual([{ objectId: 'o', recordId: 'r' }]);
    expect(refsOf(null)).toEqual([]);
  });
});

describe('relatedSides (spec 0017, AC-375)', () => {
  const COMPANIES = {
    ...PEOPLE,
    id: '0199a6f2-0000-7000-8000-00000000000b',
    apiSlug: 'companies',
    pluralName: 'Companies',
  };
  const relationship = (targetObjectId: string) => ({
    id: '0199a6f2-0000-7000-8000-0000000000r1',
    cardinality: 'one_to_many' as const,
    side: 'to' as const,
    targetObjectIds: [targetObjectId],
    farHoldsOne: true,
  });
  it('lists the sides that hold many, in attribute order, with the object their records come from', () => {
    const team = attribute({
      id: 't',
      title: 'Team',
      type: 'record_reference',
      isMulti: true,
      position: 4,
      relationship: relationship(PEOPLE.id),
    });
    const deals = attribute({
      id: 'd',
      title: 'Deals',
      type: 'record_reference',
      isMulti: true,
      position: 2,
      relationship: relationship(COMPANIES.id),
    });
    const one = attribute({
      id: 'o',
      title: 'Parent',
      type: 'record_reference',
      isMulti: false,
      relationship: relationship(COMPANIES.id),
    });
    const text = attribute({ id: 'x', type: 'text' });
    const sides = relatedSides([team, one, deals, text], [PEOPLE, COMPANIES]);
    expect(sides.map((side) => [side.attribute.title, side.farObject.apiSlug])).toEqual([
      ['Deals', 'companies'],
      ['Team', 'people'],
    ]);
  });
  it('watches the name attribute of every object a side links to, not just the first', () => {
    const named = (object: typeof PEOPLE, primaryAttributeId: string) => ({ ...object, primaryAttributeId });
    const team = attribute({
      id: 't',
      type: 'record_reference',
      isMulti: true,
      relationship: { ...relationship(PEOPLE.id), targetObjectIds: [PEOPLE.id, COMPANIES.id] },
    });
    const [side] = relatedSides([team], [named(PEOPLE, 'person-name'), named(COMPANIES, 'company-name')]);
    expect(side?.farNameAttributeIds).toEqual(['person-name', 'company-name']);
    // A target the person can't see, or one with no name attribute, adds nothing.
    const [partial] = relatedSides([team], [named(PEOPLE, 'person-name')]);
    expect(partial?.farNameAttributeIds).toEqual(['person-name']);
  });
  it('leaves out a side whose far object the person can’t see', () => {
    const team = attribute({ id: 't', type: 'record_reference', isMulti: true, relationship: relationship(PEOPLE.id) });
    expect(relatedSides([team], [COMPANIES])).toEqual([]);
  });
});
