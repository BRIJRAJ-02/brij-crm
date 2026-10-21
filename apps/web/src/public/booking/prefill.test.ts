// A form's hand off on the booking page (spec 0023 AC-1058; the security
// review of 21 October 2026): the token leaves the address as the page loads
// and is kept in the tab's session storage, so a copied or forwarded address
// never carries it while a reload or the return from Google still has it.
import { describe, expect, it } from 'vitest';
import { forgetHandoff, takeHandoff, type HandoffStorage } from './prefill.ts';

const KEY = 'abcdefghijklmnop';

/** A tab's session storage, in memory. */
function memory(): HandoffStorage & { readonly kept: Map<string, string> } {
  const kept = new Map<string, string>();
  return {
    kept,
    getItem: (key) => kept.get(key) ?? null,
    setItem: (key, value) => {
      kept.set(key, value);
    },
    removeItem: (key) => {
      kept.delete(key);
    },
  };
}

/** Storage that refuses everything, as a locked down browser's may. */
const refusing: HandoffStorage = {
  getItem: () => {
    throw new Error('refused');
  },
  setItem: () => {
    throw new Error('refused');
  },
  removeItem: () => {
    throw new Error('refused');
  },
};

describe('a form’s hand off on the booking page', () => {
  it('takes the token out of the address and keeps it for the tab', () => {
    const storage = memory();
    const first = takeHandoff(new URL(`https://app.test/b/${KEY}?p=fb1.abc.def&utm_source=news`), KEY, storage);
    expect(first).toEqual({ handoff: 'fb1.abc.def', tidied: `/b/${KEY}?utm_source=news` });
    // A reload, or the return from Google, finds it in the tab with a clean address.
    expect(takeHandoff(new URL(`https://app.test/b/${KEY}?d=30&calendar=connected`), KEY, storage)).toEqual({
      handoff: 'fb1.abc.def',
    });
    // Another page in the same tab has none.
    expect(takeHandoff(new URL('https://app.test/b/otherpagekey00000'), 'otherpagekey00000', storage)).toEqual({});
    // Booked: the tab's next booking here starts empty.
    forgetHandoff(KEY, storage);
    expect(takeHandoff(new URL(`https://app.test/b/${KEY}`), KEY, storage)).toEqual({});
  });

  it('drops an empty or oversized token from the address and keeps nothing', () => {
    const storage = memory();
    expect(takeHandoff(new URL(`https://app.test/b/${KEY}?p=`), KEY, storage)).toEqual({ tidied: `/b/${KEY}` });
    expect(takeHandoff(new URL(`https://app.test/b/${KEY}?p=${'x'.repeat(4097)}`), KEY, storage)).toEqual({
      tidied: `/b/${KEY}`,
    });
    expect(storage.kept.size).toBe(0);
  });

  it('still reads the token once when storage refuses, and never throws', () => {
    expect(takeHandoff(new URL(`https://app.test/b/${KEY}?p=fb1.abc.def`), KEY, refusing)).toEqual({
      handoff: 'fb1.abc.def',
      tidied: `/b/${KEY}`,
    });
    expect(takeHandoff(new URL(`https://app.test/b/${KEY}`), KEY, refusing)).toEqual({});
    expect(takeHandoff(new URL(`https://app.test/b/${KEY}`), KEY, undefined)).toEqual({});
    expect(() => {
      forgetHandoff(KEY, refusing);
    }).not.toThrow();
  });
});
