// A team page's busy read: its 62 day chunk plus margins can run past what one free and busy read takes, so each
// member is read in pieces, as a single host page is (a team page failed outright before 06:00 in the visitor's zone).
import { describe, expect, it } from 'vitest';
import type { BusyReader } from '../booking/calendar.ts';
import { BUSY_MARGIN_MS } from '../booking/slots.ts';
import { FREE_BUSY_MAX_DAYS } from '../calendar/events.ts';
import { memberBusy } from './team.ts';

const DAY_MS = 86_400_000;

/** A reader that refuses a range over 62 days, as the calendar events service does, with the answer given. */
function capped(answer: (memberId: string) => Awaited<ReturnType<BusyReader>>) {
  const asked: string[] = [];
  const reader: BusyReader = (request) => {
    asked.push(request.memberId);
    if (Date.parse(request.to) - Date.parse(request.from) > FREE_BUSY_MAX_DAYS * DAY_MS) {
      return Promise.reject(new Error('Ask for at most 62 days at once.'));
    }
    return Promise.resolve(answer(request.memberId));
  };
  return { reader, asked };
}

// 00:23 in Kolkata on 6 Nov: the chunk runs from now to 7 Jan 00:00 there.
const from = new Date(Date.parse('2026-11-05T18:53:00.000Z') - BUSY_MARGIN_MS);
const to = new Date(Date.parse('2027-01-06T18:30:00.000Z') + BUSY_MARGIN_MS);
const hour = { start: '2026-11-10T10:00:00.000Z', end: '2026-11-10T11:00:00.000Z' };

describe('memberBusy', () => {
  it('reads a chunk opened after midnight in pieces for each member, without a refusal', async () => {
    const source = capped(() => ({ status: 'read', busy: [hour] }));
    const busy = await memberBusy(source.reader, 'w', ['m', 'n'], from, to);
    expect(source.asked).toEqual(['m', 'm', 'n', 'n']);
    expect(busy.get('m')).toMatchObject({ blocked: false, noCalendar: false });
    expect(busy.get('m')?.busy).toHaveLength(2);
  });

  it('keeps one member blocked and another without a calendar apart', async () => {
    const source = capped((memberId) => (memberId === 'm' ? { status: 'blocked' } : { status: 'none' }));
    const busy = await memberBusy(source.reader, 'w', ['m', 'n'], from, to);
    expect(busy.get('m')).toMatchObject({ blocked: true, noCalendar: false, busy: [] });
    expect(busy.get('n')).toMatchObject({ blocked: false, noCalendar: true, busy: [] });
  });
});
