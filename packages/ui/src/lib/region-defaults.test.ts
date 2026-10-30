import { describe, expect, it } from 'vitest';
import { countryOfLocale, currencyOfCountry, regionDefaults } from './region-defaults.ts';

describe('region defaults', () => {
  it('reads the region from the language', () => {
    expect(countryOfLocale('en-GB')).toBe('GB');
    expect(countryOfLocale('de')).toBe('DE');
    expect(countryOfLocale('not a tag')).toBeUndefined();
  });

  it('gives each region its currency, the euro for its countries', () => {
    expect(currencyOfCountry('IN')).toBe('INR');
    expect(currencyOfCountry('fr')).toBe('EUR');
    expect(currencyOfCountry('AQ')).toBeUndefined();
  });

  it('prefers the workspace’s own, then the language’s, then the US', () => {
    expect(regionDefaults('en-IN')).toEqual({ country: 'IN', currency: 'INR' });
    expect(regionDefaults('en-IN', { currency: 'USD' })).toEqual({ country: 'IN', currency: 'USD' });
    expect(regionDefaults('en-IN', { country: 'DE' })).toEqual({ country: 'DE', currency: 'EUR' });
    expect(regionDefaults('xx-AQ')).toEqual({ country: 'AQ', currency: 'USD' });
  });
});
