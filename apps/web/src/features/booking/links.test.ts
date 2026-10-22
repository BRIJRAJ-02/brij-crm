// The address Copy link gives (owner, 23 Oct 2026): a Public page whose owner has a handle copies /<handle>/<slug>,
// never its /b/ key, once a newer read brings the handle claimed in Profile.
import type { BookingPageView } from '@crm/data';
import { describe, expect, it } from 'vitest';
import { publicBookingPath, withHandle } from './links.ts';

/** The fields the address reads; the rest of a page doesn't matter here. */
const page = (changes: Partial<BookingPageView> = {}): BookingPageView =>
  ({ publicKey: 'x5qe-qYNmYTEPQls', slug: 'meeting', isPrivate: false, ...changes }) as unknown as BookingPageView;

describe('withHandle', () => {
  it('turns the /b/ link of a page read before the handle into the handle address', () => {
    const before = page();
    expect(publicBookingPath(before)).toBe('/b/x5qe-qYNmYTEPQls');
    expect(publicBookingPath(withHandle(before, 'anish'))).toBe('/anish/meeting');
  });

  it('follows a changed handle, and a handle that is gone falls back to the /b/ link', () => {
    expect(publicBookingPath(withHandle(page({ handle: 'anish' }), 'anish-t'))).toBe('/anish-t/meeting');
    const gone = withHandle(page({ handle: 'anish' }), undefined);
    expect('handle' in gone).toBe(false);
    expect(publicBookingPath(gone)).toBe('/b/x5qe-qYNmYTEPQls');
  });

  it('keeps a Link only page on its /b/ link whatever the handle', () => {
    expect(publicBookingPath(withHandle(page({ isPrivate: true }), 'anish'))).toBe('/b/x5qe-qYNmYTEPQls');
  });
});
