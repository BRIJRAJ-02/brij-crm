// The booking's calendar entry (spec 0025), ported from an earlier scheduling
// build's suite: the instant in UTC, DST, the three properties that decide
// update versus duplicate, cancellation, escaping and folding.
import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';
import { buildBookingIcs, type IcsInput } from './ics.ts';

/** One property's value, unfolded. */
function prop(ics: string, name: string): string | null {
  const line = ics
    .replace(/\r\n /g, '')
    .split('\r\n')
    .find((each) => each.startsWith(`${name}:`) || each.startsWith(`${name};`));
  return line === undefined ? null : line.slice(line.indexOf(':') + 1);
}

const START = DateTime.fromISO('2026-09-10T17:00:00', { zone: 'Asia/Dubai' }).toJSDate();

const ics = (over: Partial<IcsInput> = {}) =>
  buildBookingIcs({
    bookingId: 'b7f1c0de-0000-4000-8000-000000000001',
    uidDomain: 'app.example',
    method: 'REQUEST',
    start: START,
    end: new Date(START.getTime() + 30 * 60_000),
    summary: 'Intro call with Amara Okafor',
    description: 'Booked through Intro call.',
    location: 'https://meet.example/abc-defg-hij',
    url: 'https://app.example/b/abcdefghijklmnop/manage?t=token',
    organizerEmail: 'bookings@app.example',
    organizerName: 'Bookings',
    attendees: [{ name: 'Sam Reed', email: 'sam@guest.example' }],
    sequence: 0,
    now: new Date('2026-09-01T08:00:00Z'),
    ...over,
  });

describe('buildBookingIcs', () => {
  it('writes the instant in UTC, the same from any zone, and a DST hour as 60 real minutes', () => {
    expect(prop(ics(), 'DTSTART')).toBe('20260910T130000Z');
    expect(prop(ics(), 'DTEND')).toBe('20260910T133000Z');
    expect(prop(ics(), 'DTSTAMP')).toBe('20260901T080000Z');
    const fallBack = DateTime.fromISO('2027-11-07T01:00:00', { zone: 'America/New_York' }).toJSDate();
    const body = ics({ start: fallBack, end: new Date(fallBack.getTime() + 3_600_000) });
    expect([prop(body, 'DTSTART'), prop(body, 'DTEND')]).toEqual(['20271107T050000Z', '20271107T060000Z']);
  });

  it('keeps the UID through a move, only raises SEQUENCE, and requests rather than publishes', () => {
    const moved = ics({ sequence: 1_800_000_000, start: new Date(START.getTime() + 3_600_000) });
    expect(prop(ics(), 'UID')).toBe('b7f1c0de-0000-4000-8000-000000000001@app.example');
    expect(prop(moved, 'UID')).toBe(prop(ics(), 'UID'));
    expect(Number(prop(moved, 'SEQUENCE'))).toBeGreaterThan(0);
    expect(prop(ics({ sequence: -5 }), 'SEQUENCE')).toBe('0');
    expect(prop(ics({ sequence: 7.9 }), 'SEQUENCE')).toBe('7');
    expect(ics()).toContain('METHOD:REQUEST');
    expect(prop(ics(), 'STATUS')).toBe('CONFIRMED');
    expect(ics()).toContain('PARTSTAT=ACCEPTED');
  });

  it('cancels by removing the entry', () => {
    const cancel = ics({ method: 'CANCEL', sequence: 1 });
    expect(cancel).toContain('METHOD:CANCEL');
    expect(prop(cancel, 'STATUS')).toBe('CANCELLED');
    expect(cancel).toContain('PARTSTAT=DECLINED');
  });

  it('escapes what people type, so nothing breaks the parse', () => {
    const nasty = ics({
      summary: 'Table for 4; Smith, party of four\nRing the bell',
      description: 'Notes: a\\b, c; d\r\nsecond line',
      attendees: [{ name: 'O’Brien, Seán; VIP', email: 'sean@guest.example' }],
    });
    const summary = prop(nasty, 'SUMMARY') ?? '';
    expect(summary).toContain('\\;');
    expect(summary).toContain('\\,');
    expect(summary).toContain('\\n');
    expect(summary).not.toContain('\n');
    expect(prop(nasty, 'DESCRIPTION')).toContain('\\\\');
    expect(nasty.replace(/\r\n /g, '').trimEnd().endsWith('END:VCALENDAR')).toBe(true);
  });

  it('uses CRLF, ends with one, holds one VEVENT, and folds at 75 octets, multi byte characters too', () => {
    const body = ics();
    expect(/[^\r]\n/.test(body)).toBe(false);
    expect(body.endsWith('\r\n')).toBe(true);
    expect(body.split('BEGIN:VEVENT')).toHaveLength(2);
    const long = ics({ summary: 'A very long event title '.repeat(8), description: 'Café • 日本語 • Zoë '.repeat(10) });
    expect(long.split('\r\n').filter((line) => new TextEncoder().encode(line).length > 75)).toEqual([]);
  });

  it('writes a location only when there is one, and every attendee', () => {
    expect(prop(ics(), 'LOCATION')).toContain('meet.example');
    expect(prop(ics({ location: null }), 'LOCATION')).toBeNull();
    expect(prop(ics({ location: '   ' }), 'LOCATION')).toBeNull();
    const two = ics({
      attendees: [
        { name: 'A', email: 'a@x.example' },
        { name: 'B', email: 'b@x.example' },
      ],
    });
    expect(two.match(/^ATTENDEE/gm)).toHaveLength(2);
    expect(ics()).toContain('MAILTO:bookings@app.example');
  });
});
