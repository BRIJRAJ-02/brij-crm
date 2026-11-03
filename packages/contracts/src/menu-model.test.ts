// The Menu app's pure rules (spec 0065, AC-6532, AC-6528): prices as integer minor units in each currency's own
// digits, typed prices parsed without a float, and serving times read on the place's clock.
import { describe, expect, it } from 'vitest';
import {
  currencyDigits,
  formatPrice,
  formatPriceDelta,
  menuCacheTags,
  minorToDecimal,
  parsePrice,
  servingAt,
} from './menu-model.ts';

describe('prices (AC-6532)', () => {
  it('knows each currency’s minor units: JPY none, GBP two, BHD three', () => {
    expect(currencyDigits('JPY')).toBe(0);
    expect(currencyDigits('GBP')).toBe(2);
    expect(currencyDigits('BHD')).toBe(3);
  });

  it('turns minor units into an exact decimal, never through a float', () => {
    expect(minorToDecimal(950, 'GBP')).toBe('9.50');
    expect(minorToDecimal(5, 'GBP')).toBe('0.05');
    expect(minorToDecimal(1200, 'JPY')).toBe('1200');
    expect(minorToDecimal(1250, 'BHD')).toBe('1.250');
    // 0.1 + 0.2 would drift as a float; as minor units it can't.
    expect(minorToDecimal(30, 'GBP')).toBe('0.30');
    expect(minorToDecimal(99_999_999, 'GBP')).toBe('999999.99');
  });

  it('formats in the place’s locale with the currency’s own digits', () => {
    expect(formatPrice(1200, 'JPY', 'ja-JP')).toBe('￥1,200');
    expect(formatPrice(950, 'GBP', 'en-GB')).toBe('£9.50');
    expect(formatPrice(1250, 'BHD', 'en-BH')).toMatch(/1\.250/);
    expect(formatPrice(3800, 'EUR', 'de-DE')).toBe('38,00 €');
    expect(formatPriceDelta(150, 'GBP', 'en-GB')).toBe('+£1.50');
    expect(formatPriceDelta(-50, 'GBP', 'en-GB')).toBe('−£0.50');
    expect(formatPriceDelta(0, 'GBP', 'en-GB')).toBe('');
  });

  it('parses what an editor types into minor units, refusing more digits than the currency has', () => {
    expect(parsePrice('9.5', 'GBP')).toBe(950);
    expect(parsePrice('9,50', 'GBP')).toBe(950);
    expect(parsePrice('38', 'GBP')).toBe(3800);
    expect(parsePrice('1200', 'JPY')).toBe(1200);
    expect(parsePrice('12.5', 'JPY')).toBeUndefined();
    expect(parsePrice('1.250', 'BHD')).toBe(1250);
    expect(parsePrice('1.2505', 'BHD')).toBeUndefined();
    expect(parsePrice('-1', 'GBP')).toBeUndefined();
    expect(parsePrice('abc', 'GBP')).toBeUndefined();
    expect(parsePrice('1000000', 'GBP')).toBeUndefined();
  });
});

describe('serving times (AC-6528)', () => {
  const brunch = { days: ['sat', 'sun'] as const, from: '10:00', to: '15:00' };

  it('serves on a Saturday at 11 in the place’s zone, and not at 16, with when it starts next', () => {
    // Saturday 7 November 2026, 11:00 in London (GMT) is 11:00 UTC.
    expect(servingAt({ ...brunch, days: [...brunch.days] }, new Date('2026-11-07T11:00:00Z'), 'Europe/London')).toEqual(
      {
        now: true,
      },
    );
    const later = servingAt({ ...brunch, days: [...brunch.days] }, new Date('2026-11-07T16:00:00Z'), 'Europe/London');
    expect(later.now).toBe(false);
    expect(later.next?.toISOString()).toBe('2026-11-08T10:00:00.000Z');
  });

  it('reads the zone, not the server’s clock: 11:00 UTC is 20:00 in Tokyo', () => {
    expect(servingAt({ ...brunch, days: [...brunch.days] }, new Date('2026-11-07T11:00:00Z'), 'Asia/Tokyo').now).toBe(
      false,
    );
  });

  it('serves always with no serving time', () => {
    expect(servingAt(undefined, new Date(), 'UTC')).toEqual({ now: true });
  });
});

describe('cache tags', () => {
  it('tags each place once, and nothing that isn’t an id', () => {
    const id = '0199f0a0-0000-7000-8000-000000000001';
    expect(menuCacheTags(id, id, 'menu:evil')).toEqual([`menu:${id}`]);
  });
});
