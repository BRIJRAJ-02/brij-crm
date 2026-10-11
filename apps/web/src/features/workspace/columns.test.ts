// People's opening columns: the name first, the chosen columns in order, the rest by position, the noisy ones hidden.
import type { AttributeDefinition, ObjectSummary } from '@crm/data';
import { describe, expect, it } from 'vitest';
import { avatarAttribute, listedAttributes, readAttributeIds, shownAttributes } from './columns.ts';

const attribute = (
  apiSlug: string,
  position: number,
  extra: Partial<AttributeDefinition> = {},
): AttributeDefinition => ({
  id: `id-${apiSlug}`,
  apiSlug,
  title: apiSlug,
  type: 'text',
  isMulti: false,
  isRequired: false,
  isUnique: false,
  isSystem: false,
  config: {},
  position,
  ...extra,
});

const ATTRIBUTES: readonly AttributeDefinition[] = [
  attribute('created_at', 0, { isSystem: true, type: 'timestamp' }),
  attribute('email_addresses', 1, { type: 'email', isMulti: true }),
  attribute('name', 0, { type: 'personal_name' }),
  attribute('job_title', 3),
  attribute('description', 4, { type: 'long_text' }),
  attribute('avatar', 6, { type: 'url' }),
  attribute('linkedin', 7, { type: 'url' }),
  attribute('owner', 13, { type: 'actor_reference' }),
  attribute('company', 20, { type: 'record_reference' }),
  attribute('warmth', 21, { type: 'rating' }),
];

const PEOPLE: ObjectSummary = {
  id: 'people',
  apiSlug: 'people',
  singularName: 'Person',
  pluralName: 'People',
  icon: 'user',
  hue: 'blue',
  standardKey: 'people',
  primaryAttributeId: 'id-name',
  access: 'write',
};

describe('People’s opening columns', () => {
  it('leads with the name, then the chosen columns, then the rest by position, then created at', () => {
    expect(shownAttributes(PEOPLE, ATTRIBUTES).map((each) => each.apiSlug)).toEqual([
      'name',
      'email_addresses',
      'company',
      'job_title',
      'owner',
      'warmth',
      'created_at',
    ]);
  });

  it('lists the noisy ones hidden, so the column list still holds them', () => {
    const hidden = listedAttributes(PEOPLE, ATTRIBUTES).filter((each) => each.isHidden);
    expect(hidden.map((each) => each.definition.apiSlug)).toEqual(['description', 'avatar', 'linkedin']);
  });

  it('reads the avatar for the name cell even while its column is hidden', () => {
    expect(avatarAttribute(PEOPLE, ATTRIBUTES)?.apiSlug).toBe('avatar');
    expect(readAttributeIds(PEOPLE, ATTRIBUTES)).toContain('id-avatar');
  });

  it('leaves an object with no opening layout as it is: every attribute by position', () => {
    const custom = { ...PEOPLE, standardKey: undefined, apiSlug: 'projects' } as unknown as ObjectSummary;
    const listed = listedAttributes(custom, ATTRIBUTES);
    expect(listed.every((each) => !each.isHidden)).toBe(true);
    expect(avatarAttribute(custom, ATTRIBUTES)).toBeUndefined();
  });
});
