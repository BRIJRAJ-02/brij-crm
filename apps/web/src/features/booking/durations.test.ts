import { describe, expect, it } from 'vitest';
import { lengthChoices, lengthOf } from './durations.ts';

describe('lengthOf', () => {
  it('takes 5 to 480 minutes in steps of 5', () => {
    expect(lengthOf('25')).toBe(25);
    expect(lengthOf(' 120 ')).toBe(120);
    expect(lengthOf('5')).toBe(5);
    expect(lengthOf('480')).toBe(480);
  });

  it('refuses anything else', () => {
    for (const text of ['', '0', '3', '22', '485', '500', '1.5', '-10', 'ten', '25 min']) {
      expect(lengthOf(text)).toBeUndefined();
    }
  });
});

describe('lengthChoices', () => {
  it('adds a page’s custom lengths among the ready picks, shortest first, once each', () => {
    expect(lengthChoices([25, 30], [120])).toEqual([15, 25, 30, 45, 60, 90, 120]);
  });
});
