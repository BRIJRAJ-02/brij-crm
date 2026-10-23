import { describe, expect, it } from 'vitest';
import { currentZone, offsetLabel, zoneDisplay, zoneName } from './zones.ts';

describe('a zone as a person says it (QA Q78)', () => {
  const january = Date.UTC(2026, 0, 15);

  it('names the city and its offset, by the zone’s current name', () => {
    expect(zoneDisplay('Asia/Calcutta', january)).toBe('Kolkata time (GMT+5:30)');
    expect(zoneDisplay('Europe/London', january)).toBe('London time (GMT)');
    expect(zoneDisplay('America/New_York', january)).toBe('New York time (GMT-5)');
    expect(zoneName('Asia/Saigon')).toBe('Ho Chi Minh time');
    expect(currentZone('Europe/Kiev')).toBe('Europe/Kyiv');
  });

  it('keeps a zone with no city by its name, and says nothing of a zone it doesn’t know', () => {
    expect(zoneDisplay('UTC', january)).toBe('UTC');
    expect(zoneDisplay('Etc/GMT+4', january)).toBe('Etc/GMT+4');
    expect(offsetLabel('Not/AZone', january)).toBe('');
  });
});
