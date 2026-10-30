import { describe, expect, it } from 'vitest';
import { parseDateText } from './parse-date-text.ts';

// Friday 30 October 2026.
const gb = { today: '2026-10-30', locale: 'en-GB' } as const;
const us = { today: '2026-10-30', locale: 'en-US' } as const;

describe('parseDateText', () => {
  it.each([
    ['today', '2026-10-30'],
    ['Tomorrow ', '2026-10-31'],
    ['TMR', '2026-10-31'],
    ['yesterday', '2026-10-29'],
    ['eom', '2026-10-31'],
    ['end of month', '2026-10-31'],
  ])('reads the word %j', (text, day) => {
    expect(parseDateText(text, gb)).toBe(day);
  });

  it('reads a weekday as the next one after today, never today', () => {
    expect(parseDateText('fri', gb)).toBe('2026-11-06');
    expect(parseDateText('Monday', gb)).toBe('2026-11-02');
    expect(parseDateText('sat', gb)).toBe('2026-10-31');
  });

  it('reads "this" and "next" against the week', () => {
    expect(parseDateText('this fri', gb)).toBe('2026-10-30');
    expect(parseDateText('next fri', gb)).toBe('2026-11-06');
    expect(parseDateText('next mon', gb)).toBe('2026-11-02');
    expect(parseDateText('next week', gb)).toBe('2026-11-02');
    expect(parseDateText('next month', gb)).toBe('2026-11-01');
    // A week that starts on Sunday puts next week's first day on the 1st.
    expect(parseDateText('next week', { ...us, firstDayOfWeek: 0 })).toBe('2026-11-01');
  });

  it.each([
    ['in 2 weeks', '2026-11-13'],
    ['in 3 days', '2026-11-02'],
    ['3d', '2026-11-02'],
    ['+2w', '2026-11-13'],
    ['-1d', '2026-10-29'],
    ['2 months ago', '2026-08-30'],
    ['in 1 year', '2027-10-30'],
  ])('reads the amount %j', (text, day) => {
    expect(parseDateText(text, gb)).toBe(day);
  });

  it('keeps a month later to its last day', () => {
    expect(parseDateText('in 1 month', { today: '2027-01-31', locale: 'en-GB' })).toBe('2027-02-28');
  });

  it.each([
    ['Oct 8', '2026-10-08'],
    ['8 oct', '2026-10-08'],
    ['dec 25', '2026-12-25'],
    ['8 October 2027', '2027-10-08'],
    ['oct 8, 27', '2027-10-08'],
    ['sept 3', '2026-09-03'],
  ])('reads the named month %j, this year unless one is given', (text, day) => {
    expect(parseDateText(text, gb)).toBe(day);
  });

  it("reads a numeric day in the language's order", () => {
    expect(parseDateText('8/10', gb)).toBe('2026-10-08');
    expect(parseDateText('8/10', us)).toBe('2026-08-10');
    expect(parseDateText('10/8/2026', us)).toBe('2026-10-08');
    expect(parseDateText('08.10.2026', { today: '2026-10-30', locale: 'de-DE' })).toBe('2026-10-08');
    expect(parseDateText('2026-11-03', us)).toBe('2026-11-03');
    expect(parseDateText('15', gb)).toBe('2026-10-15');
  });

  it.each(['', '   ', 'banana', '31/2', '32', 'next banana', 'in 3 bananas', '2026-02-30'])(
    'names no day for %j',
    (text) => {
      expect(parseDateText(text, gb)).toBeUndefined();
    },
  );
});
