// The country and phone pickers' search, pinning and "+CC" reading.
import { describe, expect, it } from 'vitest';
import { countriesIn, countryOfNumber, flagOf, matchesCountry, searchCountries, withoutDialCode } from './countries.ts';

const countries = countriesIn('en');
const india = countries.find((country) => country.code === 'IN');

describe('the country list', () => {
  it('names every country with a dial code, sorted by name, each with its flag', () => {
    expect(india).toEqual({ code: 'IN', name: 'India', dial: '91' });
    expect(countries[0]?.name).toBe('Afghanistan');
    expect(flagOf('IN')).toBe('🇮🇳');
    expect(flagOf('not')).toBe('');
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
    expect(countryOfNumber('07700 900123')).toBeUndefined();
  });

  it('keeps the national part once the code is read', () => {
    expect(withoutDialCode('+44 7700 900123', 'GB')).toBe('7700 900123');
    expect(withoutDialCode('07700 900123', 'GB')).toBe('07700 900123');
  });
});
