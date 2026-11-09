// The link page's Menu and Reserve blocks (spec 0065, AC-6528). A block names one of its page's own workspace's places
// by id; everything about the place is read inside that workspace's transaction, under its row level security, so an
// id from anywhere else simply reads nothing and its block shows nothing.
//
// - The editor's facts (`placeFactsOf`): each place's name and, per kind, whether a visitor sees the block now and why
//   not (the app removed, the menu never published or hidden, the place not taking reservations online).
// - The guest's blocks (`publicPlaceBlocks`): a Menu block reads the place's published snapshot (never the draft) for
//   its address and first dishes, through the business page's own reader (`businessMenuOf`, which leaves a hidden
//   menu and sold out dishes out); a Reserve block shows only while Table seating is installed and the place takes
//   reservations online. A removed app hides both at once.
import { PROFILE_MENU_DISHES, type ProfilePlaceChoice, type ProfilePlaceFacts } from '@crm/contracts';
import { schema, type WorkspaceTx } from '@crm/db';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { inWorkspace } from '../access/run.ts';
import type { EngineScope } from '../engine/scope.ts';
import { isUuid } from '../engine/ids.ts';
import { installedHospitalityApps } from '../hospitality/gate.ts';
import { placeReachSql, reachOf } from '../hospitality/reach.ts';
import { reservePathOf } from '../hospitality/public-page.ts';
import { businessMenuOf } from '../hospitality/public-menu.ts';
import { readTableService } from '../visits/table-service.ts';

const { menuDrafts, menuVersions, places } = schema;

/** The two kinds that name a place. */
export type PlaceBlockKind = 'menu' | 'reserve';

/** Whether a stored kind is one of them. */
export const isPlaceBlock = (kind: string): kind is PlaceBlockKind => kind === 'menu' || kind === 'reserve';

/** The row words each kind shows when its owner gave none. */
export const PLACE_BLOCK_TITLES: Readonly<Record<PlaceBlockKind, string>> = {
  menu: 'Our menu',
  reserve: 'Reserve a table',
};

/** A place's facts for both kinds. */
export interface PlaceFacts {
  readonly menu: ProfilePlaceFacts;
  readonly reserve: ProfilePlaceFacts;
}

/** The facts of `placeIds` in `workspaceId` (the caller's transaction): absent for a place that isn't there. */
export async function placeFactsOf(
  tx: WorkspaceTx,
  workspaceId: string,
  placeIds: readonly string[],
): Promise<ReadonlyMap<string, PlaceFacts>> {
  const ids = [...new Set(placeIds.filter(isUuid))];
  const facts = new Map<string, PlaceFacts>();
  if (ids.length === 0) return facts;
  const rows = await tx
    .select({
      id: places.id,
      name: places.name,
      menuKey: places.menuKey,
      publicKey: places.publicKey,
      propertyId: places.propertyId,
    })
    .from(places)
    .where(and(eq(places.workspaceId, workspaceId), inArray(places.id, ids)));
  if (rows.length === 0) return facts;
  const apps = await installedHospitalityApps(tx, workspaceId);
  // Live or Hidden is each business's own (spec 0065 H7): the businesses whose menus are hidden now.
  const hiddenRows = await tx
    .select({ propertyId: menuDrafts.propertyId })
    .from(menuDrafts)
    .where(and(eq(menuDrafts.workspaceId, workspaceId), eq(menuDrafts.hidden, true)));
  const hidden = new Set(hiddenRows.map((each) => each.propertyId));
  for (const row of rows) {
    const [published] = apps.has('menu')
      ? await tx
          .select({ version: menuVersions.version })
          .from(menuVersions)
          .where(and(eq(menuVersions.workspaceId, workspaceId), eq(menuVersions.placeId, row.id)))
          .orderBy(desc(menuVersions.version))
          .limit(1)
      : [];
    const menuReason = !apps.has('menu')
      ? 'app'
      : published === undefined
        ? 'unpublished'
        : hidden.has(row.propertyId)
          ? 'hidden'
          : undefined;
    const service = apps.has('table_seating') ? await readTableService(tx, row.id) : undefined;
    const reserveReason = !apps.has('table_seating') ? 'app' : service?.rules.online === true ? undefined : 'offline';
    // The path only while a visitor can open it: a member never learns a key before its page is live.
    const factOf = (reason: ProfilePlaceFacts['reason'], path: string): ProfilePlaceFacts =>
      reason === undefined ? { name: row.name, status: 'live', path } : { name: row.name, status: 'paused', reason };
    facts.set(row.id, {
      menu: factOf(menuReason, `/m/${encodeURIComponent(row.menuKey)}`),
      reserve: factOf(reserveReason, `/r/${encodeURIComponent(row.publicKey)}`),
    });
  }
  return facts;
}

/**
 * The places the caller may put a Menu or Reserve block for (spec 0065, AC-6528): every place of their own workspace,
 * with each kind's facts, while Menu or Table seating is installed; none otherwise. Any member: it is their own link
 * page, and a place's name and whether its menu is live are what its public pages already say.
 */
export async function listPlaceChoices(scope: EngineScope): Promise<readonly ProfilePlaceChoice[]> {
  return inWorkspace(scope, async (tx) => {
    const apps = await installedHospitalityApps(tx, scope.workspaceId);
    if (!apps.has('menu') && !apps.has('table_seating')) return [];
    // Only the places the member reaches (spec 0065 H7, AC-6596).
    const reach = await reachOf(tx, scope);
    const rows = await tx
      .select({ id: places.id })
      .from(places)
      .where(and(eq(places.workspaceId, scope.workspaceId), placeReachSql(reach, places.id)))
      .orderBy(places.position, places.id);
    const facts = await placeFactsOf(
      tx,
      scope.workspaceId,
      rows.map((row) => row.id),
    );
    return rows.flatMap((row) => {
      const found = facts.get(row.id);
      if (found === undefined) return [];
      return [
        {
          placeId: row.id,
          ...(apps.has('menu') ? { menu: found.menu } : {}),
          ...(apps.has('table_seating') ? { reserve: found.reserve } : {}),
        },
      ];
    });
  });
}

/** One Menu or Reserve block as a visitor's page reads it, before the answer's schema checks it. */
export type PublicPlaceBlock =
  | {
      readonly kind: 'menu';
      readonly id: string;
      readonly title: string;
      readonly path: string;
      readonly dishes: readonly { readonly name: string; readonly price?: string }[];
    }
  | { readonly kind: 'reserve'; readonly id: string; readonly title: string; readonly path: string };

/** One stored block, as much of it as this reader needs. */
interface PlaceBlockRow {
  readonly id: string;
  readonly kind: string;
  readonly data: unknown;
}

/** The owner's label for the row, else the kind's own words. */
function titleOf(kind: PlaceBlockKind, data: Readonly<Record<string, unknown>>): string {
  const label = typeof data.label === 'string' ? data.label.trim() : '';
  return label === '' || label.length > 60 || /[\r\n]/.test(label) ? PLACE_BLOCK_TITLES[kind] : label;
}

/**
 * The Menu and Reserve blocks among `rows` that a visitor sees now, by block id, read in the page's own workspace
 * (`workspaceId`, the caller's transaction). A block whose place is gone, whose app is removed, whose menu is
 * unpublished, hidden or has no dish to show, or whose place doesn't take reservations online is left out.
 */
export async function publicPlaceBlocks(
  tx: WorkspaceTx,
  workspaceId: string,
  rows: readonly PlaceBlockRow[],
): Promise<ReadonlyMap<string, PublicPlaceBlock>> {
  const wanted = rows.filter((row) => isPlaceBlock(row.kind));
  const shown = new Map<string, PublicPlaceBlock>();
  if (wanted.length === 0) return shown;
  const apps = await installedHospitalityApps(tx, workspaceId);
  // One read per place, however many blocks name it.
  const menus = new Map<string, Awaited<ReturnType<typeof businessMenuOf>>>();
  const reserves = new Map<string, string | undefined>();
  for (const row of wanted) {
    const data: Readonly<Record<string, unknown>> =
      typeof row.data === 'object' && row.data !== null ? (row.data as Readonly<Record<string, unknown>>) : {};
    const placeId = typeof data.placeId === 'string' && isUuid(data.placeId) ? data.placeId : undefined;
    if (placeId === undefined) continue;
    if (row.kind === 'menu' && apps.has('menu')) {
      if (!menus.has(placeId)) menus.set(placeId, await businessMenuOf(tx, workspaceId, placeId));
      const menu = menus.get(placeId);
      const dishes = (menu?.sections ?? []).flatMap((section) => section.items).slice(0, PROFILE_MENU_DISHES);
      if (menu?.path === undefined || dishes.length === 0) continue;
      shown.set(row.id, {
        kind: 'menu',
        id: row.id,
        title: titleOf('menu', data),
        path: menu.path,
        dishes: dishes.map((dish) => ({ name: dish.name, ...(dish.price === undefined ? {} : { price: dish.price }) })),
      });
    }
    if (row.kind === 'reserve' && apps.has('table_seating')) {
      if (!reserves.has(placeId)) reserves.set(placeId, await reservePathOf(tx, workspaceId, placeId));
      const path = reserves.get(placeId);
      if (path === undefined) continue;
      shown.set(row.id, { kind: 'reserve', id: row.id, title: titleOf('reserve', data), path });
    }
  }
  return shown;
}
