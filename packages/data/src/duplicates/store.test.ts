// Likely duplicates in the data layer (spec 0049): the check's pause, abort
// and quiet failure, and the pairs list's paging, reading on past short pages,
// and "Not a duplicate" shown at once, put back on a refusal, and its Undo.
import type { DuplicatePair, DuplicatePairs } from '@crm/contracts';
import { describe, expect, it } from 'vitest';
import { createDuplicateCheck, createDuplicatePairs, pairKey } from './store.ts';

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const ref = (id: string) => ({ objectId: 'o', recordId: id, name: id, kind: 'company' as const });
const pair = (a: string, b: string): DuplicatePair => ({ a: ref(a), b: ref(b), reason: 'name' });

describe('the check', () => {
  it('waits for the pause, aborts the request before, and shows nothing when a check fails', async () => {
    const timers: (() => void)[] = [];
    const calls: { signal: AbortSignal; resolve: (value: readonly []) => void; reject: () => void }[] = [];
    const check = createDuplicateCheck({
      run: (_values, signal) =>
        new Promise((resolve, reject) => {
          calls.push({ signal, resolve: () => resolve([]), reject: () => reject(new Error('limited')) });
        }),
      later: (run) => {
        timers.push(run);
        return () => undefined;
      },
    });
    check.ask({ n: 'Acme' });
    expect(check.getSnapshot().status).toBe('checking');
    timers.shift()?.();
    check.ask({ n: 'Acme Inc' });
    expect(calls[0]?.signal.aborted).toBe(true);
    timers.shift()?.();
    calls[1]?.reject();
    await settle();
    expect(check.getSnapshot()).toEqual({ status: 'ready', matches: [] });
    check.ask({ n: '' });
    expect(check.getSnapshot()).toEqual({ status: 'idle', matches: [] });
  });
});

describe('the pairs', () => {
  it('reads on past short pages, and dismisses at once with a refusal putting the pair back', async () => {
    const pages: DuplicatePairs[] = [{ pairs: [pair('a', 'b')], cursor: 'c1' }, { pairs: [pair('c', 'd')] }];
    let refuse = true;
    const list = createDuplicatePairs({
      load: () => Promise.resolve(pages.shift() ?? { pairs: [] }),
      dismiss: () => (refuse ? Promise.reject(new Error('no')) : Promise.resolve()),
      restore: () => Promise.resolve(),
      isForbidden: () => false,
    });
    expect(list.getSnapshot().status).toBe('loading');
    list.subscribe(() => undefined);
    await settle();
    await settle();
    expect(list.getSnapshot().pairs.map(pairKey)).toEqual(['a:b', 'c:d']);
    expect(list.getSnapshot().hasMore).toBe(false);
    const refused = list.dismiss(pair('b', 'a'));
    expect(list.getSnapshot().pairs.map(pairKey)).toEqual(['c:d']);
    await expect(refused).rejects.toThrow('no');
    expect(list.getSnapshot().pairs.map(pairKey)).toEqual(['a:b', 'c:d']);
    refuse = false;
    await list.dismiss(pair('a', 'b'));
    expect(list.getSnapshot().pairs.map(pairKey)).toEqual(['c:d']);
    await list.restore(pair('a', 'b'));
    expect(list.getSnapshot().pairs.map(pairKey)).toEqual(['a:b', 'c:d']);
  });

  it('says forbidden for an object out of reach', async () => {
    const list = createDuplicatePairs({
      load: () => Promise.reject(new Error('gone')),
      dismiss: () => Promise.resolve(),
      restore: () => Promise.resolve(),
      isForbidden: () => true,
    });
    list.subscribe(() => undefined);
    await settle();
    expect(list.getSnapshot().status).toBe('forbidden');
  });
});

describe('the pairs’ life', () => {
  it('reads nothing until a screen shows it, and stops when the last one leaves', async () => {
    const signals: AbortSignal[] = [];
    const list = createDuplicatePairs({
      load: (_cursor, signal) => {
        signals.push(signal);
        return new Promise(() => undefined);
      },
      dismiss: () => Promise.resolve(),
      restore: () => Promise.resolve(),
      isForbidden: () => false,
    });
    await settle();
    expect(signals).toHaveLength(0);
    const leave = list.subscribe(() => undefined);
    expect(signals).toHaveLength(1);
    leave();
    expect(signals[0]?.aborted).toBe(true);
    list.subscribe(() => undefined);
    expect(signals).toHaveLength(2);
  });
});
