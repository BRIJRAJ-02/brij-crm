// My tasks' days (spec 0019, AC-436, AC-437): the four groups by the local
// day, and the timer to the next local midnight, across time zones and a
// daylight saving change.
import { describe, expect, it } from 'vitest';
import { dayAt, dayGroup, daySections, msToNextDay } from './day.ts';

describe('dayAt', () => {
  it('names the day in the given time zone', () => {
    const at = Date.parse('2026-10-20T23:30:00Z');
    expect(dayAt(at, 'UTC')).toBe('2026-10-20');
    expect(dayAt(at, 'Asia/Kolkata')).toBe('2026-10-21');
    expect(dayAt(at, 'America/Los_Angeles')).toBe('2026-10-20');
  });
});

describe('dayGroup and daySections (AC-436)', () => {
  it('puts a task before today in Overdue, today in Today, later in Upcoming and none in No date', () => {
    expect(dayGroup('2026-10-19', '2026-10-20')).toBe('overdue');
    expect(dayGroup('2026-10-20', '2026-10-20')).toBe('today');
    expect(dayGroup('2026-10-27', '2026-10-20')).toBe('upcoming');
    expect(dayGroup(undefined, '2026-10-20')).toBe('none');
  });

  it('moves a task from Today to Overdue when the day turns, with the same section objects', () => {
    const task = { id: 't', title: 'T', isDone: false, dueOn: '2026-10-20' };
    expect(daySections('2026-10-20')(task)).toEqual({ id: 'today', title: 'Today' });
    expect(daySections('2026-10-21')(task)).toEqual({ id: 'overdue', title: 'Overdue' });
    expect(daySections('2026-10-21')(task)).toBe(daySections('2026-10-22')(task));
  });
});

describe('msToNextDay (AC-437)', () => {
  it('waits until the next local midnight', () => {
    const at = Date.parse('2026-10-20T22:00:00Z');
    expect(msToNextDay(at, 'UTC')).toBe(2 * 3_600_000);
    // 03:30 on the 21st in Kolkata: 20.5 hours to go.
    expect(msToNextDay(at, 'Asia/Kolkata')).toBe(20.5 * 3_600_000);
  });

  it('lands on the new day across a daylight saving change, never before it', () => {
    // London's clocks go back an hour at 02:00 on 25 October 2026: that day is 25 hours long.
    const before = Date.parse('2026-10-24T23:30:00Z');
    const wait = msToNextDay(before, 'Europe/London');
    expect(dayAt(before + wait, 'Europe/London')).toBe('2026-10-26');
    expect(dayAt(before + wait - 1_000, 'Europe/London')).toBe('2026-10-25');
    // New York's clocks go forward on 8 March 2026: a 23 hour day.
    const spring = Date.parse('2026-03-08T05:30:00Z');
    const springWait = msToNextDay(spring, 'America/New_York');
    expect(dayAt(spring + springWait, 'America/New_York')).toBe('2026-03-09');
    expect(dayAt(spring + springWait - 1_000, 'America/New_York')).toBe('2026-03-08');
  });

  it('never answers less than a second', () => {
    expect(msToNextDay(Date.parse('2026-10-20T23:59:59.900Z'), 'UTC')).toBeGreaterThanOrEqual(1_000);
  });
});
