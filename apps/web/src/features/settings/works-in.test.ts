// The Works in picker's rules (spec 0065 H7, AC-6594): when it shows, what it offers, and which choice clears which.
import type { MemberReachView } from '@crm/data';
import { describe, expect, it } from 'vitest';
import { EVERY, reachFromValues, worksInItems, worksInMatters, worksInValues } from './works-in.ts';

const A = '0190a000-0000-7000-8000-00000000000a';
const B = '0190a000-0000-7000-8000-00000000000b';
const A1 = '0190a000-0000-7000-8000-0000000000a1';
const B1 = '0190a000-0000-7000-8000-0000000000b1';
const B2 = '0190a000-0000-7000-8000-0000000000b2';

const view: MemberReachView = {
  memberId: '0190a000-0000-7000-8000-000000000001',
  reach: { all: true, properties: [], places: [] },
  fixed: false,
  businesses: [
    { id: A, name: 'Somewhere', places: [{ id: A1, name: 'Soho' }] },
    {
      id: B,
      name: 'Bar',
      places: [
        { id: B1, name: 'Quay' },
        { id: B2, name: 'Pier' },
      ],
    },
  ],
};
const words = { every: 'Every business', allOf: 'All places' };

describe('the Works in picker', () => {
  it('shows only once there is a choice: two businesses, or one business with two places', () => {
    expect(worksInMatters(view)).toBe(true);
    expect(worksInMatters({ ...view, businesses: view.businesses.slice(0, 1) })).toBe(false);
  });

  it('offers Every business, then each business whole and, from two places, each place under its heading', () => {
    expect(worksInItems(view, words).map((item) => [item.group ?? '', item.label])).toEqual([
      ['', 'Every business'],
      ['Somewhere', 'Somewhere'],
      ['Bar', 'All places'],
      ['Bar', 'Quay'],
      ['Bar', 'Pier'],
    ]);
  });

  it('turns choices into a reach and back, one never saying both a business and its places', () => {
    expect(worksInValues(view.reach)).toEqual([EVERY]);
    const one = reachFromValues(view, [EVERY, `b:${A}`], [EVERY]);
    expect(one).toEqual({ all: false, properties: [A], places: [] });
    // A place chosen takes its business's whole choice away; the business chosen again takes its places away.
    const place = reachFromValues(view, [`b:${B}`, `p:${B1}`], [`b:${B}`]);
    expect(place).toEqual({ all: false, properties: [], places: [B1] });
    expect(reachFromValues(view, [`p:${B1}`, `b:${B}`], [`p:${B1}`])).toEqual({
      all: false,
      properties: [B],
      places: [],
    });
    // Every business picked, or nothing left, is every business.
    expect(reachFromValues(view, [`b:${A}`, EVERY], [`b:${A}`]).all).toBe(true);
    expect(reachFromValues(view, [], [`b:${A}`]).all).toBe(true);
    expect(worksInValues({ all: false, properties: [A], places: [B1] })).toEqual([`b:${A}`, `p:${B1}`]);
  });
});
