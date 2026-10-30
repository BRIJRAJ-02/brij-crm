import { describe, expect, it } from 'vitest';
import { cleanEmail, cleanText, parseAmount, parseDateInput, splitPasted } from './parse-input.ts';

describe('cleanText', () => {
  it('drops zero width marks, plain spaces for odd ones, and one pair of wrapping quotes', () => {
    expect(cleanText('​Acme Ltd ')).toBe('Acme Ltd');
    expect(cleanText('"Acme"')).toBe('Acme');
    expect(cleanText('“Acme”')).toBe('Acme');
    expect(cleanText('"Acme')).toBe('"Acme');
  });
});

describe('parseAmount', () => {
  const en = { locale: 'en-US' };
  it('reads symbols and codes on either side, and names the currency', () => {
    expect(parseAmount('$1,200', en)).toEqual({ amount: '1200', currency: 'USD', isPercent: false });
    expect(parseAmount('€5', en)).toEqual({ amount: '5', currency: 'EUR', isPercent: false });
    expect(parseAmount('1,200 USD', en)).toEqual({ amount: '1200', currency: 'USD', isPercent: false });
    expect(parseAmount('usd 99.5', en)).toEqual({ amount: '99.5', currency: 'USD', isPercent: false });
    expect(parseAmount('US$5', en)?.currency).toBe('USD');
    expect(parseAmount('1.234,5 €', { locale: 'de-DE' })).toEqual({
      amount: '1234.5',
      currency: 'EUR',
      isPercent: false,
    });
  });

  it('gives "$" the default dollar', () => {
    expect(parseAmount('$40', { locale: 'en-CA', defaultCurrency: 'CAD' })?.currency).toBe('CAD');
  });

  it('reads thousands, millions and billions exactly', () => {
    expect(parseAmount('1.2k', en)?.amount).toBe('1200');
    expect(parseAmount('2M', en)?.amount).toBe('2000000');
    expect(parseAmount('3bn', en)?.amount).toBe('3000000000');
    expect(parseAmount('$1.25m', en)).toEqual({ amount: '1250000', currency: 'USD', isPercent: false });
  });

  it('reads brackets and a minus anywhere before the digits as negative', () => {
    expect(parseAmount('(300)', en)?.amount).toBe('-300');
    expect(parseAmount('-$5.50', en)?.amount).toBe('-5.5');
    expect(parseAmount('$-5', en)?.amount).toBe('-5');
    expect(parseAmount('− 12', en)?.amount).toBe('-12');
  });

  it('marks a percent and keeps the number as typed', () => {
    expect(parseAmount('12%', en)).toEqual({ amount: '12', isPercent: true });
    expect(parseAmount('12.5 %', en)?.amount).toBe('12.5');
  });

  it('refuses text with no amount', () => {
    expect(parseAmount('', en)).toBeUndefined();
    expect(parseAmount('USD', en)).toBeUndefined();
    expect(parseAmount('abc', en)).toBeUndefined();
    expect(parseAmount('1.23456', en)).toBeUndefined();
  });
});

describe('cleanEmail', () => {
  it('takes the address out of what an email client pastes', () => {
    expect(cleanEmail('mailto:ada@x.com')).toBe('ada@x.com');
    expect(cleanEmail('mailto:ada@x.com?subject=Hi')).toBe('ada@x.com');
    expect(cleanEmail('Ada Lovelace <ada@x.com>')).toBe('ada@x.com');
    expect(cleanEmail('"Lovelace, Ada" <ada@x.com>')).toBe('ada@x.com');
    expect(cleanEmail('ada@x.com.')).toBe('ada@x.com');
    expect(cleanEmail('<ada@x.com>,')).toBe('ada@x.com');
  });
});

describe('splitPasted', () => {
  it('splits on commas, semicolons, tabs and lines', () => {
    expect(splitPasted('a@x.com, b@x.com;c@x.com\nd@x.com')).toEqual(['a@x.com', 'b@x.com', 'c@x.com', 'd@x.com']);
  });

  it('keeps a comma inside a quoted name or angle brackets', () => {
    expect(splitPasted('"Lovelace, Ada" <ada@x.com>, b@x.com')).toEqual(['"Lovelace, Ada" <ada@x.com>', 'b@x.com']);
  });

  it('splits on spaces only when asked', () => {
    expect(splitPasted('+44 20 7123 4567')).toEqual(['+44 20 7123 4567']);
    expect(splitPasted('a.com b.com', { onSpaces: true })).toEqual(['a.com', 'b.com']);
  });
});

describe('parseDateInput', () => {
  const context = { locale: 'en-GB', today: '2026-10-08' };
  it('reads words, names and numbers against today', () => {
    expect(parseDateInput('tomorrow', context)).toBe('2026-10-09');
    expect(parseDateInput('8 Oct 2026', context)).toBe('2026-10-08');
    expect(parseDateInput('in 2 weeks', context)).toBe('2026-10-22');
    expect(parseDateInput('"2026-11-03"', context)).toBe('2026-11-03');
  });

  it('takes the day of an ISO instant', () => {
    expect(parseDateInput('2026-10-08T09:30:00Z', context)).toBe('2026-10-08');
  });

  it('without today, reads only a date that names its year', () => {
    expect(parseDateInput('8 Oct 2026', { locale: 'en-GB' })).toBe('2026-10-08');
    expect(parseDateInput('08/10/2026', { locale: 'en-GB' })).toBe('2026-10-08');
    expect(parseDateInput('tomorrow', { locale: 'en-GB' })).toBeUndefined();
    expect(parseDateInput('Oct 8', { locale: 'en-GB' })).toBeUndefined();
  });
});
