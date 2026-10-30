import type { AttributeDefinition, ObjectSummary } from '@crm/data';
import { describe, expect, it } from 'vitest';
import { makeModeOf, nameValueOf, splitName } from './make.ts';

const attribute = (overrides: Partial<AttributeDefinition>): AttributeDefinition =>
  ({
    id: 'name',
    title: 'Name',
    type: 'text',
    isRequired: false,
    isSystem: false,
    isArchived: false,
    isMulti: false,
    ...overrides,
  }) as AttributeDefinition;

const object = (overrides: Partial<ObjectSummary> = {}): ObjectSummary =>
  ({
    id: 'companies',
    singularName: 'Company',
    pluralName: 'Companies',
    primaryAttributeId: 'name',
    access: 'write',
    isArchived: false,
    ...overrides,
  }) as ObjectSummary;

describe('splitName', () => {
  it('splits at the first space, or takes a comma as last name first', () => {
    expect(splitName(' Ada  King Lovelace ')).toEqual({ firstName: 'Ada', lastName: 'King Lovelace' });
    expect(splitName('Lovelace, Ada')).toEqual({ firstName: 'Ada', lastName: 'Lovelace' });
    expect(splitName('Ada')).toEqual({ firstName: 'Ada' });
    expect(splitName('  ')).toBeUndefined();
  });
});

describe('nameValueOf', () => {
  it('fills a text or personal name primary, and nothing else', () => {
    expect(nameValueOf(attribute({}), ' Acme ')).toBe('Acme');
    expect(nameValueOf(attribute({ type: 'personal_name' }), 'Ada Lovelace')).toEqual({
      firstName: 'Ada',
      lastName: 'Lovelace',
    });
    expect(nameValueOf(attribute({ type: 'number' }), '12')).toBeUndefined();
    expect(nameValueOf(undefined, 'Acme')).toBeUndefined();
  });
});

describe('makeModeOf', () => {
  it('makes from a name when nothing else is required', () => {
    expect(makeModeOf(object(), [attribute({})])).toBe('name');
  });

  it('asks for the form when a required attribute has no default', () => {
    const stage = attribute({ id: 'stage', type: 'status', isRequired: true });
    expect(makeModeOf(object(), [attribute({}), stage])).toBe('form');
    const defaulted = { ...stage, defaultValue: { kind: 'static', value: 'lead' } } as AttributeDefinition;
    expect(makeModeOf(object(), [attribute({}), defaulted])).toBe('name');
    expect(makeModeOf(object(), [attribute({}), { ...stage, isArchived: true }])).toBe('name');
  });

  it('asks for the form when the primary isn’t a name', () => {
    expect(makeModeOf(object(), [attribute({ type: 'number' })])).toBe('form');
  });

  it('offers nothing without write access or on an archived object', () => {
    expect(makeModeOf(object({ access: 'read' }), [attribute({})])).toBeUndefined();
    expect(makeModeOf(object({ isArchived: true }), [attribute({})])).toBeUndefined();
  });
});
