import { describe, expect, it } from 'vitest';
import { firstBusinessGuess, regionOf } from './first-business.ts';

describe('the first install’s guesses', () => {
  it('starts a new workspace from the browser: region, its currency, its zone', () => {
    expect(firstBusinessGuess({ timeZone: 'UTC' }, { language: 'en-GB', timeZone: 'Europe/London' })).toEqual({
      country: 'GB',
      currency: 'GBP',
      timeZone: 'Europe/London',
    });
    expect(firstBusinessGuess(undefined, { language: 'de-DE', timeZone: 'Europe/Berlin' }).currency).toBe('EUR');
    // A language with no region is maximised to its likely one.
    expect(regionOf('ja')).toBe('JP');
  });

  it('keeps the workspace’s own settings, and leaves an unknown currency for the person to pick', () => {
    expect(
      firstBusinessGuess(
        { country: 'AE', currency: 'AED', timeZone: 'Asia/Dubai' },
        { language: 'en-US', timeZone: 'America/New_York' },
      ),
    ).toEqual({ country: 'AE', currency: 'AED', timeZone: 'Asia/Dubai' });
    expect(firstBusinessGuess(undefined, { language: 'pt-BR', timeZone: undefined })).toEqual({
      country: 'BR',
      currency: null,
      timeZone: 'UTC',
    });
  });
});
