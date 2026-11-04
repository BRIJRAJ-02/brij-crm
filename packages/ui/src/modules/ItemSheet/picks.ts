// Your picks as kept (spec 0065, H1, AC-6530): a pick names its dish, size and options by id, never by their place in
// a list, so a menu published again can't move a saved pick onto another size. Pure, run in a Node test.
import type { PublicMenu, SnapshotItem } from '@crm/contracts';

/** One dish a guest picked: the item, the size (by its id) and options they chose, and how many. */
export interface GuestPick {
  readonly key: string;
  readonly itemId: string;
  readonly sizeId?: string;
  readonly optionIds: readonly string[];
  readonly quantity: number;
}

/** A key for a pick: the same dish with the same choices adds to one line. */
export const pickKey = (pick: Omit<GuestPick, 'key' | 'quantity'>) =>
  `${pick.itemId}|${pick.sizeId ?? ''}|${[...pick.optionIds].sort().join(',')}`;

/** A size's price by its id, or undefined when the menu no longer has it. */
export const sizePrice = (item: SnapshotItem, sizeId: string | undefined) =>
  item.sizes.find((each) => each.id === sizeId)?.priceMinor;

/**
 * The saved picks the menu as it stands still offers (AC-6530): a pick whose dish, size or option is gone, or that
 * names no size of a dish that has sizes, is dropped, so a republished menu never prices a pick at the wrong size.
 */
export function livePicks(menu: PublicMenu, picks: readonly GuestPick[]): readonly GuestPick[] {
  return picks.filter((pick) => {
    const item = menu.menu.items[pick.itemId];
    if (item === undefined) return false;
    if (item.sizes.length === 0 ? pick.sizeId !== undefined : sizePrice(item, pick.sizeId) === undefined) return false;
    const offered = new Set(item.groupIds.flatMap((id) => (menu.menu.groups[id]?.options ?? []).map((o) => o.id)));
    return pick.optionIds.every((id) => offered.has(id));
  });
}
