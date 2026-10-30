// The record panel's address (`?record=`, `?panelTab=`) and its steps through
// the list beside it (spec 0017, AC-384 and AC-385).
import { describe, expect, it } from 'vitest';
import { isPeekTab, isRecordParam, stepsAround } from './params.ts';

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

  it('leaves out a neighbour still loading', () => {
    expect(stepsAround(1, 4, (index) => (index === 2 ? undefined : idAt(index)))).toEqual({ previous: 'a' });
  });

  it('has no steps for a record the list doesn’t hold', () => {
    expect(stepsAround(undefined, 4, idAt)).toBeUndefined();
    expect(stepsAround(9, 4, idAt)).toBeUndefined();
  });
});
