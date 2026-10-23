// The address Copy link gives (owner, 23 Oct 2026): a Public page whose owner has a handle copies /<handle>/<slug>,
// never its /b/ key, and the editor takes a newer read of the page (the handle just claimed in Profile) over the
// cached one the route shows first.
import type { BookingPageView } from '@crm/data';
import { describe, expect, it } from 'vitest';
import { isNotOlder, publicBookingPath } from './links.ts';

/** The fields the address and the read order use; the rest of a page doesn't matter here. */
const page = (changes: Partial<BookingPageView> = {}): BookingPageView =>
  ({
    publicKey: 'x5qe-qYNmYTEPQls',
    slug: 'meeting',
    isPrivate: false,
    updatedAt: '2026-10-22T18:40:00.000Z',
    ...changes,
  }) as unknown as BookingPageView;

describe('the address a page copies', () => {
  it('is the handle address once the owner has a handle, and the /b/ link before', () => {
    expect(publicBookingPath(page())).toBe('/b/x5qe-qYNmYTEPQls');
    expect(publicBookingPath(page({ handle: 'anish' }))).toBe('/anish/meeting');
  });

  it('stays the /b/ link for a Link only page whatever the handle', () => {
    expect(publicBookingPath(page({ handle: 'anish', isPrivate: true }))).toBe('/b/x5qe-qYNmYTEPQls');
  });
});

describe('isNotOlder', () => {
  it('takes a read that only brings the handle claimed in Profile, which leaves updatedAt as it was', () => {
    expect(isNotOlder(page({ handle: 'anish' }), page())).toBe(true);
  });

  it('takes a newer read and refuses one older than the page the editor holds (a save landed since)', () => {
    const saved = page({ updatedAt: '2026-10-22T18:45:00.000Z' });
    expect(isNotOlder(page({ updatedAt: '2026-10-22T18:46:00.000Z' }), saved)).toBe(true);
    expect(isNotOlder(page(), saved)).toBe(false);
  });

  it('compares instants, not text, when the server writes fewer fraction digits', () => {
    expect(
      isNotOlder(page({ updatedAt: '2026-10-22T18:45:00.5Z' }), page({ updatedAt: '2026-10-22T18:45:00.400Z' })),
    ).toBe(true);
  });
});
