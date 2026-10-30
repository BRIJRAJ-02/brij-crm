// The Team day's optimistic changes (spec 0030, AC-781): a block on a column, a block taken off, and a booking handed
// to another host, each leaving everything else as it was.
import { describe, expect, it } from 'vitest';
import type { BookingListItem, TeamDay } from '@crm/contracts';
import { blockedOnDay, reassignedOnDay, unblockedOnDay } from './team-day.ts';

const SAM = '00000000-0000-7000-8000-00000000000a';
const BEA = '00000000-0000-7000-8000-00000000000b';
const BOOKING = '00000000-0000-7000-8000-0000000000b1';
const BLOCK = '00000000-0000-7000-8000-0000000000c1';

const booking = {
  id: BOOKING,
  hostMemberId: SAM,
  needsHost: true,
  hostAway: true,
  startsAt: '2030-01-07T10:00:00.000Z',
  endsAt: '2030-01-07T10:30:00.000Z',
} as unknown as BookingListItem;

const day: TeamDay = {
  day: '2030-01-07',
  from: '2030-01-07T00:00:00.000Z',
  to: '2030-01-08T00:00:00.000Z',
  columns: [
    {
      memberId: SAM,
      name: 'Sam',
      timeZone: 'UTC',
      canManage: true,
      open: [],
      booked: 1,
      items: [{ kind: 'booking', bookingId: BOOKING, startsAt: booking.startsAt, endsAt: booking.endsAt }],
    },
    { memberId: BEA, name: 'Bea', timeZone: 'UTC', canManage: true, open: [], booked: 0, items: [] },
  ],
  bookings: [booking],
  needsHost: [BOOKING],
  issues: [{ kind: 'outsideHours', memberId: SAM, bookingId: BOOKING }],
};

describe('Team day changes', () => {
  it('draws a block on one column, in order, and takes it off again', () => {
    const blocked = blockedOnDay(day, SAM, BLOCK, [
      { kind: 'block', repeat: 'once', startsAt: '2030-01-07T09:00:00.000Z', endsAt: '2030-01-07T09:30:00.000Z' },
    ]);
    expect(blocked.columns[0]?.items.map((item) => item.kind)).toEqual(['block', 'booking']);
    expect(blocked.columns[1]).toBe(day.columns[1]);
    expect(unblockedOnDay(blocked, BLOCK).columns[0]?.items).toEqual(day.columns[0]?.items);
    // A column the day doesn't show is left alone.
    expect(blockedOnDay(day, '00000000-0000-7000-8000-0000000000ff', BLOCK, [])).toBe(day);
  });

  it('moves a reassigned booking to the new host’s column and out of the lane', () => {
    const moved = reassignedOnDay(day, BOOKING, BEA);
    expect(moved.columns.map((column) => [column.booked, column.items.length])).toEqual([
      [0, 0],
      [1, 1],
    ]);
    expect(moved.bookings[0]).toMatchObject({ hostMemberId: BEA, needsHost: false });
    expect(moved.bookings[0]?.hostAway).toBeUndefined();
    expect(moved.needsHost).toEqual([]);
    expect(moved.issues).toEqual([]);
  });
});
