import { describe, expect, it } from 'vitest';
import { zoneCountry } from './zone-country.ts';

describe('zoneCountry (forms fixes 2)', () => {
  it('names the country a zone is in, by its current or its old spelling', () => {
    expect(zoneCountry('Asia/Kolkata')).toBe('IN');
    expect(zoneCountry('Asia/Calcutta')).toBe('IN');
    expect(zoneCountry('Europe/London')).toBe('GB');
    expect(zoneCountry('America/Los_Angeles')).toBe('US');
  });

  it('names none for a zone with no single country', () => {
    expect(zoneCountry('UTC')).toBeUndefined();
    expect(zoneCountry('Etc/GMT+4')).toBeUndefined();
  });
});
