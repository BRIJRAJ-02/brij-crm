// The members' busy read: a page's 62 day chunk plus its margins can run a few
// hours past what one free and busy read takes, so it is read in pieces.
import { describe, expect, it } from 'vitest';
import { FREE_BUSY_MAX_DAYS } from '../calendar/events.ts';
import type { BusyReader } from './calendar.ts';
import { BUSY_MARGIN_MS, busyWindows, membersBusy } from './slots.ts';

const DAY_MS = 86_400_000;

/** A reader that refuses a range over 62 days, as the calendar events service does. */
function capped() {
  const asked: { readonly from: string; readonly to: string }[] = [];
  const reader: BusyReader = (request) => {
    asked.push({ from: request.from, to: request.to });
    if (Date.parse(request.to) - Date.parse(request.from) > FREE_BUSY_MAX_DAYS * DAY_MS) {
      return Promise.reject(new Error('Ask for at most 62 days at once.'));
    }
    return Promise.resolve({
      status: 'read',
      busy: [{ start: request.from, end: new Date(Date.parse(request.from) + 3_600_000).toISOString() }],
    });
  };
  return { reader, asked };
}

describe('membersBusy', () => {
  it('reads a chunk opened after midnight, 62 days plus its margins, without a refusal', async () => {
    // 01:10 in Kolkata on 22 Oct: the chunk runs from now to 23 Dec 00:00 there.
    const from = new Date('2026-10-21T19:40:00.000Z');
    const to = new Date('2026-12-22T18:30:00.000Z');
    const source = capped();
    const busy = await membersBusy(
      source.reader,
      'w',
      ['m'],
      new Date(from.getTime() - BUSY_MARGIN_MS),
      new Date(to.getTime() + BUSY_MARGIN_MS),
    );
    expect(source.asked).toHaveLength(2);
    expect(busy.busy).toHaveLength(2);
    expect(busy).toMatchObject({ blocked: false, noCalendar: false });
  });

  it('reads a range within 62 days once', async () => {
    const source = capped();
    await membersBusy(
      source.reader,
      'w',
      ['m', 'n'],
      new Date('2026-11-01T00:00:00.000Z'),
      new Date('2026-11-08T00:00:00.000Z'),
    );
    expect(source.asked).toHaveLength(2);
  });
});

describe('busyWindows', () => {
  it('cuts a range into back to back pieces of at most 62 days', () => {
    const from = new Date('2026-10-01T00:00:00.000Z');
    const to = new Date(from.getTime() + 130 * DAY_MS);
    const pieces = busyWindows(from, to);
    expect(pieces.map((piece) => (piece.to.getTime() - piece.from.getTime()) / DAY_MS)).toEqual([62, 62, 6]);
    expect(pieces[0]?.from).toEqual(from);
    expect(pieces.at(-1)?.to).toEqual(to);
  });
});
