// The public page's dates in the visitor's zone (spec 0025, AC-630): day keys,
// local midnight across DST and fractional offsets, and the week's steps.
import { describe, expect, it } from 'vitest';
import { addDays, dayKey, startOfDay, timeLabel } from './time.ts';

describe('the visitor’s days', () => {
  it('keys an instant by its day in the zone', () => {
    const instant = Date.parse('2026-11-02T03:30:00Z');
    expect(dayKey(instant, 'UTC')).toBe('2026-11-02');
    expect(dayKey(instant, 'America/Los_Angeles')).toBe('2026-11-01');
    expect(dayKey(instant, 'Asia/Kolkata')).toBe('2026-11-02');
  });

  it('finds local midnight, on DST days and with fractional offsets too', () => {
    expect(new Date(startOfDay('2026-11-02', 'UTC')).toISOString()).toBe('2026-11-02T00:00:00.000Z');
    expect(new Date(startOfDay('2026-11-02', 'Asia/Kathmandu')).toISOString()).toBe('2026-11-01T18:15:00.000Z');
    // New York falls back on 1 November 2026: midnight is still EDT.
    expect(new Date(startOfDay('2026-11-01', 'America/New_York')).toISOString()).toBe('2026-11-01T04:00:00.000Z');
    expect(new Date(startOfDay('2026-11-02', 'America/New_York')).toISOString()).toBe('2026-11-02T05:00:00.000Z');
    // Santiago springs forward at midnight on 6 September 2026: the day starts at 01:00.
    expect(new Date(startOfDay('2026-09-06', 'America/Santiago')).toISOString()).toBe('2026-09-06T04:00:00.000Z');
  });

  it('steps days across months and years, and labels a time in the zone', () => {
    expect(addDays('2026-12-29', 7)).toBe('2027-01-05');
    expect(addDays('2026-11-02', -7)).toBe('2026-10-26');
    expect(timeLabel('2026-11-02T09:30:00.000Z', 'Asia/Kolkata', 'en-GB')).toBe('15:00');
  });
});
