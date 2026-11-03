// The Menus editor's phone preview (spec 0065, H1): the draft as the guest menu would show it at one place, built the
// way Publish builds a place's snapshot (the menus shown there, each section with its sub sections, every placed item
// once, only the option groups those items use), so the preview draws the real MenuList with the draft. Pure.
import type { MenuDraft, MenuPlace, PlaceHours, PublicMenu, SnapshotItem, SnapshotSection } from '@crm/data';

/** The draft's menus at `place`, as `GET /api/public/menu/:key` would answer them after Publish. */
export function previewMenu(
  draft: MenuDraft,
  place: MenuPlace,
  header: { readonly businessName: string; readonly hours?: PlaceHours },
): PublicMenu {
  const items = new Map(draft.items.map((item) => [item.id, item]));
  const used = new Set<string>();
  const subsection = (section: MenuDraft['sections'][number]) => {
    const itemIds = section.itemIds.filter((id) => items.has(id));
    for (const id of itemIds) used.add(id);
    return {
      id: section.id,
      name: section.name,
      ...(section.description === undefined ? {} : { description: section.description }),
      layout: section.layout,
      ...(section.serving === undefined ? {} : { serving: section.serving }),
      itemIds,
    };
  };
  const menus = draft.menus
    .filter((menu) => menu.placeIds.includes(place.id))
    .sort((a, b) => a.position - b.position)
    .map((menu) => ({
      id: menu.id,
      name: menu.name,
      ...(menu.note === undefined ? {} : { note: menu.note }),
      ...(menu.serving === undefined ? {} : { serving: menu.serving }),
      ...(menu.taxRate > 0 ? { taxRate: menu.taxRate } : {}),
      ...(menu.serviceRate > 0 ? { serviceRate: menu.serviceRate } : {}),
      sections: draft.sections
        .filter((section) => section.menuId === menu.id && section.parentId === undefined)
        .sort((a, b) => a.position - b.position)
        .map((section): SnapshotSection => ({
          ...subsection(section),
          sections: draft.sections
            .filter((sub) => sub.parentId === section.id)
            .sort((a, b) => a.position - b.position)
            .map(subsection),
        })),
    }));
  const snapshotItems: Record<string, SnapshotItem> = {};
  const groupIds = new Set<string>();
  for (const id of used) {
    const item = items.get(id);
    if (item === undefined) continue;
    for (const group of item.groupIds) groupIds.add(group);
    snapshotItems[id] = {
      id,
      name: item.name,
      ...(item.description === undefined ? {} : { description: item.description }),
      ...(item.priceMinor === undefined ? {} : { priceMinor: item.priceMinor }),
      ...(item.priceNote === undefined ? {} : { priceNote: item.priceNote }),
      ...(item.photo === undefined ? {} : { photo: item.photo }),
      diet: item.diet,
      allergens: item.allergens,
      ...(item.kcal === undefined ? {} : { kcal: item.kcal }),
      featured: item.featured,
      sizes: item.sizes.map((size) => ({ name: size.name, priceMinor: size.priceMinor })),
      groupIds: item.groupIds,
    };
  }
  return {
    placeId: place.id,
    // The preview is never cached, so it names no workspace.
    workspaceId: '00000000-0000-0000-0000-000000000000',
    version: 0,
    business: { name: header.businessName },
    place: {
      name: place.name,
      timeZone: place.timeZone,
      locale: place.locale,
      hours: header.hours ?? { weekly: {}, exceptions: [] },
    },
    menu: {
      currency: draft.currency,
      menus,
      items: snapshotItems,
      groups: Object.fromEntries(
        draft.groups.filter((group) => groupIds.has(group.id)).map((group) => [group.id, group]),
      ),
    },
    soldOut: draft.items.filter((item) => item.soldOut && used.has(item.id)).map((item) => item.id),
  };
}

/**
 * What keeps the draft from publishing, as the server's own rule says it (`publishProblem` in core): nothing placed,
 * or a placed dish with no price, sizes or price note. The editor shows it before Publish is pressed.
 */
export function publishBlocker(
  draft: MenuDraft,
):
  | { readonly reason: 'empty' }
  | { readonly reason: 'nowhere'; readonly menuId: string; readonly name: string }
  | { readonly reason: 'unpriced'; readonly itemId: string; readonly name: string }
  | undefined {
  const placed = new Set(draft.sections.flatMap((section) => section.itemIds));
  if (placed.size === 0) return { reason: 'empty' };
  if (!guestsSeeADish(draft)) {
    const menu = homelessMenus(draft)[0];
    if (menu !== undefined) return { reason: 'nowhere', menuId: menu.id, name: menu.name };
  }
  const unpriced = draft.items.find(
    (item) =>
      placed.has(item.id) && item.priceMinor === undefined && item.priceNote === undefined && item.sizes.length === 0,
  );
  return unpriced === undefined ? undefined : { reason: 'unpriced', itemId: unpriced.id, name: unpriced.name };
}

/** The dishes placed on a menu with no price, sizes or price note: each needs one before Publish. */
export function unpricedDishes(draft: MenuDraft): readonly MenuDraft['items'][number][] {
  const placed = new Set(draft.sections.flatMap((section) => section.itemIds));
  return draft.items.filter(
    (item) =>
      placed.has(item.id) && item.priceMinor === undefined && item.priceNote === undefined && item.sizes.length === 0,
  );
}

/** Menus holding dishes that show at no place: guests could never see them. */
export function homelessMenus(draft: MenuDraft): readonly MenuDraft['menus'][number][] {
  return draft.menus.filter(
    (menu) =>
      menu.placeIds.length === 0 &&
      draft.sections.some((section) => section.menuId === menu.id && section.itemIds.length > 0),
  );
}

/** Whether any dish is on a menu that shows at a place: otherwise Publish would give guests nothing. */
export function guestsSeeADish(draft: MenuDraft): boolean {
  const shown = new Set(draft.menus.filter((menu) => menu.placeIds.length > 0).map((menu) => menu.id));
  return draft.sections.some((section) => shown.has(section.menuId) && section.itemIds.length > 0);
}
