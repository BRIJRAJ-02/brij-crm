import { describe, expect, it } from 'vitest';
import { clampNumber, currencySymbol, formatNumber, parseNumber, stepNumber } from './number.ts';

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
