import { describe, expect, it } from 'vitest';
import {
  clampNumber,
  currencySymbol,
  formatNumber,
  parseNumber,
  roundToShown,
  stepNumber,
  type NumberFieldMode,
} from './number.ts';

describe('parseNumber', () => {
  it('reads plain and grouped numbers in English', () => {
    expect(parseNumber('42', 'en-GB')).toEqual({ kind: 'number', value: 42 });
    expect(parseNumber('1,234.5', 'en-GB')).toEqual({ kind: 'number', value: 1234.5 });
    expect(parseNumber(' -3 ', 'en-GB')).toEqual({ kind: 'number', value: -3 });
    expect(parseNumber('.5', 'en-GB')).toEqual({ kind: 'number', value: 0.5 });
  });

  it('reads a German number, and a plain point where the text has no comma', () => {
    expect(parseNumber('1.234,5', 'de-DE')).toEqual({ kind: 'number', value: 1234.5 });
    expect(parseNumber('2.5', 'de-DE')).toEqual({ kind: 'number', value: 2.5 });
  });

  // The review's blocker (12 November 2026): German, Spanish and Brazilian Portuguese group with a point, so a point
  // followed by exactly three digits is their group mark, never a decimal point.
  it.each([
    ['1.234', 'de-DE', 1234],
    ['12.345', 'es-ES', 12_345],
    ['1.500', 'pt-BR', 1500],
    ['-1.500', 'de-DE', -1500],
    ['1.234.567', 'de-DE', 1_234_567],
    ['1.234', 'id', 1234],
    ['1.234', 'tr', 1234],
    ['1.234', 'nl', 1234],
  ])('reads %s in %s as %d: the point is the group mark', (text, locale, value) => {
    expect(parseNumber(text, locale)).toEqual({ kind: 'number', value });
  });

  it.each([
    ['2.5', 'de-DE', 2.5],
    ['12.25', 'de-DE', 12.25],
    ['1.2345', 'de-DE', 1.2345],
    ['0.125', 'de-DE', 0.125],
    ['.125', 'de-DE', 0.125],
    ['1234.567', 'de-DE', 1234.567],
    ['-2.5', 'es-ES', -2.5],
    // Where the point is no group mark at all, any lone point is a decimal point.
    ['1.234', 'fr-FR', 1.234],
    ['1.234', 'ar-EG', 1.234],
  ])('reads %s in %s as %d: a point that cannot be a group mark is a decimal point', (text, locale, value) => {
    expect(parseNumber(text, locale)).toEqual({ kind: 'number', value });
  });

  it('drops a group mark an edit left out of place, and refuses one after the decimal mark', () => {
    expect(parseNumber('1,23', 'en-US')).toEqual({ kind: 'number', value: 123 });
    expect(parseNumber('1.23.4', 'de-DE')).toEqual({ kind: 'number', value: 1234 });
    expect(parseNumber('1.234,5,6', 'de-DE')).toEqual({ kind: 'invalid' });
    expect(parseNumber('1,234.5,6', 'en-US')).toEqual({ kind: 'invalid' });
  });

  it('reads Indian grouping', () => {
    expect(parseNumber('12,34,567.89', 'en-IN')).toEqual({ kind: 'number', value: 1_234_567.89 });
  });

  // The review's second finding: languages that write their own digits (Bengali, Marathi, Arabic, Persian, Nepali).
  it.each([
    ['১,২৩৪.৫', 'bn-IN', 1234.5],
    ['१,२३४.५', 'mr-IN', 1234.5],
    ['١٬٢٣٤٫٥', 'ar-EG', 1234.5],
    ['۱٬۲۳۴٫۵', 'fa', 1234.5],
    ['१,२३४.५', 'ne', 1234.5],
    ['1,234.5', 'bn-IN', 1234.5],
  ])('reads %s in %s, its own digits', (text, locale, value) => {
    expect(parseNumber(text, locale)).toEqual({ kind: 'number', value });
  });

  it('reads a French number grouped with a narrow no break space', () => {
    expect(parseNumber('1 234,5', 'fr-FR')).toEqual({ kind: 'number', value: 1234.5 });
  });

  it('calls an empty text empty and anything else invalid, never a guess', () => {
    expect(parseNumber('   ', 'en-GB')).toEqual({ kind: 'empty' });
    expect(parseNumber('abc', 'en-GB')).toEqual({ kind: 'invalid' });
    expect(parseNumber('1.2.3', 'en-GB')).toEqual({ kind: 'invalid' });
    expect(parseNumber('12px', 'en-GB')).toEqual({ kind: 'invalid' });
  });
});

describe('formatNumber', () => {
  it('writes money with two decimals and a plain number without dust', () => {
    expect(formatNumber(1234.5, 'en-US', 'currency')).toBe('1,234.50');
    expect(formatNumber(0.1 + 0.2, 'en-US')).toBe('0.3');
    expect(formatNumber(12.25, 'en-US', 'percent')).toBe('12.3');
  });

  it('writes in the reader’s language', () => {
    expect(formatNumber(1234.5, 'de-DE', 'currency')).toBe('1.234,50');
  });

  it('round trips through parseNumber', () => {
    const written = formatNumber(98765.43, 'fr-FR', 'currency');
    expect(parseNumber(written, 'fr-FR')).toEqual({ kind: 'number', value: 98765.43 });
  });
});

/** A seeded run of numbers, so the property below sees the same values on every run (and a failure can be re-run). */
function numbersFrom(seed: number, count: number): number[] {
  let state = seed;
  const next = () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 2_147_483_648;
  };
  return Array.from({ length: count }, () => {
    const magnitude = 10 ** Math.floor(next() * 9);
    const value = Math.round(next() * magnitude * 100) / 100;
    return next() < 0.3 ? -value : value;
  });
}

const FIXED = [0, 1, 12, 999, 1000, 1234, 1500, 12_345, 100_000, 1_234_567, 1_234_567.89, 0.5, 2.25, 0.05, 99.99];
const ROUND_TRIP_VALUES = [...FIXED, ...FIXED.map((value) => -value), ...numbersFrom(73, 200)];
const ROUND_TRIP_LOCALES = [
  'de-DE',
  'es-ES',
  'pt-BR',
  'fr-FR',
  'en-IN',
  'en-US',
  'bn-IN',
  'mr-IN',
  'ar-EG',
  'fa',
  'ne',
];
const MODES: readonly NumberFieldMode[] = ['number', 'currency', 'percent'];

describe('parseNumber(formatNumber(x)) is x, as shown', () => {
  it.each(ROUND_TRIP_LOCALES)('in %s, in every mode', (locale) => {
    for (const mode of MODES) {
      for (const value of ROUND_TRIP_VALUES) {
        const written = formatNumber(value, locale, mode);
        const read = parseNumber(written, locale);
        // What the field shows is the value rounded to its mode's decimals, so that is what reading it gives back.
        expect(read, `${locale} ${mode} ${String(value)} → "${written}"`).toEqual({
          kind: 'number',
          value: roundToShown(value, mode) + 0,
        });
      }
    }
  });
});

describe('roundToShown', () => {
  it('rounds to the decimals the mode shows', () => {
    expect(roundToShown(12.345, 'currency')).toBe(12.35);
    expect(roundToShown(12.25, 'percent')).toBe(12.3);
    expect(roundToShown(1.23456, 'number')).toBe(1.23);
    expect(roundToShown(1.23456, 'number', 0.001)).toBe(1.235);
    expect(roundToShown(1.23456, 'number', 1, 0)).toBe(1);
    expect(roundToShown(-0.004, 'currency')).toBe(0);
  });
});

describe('stepping', () => {
  it('steps without float dust and holds the limits', () => {
    expect(stepNumber(0.1, 0.2, 1, 0, 10)).toBe(0.3);
    expect(stepNumber(9, 1, 10, 0, 10)).toBe(10);
    expect(stepNumber(1, 1, -10, 0, 10)).toBe(0);
    expect(clampNumber(-5, 0, Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe('currencySymbol', () => {
  it('gives the narrow symbol', () => {
    expect(currencySymbol('USD', 'en-US')).toBe('$');
    expect(currencySymbol('EUR', 'en-GB')).toBe('€');
    expect(currencySymbol('INR', 'en-IN')).toBe('₹');
  });
});
