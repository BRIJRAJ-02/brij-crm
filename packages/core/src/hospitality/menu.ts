// The Menu app's editor (spec 0065, H1, AC-6520 to AC-6527): menus, sections one level deep, items placed in
// sections, sizes, shared option groups, photos, Publish and Discard, and Sold out. `hospitality.manage` edits and
// publishes, checked before any input is read, and only while Menu is installed (`requireApp`). Every edit saves into
// the draft and counts one change (AC-6525); the guest page reads only what Publish froze per place
// (`menu_versions`), with Sold out read live over it (AC-6526). Every write takes the workspace's menu lock, so two
// editors never pass a limit or each other's positions, and answers the whole draft.
//
// Each business has its own menus, dish library, option groups, photos, draft, Publish, Live or Hidden and look (spec
// 0065 H7, migration 0199). Every call works in one: `propertyId` when it names one of the workspace's, else the first.
// A menu, section, dish or group of another business answers as one that doesn't exist, and the limits (30 menus,
// 2,000 dishes, 1,000 photos, 200 option groups) count one business's rows (AC-6518).
import {
  DEFAULT_MENU_LOOK,
  MENU_LIMITS,
  MenuLook,
  type ItemFields,
  type MenuDraft,
  type MenuPlace,
  type MenuServing,
  type SectionLayout,
} from '@crm/contracts';
import { schema, type WorkspaceTx } from '@crm/db';
import { and, asc, count, desc, eq, inArray, isNotNull, isNull, ne, notInArray, sql } from 'drizzle-orm';
import { requirePermission } from '../access/check.ts';
import type { EngineScope } from '../access/mint.ts';
import { can } from '../access/policy.ts';
import { inWorkspace } from '../access/run.ts';
import { lockKey } from '../booking/locks.ts';
import { checkId, newId } from '../engine/ids.ts';
import { inputInvalid, refuse, refuseOn } from '../engine/refusals.ts';
import { readMenuBrandIn } from '../brand/public.ts';
import { auditSetup, hospitalityMember, requireApp } from './gate.ts';
import { menuLookStylesheet } from './public-menu.ts';
import {
  draftOf,
  parseKeptRows,
  photoVersions,
  readMenuRows,
  restoreMenuRows,
  type MenuRows,
  snapshotFor,
  soldOutIds,
} from './menu-rows.ts';
import { currentProperty, type CurrentProperty } from './property.ts';

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
  menuVersions,
  menuDrafts,
  places,
  properties,
} = schema;

const MENU_NOT_FOUND = 'That menu doesn’t exist.';
const SECTION_NOT_FOUND = 'That section doesn’t exist.';
const ITEM_NOT_FOUND = 'That dish doesn’t exist.';
const GROUP_NOT_FOUND = 'That option group doesn’t exist.';
const L = MENU_LIMITS;

/** How many published versions a place keeps. */
const VERSIONS_KEPT = 10;

/** The property's currency, or US dollars until one is set (the first install's card sets it). */
const currencyOf = (property: CurrentProperty): string => property.currency ?? 'USD';

/** Which business a menu call works in (spec 0065 H7): left out, the workspace's first. */
export interface InProperty {
  readonly propertyId?: string;
}

/** The business's places as the Menus screen names them, in order. */
async function placesOf(tx: WorkspaceTx, workspaceId: string, propertyId: string): Promise<MenuPlace[]> {
  return tx
    .select({
      id: places.id,
      name: places.name,
      menuKey: places.menuKey,
      timeZone: places.timeZone,
      locale: places.locale,
    })
    .from(places)
    .where(and(eq(places.workspaceId, workspaceId), eq(places.propertyId, propertyId)))
    .orderBy(asc(places.position), asc(places.id));
}

/** A menu of the business, or undefined: one of another business reads as none. */
async function menuOf(tx: WorkspaceTx, workspaceId: string, propertyId: string, id: string) {
  const [row] = await tx
    .select({ id: menus.id })
    .from(menus)
    .where(and(eq(menus.workspaceId, workspaceId), eq(menus.propertyId, propertyId), eq(menus.id, id)));
  return row;
}

/** The business's draft as the reader sees it, read in the caller's transaction. */
async function readDraft(tx: WorkspaceTx, scope: EngineScope, property: CurrentProperty): Promise<MenuDraft> {
  const workspaceId = scope.workspaceId;
  const rows = await readMenuRows(tx, workspaceId, property.id);
  const [state] = await tx
    .select({ changes: menuDrafts.changes, publishedAt: menuDrafts.publishedAt, hidden: menuDrafts.hidden })
    .from(menuDrafts)
    .where(and(eq(menuDrafts.workspaceId, workspaceId), eq(menuDrafts.propertyId, property.id)));
  const brand = await readMenuBrandIn(tx, workspaceId, property.id);
  return draftOf(rows, {
    currency: currencyOf(property),
    look: brand.menuLook ?? DEFAULT_MENU_LOOK,
    lookAccents: {
      ...(brand.accents.accent === undefined ? {} : { accent: brand.accents.accent }),
      ...(brand.accents.accentDark === undefined ? {} : { accentDark: brand.accents.accentDark }),
    },
    places: await placesOf(tx, workspaceId, property.id),
    changes: state?.changes ?? 0,
    ...(state?.publishedAt === null || state?.publishedAt === undefined
      ? {}
      : { publishedAt: new Date(state.publishedAt).toISOString() }),
    hidden: state?.hidden ?? false,
    soldOut: await soldOutIds(tx, workspaceId, property.id),
    photos: await photoVersions(tx, workspaceId, property.id),
    canEdit: can(scope.access, 'hospitality.manage'),
  });
}

/** Counts one change waiting for the business's Publish (AC-6525). */
async function noteChange(tx: WorkspaceTx, workspaceId: string, propertyId: string): Promise<void> {
  await tx
    .insert(menuDrafts)
    .values({ workspaceId, propertyId, changes: 1 })
    .onConflictDoUpdate({
      target: [menuDrafts.workspaceId, menuDrafts.propertyId],
      set: { changes: sql`${menuDrafts.changes} + 1`, updatedAt: sql`now()` },
    });
}

/**
 * One draft edit: the permission, the app, the business, the lock, the change, its count and audit row, then the
 * business's whole draft.
 */
async function edit(
  scope: EngineScope,
  where: InProperty,
  what: string,
  ids: Readonly<Record<string, string>>,
  change: (tx: WorkspaceTx, by: string, propertyId: string) => Promise<void>,
): Promise<MenuDraft> {
  requirePermission(scope, 'hospitality.manage');
  const by = hospitalityMember(scope);
  return inWorkspace(scope, async (tx) => {
    await requireApp(tx, scope.workspaceId, 'menu');
    const property = await currentProperty(tx, scope.workspaceId, where.propertyId);
    await lockKey(tx, `menu:${scope.workspaceId}`);
    await change(tx, by, property.id);
    await noteChange(tx, scope.workspaceId, property.id);
    await auditSetup(tx, scope, what, { ...ids, propertyId: property.id });
    return readDraft(tx, scope, property);
  });
}

/** The Menus screen (AC-6520): the business's whole draft. Run service reads it too, to flip Sold out (AC-6526). */
export async function readMenuDraft(scope: EngineScope, where: InProperty = {}): Promise<MenuDraft> {
  requireMenuReader(scope);
  return inWorkspace(scope, async (tx) => {
    await requireApp(tx, scope.workspaceId, 'menu');
    return readDraft(tx, scope, await currentProperty(tx, scope.workspaceId, where.propertyId));
  });
}

/**
 * The editor's preview look (spec 0065, H1): the stylesheet guests' menus wear (the saved look with the brand's
 * accent), for any member who reads the Menus screen, so the phone preview draws what guests will see before the
 * first Publish. It names nothing of the draft. It is linked inside the app, so it never takes the app's own face.
 */
export async function readMenuDraftLook(scope: EngineScope, where: InProperty = {}): Promise<string> {
  requireMenuReader(scope);
  return inWorkspace(scope, async (tx) => {
    await requireApp(tx, scope.workspaceId, 'menu');
    const property = await currentProperty(tx, scope.workspaceId, where.propertyId);
    return menuLookStylesheet(await readMenuBrandIn(tx, scope.workspaceId, property.id), { inApp: true });
  });
}

/** Refuses anyone holding neither Manage hospitality nor Run service. */
function requireMenuReader(scope: EngineScope): void {
  if (!can(scope.access, 'hospitality.manage')) requirePermission(scope, 'hospitality.service');
}

/** A serving time as stored, or null to clear; undefined leaves it. */
const servingValue = (serving: MenuServing | null | undefined) =>
  serving === undefined ? {} : { serving: serving === null ? null : { weekly: { ...serving.weekly } } };

/** Empty text as null. */
const blank = (value: string | undefined): string | null =>
  value === undefined || value.trim() === '' ? null : value.trim();

/** Adds a menu, or changes one (AC-6520). `id` is the client's own, so a retry makes one menu. */
export async function saveMenu(
  scope: EngineScope,
  input: {
    readonly id: string;
    readonly name: string;
    readonly note?: string;
    readonly placeIds: readonly string[];
    readonly serving?: MenuServing | null;
    /** Basis points; left out keeps what is there. */
    readonly taxRate?: number;
    readonly serviceRate?: number;
  } & InProperty,
): Promise<MenuDraft> {
  requirePermission(scope, 'hospitality.manage');
  const id = checkId(input.id, MENU_NOT_FOUND);
  return edit(scope, input, 'menu.saved', { menuId: id }, async (tx, by, propertyId) => {
    const ws = scope.workspaceId;
    const placeIds = [...new Set(input.placeIds.map((each) => each.toLowerCase()))];
    // A menu serves only its own business's places (spec 0065 H7, AC-6514). A menu or a place of another business
    // reads as none.
    const [existing] = await tx
      .select({ propertyId: menus.propertyId })
      .from(menus)
      .where(and(eq(menus.workspaceId, ws), eq(menus.id, id)));
    if (existing !== undefined && existing.propertyId !== propertyId) throw refuse('NOT_FOUND', MENU_NOT_FOUND);
    const found =
      placeIds.length === 0
        ? []
        : await tx
            .select({ id: places.id })
            .from(places)
            .where(and(eq(places.workspaceId, ws), eq(places.propertyId, propertyId), inArray(places.id, placeIds)));
    if (found.length !== placeIds.length) throw refuse('NOT_FOUND', 'That place doesn’t exist.');
    const fields = {
      name: input.name,
      note: blank(input.note),
      ...servingValue(input.serving),
      ...(input.taxRate === undefined ? {} : { taxRate: input.taxRate }),
      ...(input.serviceRate === undefined ? {} : { serviceRate: input.serviceRate }),
    };
    const changed = await tx
      .update(menus)
      .set({ ...fields, updatedByMemberId: by, updatedAt: sql`now()` })
      .where(and(eq(menus.workspaceId, ws), eq(menus.propertyId, propertyId), eq(menus.id, id)))
      .returning({ id: menus.id });
    if (changed.length === 0) {
      const [counted] = await tx
        .select({ n: count() })
        .from(menus)
        .where(and(eq(menus.workspaceId, ws), eq(menus.propertyId, propertyId)));
      const position = counted?.n ?? 0;
      if (position >= L.menus) throw refuse('LIMIT_REACHED', `A business takes up to ${String(L.menus)} menus.`);
      await tx.insert(menus).values({
        workspaceId: ws,
        id,
        propertyId,
        ...fields,
        position,
        createdByMemberId: by,
        updatedByMemberId: by,
      });
    }
    await tx.delete(menuPlaces).where(and(eq(menuPlaces.workspaceId, ws), eq(menuPlaces.menuId, id)));
    if (placeIds.length > 0) {
      await tx
        .insert(menuPlaces)
        .values(placeIds.map((placeId) => ({ workspaceId: ws, menuId: id, placeId, propertyId })));
    }
  });
}

/** Deletes a menu with its sections; its items stay in the library (AC-6524). */
export async function deleteMenu(
  scope: EngineScope,
  input: { readonly menuId: string } & InProperty,
): Promise<MenuDraft> {
  requirePermission(scope, 'hospitality.manage');
  const id = checkId(input.menuId, MENU_NOT_FOUND);
  return edit(scope, input, 'menu.deleted', { menuId: id }, async (tx, _by, propertyId) => {
    const gone = await tx
      .delete(menus)
      .where(and(eq(menus.workspaceId, scope.workspaceId), eq(menus.propertyId, propertyId), eq(menus.id, id)))
      .returning({ id: menus.id });
    if (gone.length === 0) throw refuse('NOT_FOUND', MENU_NOT_FOUND);
    await renumber(tx, scope.workspaceId, 'menu', propertyId);
  });
}

/** A section's row while it is in one of the business's menus, else undefined. */
async function sectionRow(tx: WorkspaceTx, workspaceId: string, propertyId: string, id: string) {
  const [row] = await tx
    .select({ id: menuSections.id, menuId: menuSections.menuId, parentId: menuSections.parentId })
    .from(menuSections)
    .innerJoin(menus, and(eq(menus.workspaceId, menuSections.workspaceId), eq(menus.id, menuSections.menuId)))
    .where(and(eq(menuSections.workspaceId, workspaceId), eq(menus.propertyId, propertyId), eq(menuSections.id, id)));
  return row;
}

/** A dish of the business, or undefined: one of another business reads as none. */
async function itemOf(tx: WorkspaceTx, workspaceId: string, propertyId: string, id: string) {
  const [row] = await tx
    .select({ id: menuItems.id })
    .from(menuItems)
    .where(and(eq(menuItems.workspaceId, workspaceId), eq(menuItems.propertyId, propertyId), eq(menuItems.id, id)));
  return row;
}

/**
 * Adds a section or changes one (AC-6521). A sub section's parent is a top level section of the same menu, and a
 * section with sub sections can't become one itself: one level deep, never more. Up to 100 a menu.
 */
export async function saveSection(
  scope: EngineScope,
  input: {
    readonly id: string;
    readonly menuId: string;
    readonly parentId?: string;
    readonly name: string;
    readonly description?: string;
    readonly layout: SectionLayout;
    readonly serving?: MenuServing | null;
  } & InProperty,
): Promise<MenuDraft> {
  requirePermission(scope, 'hospitality.manage');
  const id = checkId(input.id, SECTION_NOT_FOUND);
  const menuId = checkId(input.menuId, MENU_NOT_FOUND);
  const parentId = input.parentId === undefined ? null : checkId(input.parentId, SECTION_NOT_FOUND);
  return edit(scope, input, 'menu.section_saved', { menuId, sectionId: id }, async (tx, _by, propertyId) => {
    const ws = scope.workspaceId;
    if ((await menuOf(tx, ws, propertyId, menuId)) === undefined) throw refuse('NOT_FOUND', MENU_NOT_FOUND);
    if (parentId !== null) {
      const parent = await sectionRow(tx, ws, propertyId, parentId);
      if (parent === undefined || parent.menuId !== menuId) throw refuse('NOT_FOUND', SECTION_NOT_FOUND);
      if (parent.parentId !== null || parentId === id) {
        throw refuse('CONFIG_INVALID', 'Sections go one level deep, such as Wines, then Red.');
      }
      const [child] = await tx
        .select({ id: menuSections.id })
        .from(menuSections)
        .where(and(eq(menuSections.workspaceId, ws), eq(menuSections.parentId, id)))
        .limit(1);
      if (child !== undefined)
        throw refuse('CONFIG_INVALID', 'A section with its own sections can’t go inside another.');
    }
    const fields = {
      name: input.name,
      description: blank(input.description),
      layout: input.layout,
      parentId,
      ...servingValue(input.serving),
    };
    const existing = await sectionRow(tx, ws, propertyId, id);
    if (existing === undefined) {
      // An id another business's section holds is never taken over.
      const [elsewhere] = await tx
        .select({ id: menuSections.id })
        .from(menuSections)
        .where(and(eq(menuSections.workspaceId, ws), eq(menuSections.id, id)));
      if (elsewhere !== undefined) throw refuse('NOT_FOUND', SECTION_NOT_FOUND);
    }
    if (existing !== undefined) {
      if (existing.menuId !== menuId) throw refuse('NOT_FOUND', SECTION_NOT_FOUND);
      await tx
        .update(menuSections)
        .set({ ...fields, updatedAt: sql`now()` })
        .where(and(eq(menuSections.workspaceId, ws), eq(menuSections.id, id)));
      if (existing.parentId !== parentId) await renumber(tx, ws, 'section', menuId);
      return;
    }
    const [counted] = await tx
      .select({ n: count() })
      .from(menuSections)
      .where(and(eq(menuSections.workspaceId, ws), eq(menuSections.menuId, menuId)));
    if ((counted?.n ?? 0) >= L.sectionsPerMenu) {
      throw refuse('LIMIT_REACHED', `A menu takes up to ${String(L.sectionsPerMenu)} sections.`);
    }
    const [siblings] = await tx
      .select({ n: count() })
      .from(menuSections)
      .where(
        and(
          eq(menuSections.workspaceId, ws),
          eq(menuSections.menuId, menuId),
          parentId === null ? isNull(menuSections.parentId) : eq(menuSections.parentId, parentId),
        ),
      );
    await tx.insert(menuSections).values({ workspaceId: ws, id, menuId, ...fields, position: siblings?.n ?? 0 });
  });
}

/** Deletes a section with its sub sections; their items stay in the library. */
export async function deleteSection(
  scope: EngineScope,
  input: { readonly sectionId: string } & InProperty,
): Promise<MenuDraft> {
  requirePermission(scope, 'hospitality.manage');
  const id = checkId(input.sectionId, SECTION_NOT_FOUND);
  return edit(scope, input, 'menu.section_deleted', { sectionId: id }, async (tx, _by, propertyId) => {
    const section = await sectionRow(tx, scope.workspaceId, propertyId, id);
    if (section === undefined) throw refuse('NOT_FOUND', SECTION_NOT_FOUND);
    await tx.delete(menuSections).where(and(eq(menuSections.workspaceId, scope.workspaceId), eq(menuSections.id, id)));
    await renumber(tx, scope.workspaceId, 'section', section.menuId);
  });
}

/** The end of a section's items, refusing past its limit. */
async function placementEnd(tx: WorkspaceTx, workspaceId: string, sectionId: string): Promise<number> {
  const [counted] = await tx
    .select({ n: count() })
    .from(menuPlacements)
    .where(and(eq(menuPlacements.workspaceId, workspaceId), eq(menuPlacements.sectionId, sectionId)));
  const n = counted?.n ?? 0;
  if (n >= L.placementsPerSection) {
    throw refuse('LIMIT_REACHED', `A section takes up to ${String(L.placementsPerSection)} dishes.`);
  }
  return n;
}

/**
 * Adds an item or changes one, whole (AC-6522, AC-6523): its fields, its sizes (kept by id, the rest new, those left
 * out removed) and its option groups in order. A new one is placed at the end of `sectionId`. Up to 2,000.
 */
export async function saveItem(
  scope: EngineScope,
  input: { readonly id: string; readonly sectionId?: string; readonly item: ItemFields } & InProperty,
): Promise<MenuDraft> {
  requirePermission(scope, 'hospitality.manage');
  const id = checkId(input.id, ITEM_NOT_FOUND);
  const sectionId = input.sectionId === undefined ? undefined : checkId(input.sectionId, SECTION_NOT_FOUND);
  const { item } = input;
  return edit(scope, input, 'menu.item_saved', { itemId: id }, async (tx, by, propertyId) => {
    const ws = scope.workspaceId;
    const groupIds = item.groupIds.map((each) => each.toLowerCase());
    if (groupIds.length > 0) {
      // A dish offers only its own business's option groups.
      const found = await tx
        .select({ id: menuOptionGroups.id })
        .from(menuOptionGroups)
        .where(
          and(
            eq(menuOptionGroups.workspaceId, ws),
            eq(menuOptionGroups.propertyId, propertyId),
            inArray(menuOptionGroups.id, groupIds),
          ),
        );
      if (found.length !== groupIds.length) throw refuse('NOT_FOUND', GROUP_NOT_FOUND);
    }
    const fields = {
      name: item.name,
      description: blank(item.description),
      priceMinor: item.sizes.length > 0 ? null : item.priceMinor,
      priceNote: blank(item.priceNote),
      diet: [...item.diet],
      allergens: item.allergens.map((each) => ({ code: each.code, level: each.level })),
      kcal: item.kcal,
      featured: item.featured,
      updatedByMemberId: by,
    };
    const changed = await tx
      .update(menuItems)
      .set({ ...fields, updatedAt: sql`now()` })
      .where(and(eq(menuItems.workspaceId, ws), eq(menuItems.propertyId, propertyId), eq(menuItems.id, id)))
      .returning({ id: menuItems.id });
    if (changed.length === 0) {
      const [counted] = await tx
        .select({ n: count() })
        .from(menuItems)
        .where(and(eq(menuItems.workspaceId, ws), eq(menuItems.propertyId, propertyId)));
      if ((counted?.n ?? 0) >= L.items)
        throw refuse('LIMIT_REACHED', `A business takes up to ${String(L.items)} dishes.`);
      // An id another business's dish holds answers as a dish that doesn't exist.
      const inserted = await tx
        .insert(menuItems)
        .values({ workspaceId: ws, id, propertyId, ...fields, createdByMemberId: by })
        .onConflictDoNothing({ target: [menuItems.workspaceId, menuItems.id] })
        .returning({ id: menuItems.id });
      if (inserted.length === 0) throw refuse('NOT_FOUND', ITEM_NOT_FOUND);
      if (sectionId !== undefined) {
        const section = await sectionRow(tx, ws, propertyId, sectionId);
        if (section === undefined) throw refuse('NOT_FOUND', SECTION_NOT_FOUND);
        const position = await placementEnd(tx, ws, sectionId);
        await tx.insert(menuPlacements).values({ workspaceId: ws, sectionId, itemId: id, position });
      }
    }
    // Sizes: kept by id when the id is this item's own, the rest new; the ones left out go.
    const own = await tx
      .select({ id: menuItemSizes.id })
      .from(menuItemSizes)
      .where(and(eq(menuItemSizes.workspaceId, ws), eq(menuItemSizes.itemId, id)));
    const ownIds = new Set(own.map((row) => row.id));
    await tx.delete(menuItemSizes).where(and(eq(menuItemSizes.workspaceId, ws), eq(menuItemSizes.itemId, id)));
    if (item.sizes.length > 0) {
      await tx.insert(menuItemSizes).values(
        item.sizes.map((size, position) => ({
          workspaceId: ws,
          ...(size.id !== undefined && ownIds.has(size.id.toLowerCase()) ? { id: size.id.toLowerCase() } : {}),
          itemId: id,
          name: size.name,
          priceMinor: size.priceMinor,
          position,
        })),
      );
    }
    await tx
      .delete(menuItemOptionGroups)
      .where(and(eq(menuItemOptionGroups.workspaceId, ws), eq(menuItemOptionGroups.itemId, id)));
    if (groupIds.length > 0) {
      await tx
        .insert(menuItemOptionGroups)
        .values(groupIds.map((groupId, position) => ({ workspaceId: ws, itemId: id, groupId, position })));
    }
  });
}

/** Deletes an item from every section and menu at once (the screen asks first). */
export async function deleteItem(
  scope: EngineScope,
  input: { readonly itemId: string } & InProperty,
): Promise<MenuDraft> {
  requirePermission(scope, 'hospitality.manage');
  const id = checkId(input.itemId, ITEM_NOT_FOUND);
  return edit(scope, input, 'menu.item_deleted', { itemId: id }, async (tx, _by, propertyId) => {
    const gone = await tx
      .delete(menuItems)
      .where(
        and(eq(menuItems.workspaceId, scope.workspaceId), eq(menuItems.propertyId, propertyId), eq(menuItems.id, id)),
      )
      .returning({ id: menuItems.id });
    if (gone.length === 0) throw refuse('NOT_FOUND', ITEM_NOT_FOUND);
  });
}

/** Places an item in another section (AC-6524), or takes it out of one; an item in no section stays in the library. */
export async function placeItem(
  scope: EngineScope,
  input: { readonly itemId: string; readonly sectionId: string; readonly placed: boolean } & InProperty,
): Promise<MenuDraft> {
  requirePermission(scope, 'hospitality.manage');
  const itemId = checkId(input.itemId, ITEM_NOT_FOUND);
  const sectionId = checkId(input.sectionId, SECTION_NOT_FOUND);
  const what = input.placed ? 'menu.item_placed' : 'menu.item_unplaced';
  return edit(scope, input, what, { itemId, sectionId }, async (tx, _by, propertyId) => {
    const ws = scope.workspaceId;
    // A dish sits only in its own business's menus: the section and the dish must both be the business's.
    if ((await sectionRow(tx, ws, propertyId, sectionId)) === undefined) throw refuse('NOT_FOUND', SECTION_NOT_FOUND);
    if (!input.placed) {
      await tx
        .delete(menuPlacements)
        .where(
          and(
            eq(menuPlacements.workspaceId, ws),
            eq(menuPlacements.sectionId, sectionId),
            eq(menuPlacements.itemId, itemId),
          ),
        );
      await renumber(tx, ws, 'placement', sectionId);
      return;
    }
    if ((await itemOf(tx, ws, propertyId, itemId)) === undefined) throw refuse('NOT_FOUND', ITEM_NOT_FOUND);
    const [already] = await tx
      .select({ itemId: menuPlacements.itemId })
      .from(menuPlacements)
      .where(
        and(
          eq(menuPlacements.workspaceId, ws),
          eq(menuPlacements.sectionId, sectionId),
          eq(menuPlacements.itemId, itemId),
        ),
      );
    if (already !== undefined) return;
    const position = await placementEnd(tx, ws, sectionId);
    await tx.insert(menuPlacements).values({ workspaceId: ws, sectionId, itemId, position });
  });
}

/**
 * Renumbers positions from 0, keeping their order: a business's menus, a menu's sections (each level), or a section's
 * items. `within` is the business, the menu or the section.
 */
async function renumber(
  tx: WorkspaceTx,
  workspaceId: string,
  part: 'menu' | 'section' | 'placement',
  within?: string,
): Promise<void> {
  if (part === 'menu') {
    await tx.execute(sql`
      update menus m set position = r.n - 1
      from (
        select id, row_number() over (order by position, id) as n
        from menus where workspace_id = ${workspaceId} and property_id = ${within ?? null}
      ) r
      where m.workspace_id = ${workspaceId} and m.id = r.id and m.position <> r.n - 1`);
  } else if (part === 'section') {
    await tx.execute(sql`
      update menu_sections s set position = r.n - 1
      from (
        select id, row_number() over (partition by parent_id order by position, id) as n
        from menu_sections where workspace_id = ${workspaceId} and menu_id = ${within ?? null}
      ) r
      where s.workspace_id = ${workspaceId} and s.id = r.id and s.position <> r.n - 1`);
  } else {
    await tx.execute(sql`
      update menu_placements p set position = r.n - 1
      from (
        select item_id, row_number() over (order by position, item_id) as n
        from menu_placements where workspace_id = ${workspaceId} and section_id = ${within ?? null}
      ) r
      where p.workspace_id = ${workspaceId} and p.section_id = ${within ?? null} and p.item_id = r.item_id
        and p.position <> r.n - 1`);
  }
}

/** Moves a menu, a section among its siblings, or an item within its section, to `toIndex` (drag to reorder). */
export async function moveMenuPart(
  scope: EngineScope,
  input: {
    readonly part: 'menu' | 'section' | 'placement';
    readonly id: string;
    readonly sectionId?: string;
    readonly toIndex: number;
  } & InProperty,
): Promise<MenuDraft> {
  requirePermission(scope, 'hospitality.manage');
  const id = checkId(
    input.id,
    input.part === 'menu' ? MENU_NOT_FOUND : input.part === 'section' ? SECTION_NOT_FOUND : ITEM_NOT_FOUND,
  );
  return edit(scope, input, `menu.${input.part}_moved`, { id }, async (tx, _by, propertyId) => {
    const ws = scope.workspaceId;
    let order: string[];
    if (input.part === 'menu') {
      const rows = await tx
        .select({ id: menus.id })
        .from(menus)
        .where(and(eq(menus.workspaceId, ws), eq(menus.propertyId, propertyId)))
        .orderBy(asc(menus.position), asc(menus.id));
      order = rows.map((row) => row.id);
    } else if (input.part === 'section') {
      const section = await sectionRow(tx, ws, propertyId, id);
      if (section === undefined) throw refuse('NOT_FOUND', SECTION_NOT_FOUND);
      const rows = await tx
        .select({ id: menuSections.id })
        .from(menuSections)
        .where(
          and(
            eq(menuSections.workspaceId, ws),
            eq(menuSections.menuId, section.menuId),
            section.parentId === null ? isNull(menuSections.parentId) : eq(menuSections.parentId, section.parentId),
          ),
        )
        .orderBy(asc(menuSections.position), asc(menuSections.id));
      order = rows.map((row) => row.id);
    } else {
      const sectionId = checkId(input.sectionId ?? '', SECTION_NOT_FOUND);
      if ((await sectionRow(tx, ws, propertyId, sectionId)) === undefined) throw refuse('NOT_FOUND', SECTION_NOT_FOUND);
      const rows = await tx
        .select({ id: menuPlacements.itemId })
        .from(menuPlacements)
        .where(and(eq(menuPlacements.workspaceId, ws), eq(menuPlacements.sectionId, sectionId)))
        .orderBy(asc(menuPlacements.position), asc(menuPlacements.itemId));
      order = rows.map((row) => row.id);
    }
    if (!order.includes(id)) {
      throw refuse(
        'NOT_FOUND',
        input.part === 'menu' ? MENU_NOT_FOUND : input.part === 'section' ? SECTION_NOT_FOUND : ITEM_NOT_FOUND,
      );
    }
    const rest = order.filter((each) => each !== id);
    rest.splice(Math.min(input.toIndex, rest.length), 0, id);
    for (const [position, each] of rest.entries()) {
      if (input.part === 'menu') {
        await tx
          .update(menus)
          .set({ position })
          .where(and(eq(menus.workspaceId, ws), eq(menus.id, each)));
      } else if (input.part === 'section') {
        await tx
          .update(menuSections)
          .set({ position })
          .where(and(eq(menuSections.workspaceId, ws), eq(menuSections.id, each)));
      } else {
        await tx
          .update(menuPlacements)
          .set({ position })
          .where(
            and(
              eq(menuPlacements.workspaceId, ws),
              eq(menuPlacements.sectionId, (input.sectionId ?? '').toLowerCase()),
              eq(menuPlacements.itemId, each),
            ),
          );
      }
    }
  });
}

/** Adds an option group or changes one, whole (AC-6523): its options kept by id, the rest new. Up to 200. */
export async function saveOptionGroup(
  scope: EngineScope,
  input: {
    readonly id: string;
    readonly name: string;
    readonly rule: 'one' | 'up_to' | 'any';
    readonly min?: number;
    readonly max?: number;
    readonly options: readonly { readonly id?: string; readonly name: string; readonly priceDeltaMinor: number }[];
  } & InProperty,
): Promise<MenuDraft> {
  requirePermission(scope, 'hospitality.manage');
  const id = checkId(input.id, GROUP_NOT_FOUND);
  return edit(scope, input, 'menu.group_saved', { groupId: id }, async (tx, _by, propertyId) => {
    const ws = scope.workspaceId;
    const fields = {
      name: input.name,
      rule: input.rule,
      min: input.min ?? 0,
      max: input.rule === 'up_to' ? (input.max ?? 1) : null,
    };
    const changed = await tx
      .update(menuOptionGroups)
      .set({ ...fields, updatedAt: sql`now()` })
      .where(
        and(
          eq(menuOptionGroups.workspaceId, ws),
          eq(menuOptionGroups.propertyId, propertyId),
          eq(menuOptionGroups.id, id),
        ),
      )
      .returning({ id: menuOptionGroups.id });
    if (changed.length === 0) {
      const [counted] = await tx
        .select({ n: count() })
        .from(menuOptionGroups)
        .where(and(eq(menuOptionGroups.workspaceId, ws), eq(menuOptionGroups.propertyId, propertyId)));
      if ((counted?.n ?? 0) >= L.groups) {
        throw refuse('LIMIT_REACHED', `A business takes up to ${String(L.groups)} option groups.`);
      }
      const inserted = await tx
        .insert(menuOptionGroups)
        .values({ workspaceId: ws, id, propertyId, ...fields })
        .onConflictDoNothing({ target: [menuOptionGroups.workspaceId, menuOptionGroups.id] })
        .returning({ id: menuOptionGroups.id });
      if (inserted.length === 0) throw refuse('NOT_FOUND', GROUP_NOT_FOUND);
    }
    const own = await tx
      .select({ id: menuOptions.id })
      .from(menuOptions)
      .where(and(eq(menuOptions.workspaceId, ws), eq(menuOptions.groupId, id)));
    const ownIds = new Set(own.map((row) => row.id));
    await tx.delete(menuOptions).where(and(eq(menuOptions.workspaceId, ws), eq(menuOptions.groupId, id)));
    await tx.insert(menuOptions).values(
      input.options.map((option, position) => ({
        workspaceId: ws,
        ...(option.id !== undefined && ownIds.has(option.id.toLowerCase()) ? { id: option.id.toLowerCase() } : {}),
        groupId: id,
        name: option.name,
        priceDeltaMinor: option.priceDeltaMinor,
        position,
      })),
    );
  });
}

/** Deletes an option group from every item that offers it. */
export async function deleteOptionGroup(
  scope: EngineScope,
  input: { readonly groupId: string } & InProperty,
): Promise<MenuDraft> {
  requirePermission(scope, 'hospitality.manage');
  const id = checkId(input.groupId, GROUP_NOT_FOUND);
  return edit(scope, input, 'menu.group_deleted', { groupId: id }, async (tx, _by, propertyId) => {
    const gone = await tx
      .delete(menuOptionGroups)
      .where(
        and(
          eq(menuOptionGroups.workspaceId, scope.workspaceId),
          eq(menuOptionGroups.propertyId, propertyId),
          eq(menuOptionGroups.id, id),
        ),
      )
      .returning({ id: menuOptionGroups.id });
    if (gone.length === 0) throw refuse('NOT_FOUND', GROUP_NOT_FOUND);
  });
}

/**
 * Sold out on or off (AC-6526): live at once, never a draft change, so the floor can 86 a dish mid service. Manage
 * hospitality or Run service. Answers the draft and the places to purge.
 */
export async function setItemSoldOut(
  scope: EngineScope,
  input: { readonly itemId: string; readonly soldOut: boolean } & InProperty,
): Promise<{ readonly draft: MenuDraft; readonly placeIds: readonly string[] }> {
  requireMenuReader(scope);
  hospitalityMember(scope);
  const id = checkId(input.itemId, ITEM_NOT_FOUND);
  return inWorkspace(scope, async (tx) => {
    const ws = scope.workspaceId;
    await requireApp(tx, ws, 'menu');
    const property = await currentProperty(tx, ws, input.propertyId);
    const changed = await tx
      .update(menuItems)
      .set({ soldOut: input.soldOut, soldOutAt: input.soldOut ? sql`now()` : null })
      .where(and(eq(menuItems.workspaceId, ws), eq(menuItems.propertyId, property.id), eq(menuItems.id, id)))
      .returning({ id: menuItems.id });
    if (changed.length === 0) throw refuse('NOT_FOUND', ITEM_NOT_FOUND);
    await auditSetup(tx, scope, input.soldOut ? 'menu.sold_out' : 'menu.back_on', { itemId: id });
    return {
      draft: await readDraft(tx, scope, property),
      placeIds: (await placesOf(tx, ws, property.id)).map((place) => place.id),
    };
  });
}

/**
 * Live or Hidden (spec 0065, H1, after checklabs' menu switch): hides every guest menu of the business for now, or
 * shows it again. Live at once and never a draft change, so the count of changes and the published rows stay as they
 * are. Manage hospitality; refused `CONFLICT` before the business's first Publish, since there is nothing live to
 * hide. Answers the draft and the places to purge.
 */
export async function setMenuHidden(
  scope: EngineScope,
  input: { readonly hidden: boolean } & InProperty,
): Promise<{ readonly draft: MenuDraft; readonly placeIds: readonly string[] }> {
  requirePermission(scope, 'hospitality.manage');
  hospitalityMember(scope);
  return inWorkspace(scope, async (tx) => {
    const ws = scope.workspaceId;
    await requireApp(tx, ws, 'menu');
    const property = await currentProperty(tx, ws, input.propertyId);
    await lockKey(tx, `menu:${ws}`);
    const changed = await tx
      .update(menuDrafts)
      .set({ hidden: input.hidden, updatedAt: sql`now()` })
      .where(
        and(
          eq(menuDrafts.workspaceId, ws),
          eq(menuDrafts.propertyId, property.id),
          sql`${menuDrafts.publishedAt} is not null`,
        ),
      )
      .returning({ workspaceId: menuDrafts.workspaceId });
    if (changed.length === 0) throw refuse('CONFLICT', 'Publish the menu first, then you can hide it.');
    await auditSetup(tx, scope, input.hidden ? 'menu.hidden' : 'menu.shown', { propertyId: property.id });
    return {
      draft: await readDraft(tx, scope, property),
      placeIds: (await placesOf(tx, ws, property.id)).map((place) => place.id),
    };
  });
}

/**
 * Saves the guest look (spec 0065, AC-6570 as amended): the business's one look for its guest menu, reservation page
 * and business page. Live at once, with no Publish and no draft change, so an owner sees it as they save it. The look is
 * parsed again here, whichever door it came by, since it ends up in CSS on a public page; a cover must be a stored photo
 * of this workspace at that version. Answers the draft and every place, for the api's purge.
 */
export async function saveMenuLook(
  scope: EngineScope,
  input: { readonly look: unknown } & InProperty,
): Promise<{
  readonly draft: MenuDraft;
  readonly placeIds: readonly string[];
  /** A cover this save let go of: its stored files, for the api to remove. */
  readonly removedPaths: readonly string[];
}> {
  requirePermission(scope, 'hospitality.manage');
  const by = hospitalityMember(scope);
  const parsed = MenuLook.safeParse(input.look);
  if (!parsed.success) throw inputInvalid('look', 'That look can’t be saved. Choose from the options on the page.');
  const look = parsed.data;
  return inWorkspace(scope, async (tx) => {
    const ws = scope.workspaceId;
    await requireApp(tx, ws, 'menu');
    const property = await currentProperty(tx, ws, input.propertyId);
    await lockKey(tx, `menu:${ws}`);
    if (look.cover !== undefined) {
      // A cover is one of the business's own photos.
      const [photo] = await tx
        .select({ id: menuPhotos.id })
        .from(menuPhotos)
        .where(
          and(
            eq(menuPhotos.workspaceId, ws),
            eq(menuPhotos.propertyId, property.id),
            eq(menuPhotos.id, look.cover.id),
            eq(menuPhotos.version, look.cover.version),
          ),
        );
      if (photo === undefined) throw refuse('NOT_FOUND', 'That cover photo doesn’t exist.');
    }
    const wasCover = await savedCoverId(tx, ws, property.id);
    const changed = await tx
      .update(properties)
      .set({ look, updatedAt: sql`now()`, updatedByMemberId: by })
      .where(and(eq(properties.workspaceId, ws), eq(properties.id, property.id), isNotNull(properties.name)))
      .returning({ workspaceId: properties.workspaceId });
    if (changed.length === 0) throw refuse('CONFLICT', 'Add your business first, then you can design its menu.');
    // A cover has a photo row of its own and is live with no Publish, so one replaced or taken off goes as this saves:
    // a look can change many times between Publishes, and each row counts towards the workspace's photos.
    const removedPaths =
      wasCover === undefined || wasCover === look.cover?.id
        ? []
        : (
            await tx
              .delete(menuPhotos)
              .where(
                and(
                  eq(menuPhotos.workspaceId, ws),
                  eq(menuPhotos.propertyId, property.id),
                  eq(menuPhotos.id, wasCover),
                  sql`not exists (select 1 from ${menuItems} where ${menuItems.workspaceId} = ${ws} and ${menuItems.photoId} = ${wasCover}::uuid)`,
                ),
              )
              .returning({ largePath: menuPhotos.largePath, smallPath: menuPhotos.smallPath })
          ).flatMap((row) => [row.largePath, row.smallPath]);
    await auditSetup(tx, scope, 'menu.look_saved', {
      propertyId: property.id,
      ...(look.cover === undefined ? {} : { photoId: look.cover.id }),
    });
    return {
      draft: await readDraft(tx, scope, property),
      placeIds: (await placesOf(tx, ws, property.id)).map((place) => place.id),
      removedPaths,
    };
  });
}

/**
 * The cover a business's look names, read from the raw document rather than through its schema: a row the schema no
 * longer takes wears the default look, but still names a photo, which nothing may delete for that.
 */
async function savedCoverId(tx: WorkspaceTx, workspaceId: string, propertyId: string): Promise<string | undefined> {
  const [row] = await tx
    .select({ id: sql<string | null>`${properties.look} -> 'cover' ->> 'id'` })
    .from(properties)
    .where(and(eq(properties.workspaceId, workspaceId), eq(properties.id, propertyId)));
  const id = row?.id ?? undefined;
  return id !== undefined && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
    ? id
    : undefined;
}

/** Refuses a new photo past the business's 1,000 (AC-6518, AC-6527). */
async function requirePhotoRoom(tx: WorkspaceTx, workspaceId: string, propertyId: string): Promise<void> {
  const [counted] = await tx
    .select({ n: count() })
    .from(menuPhotos)
    .where(and(eq(menuPhotos.workspaceId, workspaceId), eq(menuPhotos.propertyId, propertyId)));
  if ((counted?.n ?? 0) >= L.photos) {
    throw refuse('LIMIT_REACHED', `A business takes up to ${String(L.photos)} photos.`);
  }
}

/**
 * Keeps a new cover photo's row, up to the business's photos (AC-6527), and answers what the look names. Nothing shows
 * it until a saved look does; a photo no look or item names goes with the next Publish or Discard.
 */
export async function addMenuCover(
  scope: EngineScope,
  input: { readonly photo: MenuPhotoFile } & InProperty,
): Promise<{ readonly id: string; readonly version: string }> {
  requirePermission(scope, 'hospitality.manage');
  const by = hospitalityMember(scope);
  return inWorkspace(scope, async (tx) => {
    const ws = scope.workspaceId;
    await requireApp(tx, ws, 'menu');
    const property = await currentProperty(tx, ws, input.propertyId);
    await lockKey(tx, `menu:${ws}`);
    await requirePhotoRoom(tx, ws, property.id);
    const [photo] = await tx
      .insert(menuPhotos)
      .values({ workspaceId: ws, propertyId: property.id, ...input.photo, createdByMemberId: by })
      .returning({ id: menuPhotos.id, version: menuPhotos.version });
    if (photo === undefined) throw new Error('The photo was not stored.');
    await auditSetup(tx, scope, 'menu.cover_added', { photoId: photo.id, propertyId: property.id });
    return photo;
  });
}

/**
 * A draft photo's stored file at one width, for the editor and its preview (the guest page serves only what a
 * snapshot shows). Manage hospitality or Run service, while Menu is installed; anything else is absent.
 */
export async function readMenuPhotoFile(
  scope: EngineScope,
  input: { readonly photoId: string; readonly size: 'large' | 'small' },
): Promise<{ readonly path: string; readonly type: string; readonly version: string } | undefined> {
  requireMenuReader(scope);
  const photoId = checkId(input.photoId, 'That photo doesn’t exist.');
  return inWorkspace(scope, async (tx) => {
    await requireApp(tx, scope.workspaceId, 'menu');
    const [row] = await tx
      .select({
        largePath: menuPhotos.largePath,
        smallPath: menuPhotos.smallPath,
        type: menuPhotos.type,
        version: menuPhotos.version,
      })
      .from(menuPhotos)
      .where(and(eq(menuPhotos.workspaceId, scope.workspaceId), eq(menuPhotos.id, photoId)));
    if (row === undefined) return undefined;
    return { path: input.size === 'large' ? row.largePath : row.smallPath, type: row.type, version: row.version };
  });
}

/** Refuses anyone without Manage hospitality before a photo's bytes are read (the upload route asks it first). */
export function requireMenuEditor(scope: EngineScope): void {
  requirePermission(scope, 'hospitality.manage');
}

/** Where a workspace's menu photos are kept in the private store: one folder per workspace, nothing typed in it. */
export function menuPhotoFolder(workspaceId: string): string {
  return `menu-photos/${workspaceId}/`;
}

/** A stored photo's two paths and checked type (AC-6527), as the api's upload made them. */
export interface MenuPhotoFile {
  readonly largePath: string;
  readonly smallPath: string;
  readonly type: 'image/webp' | 'image/jpeg' | 'image/png';
  readonly version: string;
}

/**
 * Gives an item a new photo (AC-6527): one stored at both widths, up to 1,000 a workspace. A draft change; the
 * photo it replaces is kept until Publish or Discard no longer needs it.
 */
export async function attachMenuPhoto(
  scope: EngineScope,
  input: { readonly itemId: string; readonly photo: MenuPhotoFile } & InProperty,
): Promise<MenuDraft> {
  requirePermission(scope, 'hospitality.manage');
  const itemId = checkId(input.itemId, ITEM_NOT_FOUND);
  return edit(scope, input, 'menu.photo_added', { itemId }, async (tx, by, propertyId) => {
    const ws = scope.workspaceId;
    if ((await itemOf(tx, ws, propertyId, itemId)) === undefined) throw refuse('NOT_FOUND', ITEM_NOT_FOUND);
    await requirePhotoRoom(tx, ws, propertyId);
    const [photo] = await tx
      .insert(menuPhotos)
      .values({ workspaceId: ws, propertyId, ...input.photo, createdByMemberId: by })
      .returning({ id: menuPhotos.id });
    if (photo === undefined) throw new Error('The photo was not stored.');
    await tx
      .update(menuItems)
      .set({ photoId: photo.id, updatedByMemberId: by, updatedAt: sql`now()` })
      .where(and(eq(menuItems.workspaceId, ws), eq(menuItems.propertyId, propertyId), eq(menuItems.id, itemId)));
  });
}

/** Takes an item's photo off (a draft change). */
export async function removeMenuPhoto(
  scope: EngineScope,
  input: { readonly itemId: string } & InProperty,
): Promise<MenuDraft> {
  requirePermission(scope, 'hospitality.manage');
  const itemId = checkId(input.itemId, ITEM_NOT_FOUND);
  return edit(scope, input, 'menu.photo_removed', { itemId }, async (tx, _by, propertyId) => {
    const changed = await tx
      .update(menuItems)
      .set({ photoId: null, updatedAt: sql`now()` })
      .where(
        and(
          eq(menuItems.workspaceId, scope.workspaceId),
          eq(menuItems.propertyId, propertyId),
          eq(menuItems.id, itemId),
        ),
      )
      .returning({ id: menuItems.id });
    if (changed.length === 0) throw refuse('NOT_FOUND', ITEM_NOT_FOUND);
  });
}

/**
 * Deletes the business's photos neither its draft, what it last published nor its saved look names (the first two are
 * the same set right after Publish or Discard), answering their stored paths for the api to remove from the store.
 */
async function dropUnusedPhotos(tx: WorkspaceTx, workspaceId: string, propertyId: string): Promise<readonly string[]> {
  const used = tx
    .select({ id: menuItems.photoId })
    .from(menuItems)
    .where(and(eq(menuItems.workspaceId, workspaceId), sql`${menuItems.photoId} is not null`));
  const coverId = await savedCoverId(tx, workspaceId, propertyId);
  const gone = await tx
    .delete(menuPhotos)
    .where(
      and(
        eq(menuPhotos.workspaceId, workspaceId),
        eq(menuPhotos.propertyId, propertyId),
        notInArray(menuPhotos.id, sql`(${used})`),
        ...(coverId === undefined ? [] : [ne(menuPhotos.id, coverId)]),
      ),
    )
    .returning({ largePath: menuPhotos.largePath, smallPath: menuPhotos.smallPath });
  return gone.flatMap((row) => [row.largePath, row.smallPath]);
}

/**
 * Refuses a menu Publish would show broken (owner rule, 4 Nov 2026): nothing placed in any menu at all, or a placed
 * dish with no price, no sizes and no price note. The refusal names the dish on `items.<id>`, so the editor links it.
 */
export function publishProblem(rows: MenuRows): void {
  const placed = new Set(rows.placements.map((row) => row.itemId));
  if (placed.size === 0) throw refuse('CONFIG_INVALID', 'Add a dish to a menu before publishing.');
  // A menu shown at no place is never seen: at least one dish must sit in a menu a place shows.
  const shown = new Set(rows.menuPlaces.map((row) => row.menuId));
  const shownSections = new Set(rows.sections.filter((row) => shown.has(row.menuId)).map((row) => row.id));
  if (!rows.placements.some((row) => shownSections.has(row.sectionId))) {
    const menu = rows.menus.find((row) => !shown.has(row.id));
    throw refuseOn(
      'CONFIG_INVALID',
      `${menu?.name ?? 'Your menu'} shows nowhere. Pick where it shows, then publish.`,
      menu === undefined ? 'menus' : `menus.${menu.id}`,
    );
  }
  const sized = new Set(rows.sizes.map((row) => row.itemId));
  const unpriced = rows.items.find(
    (item) => placed.has(item.id) && item.priceMinor === null && item.priceNote === null && !sized.has(item.id),
  );
  if (unpriced !== undefined) {
    throw refuseOn('CONFIG_INVALID', `Give ${unpriced.name} a price, then publish.`, `items.${unpriced.id}`);
  }
}

/** What Publish and Discard answer: the draft, the places whose guest menus changed, and photo files to remove. */
export interface MenuPublishResult {
  readonly draft: MenuDraft;
  readonly placeIds: readonly string[];
  readonly removedPaths: readonly string[];
}

/**
 * Publish (AC-6525): one versioned snapshot per place of the business, of every menu shown there, the business's draft
 * kept whole so Discard can go back to it, and its count of changes back to 0. Each place keeps its last ten versions.
 */
export async function publishMenus(scope: EngineScope, where: InProperty = {}): Promise<MenuPublishResult> {
  requirePermission(scope, 'hospitality.manage');
  const by = hospitalityMember(scope);
  return inWorkspace(scope, async (tx) => {
    const ws = scope.workspaceId;
    await requireApp(tx, ws, 'menu');
    const property = await currentProperty(tx, ws, where.propertyId);
    await lockKey(tx, `menu:${ws}`);
    const rows = await readMenuRows(tx, ws, property.id);
    publishProblem(rows);
    const currency = currencyOf(property);
    const photos = await photoVersions(tx, ws, property.id);
    const placeList = await placesOf(tx, ws, property.id);
    for (const place of placeList) {
      const [latest] = await tx
        .select({ version: menuVersions.version })
        .from(menuVersions)
        .where(and(eq(menuVersions.workspaceId, ws), eq(menuVersions.placeId, place.id)))
        .orderBy(desc(menuVersions.version))
        .limit(1);
      const version = (latest?.version ?? 0) + 1;
      await tx.insert(menuVersions).values({
        workspaceId: ws,
        placeId: place.id,
        version,
        snapshot: snapshotFor(rows, place.id, currency, photos),
        publishedByMemberId: by,
      });
      await tx
        .delete(menuVersions)
        .where(
          and(
            eq(menuVersions.workspaceId, ws),
            eq(menuVersions.placeId, place.id),
            sql`${menuVersions.version} <= ${version - VERSIONS_KEPT}`,
          ),
        );
    }
    const published = { changes: 0, published: rows, publishedAt: sql`now()`, publishedByMemberId: by };
    await tx
      .insert(menuDrafts)
      .values({ workspaceId: ws, propertyId: property.id, ...published })
      .onConflictDoUpdate({
        target: [menuDrafts.workspaceId, menuDrafts.propertyId],
        set: { ...published, updatedAt: sql`now()` },
      });
    const removedPaths = await dropUnusedPhotos(tx, ws, property.id);
    await auditSetup(tx, scope, 'menu.published', { propertyId: property.id });
    return {
      draft: await readDraft(tx, scope, property),
      placeIds: placeList.map((place) => place.id),
      removedPaths,
    };
  });
}

/**
 * Discard (AC-6525): the business's draft goes back to what it last published, Sold out untouched. Refused `CONFLICT`
 * before its first Publish, since there is nothing to go back to.
 */
export async function discardMenuDraft(scope: EngineScope, where: InProperty = {}): Promise<MenuPublishResult> {
  requirePermission(scope, 'hospitality.manage');
  hospitalityMember(scope);
  return inWorkspace(scope, async (tx) => {
    const ws = scope.workspaceId;
    await requireApp(tx, ws, 'menu');
    const property = await currentProperty(tx, ws, where.propertyId);
    await lockKey(tx, `menu:${ws}`);
    const ownDraft = and(eq(menuDrafts.workspaceId, ws), eq(menuDrafts.propertyId, property.id));
    const [state] = await tx.select({ published: menuDrafts.published }).from(menuDrafts).where(ownDraft);
    const kept = parseKeptRows(state?.published);
    if (kept === undefined)
      throw refuse('CONFLICT', 'Nothing has been published yet, so there’s nothing to go back to.');
    const placeIds = new Set((await placesOf(tx, ws, property.id)).map((place) => place.id));
    await restoreMenuRows(tx, ws, property.id, kept, {
      placeIds,
      photoIds: new Set((await photoVersions(tx, ws, property.id)).keys()),
      soldOut: await soldOutIds(tx, ws, property.id),
    });
    await tx
      .update(menuDrafts)
      .set({ changes: 0, updatedAt: sql`now()` })
      .where(ownDraft);
    const removedPaths = await dropUnusedPhotos(tx, ws, property.id);
    await auditSetup(tx, scope, 'menu.discarded', { propertyId: property.id });
    return { draft: await readDraft(tx, scope, property), placeIds: [], removedPaths };
  });
}

/**
 * Duplicate to another business (spec 0065 H7, AC-6591): copies a menu, its sections and the dishes placed in them
 * (with their sizes and option groups) into `toPropertyId`'s draft, as new rows under new ids. The copy keeps its
 * numbers: nothing converts a price, so the screen warns first when the two currencies differ. It shows at no place
 * (the other business picks its own), and its dishes carry no photo (a photo's files are one business's). `id` is the
 * caller's, so a retry makes one copy. Counts against the other business's limits; answers its draft.
 */
export async function duplicateMenu(
  scope: EngineScope,
  input: { readonly menuId: string; readonly toPropertyId: string; readonly id: string } & InProperty,
): Promise<MenuDraft> {
  requirePermission(scope, 'hospitality.manage');
  const by = hospitalityMember(scope);
  const menuId = checkId(input.menuId, MENU_NOT_FOUND);
  const id = checkId(input.id, MENU_NOT_FOUND);
  return inWorkspace(scope, async (tx) => {
    const ws = scope.workspaceId;
    await requireApp(tx, ws, 'menu');
    const from = await currentProperty(tx, ws, input.propertyId);
    const to = await currentProperty(tx, ws, input.toPropertyId);
    if (from.id === to.id) throw inputInvalid('toPropertyId', 'Pick another business.');
    await lockKey(tx, `menu:${ws}`);
    // A retry: the copy is already there. An id another menu holds anywhere else answers as a menu that isn't there.
    const [holder] = await tx
      .select({ propertyId: menus.propertyId })
      .from(menus)
      .where(and(eq(menus.workspaceId, ws), eq(menus.id, id)));
    if (holder !== undefined) {
      if (holder.propertyId === to.id) return readDraft(tx, scope, to);
      throw refuse('NOT_FOUND', MENU_NOT_FOUND);
    }
    const rows = await readMenuRows(tx, ws, from.id);
    const menu = rows.menus.find((row) => row.id === menuId);
    if (menu === undefined) throw refuse('NOT_FOUND', MENU_NOT_FOUND);
    const sections = rows.sections.filter((row) => row.menuId === menuId);
    const sectionIds = new Set(sections.map((row) => row.id));
    const placements = rows.placements.filter((row) => sectionIds.has(row.sectionId));
    const itemIds = new Set(placements.map((row) => row.itemId));
    const items = rows.items.filter((row) => itemIds.has(row.id));
    const itemGroups = rows.itemGroups.filter((row) => itemIds.has(row.itemId));
    const groupIds = new Set(itemGroups.map((row) => row.groupId));
    const groups = rows.groups.filter((row) => groupIds.has(row.id));
    const counts = await tx.execute<{ menus: number; items: number; groups: number }>(sql`
      select
        (select count(*)::int from menus where workspace_id = ${ws}::uuid and property_id = ${to.id}::uuid) as menus,
        (select count(*)::int from menu_items where workspace_id = ${ws}::uuid and property_id = ${to.id}::uuid) as items,
        (select count(*)::int from menu_option_groups where workspace_id = ${ws}::uuid and property_id = ${to.id}::uuid)
          as groups`);
    const held = counts.rows[0] ?? { menus: 0, items: 0, groups: 0 };
    if (held.menus >= L.menus) throw refuse('LIMIT_REACHED', `A business takes up to ${String(L.menus)} menus.`);
    if (held.items + items.length > L.items) {
      throw refuse('LIMIT_REACHED', `A business takes up to ${String(L.items)} dishes.`);
    }
    if (held.groups + groups.length > L.groups) {
      throw refuse('LIMIT_REACHED', `A business takes up to ${String(L.groups)} option groups.`);
    }
    // New ids for everything copied, so the two businesses never share a row.
    const fresh = new Map<string, string>();
    const idFor = (old: string): string => {
      let next = fresh.get(old);
      if (next === undefined) {
        next = newId();
        fresh.set(old, next);
      }
      return next;
    };
    const ownOf = (old: string): string => fresh.get(old) ?? old;
    await tx.insert(menus).values({
      workspaceId: ws,
      id,
      propertyId: to.id,
      name: menu.name,
      note: menu.note,
      serving: menu.serving,
      taxRate: menu.taxRate ?? 0,
      serviceRate: menu.serviceRate ?? 0,
      position: held.menus,
      createdByMemberId: by,
      updatedByMemberId: by,
    });
    for (const level of [
      sections.filter((row) => row.parentId === null),
      sections.filter((row) => row.parentId !== null),
    ]) {
      if (level.length === 0) continue;
      await tx.insert(menuSections).values(
        level.map((row) => ({
          workspaceId: ws,
          id: idFor(row.id),
          menuId: id,
          parentId: row.parentId === null ? null : ownOf(row.parentId),
          name: row.name,
          description: row.description,
          layout: row.layout,
          serving: row.serving,
          position: row.position,
        })),
      );
    }
    if (groups.length > 0) {
      await tx.insert(menuOptionGroups).values(
        groups.map((row) => ({
          workspaceId: ws,
          id: idFor(row.id),
          propertyId: to.id,
          name: row.name,
          rule: row.rule,
          min: row.min ?? 0,
          max: row.max,
        })),
      );
      const options = rows.options.filter((row) => groupIds.has(row.groupId));
      if (options.length > 0) {
        await tx.insert(menuOptions).values(
          options.map((row) => ({
            workspaceId: ws,
            groupId: ownOf(row.groupId),
            name: row.name,
            priceDeltaMinor: row.priceDeltaMinor,
            position: row.position,
          })),
        );
      }
    }
    for (let start = 0; start < items.length; start += 500) {
      await tx.insert(menuItems).values(
        items.slice(start, start + 500).map((row) => ({
          workspaceId: ws,
          id: idFor(row.id),
          propertyId: to.id,
          name: row.name,
          description: row.description,
          priceMinor: row.priceMinor,
          priceNote: row.priceNote,
          diet: [...row.diet],
          allergens: row.allergens,
          kcal: row.kcal,
          featured: row.featured,
          createdByMemberId: by,
          updatedByMemberId: by,
        })),
      );
    }
    const sizes = rows.sizes.filter((row) => itemIds.has(row.itemId));
    for (const [table, list] of [
      [
        menuItemSizes,
        sizes.map((row) => ({
          workspaceId: ws,
          itemId: ownOf(row.itemId),
          name: row.name,
          priceMinor: row.priceMinor,
          position: row.position,
        })),
      ],
      [
        menuItemOptionGroups,
        itemGroups.map((row) => ({
          workspaceId: ws,
          itemId: ownOf(row.itemId),
          groupId: ownOf(row.groupId),
          position: row.position,
        })),
      ],
      [
        menuPlacements,
        placements.map((row) => ({
          workspaceId: ws,
          sectionId: ownOf(row.sectionId),
          itemId: ownOf(row.itemId),
          position: row.position,
        })),
      ],
    ] as const) {
      for (let start = 0; start < list.length; start += 1000) {
        await tx.insert(table).values(list.slice(start, start + 1000) as never[]);
      }
    }
    await noteChange(tx, ws, to.id);
    // Filed under the business that changed, as every draft edit is; the source beside it.
    await auditSetup(tx, scope, 'menu.duplicated', { menuId, copyId: id, propertyId: to.id, fromPropertyId: from.id });
    return readDraft(tx, scope, to);
  });
}

/** The ids of every place of every business, for purging every guest menu at once (a profile change, removing Menu). */
export async function menuPlaceIds(scope: EngineScope): Promise<readonly string[]> {
  hospitalityMember(scope);
  return inWorkspace(scope, async (tx) => {
    const rows = await tx.select({ id: places.id }).from(places).where(eq(places.workspaceId, scope.workspaceId));
    return rows.map((place) => place.id);
  });
}
