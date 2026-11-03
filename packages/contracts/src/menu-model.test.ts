// The Menu app's pure rules (spec 0065, AC-6532, AC-6528): prices as integer minor units in each currency's own
// digits, typed prices parsed without a float, and serving times read on the place's clock.
import { describe, expect, it } from 'vitest';
import {
  choicesAllowed,
  currencyDigits,
  linePrice,
  formatPrice,
  formatPriceDelta,
  menuCacheTags,
  minorToDecimal,
  parsePrice,
  formatRate,
  parseRate,
  picksTotal,
  rateNote,
  servingAt,
  servingOf,
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

describe('serving times (AC-6528), ported from checklabscms/src/lib/schedule.ts isScheduleOpen', () => {
  const brunch = { weekly: { sat: [{ from: '10:00', to: '15:00' }], sun: [{ from: '10:00', to: '15:00' }] } };

  it('serves on a Saturday at 11 in the place’s zone, and not at 16, with when it starts next', () => {
    // Saturday 7 November 2026, 11:00 in London (GMT) is 11:00 UTC.
    expect(servingAt(brunch, new Date('2026-11-07T11:00:00Z'), 'Europe/London')).toEqual({ now: true });
    const later = servingAt(brunch, new Date('2026-11-07T16:00:00Z'), 'Europe/London');
    expect(later.now).toBe(false);
    expect(later.next?.toISOString()).toBe('2026-11-08T10:00:00.000Z');
  });

  it('reads the zone, not the server’s clock: 11:00 UTC is 20:00 in Tokyo', () => {
    expect(servingAt(brunch, new Date('2026-11-07T11:00:00Z'), 'Asia/Tokyo').now).toBe(false);
  });

  it('none means always: no serving times, or a week with no day set (checklabs’ empty schedule)', () => {
    expect(servingAt(undefined, new Date(), 'UTC')).toEqual({ now: true });
    expect(servingAt({ weekly: {} }, new Date(), 'UTC')).toEqual({ now: true });
  });

  it('zero windows means closed that day, and a day left out once others are set is closed too', () => {
    const weekdays = { weekly: { mon: [{ from: '09:00', to: '17:00' }], sat: [] } };
    // Saturday 7 November 2026, noon UTC: an empty Saturday.
    expect(servingAt(weekdays, new Date('2026-11-07T12:00:00Z'), 'UTC').now).toBe(false);
    // Tuesday 10 November: left out.
    expect(servingAt(weekdays, new Date('2026-11-10T12:00:00Z'), 'UTC').now).toBe(false);
    expect(servingAt(weekdays, new Date('2026-11-09T12:00:00Z'), 'UTC').now).toBe(true);
  });

  it('a window past midnight belongs to the day it starts on (checklabs read it on the same day)', () => {
    const late = { weekly: { fri: [{ from: '22:00', to: '02:00' }] } };
    // Saturday 7 November 2026, 01:00 UTC: Friday's late window, still serving.
    expect(servingAt(late, new Date('2026-11-07T01:00:00Z'), 'UTC').now).toBe(true);
    // Friday 6 November, 01:00: checklabs would have served here; Thursday has no late window, so we don't.
    expect(servingAt(late, new Date('2026-11-06T01:00:00Z'), 'UTC').now).toBe(false);
  });

  it('reads the first build’s one range over days as the per day shape', () => {
    expect(servingOf({ days: ['sat'], from: '10:00', to: '15:00' })?.weekly.sat).toEqual([
      { from: '10:00', to: '15:00' },
    ]);
    expect(servingOf({ days: ['sat'], from: '10:00', to: '15:00' })?.weekly.mon).toEqual([]);
    expect(servingOf('nonsense')).toBeUndefined();
  });
});

describe('tax and service, ported from checklabscms/src/lib/pos/totals.ts rollupCheck', () => {
  it('pulls the inclusive tax out of the subtotal and adds service on top', () => {
    // 100.00 with 5% tax inside: 100 × 5 / 105 = 4.76; 12.5% service = 12.50.
    expect(picksTotal(10_000, 500, 1250)).toEqual({ subtotal: 10_000, tax: 476, service: 1250, total: 11_250 });
  });

  it('counts a rate outside 0 to 100% as none', () => {
    expect(picksTotal(10_000, -5, 20_000)).toEqual({ subtotal: 10_000, tax: 0, service: 0, total: 10_000 });
  });

  it('reads and writes rates in basis points, never as floats', () => {
    expect(parseRate('12.5')).toBe(1250);
    expect(parseRate('12,5 %')).toBe(1250);
    expect(parseRate('5')).toBe(500);
    expect(parseRate('100.01')).toBeUndefined();
    expect(parseRate('abc')).toBeUndefined();
    expect(formatRate(1250)).toBe('12.5');
    expect(formatRate(1275)).toBe('12.75');
    expect(formatRate(500)).toBe('5');
  });

  it('writes the foot note from the rates', () => {
    expect(rateNote(500, 1250)).toBe('Prices include 5% tax. 12.5% service is added.');
    expect(rateNote(0, 1000)).toBe('10% service is added.');
    expect(rateNote(0, 0)).toBe('');
  });
});

describe('cache tags', () => {
  it('tags each place once, and nothing that isn’t an id', () => {
    const id = '0199f0a0-0000-7000-8000-000000000001';
    expect(menuCacheTags(id, id, 'menu:evil')).toEqual([`menu:${id}`]);
  });
});

describe('a line of picks (ported from checklabs)', () => {
  it('takes the size’s price, else the item’s, adds the options and multiplies by 1 to 99', () => {
    expect(linePrice({ basePrice: 900, sizePrices: [], optionDeltas: [50, 100], quantity: 2 })).toBe(2100);
    expect(linePrice({ basePrice: 900, sizePrices: [950, 3800], size: 1, optionDeltas: [], quantity: 1 })).toBe(3800);
    expect(linePrice({ basePrice: 900, sizePrices: [], optionDeltas: [], quantity: 99 })).toBe(89_100);
    expect(linePrice({ basePrice: 900, sizePrices: [], optionDeltas: [], quantity: 100 })).toBeUndefined();
    expect(linePrice({ basePrice: 900, sizePrices: [], optionDeltas: [], quantity: 0 })).toBeUndefined();
    expect(linePrice({ sizePrices: [], optionDeltas: [], quantity: 1 })).toBeUndefined();
  });

  it('allows a group’s choices from its min to its ceiling', () => {
    expect(choicesAllowed({ rule: 'one', min: 1 }, 0)).toBe(false);
    expect(choicesAllowed({ rule: 'one', min: 1 }, 1)).toBe(true);
    expect(choicesAllowed({ rule: 'up_to', max: 2 }, 3)).toBe(false);
    expect(choicesAllowed({ rule: 'any', min: 2 }, 5)).toBe(true);
  });
});
