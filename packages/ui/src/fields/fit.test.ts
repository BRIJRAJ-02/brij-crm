// How many chips a grid cell shows before "+N".
import { describe, expect, it } from 'vitest';
import { chipsThatFit } from './fit.ts';

describe('chipsThatFit', () => {
  it('shows every chip when they all fit, with no "+N"', () => {
    expect(chipsThatFit([60, 60], 4, 30, 124)).toBe(2);
  });

  it('shows as many whole chips as fit beside "+N"', () => {
    // 60 + 4 + 60 + 4 + 30 = 158: two chips and "+N" fit in 160, not in 157.
    expect(chipsThatFit([60, 60, 60], 4, 30, 160)).toBe(2);
    expect(chipsThatFit([60, 60, 60], 4, 30, 157)).toBe(1);
  });

  it('always shows one chip, which truncates, however narrow the cell', () => {
    expect(chipsThatFit([200, 60], 4, 30, 80)).toBe(1);
  });
});
