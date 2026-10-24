// What this browser remembers for a booking page (spec 0025, AC-666, AC-668, and the opening view's hint, 25 Oct
// 2026): a choice of view is kept and read back, the page's own default fills the gap, and storage that is missing
// or throws changes nothing.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openedBefore, rememberOpened, saveHour12, savedHour12, saveView, savedView } from './prefs.ts';

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

describe('the remembered view', () => {
  it('answers nothing until this browser has chosen one, so the page’s own default fills the gap', () => {
    vi.stubGlobal('localStorage', fakeStorage());
    expect(savedView()).toBeUndefined();
    saveView('chat');
    expect(savedView()).toBe('chat');
    saveView('month');
    // Month chosen is a choice, not the absence of one: the host's default never takes it back.
    expect(savedView()).toBe('month');
  });

  it('reads a stored value it doesn’t know as no choice at all', () => {
    vi.stubGlobal('localStorage', fakeStorage({ 'crm.booking.view': 'grid' }));
    expect(savedView()).toBeUndefined();
  });

  it('answers nothing, and keeps nothing, where storage refuses', () => {
    vi.stubGlobal('localStorage', refusing);
    expect(savedView()).toBeUndefined();
    expect(() => saveView('list')).not.toThrow();
    expect(savedHour12()).toBeUndefined();
    expect(() => saveHour12(true)).not.toThrow();
    expect(openedBefore('/ada/intro')).toBeUndefined();
    expect(() => rememberOpened('/ada/intro', 'chat')).not.toThrow();
  });
});

describe('the view a page opened in', () => {
  it('is kept under the page’s address, and answers nothing for an address never seen', () => {
    vi.stubGlobal('localStorage', fakeStorage());
    expect(openedBefore('/ada/intro')).toBeUndefined();
    rememberOpened('/ada/intro', 'chat');
    rememberOpened('/b/abcdefghijklmnop', 'list');
    expect(openedBefore('/ada/intro')).toBe('chat');
    expect(openedBefore('/b/abcdefghijklmnop')).toBe('list');
    expect(openedBefore('/ada/other')).toBeUndefined();
    // A page whose host changed the setting is kept at its new view, not both.
    rememberOpened('/ada/intro', 'month');
    expect(openedBefore('/ada/intro')).toBe('month');
  });

  it('keeps the eight newest addresses and lets the older ones go', () => {
    const storage = fakeStorage();
    vi.stubGlobal('localStorage', storage);
    for (let index = 0; index < 10; index += 1) rememberOpened(`/ada/page-${String(index)}`, 'chat');
    expect(openedBefore('/ada/page-9')).toBe('chat');
    expect(openedBefore('/ada/page-2')).toBe('chat');
    expect(openedBefore('/ada/page-1')).toBeUndefined();
    expect(openedBefore('/ada/page-0')).toBeUndefined();
  });

  it('reads damaged storage as nothing, and goes on keeping views after it', () => {
    vi.stubGlobal('localStorage', fakeStorage({ 'crm.booking.opens': '{not json' }));
    expect(openedBefore('/ada/intro')).toBeUndefined();
    rememberOpened('/ada/intro', 'list');
    expect(openedBefore('/ada/intro')).toBe('list');
  });
});
