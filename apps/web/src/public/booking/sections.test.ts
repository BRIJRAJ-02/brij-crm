import { describe, expect, it } from 'vitest';
import type { PublicProfileLink } from '@crm/data/booking';
import { sectionsOf } from './sections.ts';

const A = 'aaaaaaaaaaaaaaaa';
const B = 'bbbbbbbbbbbbbbbb';

const link = (slug: string, section?: string, group: string = A): PublicProfileLink => ({
  slug,
  title: slug,
  description: '',
  durations: [30],
  isTeam: false,
  ...(section === undefined ? {} : { section }),
  group,
});

/** Each card as its heading and its links' slugs. */
const shape = (links: readonly PublicProfileLink[]) =>
  sectionsOf(links).map((each) => [each.title, each.links.map((one) => one.slug)]);

describe('sectionsOf', () => {
  it('groups by section where each first appears, ignoring case and spaces, spelled as the first one', () => {
    expect(shape([link('a'), link('b', 'Sales'), link('c', ' sales '), link('d'), link('e', 'Support')])).toEqual([
      [undefined, ['a', 'd']],
      ['Sales', ['b', 'c']],
      ['Support', ['e']],
    ]);
  });

  it('never puts two workspaces in one card, even unsectioned or under the same heading (owner ask, 24 Oct)', () => {
    const links = [link('quick-chat', undefined, A), link('brijraj', undefined, B), link('demo', 'Sales', B)];
    // The cards with no heading come first, so none sits under another workspace's heading.
    expect(shape([...links, link('pitch', 'sales', A)])).toEqual([
      [undefined, ['quick-chat']],
      [undefined, ['brijraj']],
      ['sales', ['pitch']],
      ['Sales', ['demo']],
    ]);
    // Workspaces in the order of their first link; every card's key is unique.
    const keys = sectionsOf([...links, link('pitch', 'Sales', A)]).map((each) => each.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('keeps one workspace’s cards exactly as Settings arranged them, a headless card after a heading too', () => {
    expect(shape([link('b', 'Sales'), link('a')])).toEqual([
      ['Sales', ['b']],
      [undefined, ['a']],
    ]);
  });

  it('lets a group continue with links read on the next page', () => {
    const first = [link('a', undefined, A), link('b', undefined, B)];
    const next = [link('c', undefined, A)];
    expect(shape([...first, ...next])).toEqual([
      [undefined, ['a', 'c']],
      [undefined, ['b']],
    ]);
  });
});
