// The sign in pages' rules without a browser: which redirects are honoured
// (spec 0005: only a path that starts with a single `/`), the pending email's
// storage, and the resend countdown.
import { describe, expect, it } from 'vitest';
import { clearPending, readPending, savePending } from './pending.ts';
import { safeRedirect, signInHref } from './redirect.ts';
import { secondsLeft } from './useSecondsLeft.ts';

describe('safeRedirect', () => {
  it.each(['/w/acme/objects/people', '/welcome', '/w/acme?view=all#top', '/status'])(
    'honours the app path %s',
    (path) => {
      expect(safeRedirect(path)).toBe(path);
    },
  );

  it.each([
    ['another host', '//evil.example/steal'],
    ['a backslash host', '/\\evil.example'],
    ['an absolute URL', 'https://evil.example'],
    ['a script URL', 'javascript:alert(1)'],
    ['a relative path', 'w/acme'],
    ['a space', '/w/ acme'],
    ['a tab', '/w/\tacme'],
    ['a sign in page', '/sign-in?redirect=/w/acme'],
    ['the verify page', '/verify'],
    ['nothing', undefined],
    ['a number', 42],
  ])('sends %s to /', (_name, value) => {
    expect(safeRedirect(value)).toBe('/');
  });

  it('builds the sign in address with the page to come back to', () => {
    expect(signInHref('/w/acme/objects/people')).toBe('/sign-in?redirect=%2Fw%2Facme%2Fobjects%2Fpeople');
    expect(signInHref('/')).toBe('/sign-in');
    expect(signInHref('//evil.example')).toBe('/sign-in');
  });
});

/** A sessionStorage stand in, optionally one that refuses every call. */
function memoryStorage(refuse = false): Storage {
  const items = new Map<string, string>();
  const guard = () => {
    if (refuse) throw new Error('The storage is blocked.');
  };
  return {
    get length() {
      return items.size;
    },
    clear: () => {
      guard();
      items.clear();
    },
    getItem: (key) => {
      guard();
      return items.get(key) ?? null;
    },
    key: (index) => [...items.keys()][index] ?? null,
    removeItem: (key) => {
      guard();
      items.delete(key);
    },
    setItem: (key, value) => {
      guard();
      items.set(key, value);
    },
  };
}

describe('the pending sign in', () => {
  it('keeps the address and when the code went, until it is cleared', () => {
    const storage = memoryStorage();
    expect(readPending(storage)).toBeUndefined();
    savePending(storage, { email: 'ada@example.com', sentAt: 1_000 });
    expect(readPending(storage)).toEqual({ email: 'ada@example.com', sentAt: 1_000 });
    clearPending(storage);
    expect(readPending(storage)).toBeUndefined();
  });

  it('reads nothing from blocked, missing or garbled storage, and never throws', () => {
    const blocked = memoryStorage(true);
    savePending(blocked, { email: 'ada@example.com', sentAt: 1 });
    expect(readPending(blocked)).toBeUndefined();
    expect(() => {
      clearPending(blocked);
    }).not.toThrow();
    expect(readPending(undefined)).toBeUndefined();
    const garbled = memoryStorage();
    garbled.setItem('crm.signIn.pending', '{not json');
    expect(readPending(garbled)).toBeUndefined();
    garbled.setItem('crm.signIn.pending', JSON.stringify({ email: 42, sentAt: 'soon' }));
    expect(readPending(garbled)).toBeUndefined();
  });
});

describe('secondsLeft', () => {
  it('counts whole seconds up to the moment, and stops at zero', () => {
    expect(secondsLeft(60_000, 0)).toBe(60);
    expect(secondsLeft(60_000, 500)).toBe(60);
    expect(secondsLeft(60_000, 59_001)).toBe(1);
    expect(secondsLeft(60_000, 60_000)).toBe(0);
    expect(secondsLeft(60_000, 90_000)).toBe(0);
  });
});
