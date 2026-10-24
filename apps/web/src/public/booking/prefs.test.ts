// What this browser remembers for a booking page (spec 0025, AC-666, AC-668, and the view per page, 26 Oct 2026):
// a choice is kept under the page it was made on and never reaches another page, the shape drawn before the facts
// follows what the page last opened in, the store spells out no address, and storage that is missing or throws
// changes nothing.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openedBefore, rememberOpened, saveHour12, savedHour12, saveView, savedView } from './prefs.ts';

const INTRO = '/ada/intro';
const DEMO = '/ada/demo';
const LINK_ONLY = '/b/abcdefghijklmnop';

/** A browser's storage, as a page sees it. */
function fakeStorage(start: Readonly<Record<string, string>> = {}) {
  const held = new Map(Object.entries(start));
  return {
    getItem: (key: string) => held.get(key) ?? null,
    setItem: (key: string, value: string) => {
      held.set(key, value);
    },
    held,
  };
}

/** Storage that refuses every read and write, as a private window's can. */
const refusing = {
  getItem: () => {
    throw new Error('Blocked.');
  },
  setItem: () => {
    throw new Error('Blocked.');
  },
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the view chosen on a page', () => {
  it('is answered for that page alone, so the host’s default fills the gap on every other', () => {
    vi.stubGlobal('localStorage', fakeStorage());
    expect(savedView(INTRO)).toBeUndefined();
    saveView(INTRO, 'chat');
    expect(savedView(INTRO)).toBe('chat');
    // A choice made on one page never reaches another: that page opens in its own host's default.
    expect(savedView(DEMO)).toBeUndefined();
    saveView(INTRO, 'month');
    // Month chosen is a choice, not the absence of one: the host's default never takes it back.
    expect(savedView(INTRO)).toBe('month');
  });

  it('wins over the view that page last opened in', () => {
    vi.stubGlobal('localStorage', fakeStorage());
    rememberOpened(INTRO, 'chat');
    expect(openedBefore(INTRO)).toBe('chat');
    saveView(INTRO, 'list');
    // The shape drawn before the facts follows the choice, so the page it fills in with is the same one.
    expect(openedBefore(INTRO)).toBe('list');
    // The host changing their default doesn't take that choice away.
    rememberOpened(INTRO, 'month');
    expect(savedView(INTRO)).toBe('list');
    expect(openedBefore(INTRO)).toBe('list');
  });

  it('answers nothing, and keeps nothing, where storage refuses', () => {
    vi.stubGlobal('localStorage', refusing);
    expect(savedView(INTRO)).toBeUndefined();
    expect(() => saveView(INTRO, 'list')).not.toThrow();
    expect(openedBefore(INTRO)).toBeUndefined();
    expect(() => rememberOpened(INTRO, 'chat')).not.toThrow();
    expect(savedHour12()).toBeUndefined();
    expect(() => saveHour12(true)).not.toThrow();
  });
});

describe('the view a page opened in', () => {
  it('is kept under the page’s address, which the store never spells out', () => {
    const storage = fakeStorage();
    vi.stubGlobal('localStorage', storage);
    expect(openedBefore(LINK_ONLY)).toBeUndefined();
    rememberOpened(LINK_ONLY, 'list');
    rememberOpened(INTRO, 'chat');
    expect(openedBefore(LINK_ONLY)).toBe('list');
    expect(openedBefore(INTRO)).toBe('chat');
    expect(openedBefore(DEMO)).toBeUndefined();
    // A link only page's address is its whole secret, so no address is in the store.
    const stored = storage.held.get('crm.booking.opens') ?? '';
    expect(stored).not.toContain(LINK_ONLY);
    expect(stored).not.toContain(INTRO);
  });

  it('keeps the eight newest pages, and a page met again is never the one pushed out', () => {
    vi.stubGlobal('localStorage', fakeStorage());
    saveView(INTRO, 'chat');
    for (let index = 0; index < 7; index += 1) rememberOpened(`/ada/page-${String(index)}`, 'list');
    // Met again, so it moves to the front rather than ageing towards the edge.
    rememberOpened(INTRO, 'chat');
    for (let index = 7; index < 14; index += 1) rememberOpened(`/ada/page-${String(index)}`, 'list');
    expect(savedView(INTRO)).toBe('chat');
    expect(openedBefore('/ada/page-13')).toBe('list');
    expect(openedBefore('/ada/page-0')).toBeUndefined();
  });

  it('leaves a page whose entry was pushed out opening in its host’s default, not in nothing', () => {
    vi.stubGlobal('localStorage', fakeStorage());
    saveView(INTRO, 'chat');
    for (let index = 0; index < 8; index += 1) rememberOpened(`/ada/page-${String(index)}`, 'list');
    expect(savedView(INTRO)).toBeUndefined();
    expect(openedBefore(INTRO)).toBeUndefined();
  });

  it('reads damaged storage, and a damaged entry, as nothing, and keeps views after it', () => {
    vi.stubGlobal('localStorage', fakeStorage({ 'crm.booking.opens': '{not json' }));
    expect(openedBefore(INTRO)).toBeUndefined();
    rememberOpened(INTRO, 'list');
    expect(openedBefore(INTRO)).toBe('list');
    vi.stubGlobal('localStorage', fakeStorage({ 'crm.booking.opens': '{"abc":{"chose":"grid"},"def":7}' }));
    expect(openedBefore(INTRO)).toBeUndefined();
    expect(savedView(INTRO)).toBeUndefined();
  });
});
