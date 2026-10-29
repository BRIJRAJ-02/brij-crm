import { describe, expect, it } from 'vitest';
import type { AttributeDefinition } from '@crm/data';
import { canMatchVisitor } from './visitor-match.ts';

const attribute = (changes: Partial<AttributeDefinition>): AttributeDefinition => ({
  id: '0199f0a0-0000-7000-8000-0000000000e1',
  objectId: 'projects',
  apiSlug: 'email',
  title: 'Email',
  type: 'email',
  isMulti: false,
  isRequired: false,
  isUnique: true,
  isSystem: false,
  isPrimary: false,
  config: {},
  position: 3,
  isArchived: false,
  ...changes,
});

describe('canMatchVisitor (crm-f7 booking walk, B2)', () => {
  it('takes an object with a unique email', () => {
    expect(canMatchVisitor([attribute({ type: 'text', apiSlug: 'name' }), attribute({})])).toBe(true);
  });

  it('refuses one whose email is not unique, archived or a system field, as the server does', () => {
    expect(canMatchVisitor([])).toBe(false);
    expect(canMatchVisitor([attribute({ isUnique: false })])).toBe(false);
    expect(canMatchVisitor([attribute({ isArchived: true })])).toBe(false);
    expect(canMatchVisitor([attribute({ isSystem: true })])).toBe(false);
    expect(canMatchVisitor([attribute({ type: 'text' })])).toBe(false);
  });
});
