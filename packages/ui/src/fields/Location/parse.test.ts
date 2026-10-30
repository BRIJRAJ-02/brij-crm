import { describe, expect, it } from 'vitest';
import { countryFromText, locationFromText } from './parse.ts';

describe('countryFromText', () => {
  it('reads names, codes and common aliases', () => {
    expect(countryFromText('United Kingdom', 'en-GB')).toBe('GB');
    expect(countryFromText('UK', 'en-GB')).toBe('GB');
    expect(countryFromText('usa', 'en-US')).toBe('US');
    expect(countryFromText('DE', 'en-GB')).toBe('DE');
    expect(countryFromText('Germany', 'de-DE')).toBe('DE');
    expect(countryFromText('Narnia', 'en-GB')).toBeUndefined();
  });
});

describe('locationFromText', () => {
  it('reads a city and a country', () => {
    expect(locationFromText('London, UK', 'en-GB')).toEqual({ locality: 'London', countryCode: 'GB' });
  });

  it('reads a street, a city with its postcode, and a country', () => {
    expect(locationFromText('10 Downing St, London SW1A 2AA, United Kingdom', 'en-GB')).toEqual({
      line1: '10 Downing St',
      locality: 'London',
      postcode: 'SW1A 2AA',
      countryCode: 'GB',
    });
  });

  it('reads a US address with its state and ZIP', () => {
    expect(locationFromText('1 Main St, Austin, TX 78701, USA', 'en-US')).toEqual({
      line1: '1 Main St',
      locality: 'Austin',
      region: 'TX',
      postcode: '78701',
      countryCode: 'US',
    });
  });

  it('keeps a lone city, and reads nothing from nothing', () => {
    expect(locationFromText('Paris', 'en-GB')).toEqual({ locality: 'Paris' });
    expect(locationFromText('  ', 'en-GB')).toBeUndefined();
  });
});
