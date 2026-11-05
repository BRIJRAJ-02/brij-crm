// The Menu app's editor (spec 0065, H1, AC-6520 to AC-6527): menus, sections one level deep, items placed in
// sections, sizes, shared option groups, photos, Publish and Discard, and Sold out. `hospitality.manage` edits and
// publishes, checked before any input is read, and only while Menu is installed (`requireApp`). Every edit saves into
// the draft and counts one change (AC-6525); the guest page reads only what Publish froze per place
// (`menu_versions`), with Sold out read live over it (AC-6526). Every write takes the workspace's menu lock, so two
// editors never pass a limit or each other's positions, and answers the whole draft.
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
import { and, asc, count, desc, eq, inArray, isNull, ne, notInArray, sql } from 'drizzle-orm';
import { requirePermission } from '../access/check.ts';
import type { EngineScope } from '../access/mint.ts';
import { can } from '../access/policy.ts';
import { inWorkspace } from '../access/run.ts';
import { lockKey } from '../booking/locks.ts';
import { checkId } from '../engine/ids.ts';
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
  workspaces,
  businessProfiles,
} = schema;

const MENU_NOT_FOUND = 'That menu doesn’t exist.';
const SECTION_NOT_FOUND = 'That section doesn’t exist.';
const ITEM_NOT_FOUND = 'That dish doesn’t exist.';
const GROUP_NOT_FOUND = 'That option group doesn’t exist.';
const L = MENU_LIMITS;

/** How many published versions a place keeps. */
const VERSIONS_KEPT = 10;

/** The workspace's currency, or US dollars until one is set (the first install's card sets it). */
async function currencyOf(tx: WorkspaceTx, workspaceId: string): Promise<string> {
  const [row] = await tx
    .select({ currency: workspaces.currency })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId));
  return row?.currency ?? 'USD';
}

/** The places as the Menus screen names them, in order. */
async function placesOf(tx: WorkspaceTx, workspaceId: string): Promise<MenuPlace[]> {
  return tx
    .select({
      id: places.id,
      name: places.name,
      menuKey: places.menuKey,
      timeZone: places.timeZone,
      locale: places.locale,
    })
    .from(places)
    .where(eq(places.workspaceId, workspaceId))
    .orderBy(asc(places.position), asc(places.id));
}

/** The draft as the reader sees it, read in the caller's transaction. */
async function readDraft(tx: WorkspaceTx, scope: EngineScope): Promise<MenuDraft> {
  const workspaceId = scope.workspaceId;
  const rows = await readMenuRows(tx, workspaceId);
  const [state] = await tx
    .select({ changes: menuDrafts.changes, publishedAt: menuDrafts.publishedAt, hidden: menuDrafts.hidden })
    .from(menuDrafts)
    .where(eq(menuDrafts.workspaceId, workspaceId));
  const brand = await readMenuBrandIn(tx, workspaceId);
  return draftOf(rows, {
    currency: await currencyOf(tx, workspaceId),
    look: brand.menuLook ?? DEFAULT_MENU_LOOK,
    lookAccents: {
      ...(brand.accents.accent === undefined ? {} : { accent: brand.accents.accent }),
      ...(brand.accents.accentDark === undefined ? {} : { accentDark: brand.accents.accentDark }),
    },
    places: await placesOf(tx, workspaceId),
    changes: state?.changes ?? 0,
    ...(state?.publishedAt === null || state?.publishedAt === undefined
      ? {}
      : { publishedAt: new Date(state.publishedAt).toISOString() }),
    hidden: state?.hidden ?? false,
    soldOut: await soldOutIds(tx, workspaceId),
    photos: await photoVersions(tx, workspaceId),
    canEdit: can(scope.access, 'hospitality.manage'),
  });
}

/** Counts one change waiting for Publish (AC-6525). */
async function noteChange(tx: WorkspaceTx, workspaceId: string): Promise<void> {
  await tx
    .insert(menuDrafts)
    .values({ workspaceId, changes: 1 })
    .onConflictDoUpdate({
      target: menuDrafts.workspaceId,
      set: { changes: sql`${menuDrafts.changes} + 1`, updatedAt: sql`now()` },
    });
}

/** One draft edit: the permission, the app, the lock, the change, its count and audit row, then the whole draft. */
async function edit(
  scope: EngineScope,
  what: string,
  ids: Readonly<Record<string, string>>,
  change: (tx: WorkspaceTx, by: string) => Promise<void>,
): Promise<MenuDraft> {
  requirePermission(scope, 'hospitality.manage');
  const by = hospitalityMember(scope);
  return inWorkspace(scope, async (tx) => {
    await requireApp(tx, scope.workspaceId, 'menu');
    await lockKey(tx, `menu:${scope.workspaceId}`);
    await change(tx, by);
    await noteChange(tx, scope.workspaceId);
    await auditSetup(tx, scope, what, ids);
    return readDraft(tx, scope);
  });
}

/** The Menus screen (AC-6520): the whole draft. Run service reads it too, to flip Sold out (AC-6526). */
export async function readMenuDraft(scope: EngineScope): Promise<MenuDraft> {
  requireMenuReader(scope);
  return inWorkspace(scope, async (tx) => {
    await requireApp(tx, scope.workspaceId, 'menu');
    return readDraft(tx, scope);
  });
}

/**
 * The editor's preview look (spec 0065, H1): the stylesheet guests' menus wear (the saved look with the brand's
 * accent), for any member who reads the Menus screen, so the phone preview draws what guests will see before the
 * first Publish. It names nothing of the draft. It is linked inside the app, so it never takes the app's own face.
 */
export async function readMenuDraftLook(scope: EngineScope): Promise<string> {
  requireMenuReader(scope);
  return inWorkspace(scope, async (tx) => {
    await requireApp(tx, scope.workspaceId, 'menu');
    return menuLookStylesheet(await readMenuBrandIn(tx, scope.workspaceId), { inApp: true });
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
  },
): Promise<MenuDraft> {
  requirePermission(scope, 'hospitality.manage');
  const id = checkId(input.id, MENU_NOT_FOUND);
  return edit(scope, 'menu.saved', { menuId: id }, async (tx, by) => {
    const ws = scope.workspaceId;
    const placeIds = [...new Set(input.placeIds.map((each) => each.toLowerCase()))];
    if (placeIds.length > 0) {
      const found = await tx
        .select({ id: places.id })
        .from(places)
        .where(and(eq(places.workspaceId, ws), inArray(places.id, placeIds)));
      if (found.length !== placeIds.length) throw refuse('NOT_FOUND', 'That place doesn’t exist.');
    }
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
      .where(and(eq(menus.workspaceId, ws), eq(menus.id, id)))
      .returning({ id: menus.id });
    if (changed.length === 0) {
      const [counted] = await tx.select({ n: count() }).from(menus).where(eq(menus.workspaceId, ws));
      const position = counted?.n ?? 0;
      if (position >= L.menus) throw refuse('LIMIT_REACHED', `A workspace takes up to ${String(L.menus)} menus.`);
      await tx.insert(menus).values({
        workspaceId: ws,
        id,
        ...fields,
        position,
        createdByMemberId: by,
        updatedByMemberId: by,
      });
    }
    await tx.delete(menuPlaces).where(and(eq(menuPlaces.workspaceId, ws), eq(menuPlaces.menuId, id)));
    if (placeIds.length > 0) {
      await tx.insert(menuPlaces).values(placeIds.map((placeId) => ({ workspaceId: ws, menuId: id, placeId })));
    }
  });
}

/** Deletes a menu with its sections; its items stay in the library (AC-6524). */
export async function deleteMenu(scope: EngineScope, input: { readonly menuId: string }): Promise<MenuDraft> {
  requirePermission(scope, 'hospitality.manage');
  const id = checkId(input.menuId, MENU_NOT_FOUND);
  return edit(scope, 'menu.deleted', { menuId: id }, async (tx) => {
    const gone = await tx
      .delete(menus)
      .where(and(eq(menus.workspaceId, scope.workspaceId), eq(menus.id, id)))
      .returning({ id: menus.id });
    if (gone.length === 0) throw refuse('NOT_FOUND', MENU_NOT_FOUND);
    await renumber(tx, scope.workspaceId, 'menu');
  });
}

/** A section's row, or NOT_FOUND. */
async function sectionRow(tx: WorkspaceTx, workspaceId: string, id: string) {
  const [row] = await tx
    .select({ id: menuSections.id, menuId: menuSections.menuId, parentId: menuSections.parentId })
    .from(menuSections)
    .where(and(eq(menuSections.workspaceId, workspaceId), eq(menuSections.id, id)));
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
  },
): Promise<MenuDraft> {
  requirePermission(scope, 'hospitality.manage');
  const id = checkId(input.id, SECTION_NOT_FOUND);
  const menuId = checkId(input.menuId, MENU_NOT_FOUND);
  const parentId = input.parentId === undefined ? null : checkId(input.parentId, SECTION_NOT_FOUND);
  return edit(scope, 'menu.section_saved', { menuId, sectionId: id }, async (tx) => {
    const ws = scope.workspaceId;
    const [menu] = await tx
      .select({ id: menus.id })
      .from(menus)
      .where(and(eq(menus.workspaceId, ws), eq(menus.id, menuId)));
    if (menu === undefined) throw refuse('NOT_FOUND', MENU_NOT_FOUND);
    if (parentId !== null) {
      const parent = await sectionRow(tx, ws, parentId);
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
    const existing = await sectionRow(tx, ws, id);
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
export async function deleteSection(scope: EngineScope, input: { readonly sectionId: string }): Promise<MenuDraft> {
  requirePermission(scope, 'hospitality.manage');
  const id = checkId(input.sectionId, SECTION_NOT_FOUND);
  return edit(scope, 'menu.section_deleted', { sectionId: id }, async (tx) => {
    const gone = await tx
      .delete(menuSections)
      .where(and(eq(menuSections.workspaceId, scope.workspaceId), eq(menuSections.id, id)))
      .returning({ menuId: menuSections.menuId });
    const menuId = gone[0]?.menuId;
    if (menuId === undefined) throw refuse('NOT_FOUND', SECTION_NOT_FOUND);
    await renumber(tx, scope.workspaceId, 'section', menuId);
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
  input: { readonly id: string; readonly sectionId?: string; readonly item: ItemFields },
): Promise<MenuDraft> {
  requirePermission(scope, 'hospitality.manage');
  const id = checkId(input.id, ITEM_NOT_FOUND);
  const sectionId = input.sectionId === undefined ? undefined : checkId(input.sectionId, SECTION_NOT_FOUND);
  const { item } = input;
  return edit(scope, 'menu.item_saved', { itemId: id }, async (tx, by) => {
    const ws = scope.workspaceId;
    const groupIds = item.groupIds.map((each) => each.toLowerCase());
    if (groupIds.length > 0) {
      const found = await tx
        .select({ id: menuOptionGroups.id })
        .from(menuOptionGroups)
        .where(and(eq(menuOptionGroups.workspaceId, ws), inArray(menuOptionGroups.id, groupIds)));
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
      .where(and(eq(menuItems.workspaceId, ws), eq(menuItems.id, id)))
      .returning({ id: menuItems.id });
    if (changed.length === 0) {
      const [counted] = await tx.select({ n: count() }).from(menuItems).where(eq(menuItems.workspaceId, ws));
      if ((counted?.n ?? 0) >= L.items)
        throw refuse('LIMIT_REACHED', `A workspace takes up to ${String(L.items)} dishes.`);
      await tx.insert(menuItems).values({ workspaceId: ws, id, ...fields, createdByMemberId: by });
      if (sectionId !== undefined) {
        const section = await sectionRow(tx, ws, sectionId);
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
export async function deleteItem(scope: EngineScope, input: { readonly itemId: string }): Promise<MenuDraft> {
  requirePermission(scope, 'hospitality.manage');
  const id = checkId(input.itemId, ITEM_NOT_FOUND);
  return edit(scope, 'menu.item_deleted', { itemId: id }, async (tx) => {
    const gone = await tx
      .delete(menuItems)
      .where(and(eq(menuItems.workspaceId, scope.workspaceId), eq(menuItems.id, id)))
      .returning({ id: menuItems.id });
    if (gone.length === 0) throw refuse('NOT_FOUND', ITEM_NOT_FOUND);
  });
}

/** Places an item in another section (AC-6524), or takes it out of one; an item in no section stays in the library. */
export async function placeItem(
  scope: EngineScope,
  input: { readonly itemId: string; readonly sectionId: string; readonly placed: boolean },
): Promise<MenuDraft> {
  requirePermission(scope, 'hospitality.manage');
  const itemId = checkId(input.itemId, ITEM_NOT_FOUND);
  const sectionId = checkId(input.sectionId, SECTION_NOT_FOUND);
  return edit(scope, input.placed ? 'menu.item_placed' : 'menu.item_unplaced', { itemId, sectionId }, async (tx) => {
    const ws = scope.workspaceId;
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
    const [item] = await tx
      .select({ id: menuItems.id })
      .from(menuItems)
      .where(and(eq(menuItems.workspaceId, ws), eq(menuItems.id, itemId)));
    if (item === undefined) throw refuse('NOT_FOUND', ITEM_NOT_FOUND);
    if ((await sectionRow(tx, ws, sectionId)) === undefined) throw refuse('NOT_FOUND', SECTION_NOT_FOUND);
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

/** Renumbers positions from 0, keeping their order: menus, a menu's sections (each level), or a section's items. */
async function renumber(
  tx: WorkspaceTx,
  workspaceId: string,
  part: 'menu' | 'section' | 'placement',
  within?: string,
): Promise<void> {
  if (part === 'menu') {
    await tx.execute(sql`
      update menus m set position = r.n - 1
      from (select id, row_number() over (order by position, id) as n from menus where workspace_id = ${workspaceId}) r
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
  },
): Promise<MenuDraft> {
  requirePermission(scope, 'hospitality.manage');
  const id = checkId(
    input.id,
    input.part === 'menu' ? MENU_NOT_FOUND : input.part === 'section' ? SECTION_NOT_FOUND : ITEM_NOT_FOUND,
  );
  return edit(scope, `menu.${input.part}_moved`, { id }, async (tx) => {
    const ws = scope.workspaceId;
    let order: string[];
    if (input.part === 'menu') {
      const rows = await tx
        .select({ id: menus.id })
        .from(menus)
        .where(eq(menus.workspaceId, ws))
        .orderBy(asc(menus.position), asc(menus.id));
      order = rows.map((row) => row.id);
    } else if (input.part === 'section') {
      const section = await sectionRow(tx, ws, id);
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
  },
): Promise<MenuDraft> {
  requirePermission(scope, 'hospitality.manage');
  const id = checkId(input.id, GROUP_NOT_FOUND);
  return edit(scope, 'menu.group_saved', { groupId: id }, async (tx) => {
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
      .where(and(eq(menuOptionGroups.workspaceId, ws), eq(menuOptionGroups.id, id)))
      .returning({ id: menuOptionGroups.id });
    if (changed.length === 0) {
      const [counted] = await tx
        .select({ n: count() })
        .from(menuOptionGroups)
        .where(eq(menuOptionGroups.workspaceId, ws));
      if ((counted?.n ?? 0) >= L.groups) {
        throw refuse('LIMIT_REACHED', `A workspace takes up to ${String(L.groups)} option groups.`);
      }
      await tx.insert(menuOptionGroups).values({ workspaceId: ws, id, ...fields });
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
export async function deleteOptionGroup(scope: EngineScope, input: { readonly groupId: string }): Promise<MenuDraft> {
  requirePermission(scope, 'hospitality.manage');
  const id = checkId(input.groupId, GROUP_NOT_FOUND);
  return edit(scope, 'menu.group_deleted', { groupId: id }, async (tx) => {
    const gone = await tx
      .delete(menuOptionGroups)
      .where(and(eq(menuOptionGroups.workspaceId, scope.workspaceId), eq(menuOptionGroups.id, id)))
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
  input: { readonly itemId: string; readonly soldOut: boolean },
): Promise<{ readonly draft: MenuDraft; readonly placeIds: readonly string[] }> {
  requireMenuReader(scope);
  hospitalityMember(scope);
  const id = checkId(input.itemId, ITEM_NOT_FOUND);
  return inWorkspace(scope, async (tx) => {
    const ws = scope.workspaceId;
    await requireApp(tx, ws, 'menu');
    const changed = await tx
      .update(menuItems)
      .set({ soldOut: input.soldOut, soldOutAt: input.soldOut ? sql`now()` : null })
      .where(and(eq(menuItems.workspaceId, ws), eq(menuItems.id, id)))
      .returning({ id: menuItems.id });
    if (changed.length === 0) throw refuse('NOT_FOUND', ITEM_NOT_FOUND);
    await auditSetup(tx, scope, input.soldOut ? 'menu.sold_out' : 'menu.back_on', { itemId: id });
    return { draft: await readDraft(tx, scope), placeIds: (await placesOf(tx, ws)).map((place) => place.id) };
  });
}

/**
 * Live or Hidden (spec 0065, H1, after checklabs' menu switch): hides every guest menu of the workspace for now, or
 * shows it again. Live at once and never a draft change, so the count of changes and the published rows stay as they
 * are. Manage hospitality; refused `CONFLICT` before the first Publish, since there is nothing live to hide. Answers
 * the draft and the places to purge.
 */
export async function setMenuHidden(
  scope: EngineScope,
  input: { readonly hidden: boolean },
): Promise<{ readonly draft: MenuDraft; readonly placeIds: readonly string[] }> {
  requirePermission(scope, 'hospitality.manage');
  hospitalityMember(scope);
  return inWorkspace(scope, async (tx) => {
    const ws = scope.workspaceId;
    await requireApp(tx, ws, 'menu');
    await lockKey(tx, `menu:${ws}`);
    const changed = await tx
      .update(menuDrafts)
      .set({ hidden: input.hidden, updatedAt: sql`now()` })
      .where(and(eq(menuDrafts.workspaceId, ws), sql`${menuDrafts.publishedAt} is not null`))
      .returning({ workspaceId: menuDrafts.workspaceId });
    if (changed.length === 0) throw refuse('CONFLICT', 'Publish the menu first, then you can hide it.');
    await auditSetup(tx, scope, input.hidden ? 'menu.hidden' : 'menu.shown');
    return { draft: await readDraft(tx, scope), placeIds: (await placesOf(tx, ws)).map((place) => place.id) };
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
  input: { readonly look: unknown },
): Promise<{ readonly draft: MenuDraft; readonly placeIds: readonly string[] }> {
  requirePermission(scope, 'hospitality.manage');
  const by = hospitalityMember(scope);
  const parsed = MenuLook.safeParse(input.look);
  if (!parsed.success) throw inputInvalid('look', 'That look can’t be saved. Choose from the options on the page.');
  const look = parsed.data;
  return inWorkspace(scope, async (tx) => {
    const ws = scope.workspaceId;
    await requireApp(tx, ws, 'menu');
    await lockKey(tx, `menu:${ws}`);
    if (look.cover !== undefined) {
      const [photo] = await tx
        .select({ id: menuPhotos.id })
        .from(menuPhotos)
        .where(
          and(
            eq(menuPhotos.workspaceId, ws),
            eq(menuPhotos.id, look.cover.id),
            eq(menuPhotos.version, look.cover.version),
          ),
        );
      if (photo === undefined) throw refuse('NOT_FOUND', 'That cover photo doesn’t exist.');
    }
    const changed = await tx
      .update(businessProfiles)
      .set({ look, updatedAt: sql`now()`, updatedByMemberId: by })
      .where(eq(businessProfiles.workspaceId, ws))
      .returning({ workspaceId: businessProfiles.workspaceId });
    if (changed.length === 0) throw refuse('CONFLICT', 'Add your business first, then you can design its menu.');
    await auditSetup(tx, scope, 'menu.look_saved');
    return { draft: await readDraft(tx, scope), placeIds: (await placesOf(tx, ws)).map((place) => place.id) };
  });
}

/**
 * Keeps a new cover photo's row, up to the workspace's photos (AC-6527), and answers what the look names. Nothing shows
 * it until a saved look does; a photo no look or item names goes with the next Publish or Discard.
 */
export async function addMenuCover(
  scope: EngineScope,
  input: { readonly photo: MenuPhotoFile },
): Promise<{ readonly id: string; readonly version: string }> {
  requirePermission(scope, 'hospitality.manage');
  const by = hospitalityMember(scope);
  return inWorkspace(scope, async (tx) => {
    const ws = scope.workspaceId;
    await requireApp(tx, ws, 'menu');
    await lockKey(tx, `menu:${ws}`);
    const [counted] = await tx.select({ n: count() }).from(menuPhotos).where(eq(menuPhotos.workspaceId, ws));
    if ((counted?.n ?? 0) >= L.photos)
      throw refuse('LIMIT_REACHED', `A workspace takes up to ${String(L.photos)} photos.`);
    const [photo] = await tx
      .insert(menuPhotos)
      .values({ workspaceId: ws, ...input.photo, createdByMemberId: by })
      .returning({ id: menuPhotos.id, version: menuPhotos.version });
    if (photo === undefined) throw new Error('The photo was not stored.');
    await auditSetup(tx, scope, 'menu.cover_added', { photoId: photo.id });
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
  input: { readonly itemId: string; readonly photo: MenuPhotoFile },
): Promise<MenuDraft> {
  requirePermission(scope, 'hospitality.manage');
  const itemId = checkId(input.itemId, ITEM_NOT_FOUND);
  return edit(scope, 'menu.photo_added', { itemId }, async (tx, by) => {
    const ws = scope.workspaceId;
    const [counted] = await tx.select({ n: count() }).from(menuPhotos).where(eq(menuPhotos.workspaceId, ws));
    if ((counted?.n ?? 0) >= L.photos)
      throw refuse('LIMIT_REACHED', `A workspace takes up to ${String(L.photos)} photos.`);
    const [photo] = await tx
      .insert(menuPhotos)
      .values({ workspaceId: ws, ...input.photo, createdByMemberId: by })
      .returning({ id: menuPhotos.id });
    if (photo === undefined) throw new Error('The photo was not stored.');
    const changed = await tx
      .update(menuItems)
      .set({ photoId: photo.id, updatedByMemberId: by, updatedAt: sql`now()` })
      .where(and(eq(menuItems.workspaceId, ws), eq(menuItems.id, itemId)))
      .returning({ id: menuItems.id });
    if (changed.length === 0) throw refuse('NOT_FOUND', ITEM_NOT_FOUND);
  });
}

/** Takes an item's photo off (a draft change). */
export async function removeMenuPhoto(scope: EngineScope, input: { readonly itemId: string }): Promise<MenuDraft> {
  requirePermission(scope, 'hospitality.manage');
  const itemId = checkId(input.itemId, ITEM_NOT_FOUND);
  return edit(scope, 'menu.photo_removed', { itemId }, async (tx) => {
    const changed = await tx
      .update(menuItems)
      .set({ photoId: null, updatedAt: sql`now()` })
      .where(and(eq(menuItems.workspaceId, scope.workspaceId), eq(menuItems.id, itemId)))
      .returning({ id: menuItems.id });
    if (changed.length === 0) throw refuse('NOT_FOUND', ITEM_NOT_FOUND);
  });
}

/**
 * Deletes the photos neither the draft, what was published nor the saved look names (the first two are the same set
 * right after Publish or Discard), answering their stored paths for the api to remove from the store.
 */
async function dropUnusedPhotos(tx: WorkspaceTx, workspaceId: string): Promise<readonly string[]> {
  const used = tx
    .select({ id: menuItems.photoId })
    .from(menuItems)
    .where(and(eq(menuItems.workspaceId, workspaceId), sql`${menuItems.photoId} is not null`));
  const coverId = (await readMenuBrandIn(tx, workspaceId)).menuLook?.cover?.id;
  const gone = await tx
    .delete(menuPhotos)
    .where(
      and(
        eq(menuPhotos.workspaceId, workspaceId),
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
    throw refuseOn(
      'CONFIG_INVALID',
      `Give ${unpriced.name} a price or a price note, then publish.`,
      `items.${unpriced.id}`,
    );
  }
}

/** What Publish and Discard answer: the draft, the places whose guest menus changed, and photo files to remove. */
export interface MenuPublishResult {
  readonly draft: MenuDraft;
  readonly placeIds: readonly string[];
  readonly removedPaths: readonly string[];
}

/**
 * Publish (AC-6525): one versioned snapshot per place of every menu shown there, the draft kept whole so Discard can
 * go back to it, and the count of changes back to 0. Each place keeps its last ten versions.
 */
export async function publishMenus(scope: EngineScope): Promise<MenuPublishResult> {
  requirePermission(scope, 'hospitality.manage');
  const by = hospitalityMember(scope);
  return inWorkspace(scope, async (tx) => {
    const ws = scope.workspaceId;
    await requireApp(tx, ws, 'menu');
    await lockKey(tx, `menu:${ws}`);
    const rows = await readMenuRows(tx, ws);
    publishProblem(rows);
    const currency = await currencyOf(tx, ws);
    const photos = await photoVersions(tx, ws);
    const placeList = await placesOf(tx, ws);
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
    await tx
      .insert(menuDrafts)
      .values({ workspaceId: ws, changes: 0, published: rows, publishedAt: sql`now()`, publishedByMemberId: by })
      .onConflictDoUpdate({
        target: menuDrafts.workspaceId,
        set: { changes: 0, published: rows, publishedAt: sql`now()`, publishedByMemberId: by, updatedAt: sql`now()` },
      });
    const removedPaths = await dropUnusedPhotos(tx, ws);
    await auditSetup(tx, scope, 'menu.published');
    return { draft: await readDraft(tx, scope), placeIds: placeList.map((place) => place.id), removedPaths };
  });
}

/**
 * Discard (AC-6525): the draft goes back to what was last published, Sold out untouched. Refused `CONFLICT` before
 * the first Publish, since there is nothing to go back to.
 */
export async function discardMenuDraft(scope: EngineScope): Promise<MenuPublishResult> {
  requirePermission(scope, 'hospitality.manage');
  hospitalityMember(scope);
  return inWorkspace(scope, async (tx) => {
    const ws = scope.workspaceId;
    await requireApp(tx, ws, 'menu');
    await lockKey(tx, `menu:${ws}`);
    const [state] = await tx
      .select({ published: menuDrafts.published })
      .from(menuDrafts)
      .where(eq(menuDrafts.workspaceId, ws));
    const kept = parseKeptRows(state?.published);
    if (kept === undefined)
      throw refuse('CONFLICT', 'Nothing has been published yet, so there’s nothing to go back to.');
    const placeIds = new Set((await placesOf(tx, ws)).map((place) => place.id));
    await restoreMenuRows(tx, ws, kept, {
      placeIds,
      photoIds: new Set((await photoVersions(tx, ws)).keys()),
      soldOut: await soldOutIds(tx, ws),
    });
    await tx
      .update(menuDrafts)
      .set({ changes: 0, updatedAt: sql`now()` })
      .where(eq(menuDrafts.workspaceId, ws));
    const removedPaths = await dropUnusedPhotos(tx, ws);
    await auditSetup(tx, scope, 'menu.discarded');
    return { draft: await readDraft(tx, scope), placeIds: [], removedPaths };
  });
}

/** The ids of every place, for purging every guest menu at once (a profile change, removing Menu). */
export async function menuPlaceIds(scope: EngineScope): Promise<readonly string[]> {
  hospitalityMember(scope);
  return inWorkspace(scope, async (tx) => (await placesOf(tx, scope.workspaceId)).map((place) => place.id));
}
