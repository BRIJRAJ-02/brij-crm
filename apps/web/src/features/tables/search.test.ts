import { describe, expect, it } from 'vitest';
import { reservationsSearch } from './search.ts';

describe('reservationsSearch (?date=)', () => {
  it('keeps a real day', () => {
    expect(reservationsSearch({ date: '2026-11-05' })).toEqual({ date: '2026-11-05' });
    expect(reservationsSearch({ date: '2028-02-29' })).toEqual({ date: '2028-02-29' });
  });

  it('drops anything else, so the page opens on today', () => {
    expect(reservationsSearch({})).toEqual({});
    expect(reservationsSearch({ date: '2026-02-30' })).toEqual({});
    expect(reservationsSearch({ date: '5 Nov' })).toEqual({});
    expect(reservationsSearch({ date: 20261105 })).toEqual({});
  });
});
