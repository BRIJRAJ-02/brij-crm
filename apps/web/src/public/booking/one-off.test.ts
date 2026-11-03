// The public page's one off link token and its redirect keeping (spec 0062, AC-6201, AC-6204).
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { keepRedirect, oneOffHash, oneOffTokenOf, safeRedirect, takeRedirect } from './one-off.ts';

const TOKEN = 'a'.repeat(43);

/** A tab's storage, in memory. */
function memory() {
  const held = new Map<string, string>();
  return {
    getItem: (key: string) => held.get(key) ?? null,
    setItem: (key: string, value: string) => void held.set(key, value),
    removeItem: (key: string) => void held.delete(key),
  };
}

describe('a one off link on the public page', () => {
  it('reads the token from the fragment only in its own shape', () => {
    expect(oneOffTokenOf(`#o=${TOKEN}`)).toBe(TOKEN);
    expect(oneOffTokenOf(`#x=1&o=${TOKEN}`)).toBe(TOKEN);
    expect(oneOffTokenOf('#o=short')).toBeUndefined();
    expect(oneOffTokenOf('')).toBeUndefined();
  });

  it('hashes it as the server stores it', async () => {
    expect(await oneOffHash(TOKEN)).toBe(createHash('sha256').update(TOKEN).digest('hex'));
  });
});

describe('a redirect after booking', () => {
  it('is kept for the guest page once, and only an https address', () => {
    const storage = memory();
    keepRedirect(storage, 'tok', 'https://acme.example/thanks');
    expect(takeRedirect(storage, 'tok')).toBe('https://acme.example/thanks');
    expect(takeRedirect(storage, 'tok')).toBeUndefined();
    expect(safeRedirect('javascript:alert(1)')).toBeUndefined();
    expect(safeRedirect('http://acme.example')).toBeUndefined();
  });
});
