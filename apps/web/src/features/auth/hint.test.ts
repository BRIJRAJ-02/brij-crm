import { describe, expect, it } from 'vitest';
import { localStore, readSessionHint, writeSessionHint } from './hint.ts';

function fakeStorage(initial: Record<string, string> = {}): Storage {
  const data = new Map(Object.entries(initial));
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    key: (index: number) => [...data.keys()][index] ?? null,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
  };
}

function blockedStorage(): Storage {
  const blocked = () => {
    throw new DOMException('The operation is insecure.', 'SecurityError');
  };
  return {
    get length(): number {
      return blocked();
    },
    clear: blocked,
    key: blocked,
    getItem: blocked,
    setItem: blocked,
    removeItem: blocked,
  };
}

describe('the session hint', () => {
  it('remembers what the layer learned, and reads it back', () => {
    const storage = fakeStorage();
    writeSessionHint(storage, 'in');
    expect(readSessionHint(storage)).toBe('in');
    writeSessionHint(storage, 'out');
    expect(readSessionHint(storage)).toBe('out');
  });

  it('is nothing at all on a first visit, and nothing a page could trust', () => {
    expect(readSessionHint(fakeStorage())).toBeUndefined();
    expect(readSessionHint(undefined)).toBeUndefined();
    // Whatever else is in there is not a hint: only what this file writes counts.
    expect(readSessionHint(fakeStorage({ 'crm.session': 'yes' }))).toBeUndefined();
    expect(readSessionHint(fakeStorage({ 'crm.session': 'in' }))).toBeUndefined();
    expect(readSessionHint(fakeStorage({ 'crm.session': 'in:soon' }))).toBeUndefined();
    expect(readSessionHint(fakeStorage({ 'crm.session': '{"user":"ada"}' }))).toBeUndefined();
  });

  it('forgets a session it remembers from longer ago than one can last, rather than holding the app’s place', () => {
    const storage = fakeStorage();
    const day = 24 * 60 * 60 * 1000;
    writeSessionHint(storage, 'in', 1_000 * day);
    expect(readSessionHint(storage, 1_000 * day + 29 * day)).toBe('in');
    expect(readSessionHint(storage, 1_000 * day + 31 * day)).toBeUndefined();
    // Signed out keeps: the server can only agree, and it saves a stranger the app's loading state.
    writeSessionHint(storage, 'out', 1_000 * day);
    expect(readSessionHint(storage, 2_000 * day)).toBe('out');
  });

  it('survives storage that throws, both ways, so the app holds its own place instead', () => {
    const blocked = blockedStorage();
    expect(readSessionHint(blocked)).toBeUndefined();
    expect(() => {
      writeSessionHint(blocked, 'in');
    }).not.toThrow();
  });

  it('hands back no storage when the browser refuses it', () => {
    const refusing = {
      get localStorage(): Storage {
        throw new DOMException('The operation is insecure.', 'SecurityError');
      },
    } as unknown as Window;
    expect(localStore(refusing)).toBeUndefined();
  });
});
