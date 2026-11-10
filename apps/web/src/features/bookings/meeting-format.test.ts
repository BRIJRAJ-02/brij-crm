import { describe, expect, it } from 'vitest';
import {
  clockOfMinute,
  clockRange,
  clockRangeOfMinutes,
  clockTime,
  longDay,
  minutesLabel,
  shortDay,
  zoneLabel,
} from './meeting-format.ts';

const at = Date.parse('2026-11-09T05:00:00Z');

describe('meeting formats', () => {
  it('writes times on a twelve hour clock in lower case', () => {
    expect(clockTime('2026-11-09T04:00:00Z', 'Asia/Kolkata')).toBe('9:30 am');
    expect(clockTime('2026-11-09T10:30:00Z', 'Asia/Kolkata')).toBe('4:00 pm');
    expect(clockOfMinute(570)).toBe('9:30 am');
    expect(clockOfMinute(0)).toBe('12:00 am');
    expect(clockOfMinute(12 * 60 + 5)).toBe('12:05 pm');
  });

  it('shares am or pm across a range only when both ends have it', () => {
    expect(clockRange('2026-11-09T05:30:00Z', '2026-11-09T06:15:00Z', 'Asia/Kolkata')).toBe('11:00 – 11:45 am');
    expect(clockRange('2026-11-09T06:00:00Z', '2026-11-09T07:00:00Z', 'Asia/Kolkata')).toBe('11:30 am – 12:30 pm');
  });

  it('writes days short and long, with the year only when it is another', () => {
    expect(shortDay('2026-11-09', '2026-11-09')).toBe('Mon 9 Nov');
    expect(shortDay('2027-01-04', '2026-11-09')).toBe('Mon 4 Jan 2027');
    expect(longDay('2026-11-09')).toBe('Monday 9 November');
  });

  it('names a zone by its country where it is one, else its city, with the offset', () => {
    expect(zoneLabel('Asia/Kolkata', at)).toBe('India time (GMT+5:30)');
    expect(zoneLabel('Asia/Dubai', at)).toBe('Dubai time (GMT+4)');
    expect(zoneLabel('UTC', at)).toBe('UTC');
  });

  it('writes a length in minutes', () => {
    expect(minutesLabel(45)).toBe('45 min');
  });

  it('writes a range of minutes of the day with one am or pm when both ends share it', () => {
    expect(clockRangeOfMinutes(840, 1080)).toBe('2:00 – 6:00 pm');
    expect(clockRangeOfMinutes(570, 780)).toBe('9:30 am – 1:00 pm');
    expect(clockRangeOfMinutes(1200, 1440)).toBe('8:00 pm – 12:00 am');
  });
});
