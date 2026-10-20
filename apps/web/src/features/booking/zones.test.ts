// The time zone picker's list (Phase 2, F12): each zone with its offset, the current one first, and a search on
// both the place and the offset, as timefix's picker does.
import { describe, expect, it } from 'vitest';
import { weekSummary, zoneItems, zoneMatches, zoneOffset } from './hours.ts';

const JUNE = new Date('2026-06-15T12:00:00.000Z');
const JANUARY = new Date('2026-01-15T12:00:00.000Z');

describe('zones', () => {
  it('gives each zone its offset at that moment, summer time included', () => {
    expect(zoneOffset('Asia/Kolkata', JUNE)).toBe('GMT+05:30');
    expect(zoneOffset('Europe/London', JANUARY)).toBe('GMT+00:00');
    expect(zoneOffset('Europe/London', JUNE)).toBe('GMT+01:00');
    expect(zoneOffset('America/New_York', JANUARY)).toBe('GMT-05:00');
  });

  it('puts the current zone first, once, and names places with spaces', () => {
    const items = zoneItems('America/New_York', JANUARY);
    expect(items[0]).toEqual({ id: 'America/New_York', label: 'America/New York', description: 'GMT-05:00' });
    expect(items.filter((item) => item.id === 'America/New_York')).toHaveLength(1);
  });

  it('matches every word against the place or the offset', () => {
    const item = { label: 'America/New York', description: 'GMT-05:00' };
    expect(zoneMatches(item, 'new york')).toBe(true);
    expect(zoneMatches(item, 'york new')).toBe(true);
    expect(zoneMatches(item, 'GMT-05')).toBe(true);
    expect(zoneMatches(item, 'gmt-5')).toBe(true);
    expect(zoneMatches(item, 'london')).toBe(false);
  });
});

describe('a week in a line per set of days', () => {
  const week = (
    weekly: Partial<Record<'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun', [string, string][]>>,
  ) => ({
    timeZone: 'UTC',
    weekly: { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [], ...weekly },
    overrides: [],
  });

  it('runs three or more days together, lists the rest, and prints each set of hours once', () => {
    const nine = [['09:00', '17:00']] as [string, string][];
    expect(
      weekSummary(week({ mon: nine, wed: nine, thu: nine, fri: nine, sat: [['10:00', '13:00']] }), 'en-US'),
    ).toEqual(['Mon, Wed – Fri, 9:00 AM to 5:00 PM', 'Sat, 10:00 AM to 1:00 PM']);
  });

  it('says Midnight at a day’s end, and when nothing is open', () => {
    expect(weekSummary(week({ sun: [['13:00', '24:00']] }), 'en-US')).toEqual(['Sun, 1:00 PM to Midnight']);
    expect(weekSummary(week({}), 'en-US')).toEqual(['No days open']);
  });
});
