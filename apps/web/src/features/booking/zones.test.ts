// The time zone picker's list (Phase 2, F12): each zone with its offset, the current one first, and a search on
// the place, the zone's id and the offset, as timefix's picker does.
import { describe, expect, it } from 'vitest';
import { weekSummary, zoneItems, zoneLabel, zoneMatches, zoneOffset } from './hours.ts';

const JUNE = new Date('2026-06-15T12:00:00.000Z');
const JANUARY = new Date('2026-01-15T12:00:00.000Z');

describe('zones', () => {
  it('gives each zone its offset at that moment, summer time included', () => {
    expect(zoneOffset('Asia/Kolkata', JUNE)).toBe('GMT+05:30');
    expect(zoneOffset('Europe/London', JANUARY)).toBe('GMT+00:00');
    expect(zoneOffset('Europe/London', JUNE)).toBe('GMT+01:00');
    expect(zoneOffset('America/New_York', JANUARY)).toBe('GMT-05:00');
  });

  it('puts the current zone first, once, named as people say it with its short offset', () => {
    const items = zoneItems('America/New_York', JANUARY);
    expect(items[0]).toEqual({ id: 'America/New_York', label: 'New York time', description: 'GMT-5' });
    expect(items.filter((item) => item.id === 'America/New_York')).toHaveLength(1);
    expect(zoneItems('Asia/Kolkata', JUNE)[0]).toEqual({
      id: 'Asia/Kolkata',
      label: 'Kolkata time',
      description: 'GMT+5:30',
    });
  });

  it('says a zone the one way the app shows it', () => {
    expect(zoneLabel('Asia/Kolkata', JUNE)).toBe('Kolkata time (GMT+5:30)');
    expect(zoneLabel('America/New_York', JANUARY)).toBe('New York time (GMT-5)');
    expect(zoneLabel('UTC', JANUARY)).toBe('UTC');
  });

  it('matches every word against the place, the id or the offset', () => {
    const item = { id: 'America/New_York', label: 'New York time', description: 'GMT-5' };
    expect(zoneMatches(item, 'new york')).toBe(true);
    expect(zoneMatches(item, 'york new')).toBe(true);
    expect(zoneMatches(item, 'america/new_york')).toBe(true);
    expect(zoneMatches(item, 'america')).toBe(true);
    expect(zoneMatches(item, 'GMT-05')).toBe(true);
    expect(zoneMatches(item, 'gmt-5')).toBe(true);
    expect(zoneMatches(item, 'gmt-05:00')).toBe(true);
    expect(zoneMatches(item, 'london')).toBe(false);
  });

  it('reads an offset however it is typed', () => {
    const india = { id: 'Asia/Kolkata', label: 'Kolkata time', description: 'GMT+5:30' };
    for (const typed of ['gmt+5:30', 'gmt+05:30', '+5:30', 'utc+5', 'gmt+530', '+05:30', '5:30'])
      expect(zoneMatches(india, typed), typed).toBe(true);
    expect(zoneMatches(india, 'gmt-5')).toBe(false);
    const london = { id: 'Europe/London', label: 'London time', description: 'GMT' };
    expect(zoneMatches(london, 'gmt+00:00')).toBe(true);
    expect(zoneMatches(london, 'utc+0')).toBe(true);
  });

  it('shows an old spelling by its current name, keeps the stored id, and lists each place once', () => {
    const items = zoneItems('Asia/Calcutta', JANUARY);
    expect(items[0]).toEqual({ id: 'Asia/Calcutta', label: 'Kolkata time', description: 'GMT+5:30' });
    expect(items.filter((item) => item.label === 'Kolkata time')).toHaveLength(1);
    expect(zoneMatches(items[0] ?? { label: '' }, 'kolkata')).toBe(true);
    expect(zoneMatches(items[0] ?? { label: '' }, 'asia/kolkata')).toBe(true);
    expect(zoneMatches(items[0] ?? { label: '' }, 'asia kolkata')).toBe(true);
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

  it('reads the 12 hour clock in any language, as the week editor does', () => {
    expect(weekSummary(week({ sun: [['13:00', '24:00']] }), 'en-GB')).toEqual([
      expect.stringMatching(/^Sun, 1:00\s?pm to Midnight$/i),
    ]);
  });
});
