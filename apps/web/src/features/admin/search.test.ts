// Settings › Super admin's addresses (spec 0047): the period and search read
// safely, and the routes' periods the same as the screens'.
import { describe, expect, it } from 'vitest';
import * as figures from './figures.ts';
import { DEFAULT_PERIOD, PERIODS, periodSearch, usersSearch } from './search.ts';

describe('the console address', () => {
  it('keeps a known period, and drops the default and anything else', () => {
    expect(periodSearch({ period: '7d' })).toEqual({ period: '7d' });
    expect(periodSearch({ period: '30d' })).toEqual({});
    expect(periodSearch({ period: '365d' })).toEqual({});
    expect(periodSearch({})).toEqual({});
  });

  it('keeps a search trimmed to 100 characters, and drops an empty one', () => {
    expect(usersSearch({ q: '  ada  ', period: '90d' })).toEqual({ q: 'ada', period: '90d' });
    expect(usersSearch({ q: '   ' })).toEqual({});
    expect(usersSearch({ q: 7 })).toEqual({});
    expect(usersSearch({ q: 'x'.repeat(150) }).q).toHaveLength(100);
  });

  it('offers the same periods and default as the screens', () => {
    expect(PERIODS).toEqual(figures.PERIODS);
    expect(DEFAULT_PERIOD).toBe(figures.DEFAULT_PERIOD);
  });
});
