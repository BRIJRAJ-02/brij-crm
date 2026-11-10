import { describe, expect, it } from 'vitest';
import { noteConnectStart, takeConnectArrival, type NoteStore } from './connect-start.ts';

/** A plain store over a map, standing in for session storage. */
function memoryStore(): NoteStore & { readonly size: () => number } {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
    size: () => map.size,
  };
}

describe('which account a connect made', () => {
  it('names the one account that was not there before, and reads the note once', () => {
    const store = memoryStore();
    noteConnectStart(store, { before: ['a'] }, 1_000);
    expect(takeConnectArrival(store, ['b', 'a'], 2_000)).toEqual({ kind: 'new', connectionId: 'b' });
    expect(store.size()).toBe(0);
    expect(takeConnectArrival(store, ['b', 'a'], 2_000)).toEqual({ kind: 'unknown' });
  });

  it('says a reconnect landed on the account it was for', () => {
    const store = memoryStore();
    noteConnectStart(store, { before: ['a', 'b'], reconnecting: 'b' }, 1_000);
    expect(takeConnectArrival(store, ['a', 'b'], 2_000)).toEqual({ kind: 'reconnected', connectionId: 'b' });
  });

  it('guesses nothing with no note, a stale note, a broken note, or the same account connected again', () => {
    const store = memoryStore();
    expect(takeConnectArrival(store, ['a'], 0)).toEqual({ kind: 'unknown' });
    noteConnectStart(store, { before: [] }, 0);
    expect(takeConnectArrival(store, ['a'], 11 * 60_000)).toEqual({ kind: 'unknown' });
    store.setItem('crm.calendar.connect', '{not json');
    expect(takeConnectArrival(store, ['a'], 0)).toEqual({ kind: 'unknown' });
    noteConnectStart(store, { before: ['a'] }, 0);
    expect(takeConnectArrival(store, ['a'], 1)).toEqual({ kind: 'unknown' });
    expect(takeConnectArrival(undefined, ['a'], 1)).toEqual({ kind: 'unknown' });
  });
});
