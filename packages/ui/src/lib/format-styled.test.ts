import { describe, expect, it } from 'vitest';
import { formatDayNear, formatNumber } from './format.ts';

describe('formatNumber', () => {
  it('is the plain decimal with no settings', () => {
    expect(formatNumber('1234.5', 'en-US')).toBe('1,234.5');
  });

  it('fixes the decimals shown', () => {
    expect(formatNumber('1234.5', 'en-US', { decimals: 2 })).toBe('1,234.50');
    expect(formatNumber('1234.5678', 'en-US', { decimals: 0 })).toBe('1,235');
  });

  it('writes a compact number in the language', () => {
    expect(formatNumber('1200000', 'en-US', { isCompact: true })).toBe('1.2M');
    expect(formatNumber('12000', 'en-US', { isCompact: true })).toBe('12K');
    expect(formatNumber('950', 'en-US', { isCompact: true })).toBe('950');
  });
});

describe('formatDayNear', () => {
  it('names a day within a week of today', () => {
    expect(formatDayNear('2026-10-08', '2026-10-08', 'en-GB')).toBe('Today');
    expect(formatDayNear('2026-10-09', '2026-10-08', 'en-GB')).toBe('Tomorrow');
    expect(formatDayNear('2026-10-07', '2026-10-08', 'en-GB')).toBe('Yesterday');
    expect(formatDayNear('2026-10-11', '2026-10-08', 'en-GB')).toBe('In 3 days');
    expect(formatDayNear('2026-10-05', '2026-10-08', 'en-GB')).toBe('3 days ago');
  });

  it('leaves a day further away to the date', () => {
    expect(formatDayNear('2026-10-20', '2026-10-08', 'en-GB')).toBeUndefined();
  });
});
