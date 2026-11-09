// The guest menu's door and read (spec 0065, H1, AC-6528, AC-6531): a menu key names a place through
// `crm_menu_by_key` (ids only, and only while the workspace is live and Menu is on), then
// one transaction on that workspace, under its row level security, reads the place's latest published snapshot (never
// the draft), the items sold out now, the header and the brand. Nothing of a member, a guest, a draft or another
// place is read.
import { createHash } from 'node:crypto';
import {
  DEFAULT_MENU_LOOK,
  isMenuKey,
  MENU_FONT_FACES,
  menuLookColours,
  menuLookScheme,
  menuLookShape,
  menuPhotoPath,
  MENU_PHOTO_WIDTHS,
  MENU_PRESS,
  MENU_PRESS_PROPERTIES,
  MenuSnapshot,
  formatPrice,
  type BusinessPageMenu,
  type BusinessPageMenuSection,
  type MenuPhotoSize,
  type PlaceHours,
  type PublicMenu,
} from '@crm/contracts';
import { schema, type Database, type WorkspaceTx } from '@crm/db';
import { and, desc, eq, isNotNull, sql } from 'drizzle-orm';
import { readMenuBrandIn, type PageBrand } from '../brand/public.ts';
import { businessCacheId } from './cache-tags.ts';
import { appInstalled } from './gate.ts';
import { soldOutIds } from './menu-rows.ts';
import { reservePathOf } from './public-page.ts';

const { menuDrafts, menuPhotos, menuVersions, places, properties } = schema;

/** Whether the workspace's menu is hidden from guests for now (Live or Hidden). */
async function isHidden(tx: WorkspaceTx, workspaceId: string): Promise<boolean> {
  const [state] = await tx
    .select({ hidden: menuDrafts.hidden })
    .from(menuDrafts)
    .where(eq(menuDrafts.workspaceId, workspaceId));
  return state?.hidden === true;
}

/**
 * The place's guest menu address (`/m/<menu key>`) while guests can open it: the Menu app installed, the menu not
 * hidden, and a version published for the place; else undefined. A light read for a page that only links the menu
 * (the reservation page), in the caller's workspace transaction.
 */
export async function guestMenuPathOf(
  tx: WorkspaceTx,
  workspaceId: string,
  placeId: string,
): Promise<string | undefined> {
  if (!(await appInstalled(tx, workspaceId, 'menu')) || (await isHidden(tx, workspaceId))) return undefined;
  const [place] = await tx
    .select({
      menuKey: places.menuKey,
      published: sql<boolean>`exists (
        select 1 from menu_versions v where v.workspace_id = ${places.workspaceId} and v.place_id = ${places.id}
      )`,
    })
    .from(places)
    .where(and(eq(places.workspaceId, workspaceId), eq(places.id, placeId)));
  return place !== undefined && place.published && isMenuKey(place.menuKey) ? `/m/${place.menuKey}` : undefined;
}

/** The nil uuid: a workspace no row has, for the lookup made before the workspace is known. */
const NO_WORKSPACE = '00000000-0000-0000-0000-000000000000';

/** What the menu door answers: the workspace and place a key names. Only `enterMenuPage` makes one. */
export interface MenuEntry {
  readonly workspaceId: string;
  readonly placeId: string;
  readonly key: string;
}

/**
 * The workspace and place a guest menu's key names, or undefined: a malformed key never reaches the database, and an
 * unknown key, a deleted workspace or one with Menu off all answer the same nothing.
 */
export async function enterMenuPage(deps: { readonly db: Database }, key: string): Promise<MenuEntry | undefined> {
  if (!isMenuKey(key)) return undefined;
  const found = await deps.db.withWorkspace(NO_WORKSPACE, (tx) =>
    tx.execute<{ workspace_id: string; place_id: string }>(
      sql`select workspace_id::text, place_id::text from crm_menu_by_key(${key})`,
    ),
  );
  const [row] = found.rows;
  return row === undefined ? undefined : { workspaceId: row.workspace_id, placeId: row.place_id, key };
}

/** The guest menu's answer and the brand it wears, or undefined before the place's first Publish. */
export interface PublicMenuRead {
  readonly menu: PublicMenu;
  readonly brand: PageBrand;
}

/**
 * The guest menu (AC-6528, AC-6529): the place's latest snapshot, the items of it sold out now (AC-6526), the
 * business and place header, and the versions of its look and logo; while it is hidden (Live or Hidden), the header
 * and look alone, marked `hidden`. One transaction on the entry's workspace.
 */
export async function readPublicMenu(
  deps: { readonly db: Database },
  entry: MenuEntry,
): Promise<PublicMenuRead | undefined> {
  return deps.db.withWorkspace(entry.workspaceId, async (tx) => {
    const [latest] = await tx
      .select({ version: menuVersions.version, snapshot: menuVersions.snapshot })
      .from(menuVersions)
      .where(and(eq(menuVersions.workspaceId, entry.workspaceId), eq(menuVersions.placeId, entry.placeId)))
      .orderBy(desc(menuVersions.version))
      .limit(1);
    if (latest === undefined) return undefined;
    const parsed = MenuSnapshot.safeParse(latest.snapshot);
    if (!parsed.success) return undefined;
    const [place] = await tx
      .select({
        propertyId: places.propertyId,
        name: places.name,
        addressLine: places.addressLine,
        city: places.city,
        postcode: places.postcode,
        phone: places.phone,
        timeZone: places.timeZone,
        locale: places.locale,
        hours: places.hours,
      })
      .from(places)
      .where(and(eq(places.workspaceId, entry.workspaceId), eq(places.id, entry.placeId)));
    if (place === undefined) return undefined;
    // The property the place belongs to (AC-6514). It has a name once anyone has set it up.
    const [business] = await tx
      .select({ name: properties.name, description: properties.description, website: properties.website })
      .from(properties)
      .where(
        and(
          eq(properties.workspaceId, entry.workspaceId),
          eq(properties.id, place.propertyId),
          isNotNull(properties.name),
        ),
      );
    const hidden = await isHidden(tx, entry.workspaceId);
    // Hidden, the page still offers Reserve a table while the place takes reservations online (spec 0065).
    const reservePath =
      hidden && (await appInstalled(tx, entry.workspaceId, 'table_seating'))
        ? await reservePathOf(tx, entry.workspaceId, entry.placeId)
        : undefined;
    const soldOut = hidden ? new Set<string>() : await soldOutIds(tx, entry.workspaceId);
    const brand = await readMenuBrandIn(tx, entry.workspaceId);
    const pin = menuLookPin(brand);
    const cover = brand.menuLook?.cover;
    // Hidden, the answer keeps the header and the look and drops every menu, dish and group.
    const snapshot = hidden ? { currency: parsed.data.currency, menus: [], items: {}, groups: {} } : parsed.data;
    const menu: PublicMenu = {
      placeId: entry.placeId,
      cacheId: businessCacheId(entry.workspaceId),
      version: latest.version,
      business: {
        name: business?.name ?? place.name,
        ...(business?.description === null || business?.description === undefined
          ? {}
          : { description: business.description }),
        ...(business?.website === null || business?.website === undefined ? {} : { website: business.website }),
      },
      place: {
        name: place.name,
        ...(place.addressLine === null ? {} : { addressLine: place.addressLine }),
        ...(place.city === null ? {} : { city: place.city }),
        ...(place.postcode === null ? {} : { postcode: place.postcode }),
        ...(place.phone === null ? {} : { phone: place.phone }),
        timeZone: place.timeZone,
        locale: place.locale,
        hours: place.hours as PlaceHours,
      },
      look: menuLookVersion(brand),
      ...(pin === undefined ? {} : { scheme: pin }),
      ...(cover === undefined || hidden ? {} : { cover }),
      ...(brand.logo === undefined ? {} : { logo: brand.logo.version }),
      menu: snapshot,
      soldOut: [...soldOut].filter((id) => Object.hasOwn(snapshot.items, id)).sort(),
      ...(hidden ? { hidden: true as const } : {}),
      ...(reservePath === undefined ? {} : { reservePath }),
    };
    return { menu, brand };
  });
}

/**
 * One photo of a guest menu at one width (AC-6527): only a photo the place's live snapshot shows, at the version the
 * snapshot names, or the cover the saved look names, at its version, so no other photo of the workspace (a draft's,
 * another place's) is ever served by a menu key.
 */
export async function readMenuPhoto(
  deps: { readonly db: Database },
  entry: MenuEntry,
  photoId: string,
  size: MenuPhotoSize,
  version: string,
): Promise<{ readonly path: string; readonly type: string } | undefined> {
  if (!Object.hasOwn(MENU_PHOTO_WIDTHS, size)) return undefined;
  return deps.db.withWorkspace(entry.workspaceId, async (tx) => {
    const [latest] = await tx
      .select({ snapshot: menuVersions.snapshot })
      .from(menuVersions)
      .where(and(eq(menuVersions.workspaceId, entry.workspaceId), eq(menuVersions.placeId, entry.placeId)))
      .orderBy(desc(menuVersions.version))
      .limit(1);
    const parsed = MenuSnapshot.safeParse(latest?.snapshot);
    if (!parsed.success || (await isHidden(tx, entry.workspaceId))) return undefined;
    const shown = Object.values(parsed.data.items).some(
      (item) => item.photo?.id === photoId && item.photo.version === version,
    );
    if (!shown) {
      const cover = (await readMenuBrandIn(tx, entry.workspaceId)).menuLook?.cover;
      if (cover?.id !== photoId || cover.version !== version) return undefined;
    }
    const [photo] = await tx
      .select({ largePath: menuPhotos.largePath, smallPath: menuPhotos.smallPath, type: menuPhotos.type })
      .from(menuPhotos)
      .where(
        and(eq(menuPhotos.workspaceId, entry.workspaceId), eq(menuPhotos.id, photoId), eq(menuPhotos.version, version)),
      );
    if (photo === undefined) return undefined;
    return { path: size === 'large' ? photo.largePath : photo.smallPath, type: photo.type };
  });
}

/** Which build of the look stylesheet this is: a new preset table or press feel is a new path. */
const LOOK_BUILD = 'look-4';

/** The look a page wears: what the Design page saved, else the default, Warm. */
const lookOf = (brand: PageBrand) => brand.menuLook ?? DEFAULT_MENU_LOOK;

/**
 * The version the menu's look stylesheet is served at: the look's colours, faces and corners and the brand's accent
 * pair. Its cover isn't in the stylesheet, so a new cover is no new path.
 */
export function menuLookVersion(brand: PageBrand): string {
  const { cover: _cover, ...drawn } = lookOf(brand);
  return createHash('sha256')
    .update([LOOK_BUILD, JSON.stringify(drawn), brand.accents.accent ?? '', brand.accents.accentDark ?? ''].join('|'))
    .digest('hex')
    .slice(0, 12);
}

/** The side a look pins its page to, or undefined while it follows the visitor. */
export function menuLookPin(brand: PageBrand): 'light' | 'dark' | undefined {
  const scheme = menuLookScheme(lookOf(brand));
  return scheme === 'follow' ? undefined : scheme;
}

/** The press feel's custom properties: checklabs' curve and scales, or every scale at 1 (reduced motion). */
const pressBlock = (isStill: boolean) =>
  (Object.keys(MENU_PRESS_PROPERTIES) as (keyof typeof MENU_PRESS_PROPERTIES)[])
    .filter((name) => !isStill || name !== 'ease')
    .map((name) => `${MENU_PRESS_PROPERTIES[name]}:${isStill ? '1' : MENU_PRESS[name]}`)
    .join(';');

/**
 * A guest page's look (spec 0065, AC-6570 as amended): the look's two faces (closed words, `MENU_FONT_FACES`), its
 * corners (`--menu-round`), its press feel as `--menu-press-*` (`MENU_PRESS`, constants: the curve and how far each
 * part eases down while held, all 1 under reduced motion) and its colours as `--menu-*` custom properties (`menuLookRoles`:
 * words held to 4.5:1, buttons to 3:1, a button's label black or white). A look that follows the visitor is light by
 * default and dark under their dark scheme; a pinned one writes its one side. Every value is a constant or a checked
 * hex, whatever a row holds, since this is CSS on a public page. A guest page also takes the look's body face as its
 * `--font-sans` (so the booking parts, which draw through the text tokens, wear it), unless that is the device's or
 * Inter, which leaves them as they are; the editor's preview, linked inside the app, leaves that out (`inApp`).
 */
export function menuLookStylesheet(brand: PageBrand, options: { readonly inApp?: boolean } = {}): string {
  const look = lookOf(brand);
  const accents = brand.accents;
  const ownBody = options.inApp === true || look.body === 'device' || look.body === 'sans';
  const shape = [...menuLookShape(look), ...(ownBody ? [] : ([['--font-sans', MENU_FONT_FACES[look.body]]] as const))]
    .map(([name, value]) => `${name}:${value}`)
    .join(';');
  const block = (mode: 'light' | 'dark') =>
    menuLookColours(look, accents, mode)
      .map(([name, value]) => `${name}:${value}`)
      .join(';');
  const pin = menuLookPin(brand);
  if (pin !== undefined) {
    return [
      `:root{${shape};${pressBlock(false)};${block(pin)}}`,
      `@media (prefers-reduced-motion: reduce){:root{${pressBlock(true)}}}`,
      '',
    ].join('\n');
  }
  return [
    `:root{${shape};${pressBlock(false)};${block('light')}}`,
    `@media (prefers-reduced-motion: reduce){:root{${pressBlock(true)}}}`,
    `@media (prefers-color-scheme: dark){:root:not([data-theme='light']){${block('dark')}}}`,
    `:root[data-theme='dark']{${block('dark')}}`,
    '',
  ].join('\n');
}

/**
 * A place's published menu as its business page shows it (spec 0066, AC-6642, the Menu section): each menu's sections
 * and sub sections in order, each with its dishes' names, descriptions and prices in the place's locale, and the
 * whole guest menu's address (`/m/<menu key>`). Read inside the business's own workspace transaction, from the latest
 * snapshot only (never the draft); nothing while the menu is hidden or has no published version. Sold out dishes stay
 * out, as the page can't say so.
 */
export async function businessMenuOf(
  tx: WorkspaceTx,
  workspaceId: string,
  placeId: string,
): Promise<BusinessPageMenu | undefined> {
  if (await isHidden(tx, workspaceId)) return undefined;
  const [latest] = await tx
    .select({ snapshot: menuVersions.snapshot })
    .from(menuVersions)
    .where(and(eq(menuVersions.workspaceId, workspaceId), eq(menuVersions.placeId, placeId)))
    .orderBy(desc(menuVersions.version))
    .limit(1);
  if (latest === undefined) return undefined;
  const parsed = MenuSnapshot.safeParse(latest.snapshot);
  if (!parsed.success) return undefined;
  const [place] = await tx
    .select({ locale: places.locale, menuKey: places.menuKey })
    .from(places)
    .where(and(eq(places.workspaceId, workspaceId), eq(places.id, placeId)));
  if (place === undefined) return undefined;
  const snapshot = parsed.data;
  const soldOut = await soldOutIds(tx, workspaceId);
  const several = snapshot.menus.length > 1;
  const priceOf = (minor: number | undefined) =>
    minor === undefined ? undefined : formatPrice(minor, snapshot.currency, place.locale);
  const sectionOf = (name: string, itemIds: readonly string[]): BusinessPageMenuSection => ({
    name,
    items: itemIds.flatMap((id) => {
      const item = snapshot.items[id];
      if (item === undefined || soldOut.has(id)) return [];
      // A dish priced by size reads its smallest size's price.
      const sized = item.sizes.length === 0 ? undefined : Math.min(...item.sizes.map((size) => size.priceMinor));
      const price = priceOf(item.priceMinor ?? sized);
      return [
        {
          name: item.name,
          ...(item.description === undefined ? {} : { description: item.description }),
          ...(price === undefined ? {} : { price }),
          // Its list photo on the guest menu's own route (the live snapshot's version), as the guest menu's rows show it.
          ...(item.photo === undefined || !isMenuKey(place.menuKey)
            ? {}
            : { photo: menuPhotoPath(place.menuKey, item.photo.id, 'small', item.photo.version) }),
        },
      ];
    }),
  });
  const sections = snapshot.menus.flatMap((menu) =>
    menu.sections.flatMap((section) => {
      const title = several ? `${menu.name} · ${section.name}` : section.name;
      return [
        sectionOf(title, section.itemIds),
        ...section.sections.map((sub) => sectionOf(`${title} · ${sub.name}`, sub.itemIds)),
      ];
    }),
  );
  const shown = sections.filter((section) => section.items.length > 0);
  if (shown.length === 0) return undefined;
  return { sections: shown, ...(isMenuKey(place.menuKey) ? { path: `/m/${place.menuKey}` } : {}) };
}
