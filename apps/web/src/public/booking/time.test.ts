// The public page's dates in the visitor's zone (spec 0025, AC-630): day keys,
// local midnight across DST and fractional offsets, and the week's steps.
import { describe, expect, it } from 'vitest';
import {
  addDays,
  dayKey,
  monthCells,
  rangeLabel,
  relativeLabel,
  shiftMonth,
  startOfDay,
  timeLabel,
  weekdayNames,
  zoneDisplay,
} from './time.ts';

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

describe('the month, the zone and the clock', () => {
  it('lays a month out from the locale’s first weekday', () => {
    // November 2026 starts on a Sunday: no blank in the US, six blanks where weeks start on Monday.
    expect(monthCells('2026-11', 'en-US')[0]).toBe('2026-11-01');
    expect(monthCells('2026-11', 'en-GB').slice(0, 7)).toEqual([
      ...Array.from({ length: 6 }, () => undefined),
      '2026-11-01',
    ]);
    expect(monthCells('2026-02', 'en-US').filter((cell) => cell !== undefined)).toHaveLength(28);
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
  });

  it('says a zone as a person would, and a time in 12 or 24 hours', () => {
    const at = Date.parse('2026-11-02T09:00:00Z');
    expect(zoneDisplay('Asia/Dubai', at)).toBe('Dubai time (GMT+4)');
    expect(zoneDisplay('America/New_York', at)).toBe('New York time (GMT-5)');
    expect(zoneDisplay('UTC', at)).toBe('UTC');
    expect(timeLabel('2026-11-02T09:30:00.000Z', 'UTC', 'en-US', true)).toBe('9:30 AM');
    expect(timeLabel('2026-11-02T09:30:00.000Z', 'UTC', 'en-US', false)).toBe('09:30');
  });

  it('says how far off a meeting is', () => {
    const now = Date.parse('2026-11-02T08:00:00Z');
    expect(relativeLabel('2026-11-02T08:03:00.000Z', now, 'UTC', 'en')).toBe('In 3 minutes');
    expect(relativeLabel('2026-11-03T09:00:00.000Z', now, 'UTC', 'en')).toBe('Tomorrow morning');
    expect(relativeLabel('2026-11-07T09:00:00.000Z', now, 'UTC', 'en')).toBe('In 5 days');
  });
});

describe('the weekdays and the meeting’s span', () => {
  it('names the weekdays in grid order', () => {
    expect(weekdayNames('en-US').map((name) => name.long)).toEqual([
      'Sunday',
      'Monday',
      'Tuesday',
      'Wednesday',
      'Thursday',
      'Friday',
      'Saturday',
    ]);
  });

  it('writes a meeting’s span as one range in the zone', () => {
    const range = rangeLabel('2026-11-02T09:30:00.000Z', '2026-11-02T10:00:00.000Z', 'UTC', 'en-US', true);
    expect(range).toMatch(/^9:30\s.\s10:00\sAM$/);
    expect(rangeLabel('2026-11-02T09:30:00.000Z', '2026-11-02T10:00:00.000Z', 'UTC', 'en-GB', false)).toMatch(
      /^09:30\s?.\s?10:00$/,
    );
  });
});
