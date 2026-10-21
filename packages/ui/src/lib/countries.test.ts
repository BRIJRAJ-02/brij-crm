// The country and phone pickers' search, pinning and "+CC" reading.
import { describe, expect, it } from 'vitest';
import {
  allCountriesIn,
  countriesIn,
  countryOfNumber,
  countryRank,
  flagOf,
  matchesCountry,
  searchCountries,
  withoutDialCode,
} from './countries.ts';

const countries = countriesIn('en');
const india = countries.find((country) => country.code === 'IN');

describe('the country list', () => {
  it('names every country with a dial code, sorted by name, each with its flag', () => {
    expect(india).toEqual({ code: 'IN', name: 'India', dial: '91' });
    expect(countries[0]?.name).toBe('Afghanistan');
    expect(flagOf('IN')).toBe('🇮🇳');
    expect(flagOf('not')).toBe('');
  });

  it('lists every country and territory for a place, those with no dial code too', () => {
    const all = allCountriesIn('en');
    expect(all.length).toBeGreaterThanOrEqual(countries.length);
    expect(all.find((country) => country.code === 'IN')).toEqual({ code: 'IN', name: 'India', dial: '91' });
    const noDial = all.find((country) => country.dial === '');
    if (noDial !== undefined) expect(matchesCountry(noDial, '9')).toBe(false);
  });

  it('finds a country by name, ISO code or dial code, accents aside', () => {
    if (india === undefined) throw new Error('no India');
    expect(matchesCountry(india, 'ind')).toBe(true);
    expect(matchesCountry(india, 'IN')).toBe(true);
    expect(matchesCountry(india, '+91')).toBe(true);
    expect(matchesCountry(india, '9')).toBe(true);
    expect(matchesCountry(india, '+44')).toBe(false);
    expect(searchCountries(countries, 'cote').map((country) => country.code)).toEqual(['CI']);
  });

  it('keeps every country with a dial code while only a "+" is typed', () => {
    if (india === undefined) throw new Error('no India');
    expect(matchesCountry(india, '+')).toBe(true);
    expect(countries.filter((country) => matchesCountry(country, '+'))).toHaveLength(countries.length);
  });

  it("ranks a name that starts with the search, its ISO code, and a shared code's main country first", () => {
    const ranked = (query: string) =>
      countries
        .filter((country) => matchesCountry(country, query))
        .sort((a, b) => countryRank(a, query) - countryRank(b, query))
        .map((country) => country.code);
    expect(ranked('ind').slice(0, 3)).toEqual(['IN', 'ID', 'IO']);
    expect(ranked('an')[0]).toBe('AD');
    expect(ranked('IN')[0]).toBe('IN');
    expect(ranked('+44')[0]).toBe('GB');
    expect(ranked('+4')).toContain('GG');
    expect(ranked('+4').indexOf('GB')).toBeLessThan(ranked('+4').indexOf('GG'));
    expect(ranked('+358')[0]).toBe('FI');
    expect(ranked('+1')[0]).toBe('US');
  });

  it('pins the guessed country first, while it still matches', () => {
    expect(searchCountries(countries, '', 'IN')[0]?.code).toBe('IN');
    expect(searchCountries(countries, 'germ', 'IN').map((country) => country.code)).toEqual(['DE']);
  });
});

describe('a number with its "+" code', () => {
  it('names the country by its longest code, keeping the current one where a code is shared', () => {
    expect(countryOfNumber('+44 7700 900123')).toBe('GB');
    expect(countryOfNumber('+971 50 123 4567')).toBe('AE');
    expect(countryOfNumber('+1 415 555 0100')).toBe('US');
    expect(countryOfNumber('+1 416 555 0100', 'CA')).toBe('CA');
    // A shared code's main country, as libphonenumber names it, not the first by ISO code.
    expect(countryOfNumber('+358 40 123 4567')).toBe('FI');
    expect(countryOfNumber('+358 18 12345', 'AX')).toBe('AX');
    expect(countryOfNumber('+212 650 123456')).toBe('MA');
    expect(countryOfNumber('+590 690 001122')).toBe('GP');
    expect(countryOfNumber('+599 9 123 4567')).toBe('CW');
    expect(countryOfNumber('07700 900123')).toBeUndefined();
  });

  it('keeps the national part once the code is read', () => {
    expect(withoutDialCode('+44 7700 900123', 'GB')).toBe('7700 900123');
    expect(withoutDialCode('07700 900123', 'GB')).toBe('07700 900123');
  });
});
