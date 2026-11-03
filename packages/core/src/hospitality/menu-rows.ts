// The Menu app's rows as one value (spec 0065, H1): read in one transaction (`readMenuRows`), turned into the
// editor's draft (`draftOf`) and into each place's published snapshot (`snapshotFor`), both pure, and kept whole in
// `menu_drafts.published` at Publish so Discard can put them back (`restoreMenuRows`). Sold out is never part of what
// Discard restores: it is live, not drafted (AC-6526).
import {
  ALLERGEN_LEVELS,
  DIET_MARKS,
  EU_ALLERGENS,
  type ItemAllergen,
  type Menu,
  type MenuDraft,
  type MenuItem,
  type MenuPlace,
  type MenuSection,
  type MenuServing,
  type MenuSnapshot,
  type OptionGroup,
  type SnapshotItem,
  type SnapshotSection,
  type SnapshotSubsection,
} from '@crm/contracts';
import { schema, type WorkspaceTx } from '@crm/db';
import { and, asc, eq } from 'drizzle-orm';

const {
  menus,
  menuPlaces,
  menuSections,
  menuItems,
  menuPlacements,
  menuItemSizes,
  menuOptionGroups,
  menuOptions,
  menuItemOptionGroups,
  menuPhotos,
} = schema;

/** A menu row. */
export interface MenuRow {
  readonly id: string;
  readonly name: string;
  readonly note: string | null;
  readonly serving: unknown;
  readonly position: number;
}
/** A section row. */
export interface SectionRow {
  readonly id: string;
  readonly menuId: string;
  readonly parentId: string | null;
  readonly name: string;
  readonly description: string | null;
  readonly layout: string;
  readonly serving: unknown;
  readonly position: number;
}
/** An item row (its live Sold out read apart, never restored). */
export interface ItemRow {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly priceMinor: number | null;
  readonly priceNote: string | null;
  readonly photoId: string | null;
  readonly diet: readonly string[];
  readonly allergens: unknown;
  readonly kcal: number | null;
  readonly featured: boolean;
}

/** Every row of a workspace's menus, as read in one transaction and as kept at Publish. */
export interface MenuRows {
  readonly menus: readonly MenuRow[];
  readonly menuPlaces: readonly { readonly menuId: string; readonly placeId: string }[];
  readonly sections: readonly SectionRow[];
  readonly items: readonly ItemRow[];
  readonly placements: readonly { readonly sectionId: string; readonly itemId: string; readonly position: number }[];
  readonly sizes: readonly {
    readonly id: string;
    readonly itemId: string;
    readonly name: string;
    readonly priceMinor: number;
    readonly position: number;
  }[];
  readonly groups: readonly {
    readonly id: string;
    readonly name: string;
    readonly rule: string;
    readonly max: number | null;
  }[];
  readonly options: readonly {
    readonly id: string;
    readonly groupId: string;
    readonly name: string;
    readonly priceDeltaMinor: number;
    readonly position: number;
  }[];
  readonly itemGroups: readonly { readonly itemId: string; readonly groupId: string; readonly position: number }[];
}

/** Reads every row of the workspace's menus (9 statements, each one index range). */
export async function readMenuRows(tx: WorkspaceTx, workspaceId: string): Promise<MenuRows> {
  const [menuRows, placeRows, sectionRows, itemRows, placementRows, sizeRows, groupRows, optionRows, itemGroupRows] = [
    await tx
      .select({
        id: menus.id,
        name: menus.name,
        note: menus.note,
        serving: menus.serving,
        position: menus.position,
      })
      .from(menus)
      .where(eq(menus.workspaceId, workspaceId))
      .orderBy(asc(menus.position), asc(menus.id)),
    await tx
      .select({ menuId: menuPlaces.menuId, placeId: menuPlaces.placeId })
      .from(menuPlaces)
      .where(eq(menuPlaces.workspaceId, workspaceId)),
    await tx
      .select({
        id: menuSections.id,
        menuId: menuSections.menuId,
        parentId: menuSections.parentId,
        name: menuSections.name,
        description: menuSections.description,
        layout: menuSections.layout,
        serving: menuSections.serving,
        position: menuSections.position,
      })
      .from(menuSections)
      .where(eq(menuSections.workspaceId, workspaceId))
      .orderBy(asc(menuSections.menuId), asc(menuSections.position), asc(menuSections.id)),
    await tx
      .select({
        id: menuItems.id,
        name: menuItems.name,
        description: menuItems.description,
        priceMinor: menuItems.priceMinor,
        priceNote: menuItems.priceNote,
        photoId: menuItems.photoId,
        diet: menuItems.diet,
        allergens: menuItems.allergens,
        kcal: menuItems.kcal,
        featured: menuItems.featured,
      })
      .from(menuItems)
      .where(eq(menuItems.workspaceId, workspaceId))
      .orderBy(asc(menuItems.id)),
    await tx
      .select({ sectionId: menuPlacements.sectionId, itemId: menuPlacements.itemId, position: menuPlacements.position })
      .from(menuPlacements)
      .where(eq(menuPlacements.workspaceId, workspaceId))
      .orderBy(asc(menuPlacements.sectionId), asc(menuPlacements.position)),
    await tx
      .select({
        id: menuItemSizes.id,
        itemId: menuItemSizes.itemId,
        name: menuItemSizes.name,
        priceMinor: menuItemSizes.priceMinor,
        position: menuItemSizes.position,
      })
      .from(menuItemSizes)
      .where(eq(menuItemSizes.workspaceId, workspaceId))
      .orderBy(asc(menuItemSizes.itemId), asc(menuItemSizes.position)),
    await tx
      .select({
        id: menuOptionGroups.id,
        name: menuOptionGroups.name,
        rule: menuOptionGroups.rule,
        max: menuOptionGroups.max,
      })
      .from(menuOptionGroups)
      .where(eq(menuOptionGroups.workspaceId, workspaceId))
      .orderBy(asc(menuOptionGroups.name), asc(menuOptionGroups.id)),
    await tx
      .select({
        id: menuOptions.id,
        groupId: menuOptions.groupId,
        name: menuOptions.name,
        priceDeltaMinor: menuOptions.priceDeltaMinor,
        position: menuOptions.position,
      })
      .from(menuOptions)
      .where(eq(menuOptions.workspaceId, workspaceId))
      .orderBy(asc(menuOptions.groupId), asc(menuOptions.position)),
    await tx
      .select({
        itemId: menuItemOptionGroups.itemId,
        groupId: menuItemOptionGroups.groupId,
        position: menuItemOptionGroups.position,
      })
      .from(menuItemOptionGroups)
      .where(eq(menuItemOptionGroups.workspaceId, workspaceId))
      .orderBy(asc(menuItemOptionGroups.itemId), asc(menuItemOptionGroups.position)),
  ];
  return {
    menus: menuRows,
    menuPlaces: placeRows,
    sections: sectionRows,
    items: itemRows,
    placements: placementRows,
    sizes: sizeRows,
    groups: groupRows,
    options: optionRows,
    itemGroups: itemGroupRows,
  };
}

const DIETS: ReadonlySet<string> = new Set(DIET_MARKS);
const ALLERGENS: ReadonlySet<string> = new Set(EU_ALLERGENS);
const LEVELS: ReadonlySet<string> = new Set(ALLERGEN_LEVELS);

/** A stored serving time, or none when it isn't one (checked on the way in; read defensively). */
function servingOf(value: unknown): MenuServing | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const { days, from, to } = value as Record<string, unknown>;
  if (!Array.isArray(days) || typeof from !== 'string' || typeof to !== 'string') return undefined;
  return { days: days.filter((day): day is MenuServing['days'][number] => typeof day === 'string'), from, to };
}

/** Stored allergens, keeping only well formed ones from the closed list. */
function allergensOf(value: unknown): ItemAllergen[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry: unknown) => {
    if (typeof entry !== 'object' || entry === null) return [];
    const { code, level } = entry as Record<string, unknown>;
    return typeof code === 'string' && ALLERGENS.has(code) && typeof level === 'string' && LEVELS.has(level)
      ? [{ code, level } as ItemAllergen]
      : [];
  });
}

const dietOf = (diet: readonly string[]) => diet.filter((mark): mark is MenuItem['diet'][number] => DIETS.has(mark));

/** Groups `rows` by `key`, keeping their order. */
function byKey<Row>(rows: readonly Row[], key: (row: Row) => string): ReadonlyMap<string, Row[]> {
  const out = new Map<string, Row[]>();
  for (const row of rows) {
    const list = out.get(key(row));
    if (list === undefined) out.set(key(row), [row]);
    else list.push(row);
  }
  return out;
}

/** The option groups as both the draft and a snapshot show them. */
function groupsOf(rows: MenuRows): OptionGroup[] {
  const options = byKey(rows.options, (row) => row.groupId);
  return rows.groups.map((group) => ({
    id: group.id,
    name: group.name,
    rule: group.rule as OptionGroup['rule'],
    ...(group.max === null ? {} : { max: group.max }),
    options: (options.get(group.id) ?? []).map((option) => ({
      id: option.id,
      name: option.name,
      priceDeltaMinor: option.priceDeltaMinor,
    })),
  }));
}

/** What the editor shows beside the rows: the places, the currency, the draft's state and the reader's power. */
export interface DraftContext {
  readonly currency: string;
  readonly places: readonly MenuPlace[];
  readonly changes: number;
  readonly publishedAt?: string;
  readonly soldOut: ReadonlySet<string>;
  readonly photos: ReadonlyMap<string, string>;
  readonly canEdit: boolean;
}

/** The editor's whole draft (AC-6525) from the rows. Pure. */
export function draftOf(rows: MenuRows, context: DraftContext): MenuDraft {
  const placesOf = byKey(rows.menuPlaces, (row) => row.menuId);
  const placed = byKey(rows.placements, (row) => row.sectionId);
  const sizes = byKey(rows.sizes, (row) => row.itemId);
  const itemGroups = byKey(rows.itemGroups, (row) => row.itemId);
  const known = new Set(context.places.map((place) => place.id));
  const menuList: Menu[] = rows.menus.map((menu) => {
    const serving = servingOf(menu.serving);
    return {
      id: menu.id,
      name: menu.name,
      ...(menu.note === null ? {} : { note: menu.note }),
      ...(serving === undefined ? {} : { serving }),
      placeIds: (placesOf.get(menu.id) ?? []).map((row) => row.placeId).filter((id) => known.has(id)),
      position: menu.position,
    };
  });
  const sections: MenuSection[] = rows.sections.map((section) => {
    const serving = servingOf(section.serving);
    return {
      id: section.id,
      menuId: section.menuId,
      ...(section.parentId === null ? {} : { parentId: section.parentId }),
      name: section.name,
      ...(section.description === null ? {} : { description: section.description }),
      layout: section.layout === 'grid' ? 'grid' : 'list',
      ...(serving === undefined ? {} : { serving }),
      position: section.position,
      itemIds: (placed.get(section.id) ?? []).map((row) => row.itemId),
    };
  });
  const items: MenuItem[] = rows.items.map((item) => {
    const version = item.photoId === null ? undefined : context.photos.get(item.photoId);
    return {
      id: item.id,
      name: item.name,
      ...(item.description === null ? {} : { description: item.description }),
      ...(item.priceMinor === null ? {} : { priceMinor: item.priceMinor }),
      ...(item.priceNote === null ? {} : { priceNote: item.priceNote }),
      ...(item.photoId === null || version === undefined ? {} : { photo: { id: item.photoId, version } }),
      diet: dietOf(item.diet),
      allergens: allergensOf(item.allergens),
      ...(item.kcal === null ? {} : { kcal: item.kcal }),
      featured: item.featured,
      soldOut: context.soldOut.has(item.id),
      sizes: (sizes.get(item.id) ?? []).map((size) => ({ id: size.id, name: size.name, priceMinor: size.priceMinor })),
      groupIds: (itemGroups.get(item.id) ?? []).map((row) => row.groupId),
    };
  });
  return {
    currency: context.currency,
    places: [...context.places],
    menus: menuList,
    sections,
    items,
    groups: groupsOf(rows),
    changes: context.changes,
    ...(context.publishedAt === undefined ? {} : { publishedAt: context.publishedAt }),
    photos: context.photos.size,
    canEdit: context.canEdit,
  };
}

/**
 * One place's snapshot (AC-6525): the menus shown at `placeId` in order, each with its sections and sub sections in
 * order, every item placed in them once, and only the option groups those items use. Empty sections stay (a section
 * heading with nothing yet reads as such); an empty menu stays too. Pure.
 */
export function snapshotFor(
  rows: MenuRows,
  placeId: string,
  currency: string,
  photos: ReadonlyMap<string, string>,
): MenuSnapshot {
  const shownHere = new Set(rows.menuPlaces.filter((row) => row.placeId === placeId).map((row) => row.menuId));
  const placed = byKey(rows.placements, (row) => row.sectionId);
  const sizes = byKey(rows.sizes, (row) => row.itemId);
  const itemGroups = byKey(rows.itemGroups, (row) => row.itemId);
  const children = byKey(
    rows.sections.filter((row) => row.parentId !== null),
    (row) => row.parentId ?? '',
  );
  const itemById = new Map(rows.items.map((item) => [item.id, item]));
  const used = new Set<string>();
  const subsectionOf = (section: SectionRow): SnapshotSubsection => {
    const serving = servingOf(section.serving);
    const itemIds = (placed.get(section.id) ?? []).map((row) => row.itemId).filter((id) => itemById.has(id));
    for (const id of itemIds) used.add(id);
    return {
      id: section.id,
      name: section.name,
      ...(section.description === null ? {} : { description: section.description }),
      layout: section.layout === 'grid' ? 'grid' : 'list',
      ...(serving === undefined ? {} : { serving }),
      itemIds,
    };
  };
  const menuList = rows.menus
    .filter((menu) => shownHere.has(menu.id))
    .map((menu) => {
      const serving = servingOf(menu.serving);
      const sections: SnapshotSection[] = rows.sections
        .filter((section) => section.menuId === menu.id && section.parentId === null)
        .map((section) => ({
          ...subsectionOf(section),
          sections: (children.get(section.id) ?? []).map(subsectionOf),
        }));
      return {
        id: menu.id,
        name: menu.name,
        ...(menu.note === null ? {} : { note: menu.note }),
        ...(serving === undefined ? {} : { serving }),
        sections,
      };
    });
  const items: Record<string, SnapshotItem> = {};
  const groupIds = new Set<string>();
  for (const id of used) {
    const item = itemById.get(id);
    if (item === undefined) continue;
    const version = item.photoId === null ? undefined : photos.get(item.photoId);
    const groups = (itemGroups.get(id) ?? []).map((row) => row.groupId);
    for (const group of groups) groupIds.add(group);
    items[id] = {
      id,
      name: item.name,
      ...(item.description === null ? {} : { description: item.description }),
      ...(item.priceMinor === null ? {} : { priceMinor: item.priceMinor }),
      ...(item.priceNote === null ? {} : { priceNote: item.priceNote }),
      ...(item.photoId === null || version === undefined ? {} : { photo: { id: item.photoId, version } }),
      diet: dietOf(item.diet),
      allergens: allergensOf(item.allergens),
      ...(item.kcal === null ? {} : { kcal: item.kcal }),
      featured: item.featured,
      sizes: (sizes.get(id) ?? []).map((size) => ({ name: size.name, priceMinor: size.priceMinor })),
      groupIds: groups,
    };
  }
  const groups: Record<string, OptionGroup> = {};
  for (const group of groupsOf(rows)) if (groupIds.has(group.id)) groups[group.id] = group;
  return { currency, menus: menuList, items, groups };
}

/** The photo ids the rows name. */
export const photoIdsOf = (rows: MenuRows): readonly string[] => [
  ...new Set(rows.items.flatMap((item) => (item.photoId === null ? [] : [item.photoId]))),
];

/** Each named photo's version, for the draft and the snapshots. */
export async function photoVersions(tx: WorkspaceTx, workspaceId: string): Promise<ReadonlyMap<string, string>> {
  const rows = await tx
    .select({ id: menuPhotos.id, version: menuPhotos.version })
    .from(menuPhotos)
    .where(eq(menuPhotos.workspaceId, workspaceId));
  return new Map(rows.map((row) => [row.id, row.version]));
}

/** Reads the rows back from what Publish kept, defensively: anything malformed reads as no rows. */
export function parseKeptRows(value: unknown): MenuRows | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const kept = value as Record<string, unknown>;
  const list = (name: keyof MenuRows) => (Array.isArray(kept[name]) ? (kept[name] as never[]) : undefined);
  const menuList = list('menus');
  const menuPlaceList = list('menuPlaces');
  const sectionList = list('sections');
  const itemList = list('items');
  const placementList = list('placements');
  const sizeList = list('sizes');
  const groupList = list('groups');
  const optionList = list('options');
  const itemGroupList = list('itemGroups');
  if (
    menuList === undefined ||
    menuPlaceList === undefined ||
    sectionList === undefined ||
    itemList === undefined ||
    placementList === undefined ||
    sizeList === undefined ||
    groupList === undefined ||
    optionList === undefined ||
    itemGroupList === undefined
  ) {
    return undefined;
  }
  return {
    menus: menuList,
    menuPlaces: menuPlaceList,
    sections: sectionList,
    items: itemList,
    placements: placementList,
    sizes: sizeList,
    groups: groupList,
    options: optionList,
    itemGroups: itemGroupList,
  };
}

/**
 * Puts `rows` back as the workspace's whole draft (Discard, AC-6525): every menu row now is deleted and the kept ones
 * inserted, in the order their keys need. Places deleted since and photos gone since are left out; Sold out keeps its
 * live value for items that come back.
 */
export async function restoreMenuRows(
  tx: WorkspaceTx,
  workspaceId: string,
  rows: MenuRows,
  live: {
    readonly placeIds: ReadonlySet<string>;
    readonly photoIds: ReadonlySet<string>;
    readonly soldOut: ReadonlySet<string>;
  },
): Promise<void> {
  await tx.delete(menus).where(eq(menus.workspaceId, workspaceId));
  await tx.delete(menuItems).where(eq(menuItems.workspaceId, workspaceId));
  await tx.delete(menuOptionGroups).where(eq(menuOptionGroups.workspaceId, workspaceId));
  const ws = { workspaceId };
  if (rows.menus.length > 0) {
    await tx.insert(menus).values(
      rows.menus.map((row) => ({
        ...ws,
        id: row.id,
        name: row.name,
        note: row.note,
        serving: row.serving,
        position: row.position,
      })),
    );
  }
  const menuPlaceRows = rows.menuPlaces.filter((row) => live.placeIds.has(row.placeId));
  if (menuPlaceRows.length > 0) {
    await tx
      .insert(menuPlaces)
      .values(menuPlaceRows.map((row) => ({ ...ws, menuId: row.menuId, placeId: row.placeId })));
  }
  const sectionValues = (list: readonly SectionRow[]) =>
    list.map((row) => ({
      ...ws,
      id: row.id,
      menuId: row.menuId,
      parentId: row.parentId,
      name: row.name,
      description: row.description,
      layout: row.layout,
      serving: row.serving,
      position: row.position,
    }));
  const tops = rows.sections.filter((row) => row.parentId === null);
  const subs = rows.sections.filter((row) => row.parentId !== null);
  if (tops.length > 0) await tx.insert(menuSections).values(sectionValues(tops));
  if (subs.length > 0) await tx.insert(menuSections).values(sectionValues(subs));
  if (rows.groups.length > 0) {
    await tx
      .insert(menuOptionGroups)
      .values(rows.groups.map((row) => ({ ...ws, id: row.id, name: row.name, rule: row.rule, max: row.max })));
  }
  if (rows.options.length > 0) {
    await tx.insert(menuOptions).values(
      rows.options.map((row) => ({
        ...ws,
        id: row.id,
        groupId: row.groupId,
        name: row.name,
        priceDeltaMinor: row.priceDeltaMinor,
        position: row.position,
      })),
    );
  }
  // Inserted in chunks: 2,000 items is well past one statement's parameter limit.
  for (let start = 0; start < rows.items.length; start += 500) {
    await tx.insert(menuItems).values(
      rows.items.slice(start, start + 500).map((row) => ({
        ...ws,
        id: row.id,
        name: row.name,
        description: row.description,
        priceMinor: row.priceMinor,
        priceNote: row.priceNote,
        photoId: row.photoId !== null && live.photoIds.has(row.photoId) ? row.photoId : null,
        diet: [...row.diet],
        allergens: row.allergens,
        kcal: row.kcal,
        featured: row.featured,
        soldOut: live.soldOut.has(row.id),
      })),
    );
  }
  for (const [table, list] of [
    [menuItemSizes, rows.sizes.map((row) => ({ ...ws, ...row }))],
    [menuItemOptionGroups, rows.itemGroups.map((row) => ({ ...ws, ...row }))],
    [menuPlacements, rows.placements.map((row) => ({ ...ws, ...row }))],
  ] as const) {
    for (let start = 0; start < list.length; start += 1000) {
      await tx.insert(table).values(list.slice(start, start + 1000) as never[]);
    }
  }
}

/** The items sold out now (AC-6526), through the partial index on sold out items. */
export async function soldOutIds(tx: WorkspaceTx, workspaceId: string): Promise<Set<string>> {
  const rows = await tx
    .select({ id: menuItems.id })
    .from(menuItems)
    .where(and(eq(menuItems.workspaceId, workspaceId), eq(menuItems.soldOut, true)));
  return new Set(rows.map((row) => row.id));
}
