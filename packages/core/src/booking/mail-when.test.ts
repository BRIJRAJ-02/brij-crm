// How a booking email writes a time (bookings redesign step 1): in the clock of the zone it is written in, its
// country's date order and hour cycle, with the old wording for a zone that names no country. Pure.
import { describe, expect, it } from 'vitest';
import { atLine, mailClock, whenLine } from './mail-when.ts';

const START = new Date('2026-11-02T09:00:00Z');
const END = new Date('2026-11-02T09:30:00Z');

describe('mailClock', () => {
  it('reads a zone’s country: 12 hours in the United States and India, 24 in Britain and Germany', () => {
    expect(mailClock('America/New_York')).toEqual({ locale: 'en-US', hour12: true });
    expect(mailClock('Asia/Calcutta')).toEqual({ locale: 'en-IN', hour12: true });
    expect(mailClock('Europe/London')).toEqual({ locale: 'en-GB', hour12: false });
    expect(mailClock('Europe/Berlin')).toEqual({ locale: 'en-DE', hour12: false });
  });

  it('has none for a zone with no single country', () => {
    expect(mailClock('UTC')).toBeUndefined();
    expect(mailClock('Etc/GMT+4')).toBeUndefined();
  });
});

describe('whenLine', () => {
  it('writes the range in the zone’s own clock, the zone named', () => {
    expect(whenLine(START, END, 'America/New_York')).toBe(
      'Monday, November 2, 2026, 4:00 AM to 4:30 AM, New York time (GMT-5)',
    );
    expect(whenLine(START, END, 'Europe/London')).toBe('Monday, 2 November 2026, 09:00 to 09:30, London time (GMT)');
    expect(whenLine(START, END, 'Europe/Berlin')).toBe('Monday, 2 November 2026, 10:00 to 10:30, Berlin time (GMT+1)');
  });

  it('names the zone as the booking pages do, never by its raw or old id (QA Q78)', () => {
    const start = new Date('2026-10-27T04:00:00Z');
    const end = new Date('2026-10-27T04:30:00Z');
    expect(whenLine(start, end, 'Asia/Calcutta')).toBe(
      'Tuesday, 27 October 2026, 9:30 am to 10:00 am, Kolkata time (GMT+5:30)',
    );
    // No country: the old wording, unchanged.
    expect(whenLine(start, end, 'UTC')).toBe('Tuesday 27 October 2026, 4:00 AM to 4:30 AM, UTC');
  });

  it('never keeps the narrow no break space ICU puts before AM', () => {
    expect(whenLine(START, END, 'America/New_York')).not.toContain('\u202f');
  });
});

describe('atLine', () => {
  it('writes one moment the same way', () => {
    expect(atLine(START, 'America/Los_Angeles')).toBe('Monday, November 2, 2026, 1:00 AM, Los Angeles time (GMT-8)');
    expect(atLine(START, 'UTC')).toBe('Monday 2 November 2026, 9:00 AM, UTC');
  });
});
