// The guest menu's door and read (spec 0065, H1, AC-6528, AC-6531): a menu key names a place through
// `crm_menu_by_key` (ids only, and only while the workspace is live, has early access and has Menu installed), then
// one transaction on that workspace, under its row level security, reads the place's latest published snapshot (never
// the draft), the items sold out now, the header and the brand. Nothing of a member, a guest, a draft or another
// place is read.
import { createHash } from 'node:crypto';
import {
  BRAND_HEX_PATTERN,
  brandVariables,
  isMenuKey,
  MENU_LOOK_PROPERTIES,
  MENU_PHOTO_WIDTHS,
  MenuSnapshot,
  WARM_PRESET,
  type MenuPhotoSize,
  type PlaceHours,
  type PublicMenu,
} from '@crm/contracts';
import { schema, type Database } from '@crm/db';
import { and, desc, eq, sql } from 'drizzle-orm';
import { readMenuBrandIn, type PageBrand } from '../brand/public.ts';
import { soldOutIds } from './menu-rows.ts';

const { businessProfiles, menuPhotos, menuVersions, places } = schema;

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
 * unknown key, a deleted workspace, one without early access or with Menu removed all answer the same nothing.
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
 * business and place header, and the versions of its look and logo. One transaction on the entry's workspace.
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
    const [business] = await tx
      .select({
        name: businessProfiles.name,
        description: businessProfiles.description,
        website: businessProfiles.website,
      })
      .from(businessProfiles)
      .where(eq(businessProfiles.workspaceId, entry.workspaceId));
    const soldOut = await soldOutIds(tx, entry.workspaceId);
    const brand = await readMenuBrandIn(tx, entry.workspaceId);
    const snapshot = parsed.data;
    const menu: PublicMenu = {
      placeId: entry.placeId,
      workspaceId: entry.workspaceId,
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
      ...(brand.logo === undefined ? {} : { logo: brand.logo.version }),
      menu: snapshot,
      soldOut: [...soldOut].filter((id) => Object.hasOwn(snapshot.items, id)).sort(),
    };
    return { menu, brand };
  });
}

/**
 * One photo of a guest menu at one width (AC-6527): only a photo the place's live snapshot shows, at the version the
 * snapshot names, so no other photo of the workspace (a draft's, another place's) is ever served by a menu key.
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
    if (!parsed.success) return undefined;
    const shown = Object.values(parsed.data.items).some(
      (item) => item.photo?.id === photoId && item.photo.version === version,
    );
    if (!shown) return undefined;
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

/** Which look the Warm preset's stylesheet is at: a new preset table or accent is a new path. */
const WARM_LOOK = 'warm-1';

/** The version the menu's look stylesheet is served at: the preset and the brand's accent pair. */
export function menuLookVersion(brand: PageBrand): string {
  return createHash('sha256')
    .update([WARM_LOOK, brand.accents.accent ?? '', brand.accents.accentDark ?? ''].join('|'))
    .digest('hex')
    .slice(0, 12);
}

/** A colour the stylesheet may write: six or eight hex digits, nothing else. */
const isHex = (value: string) => /^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(value);

/**
 * The guest menu's look (spec 0065, AC-6570, Warm only in H1): the preset's colours as `--menu-*` custom properties,
 * light by default and dark under the visitor's dark scheme, with the brand's accent pair (contrast adjusted by
 * `brandVariables`) taking the accent when the workspace has one. Every value is a checked hex.
 */
export function menuLookStylesheet(brand: PageBrand): string {
  const accent = brand.accents.accent;
  const colours =
    accent === undefined || !BRAND_HEX_PATTERN.test(accent)
      ? undefined
      : brandVariables({
          accent,
          ...(brand.accents.accentDark === undefined ? {} : { accentDark: brand.accents.accentDark }),
        });
  const block = (mode: 'light' | 'dark') => {
    const preset = WARM_PRESET[mode];
    const own = colours === undefined ? undefined : mode === 'light' ? colours.light : colours.dark;
    const values: Record<keyof typeof MENU_LOOK_PROPERTIES, string> = {
      ...preset,
      ...(own === undefined ? {} : { accent: own.accent, onAccent: own.onAccent }),
    };
    return (Object.keys(MENU_LOOK_PROPERTIES) as (keyof typeof MENU_LOOK_PROPERTIES)[])
      .filter((name) => isHex(values[name]))
      .map((name) => `${MENU_LOOK_PROPERTIES[name]}:${values[name]}`)
      .join(';');
  };
  return [
    `:root{${block('light')}}`,
    `@media (prefers-color-scheme: dark){:root:not([data-theme='light']){${block('dark')}}}`,
    `:root[data-theme='dark']{${block('dark')}}`,
    '',
  ].join('\n');
}
