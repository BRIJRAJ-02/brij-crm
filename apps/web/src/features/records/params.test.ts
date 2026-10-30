// The record panel's address (`?record=`, `?panelTab=`) and its steps through
// the list beside it (spec 0017, AC-384 and AC-385).
import { describe, expect, it } from 'vitest';
import { isPeekTab, isRecordParam, loadRowId, stepsAround } from './params.ts';

const ids = ['a', 'b', 'c', 'd'];
const idAt = (index: number) => ids[index];

describe('isRecordParam', () => {
  it('takes a uuid and drops anything else', () => {
    expect(isRecordParam('0199a6f2-0000-7000-8000-000000000001')).toBe(true);
    expect(isRecordParam('new')).toBe(false);
    expect(isRecordParam(42)).toBe(false);
    expect(isRecordParam(undefined)).toBe(false);
  });
});

describe('isPeekTab', () => {
  it('names the panel’s tabs only: Overview stays on the full page', () => {
    expect(isPeekTab('details')).toBe(true);
    expect(isPeekTab('comments')).toBe(true);
    expect(isPeekTab('overview')).toBe(false);
    expect(isPeekTab(undefined)).toBe(false);
  });
});

describe('stepsAround', () => {
  it('names the rows either side', () => {
    expect(stepsAround(1, 4, idAt)).toEqual({ previous: 'a', next: 'c' });
  });

  it('leaves out the step past either end', () => {
    expect(stepsAround(0, 4, idAt)).toEqual({ next: 'b' });
    expect(stepsAround(3, 4, idAt)).toEqual({ previous: 'c' });
  });

  it('keeps the step on for a neighbour the list has but hasn’t loaded, so Next is off only at the real end', () => {
    expect(stepsAround(1, 4, (index) => (index === 2 ? undefined : idAt(index)))).toEqual({
      previous: 'a',
      isNextPending: true,
    });
    expect(stepsAround(2, 4, (index) => (index === 1 ? undefined : idAt(index)))).toEqual({
      next: 'd',
      isPreviousPending: true,
    });
    // At the real end there is nothing to load.
    expect(stepsAround(3, 4, () => undefined)).toEqual({ isPreviousPending: true });
    expect(stepsAround(0, 4, () => undefined)).toEqual({ isNextPending: true });
  });

  it('has no steps for a record the list doesn’t hold', () => {
    expect(stepsAround(undefined, 4, idAt)).toBeUndefined();
    expect(stepsAround(9, 4, idAt)).toBeUndefined();
  });
});

describe('loadRowId', () => {
  /** A list whose rows load when reached, and tell its listeners. */
  const listing = (loaded: Map<number, string>) => {
    const listeners = new Set<() => void>();
    const reached: number[] = [];
    return {
      reached,
      load: (index: number, id: string) => {
        loaded.set(index, id);
        for (const listener of [...listeners]) listener();
      },
      list: {
        reach: (index: number) => {
          reached.push(index);
        },
        idAt: (index: number) => loaded.get(index),
        subscribe: (listener: () => void) => {
          listeners.add(listener);
          return () => {
            listeners.delete(listener);
          };
        },
      },
      listeners,
    };
  };

  it('answers a loaded row at once, asking for nothing', async () => {
    const held = listing(new Map([[5, 'f']]));
    expect(await loadRowId(held.list, 5, new AbortController().signal)).toBe('f');
    expect(held.reached).toEqual([]);
  });

  it('asks the list for the row and answers its id once the block lands', async () => {
    const held = listing(new Map());
    const waiting = loadRowId(held.list, 100, new AbortController().signal);
    expect(held.reached).toEqual([100]);
    held.load(7, 'other');
    held.load(100, 'x');
    expect(await waiting).toBe('x');
    expect(held.listeners.size).toBe(0);
  });

  it('gives up after the time allowed, and when the person moves on', async () => {
    const slow = listing(new Map());
    expect(await loadRowId(slow.list, 100, new AbortController().signal, 5)).toBeUndefined();
    expect(slow.listeners.size).toBe(0);
    const moved = new AbortController();
    const gone = listing(new Map());
    const waiting = loadRowId(gone.list, 100, moved.signal);
    moved.abort();
    expect(await waiting).toBeUndefined();
    expect(gone.listeners.size).toBe(0);
  });
});
