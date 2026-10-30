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
