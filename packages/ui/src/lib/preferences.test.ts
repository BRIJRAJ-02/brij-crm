// The member's date format and week start (Settings › Account › Preferences)
// in the library's formatting: each format written as it says, in the
// language's month names and the time zone's day, and weeks that start where
// the member chose.
import { describe, expect, it } from 'vitest';
import { formatDate, formatDay, formatRelative } from './format.ts';
import { firstDayOfWeek, monthCells, weekdayNames, weekStartDay } from './month.ts';

describe('the date format', () => {
  it('writes a calendar day in each format', () => {
    expect(formatDate('2026-10-08', 'en-US')).toBe('Oct 8, 2026');
    expect(formatDate('2026-10-08', 'en-US', 'auto')).toBe('Oct 8, 2026');
    expect(formatDate('2026-10-08', 'en-US', 'dmy')).toBe('8 Oct 2026');
    expect(formatDate('2026-10-08', 'en-GB', 'mdy')).toBe('Oct 8, 2026');
    expect(formatDate('2026-10-08', 'en-US', 'ymd')).toBe('2026-10-08');
  });

  it('keeps the language’s month names', () => {
    expect(formatDate('2026-03-08', 'de-DE', 'dmy')).toBe('8 März 2026');
  });

  it('reads an instant’s day in the time zone before writing it', () => {
    const lateInLondon = '2026-10-08T23:30:00Z';
    expect(formatDay(lateInLondon, 'en-GB', 'Europe/London', 'ymd')).toBe('2026-10-09');
    expect(formatDay(lateInLondon, 'en-GB', 'America/New_York', 'ymd')).toBe('2026-10-08');
  });

  it('writes a date past a week ago in the format', () => {
    const now = Date.parse('2026-10-22T12:00:00Z');
    expect(formatRelative('2026-10-01T12:00:00Z', now, 'en-US', 'UTC', 'ymd')).toBe('2026-10-01');
  });
});

describe('the week start', () => {
  it('follows the member’s choice over the language’s', () => {
    expect(firstDayOfWeek('en-US', 'monday')).toBe(1);
    expect(firstDayOfWeek('en-GB', 'sunday')).toBe(0);
    expect(firstDayOfWeek('en-GB', 'saturday')).toBe(6);
    expect(firstDayOfWeek('en-GB', 'auto')).toBe(firstDayOfWeek('en-GB'));
  });

  it('starts the month grid and its weekday names on that day', () => {
    // 1 October 2026 is a Thursday.
    expect(monthCells('2026-10', 'en-GB', 'monday').indexOf('2026-10-01')).toBe(3);
    expect(monthCells('2026-10', 'en-GB', 'sunday').indexOf('2026-10-01')).toBe(4);
    expect(monthCells('2026-10', 'en-GB', 'saturday').indexOf('2026-10-01')).toBe(5);
    // Six weeks, whatever the month and the week's first day, so every month's grid is one height.
    expect(monthCells('2026-10', 'en-GB', 'monday')).toHaveLength(42);
    expect(monthCells('2026-02', 'en-GB', 'sunday')).toHaveLength(42);
    expect(monthCells('2026-08', 'en-GB', 'monday')).toHaveLength(42);
    expect(weekdayNames('en-GB', 'sunday')[0]?.long).toBe('Sunday');
    expect(weekdayNames('en-GB', 'saturday')[0]?.long).toBe('Saturday');
  });

  it('names the day as React Aria takes it, or none for the language’s', () => {
    expect(weekStartDay('monday')).toBe('mon');
    expect(weekStartDay('sunday')).toBe('sun');
    expect(weekStartDay('saturday')).toBe('sat');
    expect(weekStartDay('auto')).toBeUndefined();
  });
});
