import { describe, expect, it } from 'vitest';
import { monthStep } from './month.ts';

describe('monthStep', () => {
  it('moves along a row and between rows of three', () => {
    expect(monthStep(9, 'ArrowRight')).toBe(10);
    expect(monthStep(9, 'ArrowLeft')).toBe(8);
    expect(monthStep(9, 'ArrowUp')).toBe(6);
    expect(monthStep(4, 'ArrowDown')).toBe(7);
  });

  it("stays put off the year's edges", () => {
    expect(monthStep(9, 'ArrowDown')).toBe(9);
    expect(monthStep(1, 'ArrowUp')).toBe(1);
    expect(monthStep(0, 'ArrowLeft')).toBe(0);
    expect(monthStep(11, 'ArrowRight')).toBe(11);
  });

  it('goes to the ends with Home and End', () => {
    expect(monthStep(5, 'Home')).toBe(0);
    expect(monthStep(5, 'End')).toBe(11);
  });

  it('swaps left and right in a right to left language', () => {
    expect(monthStep(5, 'ArrowLeft', true)).toBe(6);
    expect(monthStep(5, 'ArrowRight', true)).toBe(4);
    expect(monthStep(5, 'ArrowUp', true)).toBe(2);
  });

  it('leaves other keys alone', () => {
    expect(monthStep(5, 'Enter')).toBeUndefined();
  });
});
