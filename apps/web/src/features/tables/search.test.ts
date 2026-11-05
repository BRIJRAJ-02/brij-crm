import { describe, expect, it } from 'vitest';
import { reservationsSearch } from './search.ts';

const PLACE = '01900000-0000-7000-8000-000000000001';

describe('reservationsSearch (?date= and ?place=)', () => {
  it('keeps a real day and a place id', () => {
    expect(reservationsSearch({ date: '2026-11-05' })).toEqual({ date: '2026-11-05' });
    expect(reservationsSearch({ date: '2028-02-29', place: PLACE })).toEqual({ date: '2028-02-29', place: PLACE });
  });

  it('drops anything else, so the page opens on today at the first place', () => {
    expect(reservationsSearch({})).toEqual({});
    expect(reservationsSearch({ date: '2026-02-30' })).toEqual({});
    expect(reservationsSearch({ date: '5 Nov', place: 'Soho' })).toEqual({});
    expect(reservationsSearch({ date: 20261105 })).toEqual({});
  });
});
