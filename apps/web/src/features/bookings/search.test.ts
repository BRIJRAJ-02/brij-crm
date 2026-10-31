import { describe, expect, it } from 'vitest';
import { bookingsSearchOf, parseBookingsSearch, rawOf } from './search.ts';

describe('the calendar view in the address', () => {
  it('reads v=day as the day view and drops anything else', () => {
    expect(parseBookingsSearch({ v: 'day' })).toEqual({ v: 'day' });
    expect(parseBookingsSearch({ v: 'month' })).toEqual({});
  });

  it('is the week when the address says nothing', () => {
    expect(bookingsSearchOf({ d: '2026-10-22' }, new Date(), 1, 'UTC').view).toBeUndefined();
    expect(bookingsSearchOf({ d: '2026-10-22', v: 'day' }, new Date(), 1, 'UTC').view).toBe('day');
  });

  it('writes only the day view, on the calendar tab only', () => {
    const search = bookingsSearchOf({ d: '2026-10-22' }, new Date(), 1, 'UTC');
    expect(rawOf('calendar', { ...search, view: 'day' })).toMatchObject({ v: 'day' });
    expect(rawOf('calendar', { ...search, view: 'week' })).not.toHaveProperty('v');
    expect(rawOf('list', { ...search, view: 'day' })).not.toHaveProperty('v');
  });
});

describe('the Team day in the address (spec 0030)', () => {
  const today = new Date().toISOString().slice(0, 10);
  const SAM = '0193a1b2-0000-7000-8000-000000000001';
  const BEA = '0193a1b2-0000-7000-8000-000000000002';

  it('reads v=team with its people, Only with bookings and the order, and drops a malformed one', () => {
    expect(parseBookingsSearch({ v: 'team', who: `${SAM},${BEA}`, booked: '1', order: 'title' })).toEqual({
      v: 'team',
      who: `${SAM},${BEA}`,
      booked: '1',
      order: 'title',
    });
    expect(parseBookingsSearch({ v: 'team', who: 'everyone', booked: 'yes', order: 'age' })).toEqual({ v: 'team' });
  });

  it('round trips through the screen’s search', () => {
    const search = bookingsSearchOf(
      { d: today, v: 'team', who: SAM, booked: '1', order: 'title' },
      new Date(),
      1,
      'UTC',
    );
    expect(search).toMatchObject({ view: 'team', members: [SAM], withBookings: true, order: 'title' });
    expect(rawOf('calendar', search)).toMatchObject({ v: 'team', who: SAM, booked: '1', order: 'title' });
    const { members: _members, withBookings: _booked, ...unfiltered } = search;
    expect(rawOf('calendar', unfiltered)).not.toHaveProperty('who');
  });
});
