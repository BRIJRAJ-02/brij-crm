// Scheduled blocks (spec 0061, AC-6111): a block's window, the editor's chip, and an owner's wall clock as UTC.
import { ProfileBlock } from '@crm/contracts';
import { describe, expect, it } from 'vitest';
import { isShownAt, profileWindowState, windowOf, zonedToUtc } from './schedule.ts';

const at = (iso: string) => new Date(iso);

describe('a block’s window', () => {
  const window = { showFrom: '2026-11-03T09:00:00.000Z', hideAfter: '2026-11-10T09:00:00.000Z' };

  it('shows a block from its start, inclusive, until its end, exclusive', () => {
    expect(isShownAt(window, at('2026-11-03T08:59:59.999Z'))).toBe(false);
    expect(isShownAt(window, at('2026-11-03T09:00:00.000Z'))).toBe(true);
    expect(isShownAt(window, at('2026-11-10T08:59:59.999Z'))).toBe(true);
    expect(isShownAt(window, at('2026-11-10T09:00:00.000Z'))).toBe(false);
    expect(isShownAt({}, at('2026-11-10T09:00:00.000Z'))).toBe(true);
    expect(isShownAt({ title: 'x' }, at('2026-11-10T09:00:00.000Z'))).toBe(true);
    // A window whose end is before its start shows nothing, rather than everything.
    expect(isShownAt({ showFrom: window.hideAfter, hideAfter: window.showFrom }, at('2026-11-05T00:00:00Z'))).toBe(
      false,
    );
  });

  it('reads the window from stored data, and nothing else', () => {
    expect(windowOf({ ...window, title: 'x' })).toEqual(window);
    expect(windowOf({ showFrom: 3 })).toEqual({});
    expect(windowOf(null)).toEqual({});
  });

  it('says where it stands for the editor’s chip', () => {
    expect(profileWindowState(window, at('2026-11-01T00:00:00Z'))).toEqual({ state: 'starts', at: window.showFrom });
    expect(profileWindowState(window, at('2026-11-05T00:00:00Z'))).toEqual({ state: 'ends', at: window.hideAfter });
    expect(profileWindowState(window, at('2026-11-11T00:00:00Z'))).toEqual({ state: 'ended', at: window.hideAfter });
    expect(profileWindowState({}, at('2026-11-11T00:00:00Z'))).toEqual({ state: 'always' });
  });

  it('refuses an end at or before its start, and keeps instants in one spelling', () => {
    const refused = ProfileBlock.safeParse({
      kind: 'link',
      title: 'Sale',
      url: 'shop.example.com',
      showFrom: '2026-11-10T09:00:00Z',
      hideAfter: '2026-11-03T09:00:00Z',
    });
    expect(refused.success).toBe(false);
    expect(refused.error?.issues[0]).toMatchObject({
      path: ['hideAfter'],
      message: '“Hide after” has to come after “Show from”.',
    });
    const kept = ProfileBlock.parse({ kind: 'banner', text: 'Sale', showFrom: '2026-11-03T09:00:00Z' });
    expect(kept).toMatchObject({ showFrom: '2026-11-03T09:00:00.000Z' });
    // A heading carries no window.
    expect(ProfileBlock.parse({ kind: 'heading', title: 'A', showFrom: '2026-11-03T09:00:00Z' })).not.toHaveProperty(
      'showFrom',
    );
  });
});

describe('an owner’s wall clock as UTC', () => {
  it('reads a time in the owner’s zone, across a clock change', () => {
    expect(zonedToUtc('2026-11-03T09:00', 'Europe/London')).toBe('2026-11-03T09:00:00.000Z');
    expect(zonedToUtc('2026-07-03T09:00', 'Europe/London')).toBe('2026-07-03T08:00:00.000Z');
    expect(zonedToUtc('2026-11-03T09:00', 'Asia/Kolkata')).toBe('2026-11-03T03:30:00.000Z');
    expect(zonedToUtc('2026-11-03T09:00', 'America/New_York')).toBe('2026-11-03T14:00:00.000Z');
    // The hour a spring change skips is read forward.
    expect(zonedToUtc('2026-03-29T01:30', 'Europe/London')).toBe('2026-03-29T01:30:00.000Z');
  });

  it('refuses a time or a zone that can’t be read', () => {
    expect(zonedToUtc('2026-02-30T09:00', 'Europe/London')).toBeUndefined();
    expect(zonedToUtc('2026-11-03 09:00', 'Europe/London')).toBeUndefined();
    expect(zonedToUtc('2026-11-03T09:00', 'Mars/Olympus')).toBeUndefined();
  });
});
