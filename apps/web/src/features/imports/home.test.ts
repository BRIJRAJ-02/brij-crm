import { describe, expect, it } from 'vitest';
import { importHome } from './home.ts';

const PEOPLE = { apiSlug: 'people', pluralName: 'People', icon: 'user', hue: 'blue' } as const;
const PIPELINE = { apiSlug: 'q4-pipeline', name: 'Q4 pipeline', icon: 'list', hue: 'green' } as const;

describe('importHome', () => {
  it('ends an import into a list on the list', () => {
    expect(importHome('acme', PEOPLE, PIPELINE)).toEqual({
      id: 'list',
      name: 'Q4 pipeline',
      icon: 'list',
      hue: 'green',
      href: '/w/acme/lists/q4-pipeline',
    });
  });

  it('ends any other import on its object', () => {
    expect(importHome('acme', PEOPLE, undefined)).toEqual({
      id: 'object',
      name: 'People',
      icon: 'user',
      hue: 'blue',
      href: '/w/acme/objects/people',
    });
  });
});
