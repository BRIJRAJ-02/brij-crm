// Settings › Profile's order (owner ask A102): which pages it lists and under which sections, and the whole order
// each kind of move sends, so what the person arranges is what `/<handle>` shows.
import type { BookingPageView } from '@crm/data';
import { describe, expect, it } from 'vitest';
import {
  fittedOrder,
  orderOf,
  profileGroupsOf,
  profilePagesOf,
  sectionId,
  sectionKeyOf,
  withPageMoved,
  withSectionMoved,
} from './profile-order.ts';

const ME = '0199f0a0-0000-7000-8000-0000000000aa';
const COLLEAGUE = '0199f0a0-0000-7000-8000-0000000000bb';

/** A page with just what the order reads; the rest is never looked at here. */
function page(
  id: string,
  profilePosition: number,
  more: { readonly section?: string; readonly owner?: string; readonly isPrivate?: boolean } = {},
): BookingPageView {
  return {
    id,
    profilePosition,
    profileSection: more.section ?? null,
    ownerMemberId: more.owner ?? ME,
    isPrivate: more.isPrivate ?? false,
  } as BookingPageView;
}

const ids = (pages: readonly BookingPageView[]) => pages.map((each) => each.id).join(' ');

describe('profilePagesOf', () => {
  it('lists my Public pages only, by position then id, as the server orders a profile', () => {
    const pages = [
      page('c', 1),
      page('b', 0),
      page('a', 1),
      page('link-only', 0, { isPrivate: true }),
      page('theirs', 0, { owner: COLLEAGUE }),
    ];
    expect(ids(profilePagesOf(pages, ME))).toBe('b a c');
  });

  it('leaves the list it was given as it was', () => {
    const pages = [page('b', 1), page('a', 0)];
    profilePagesOf(pages, ME);
    expect(ids(pages)).toBe('b a');
  });
});

describe('profileGroupsOf', () => {
  it('puts each section where its first page is, its pages in their order', () => {
    const groups = profileGroupsOf(
      profilePagesOf(
        [
          page('a', 0, { section: 'Sales' }),
          page('b', 1),
          page('c', 2, { section: 'sales ' }),
          page('d', 3, { section: 'Support' }),
        ],
        ME,
      ),
    );
    expect(groups.map((group) => `${group.title ?? '-'}: ${ids(group.items)}`)).toEqual([
      'Sales: a c',
      '-: b',
      'Support: d',
    ]);
    expect(orderOf(groups)).toEqual(['a', 'c', 'b', 'd']);
  });
});

describe('moves', () => {
  const groups = profileGroupsOf([
    page('a', 0, { section: 'Sales' }),
    page('b', 1, { section: 'Sales' }),
    page('c', 2, { section: 'Sales' }),
    page('d', 3),
    page('e', 4, { section: 'Support' }),
  ]);

  it('moves a page within its section and sends the whole order', () => {
    expect(withPageMoved(groups, 'a', 2)).toEqual(['b', 'c', 'a', 'd', 'e']);
    expect(withPageMoved(groups, 'c', 0)).toEqual(['c', 'a', 'b', 'd', 'e']);
  });

  it('never takes a page out of its section', () => {
    expect(withPageMoved(groups, 'd', 1)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(withPageMoved(groups, 'missing', 0)).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('moves a section with all its pages', () => {
    expect(withSectionMoved(groups, 'support', 0)).toEqual(['e', 'a', 'b', 'c', 'd']);
    expect(withSectionMoved(groups, 'sales', 2)).toEqual(['d', 'e', 'a', 'b', 'c']);
    // The pages with no section are one section too, keyed "".
    expect(withSectionMoved(groups, '', 0)).toEqual(['d', 'a', 'b', 'c', 'e']);
  });

  it('sends the order unchanged for a section it doesn’t know or a place out of range', () => {
    expect(withSectionMoved(groups, 'nope', 0)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(withSectionMoved(groups, 'sales', 9)).toEqual(['a', 'b', 'c', 'd', 'e']);
  });
});

describe('fittedOrder', () => {
  it('drops pages gone since and puts pages new since after the rest', () => {
    expect(fittedOrder(['c', 'a', 'gone', 'b'], ['a', 'b', 'c', 'new'])).toEqual(['c', 'a', 'b', 'new']);
  });
});

describe('section ids', () => {
  it('keeps the pages with no section apart from any page id', () => {
    expect(sectionId('')).toBe('section:');
    expect(sectionKeyOf(sectionId(''))).toBe('');
    expect(sectionKeyOf(sectionId('sales'))).toBe('sales');
    expect(sectionKeyOf('0199f0a0-0000-7000-8000-000000000001')).toBeUndefined();
  });
});
