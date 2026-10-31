import type { AttributeDefinition } from '@crm/data';
import { describe, expect, it } from 'vitest';
import { matchedValues } from './matched.ts';

const attribute = (
  id: string,
  type: AttributeDefinition['type'],
  extra: { apiSlug?: string; isPrimary?: boolean; isArchived?: boolean } = {},
) =>
  ({
    id,
    type,
    apiSlug: extra.apiSlug ?? id,
    isPrimary: extra.isPrimary ?? false,
    isArchived: extra.isArchived ?? false,
  }) as const;

describe('what a duplicate check sends (spec 0049, AC-4901)', () => {
  const people = [
    attribute('name', 'personal_name', { isPrimary: true }),
    attribute('email', 'email'),
    attribute('company', 'record_reference'),
    attribute('site', 'domain'),
    attribute('title', 'text'),
    attribute('old', 'email', { isArchived: true }),
  ] as const;
  it('sends a person’s name, email and Company, never a domain or anything else', () => {
    const values = {
      name: { fullName: 'Jane' },
      email: ['j@x.test'],
      company: { recordId: 'c' },
      site: 'x.test',
      title: 'CEO',
      old: ['o@x.test'],
    };
    expect(matchedValues(people, values, 'people')).toEqual({
      name: { fullName: 'Jane' },
      email: ['j@x.test'],
      company: { recordId: 'c' },
    });
  });
  it('sends a company’s name and domains, and leaves empty values out', () => {
    expect(
      matchedValues(people, { name: 'Acme', email: ['a@x.test'], site: 'acme.test', company: null }, 'companies'),
    ).toEqual({
      name: 'Acme',
      site: 'acme.test',
    });
  });
});
