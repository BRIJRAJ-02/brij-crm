import { describe, expect, it } from 'vitest';
import type { PublicProfileLink } from '@crm/data/booking';
import { sectionsOf } from './sections.ts';

const link = (slug: string, section?: string): PublicProfileLink => ({
  slug,
  title: slug,
  description: '',
  durations: [30],
  isTeam: false,
  ...(section === undefined ? {} : { section }),
});

describe('sectionsOf', () => {
  it('groups by section where each first appears, ignoring case and spaces, spelled as the first one', () => {
    const sections = sectionsOf([link('a'), link('b', 'Sales'), link('c', ' sales '), link('d'), link('e', 'Support')]);
    expect(sections.map((each) => [each.title, each.links.map((one) => one.slug)])).toEqual([
      [undefined, ['a', 'd']],
      ['Sales', ['b', 'c']],
      ['Support', ['e']],
    ]);
  });
});
