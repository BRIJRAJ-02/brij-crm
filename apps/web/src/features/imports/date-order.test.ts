import { describe, expect, it } from 'vitest';
import { browserOrder, defaultDateOrder, longDay, numericDates, orderLocale } from './date-order.ts';

describe('defaultDateOrder', () => {
  it('reads day first when a first number is above 12', () => {
    expect(defaultDateOrder(['03/04/2025', '13/04/2025'], 'en-US')).toBe('day-first');
  });

  it('reads month first when a second number is above 12', () => {
    expect(defaultDateOrder(['03/04/2025', '04/13/2025'], 'en-IN')).toBe('month-first');
  });

  it('falls back to the browser’s order when every value reads either way, or the file mixes both', () => {
    expect(defaultDateOrder(['03/04/2025', '1.2.25'], 'en-IN')).toBe('day-first');
    expect(defaultDateOrder(['03/04/2025'], 'en-US')).toBe('month-first');
    expect(defaultDateOrder(['13/04/2025', '04/13/2025'], 'en-US')).toBe('month-first');
    expect(defaultDateOrder(['2025-04-13'], 'en-GB')).toBe('day-first');
  });
});

describe('the order’s helpers', () => {
  it('knows a language’s order', () => {
    expect(browserOrder('en-US')).toBe('month-first');
    expect(browserOrder('en-IN')).toBe('day-first');
    expect(browserOrder('de-DE')).toBe('day-first');
  });

  it('keeps only the dates the order changes', () => {
    expect(numericDates(['03/04/2025', '2025-04-03', 'soon', '3-4-25'])).toEqual(['03/04/2025', '3-4-25']);
  });

  it('names a language for each order, and writes a day out', () => {
    expect(orderLocale('day-first')).toBe('en-GB');
    expect(orderLocale('month-first')).toBe('en-US');
    expect(longDay('2025-04-03', 'en-GB')).toBe('3 April 2025');
    expect(longDay(undefined, 'en-GB')).toBeUndefined();
  });
});
