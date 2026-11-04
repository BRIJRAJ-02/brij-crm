// Your picks by id (UX review must-fix 5): a saved pick names its size by id, so a republished menu that reorders or
// removes sizes never prices it at another size; a pick whose size, option or dish is gone is dropped.
import type { PublicMenu } from '@crm/contracts';
import { describe, expect, it } from 'vitest';
import { livePicks, pickKey, type GuestPick } from './picks.ts';

const id = (n: number) => `0199f0a0-0000-7000-8000-${String(n).padStart(12, '0')}`;
const WINE = id(1);
const SOUP = id(2);
const GLASS = id(11);
const BOTTLE = id(12);
const MILK = id(21);
const OAT = id(22);

function menuWith(sizes: readonly { id: string; name: string; priceMinor: number }[], options = [OAT]): PublicMenu {
  return {
    placeId: id(90),
    workspaceId: id(91),
    version: 2,
    business: { name: 'Somewhere' },
    place: { name: 'Soho', timeZone: 'Europe/London', locale: 'en-GB', hours: { weekly: {}, exceptions: [] } },
    menu: {
      currency: 'GBP',
      menus: [],
      items: {
        [WINE]: {
          id: WINE,
          name: 'Etna Rosso',
          diet: [],
          allergens: [],
          featured: false,
          sizes: [...sizes],
          groupIds: [],
        },
        [SOUP]: {
          id: SOUP,
          name: 'Soup',
          priceMinor: 650,
          diet: [],
          allergens: [],
          featured: false,
          sizes: [],
          groupIds: [MILK],
        },
      },
      groups: {
        [MILK]: {
          id: MILK,
          name: 'Milk',
          rule: 'one',
          options: options.map((option) => ({ id: option, name: 'Oat', priceDeltaMinor: 50 })),
        },
      },
    },
    soldOut: [],
  };
}

const pick = (fields: Omit<GuestPick, 'key' | 'quantity'>): GuestPick => ({
  ...fields,
  key: pickKey(fields),
  quantity: 1,
});

describe('livePicks', () => {
  const bottle = pick({ itemId: WINE, sizeId: BOTTLE, optionIds: [] });
  const soup = pick({ itemId: SOUP, optionIds: [OAT] });

  it('keeps a pick on its size when the sizes are reordered', () => {
    const reordered = menuWith([
      { id: BOTTLE, name: 'Bottle', priceMinor: 3800 },
      { id: GLASS, name: 'Glass', priceMinor: 950 },
    ]);
    expect(livePicks(reordered, [bottle, soup])).toEqual([bottle, soup]);
    expect(bottle.key).toBe(`${WINE}|${BOTTLE}|`);
  });

  it('drops a pick whose size, option or dish is gone, or that names no size of a sized dish', () => {
    const glassOnly = menuWith([{ id: GLASS, name: 'Glass', priceMinor: 950 }], []);
    expect(livePicks(glassOnly, [bottle, soup])).toEqual([]);
    // A pick saved by position before sizes had ids names no size at all.
    const older = { key: `${WINE}|1|`, itemId: WINE, optionIds: [], quantity: 1 };
    expect(livePicks(menuWith([{ id: GLASS, name: 'Glass', priceMinor: 950 }]), [older])).toEqual([]);
    expect(livePicks(menuWith([]), [pick({ itemId: id(3), optionIds: [] })])).toEqual([]);
  });
});
