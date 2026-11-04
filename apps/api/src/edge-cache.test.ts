// A purge after a committed write never turns the write into a refusal (spec 0066, AC-6816): a forget that throws is
// logged and swallowed, one that works is waited for.
import { describe, expect, it } from 'vitest';
import { forgetAfterCommit, type EdgeCache } from './edge-cache.ts';

describe('forgetAfterCommit', () => {
  it('waits for the purge and passes the tags on', async () => {
    const asked: (readonly string[])[] = [];
    const cache: EdgeCache = {
      tag: () => undefined,
      forget: (tags) => {
        asked.push(tags);
        return Promise.resolve();
      },
    };
    await forgetAfterCommit(cache, ['business:abc', 'place:1']);
    expect(asked).toEqual([['business:abc', 'place:1']]);
  });

  it('resolves when the purge rejects, and when it throws outright', async () => {
    const rejecting: EdgeCache = { tag: () => undefined, forget: () => Promise.reject(new Error('edge down')) };
    const throwing: EdgeCache = {
      tag: () => undefined,
      forget: () => {
        throw new Error('no edge');
      },
    };
    await expect(forgetAfterCommit(rejecting, ['business:abc'])).resolves.toBeUndefined();
    await expect(forgetAfterCommit(throwing, ['business:abc'])).resolves.toBeUndefined();
  });
});
