// Keeping a view's filter whole when the person saving it can't see all of it
// (27 October 2026). The bug: their screen is built from `effectiveQuery`,
// which leaves out conditions on fields hidden from them or archived, so a
// save wrote the filter without those conditions and deleted them for
// everyone, for good. One flipped sort was enough.
import { describe, expect, it } from 'vitest';
import type { FilterGroup } from './values/filters.ts';
import { hasUnseenConditions, mergeFilter } from './view-model.ts';

const is = (attributeId: string, value: string) => ({ attributeId, operator: 'is' as const, value });
const and = (...conditions: FilterGroup['conditions']): FilterGroup => ({ conjunction: 'and', conditions });
const or = (...conditions: FilterGroup['conditions']): FilterGroup => ({ conjunction: 'or', conditions });

const STAGE = 'a1';
const SALARY = 'a2';
/** Stage is visible; Salary band is archived or hidden, so it never reached the saver's screen. */
const visible = new Set([STAGE]);

describe('mergeFilter', () => {
  it('leaves an ordinary save alone when every condition was visible', () => {
    const stored = and(is(STAGE, 'open'));
    const incoming = and(is(STAGE, 'won'));
    expect(hasUnseenConditions(stored, visible)).toBe(false);
    expect(mergeFilter(stored, incoming, visible)).toEqual({ kind: 'keep', filter: incoming });
  });

  it('keeps the unseen condition when the saver only changed something else', () => {
    // They flipped a sort and pressed Save; the filter they sent back is the one they were shown.
    const stored = and(is(STAGE, 'open'), is(SALARY, 'senior'));
    const shown = and(is(STAGE, 'open'));
    expect(hasUnseenConditions(stored, visible)).toBe(true);
    expect(mergeFilter(stored, shown, visible)).toEqual({ kind: 'keep', filter: stored });
  });

  it('refuses rather than guess when the saver did change the filter', () => {
    // Grafting their branch onto an `or` would change what the view asks, so it says so instead.
    const stored = or(is(STAGE, 'open'), is(SALARY, 'senior'));
    expect(mergeFilter(stored, and(is(STAGE, 'won')), visible)).toEqual({ kind: 'blocked' });
    // Clearing the filter entirely is a change too, and would have wiped the unseen condition.
    expect(mergeFilter(stored, undefined, visible)).toEqual({ kind: 'blocked' });
  });

  it('sees through nested groups, and reads a reordered condition as the same one', () => {
    const stored = and(is(STAGE, 'open'), or(is(SALARY, 'senior'), is(SALARY, 'staff')));
    // The whole nested group was unseen, so what they were shown is just Stage.
    expect(mergeFilter(stored, and(is(STAGE, 'open')), visible)).toEqual({ kind: 'keep', filter: stored });
    // Same condition, keys written in another order: still the same filter, not a change.
    const reordered: FilterGroup = {
      conjunction: 'and',
      conditions: [{ operator: 'is', value: 'open', attributeId: STAGE }],
    };
    expect(mergeFilter(stored, reordered, visible)).toEqual({ kind: 'keep', filter: stored });
  });

  it('has nothing to protect when the view has no filter at all', () => {
    expect(hasUnseenConditions(undefined, visible)).toBe(false);
    expect(mergeFilter(undefined, and(is(STAGE, 'open')), visible)).toEqual({
      kind: 'keep',
      filter: and(is(STAGE, 'open')),
    });
  });
});
