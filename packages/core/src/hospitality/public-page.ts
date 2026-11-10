// The public business page's reads (spec 0066, B4 lite): `/<company-handle>` and `/<company-handle>/<place-slug>`.
// No session and no scope: the handle is the only key. A business handle (current or old) names its workspace through
// crm_handle's definer (`crm_business_handle_owner`), and everything after is read inside that one workspace, under
// its row level security, and only from what was published: a draft is never read here. A page that was never
// published, a deleted workspace, and a business whose apps are all off answer the same NOT_FOUND as no page at all.
//
// One page per business (spec 0065 H7, AC-6592, AC-6593): the handle names its workspace through the definer, then
// its business through `property_handles` inside that workspace, and every read after is that business's own: its
// places, its snapshot, its pictures and its look. A handle no business names any more (a removed one's) is no page.
import {
  APPOINTMENT_KINDS,
  BUSINESS_SECOND_SEGMENTS,
  businessContentOf,
  HANDLE_PATTERN,
  PLACE_SLUG_PATTERN,
  type BusinessKind,
  type PlaceHoursShape,
  type PublicBusinessPage,
  type BusinessPageMenu,
} from '@crm/contracts';
import { schema, type Database, type WorkspaceTx } from '@crm/db';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { businessBrandOf, type PageBrand } from '../brand/public.ts';
import type { EngineScope } from '../access/mint.ts';
import { inWorkspace } from '../access/run.ts';
import { isUuid } from '../engine/ids.ts';
import { refuse } from '../engine/refusals.ts';
import { businessCacheTags } from './cache-tags.ts';
import { pagePlaces, thePage } from './business-page.ts';
import { installedHospitalityApps } from './gate.ts';
import { currentProperty } from './property.ts';
import { readTableService } from '../visits/table-service.ts';

const { businessPages, businessPhotos, places, placeSlugs, propertyHandles, workspaces } = schema;

/** The id `withWorkspace` takes for a read that belongs to no workspace: the definer reads past it. */
const NO_WORKSPACE = '00000000-0000-0000-0000-000000000000';

/** The one answer for every address with no live page behind it. */
const noPage = () => refuse('NOT_FOUND', 'There’s no page at this address.');

/**
 * A place's published menu, read through this one seam so the page works before the Menu app's menus (0065 H1) land:
 * the default answers nothing, and the page then shows no Menu section. H1 passes its own reader of the published
 * menu snapshot. Called only while the Menu app is installed, inside the business's own workspace transaction.
 */
export type MenuSource = (
  tx: WorkspaceTx,
  workspaceId: string,
  placeId: string,
) => Promise<BusinessPageMenu | undefined>;

/** No menus yet: every place answers none. */
export const NO_MENUS: MenuSource = () => Promise.resolve(undefined);

/** The workspace a business handle names, current or old, or undefined. */
async function workspaceOfHandle(db: Database, handle: string): Promise<string | undefined> {
  if (!HANDLE_PATTERN.test(handle)) return undefined;
  const found = await db.withWorkspace(NO_WORKSPACE, (tx) =>
    tx.execute<{ workspace_id: string }>(
      sql`select workspace_id::text as workspace_id from crm_business_handle_owner(${handle})`,
    ),
  );
  const id = found.rows[0]?.workspace_id;
  return id !== undefined && isUuid(id) ? id : undefined;
}

/** The business a handle names inside its workspace (current or old), or undefined. */
async function businessOfHandle(tx: WorkspaceTx, workspaceId: string, handle: string): Promise<string | undefined> {
  const [row] = await tx
    .select({ propertyId: propertyHandles.propertyId })
    .from(propertyHandles)
    .where(and(eq(propertyHandles.workspaceId, workspaceId), eq(propertyHandles.handle, handle)));
  return row?.propertyId;
}

/** The business a handle names and its workspace, read with the page's own steps: workspace, then business. */
async function openHandle<T>(
  db: Database,
  handle: string,
  read: (tx: WorkspaceTx, workspaceId: string, propertyId: string) => Promise<T | undefined>,
): Promise<T | undefined> {
  const workspaceId = await workspaceOfHandle(db, handle);
  if (workspaceId === undefined) return undefined;
  return db.withWorkspace(workspaceId, async (tx) => {
    const propertyId = await businessOfHandle(tx, workspaceId, handle);
    return propertyId === undefined ? undefined : read(tx, workspaceId, propertyId);
  });
}

/**
 * Whether the business's page may be served at all: its workspace not deleted and some business app on. Every public read asks it first, so a page, its photos, its brand and the lockup that links it
 * all go together.
 */
async function isLive(tx: WorkspaceTx, workspaceId: string): Promise<boolean> {
  const [workspace] = await tx
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(and(eq(workspaces.id, workspaceId), isNull(workspaces.deletedAt)));
  return workspace !== undefined && (await installedHospitalityApps(tx, workspaceId)).size > 0;
}

/** What the public page's entry found: the page, its workspace and business (for the cache tags), and its brand. */
export interface BusinessPageEntry {
  readonly page: PublicBusinessPage;
  readonly workspaceId: string;
  readonly propertyId: string;
  readonly brand: PageBrand;
}

/**
 * The published business page at `/<handle>` or `/<handle>/<slug>` (AC-6640 to AC-6644). An old handle or an old
 * slug finds the page, which answers its current ones so the address bar can show them. Each picture is served from
 * our own origin under the current handle.
 */
export async function enterBusinessPage(
  deps: { readonly db: Database; readonly menus?: MenuSource },
  handle: string,
  slug?: string,
): Promise<BusinessPageEntry> {
  if (
    slug !== undefined &&
    (!PLACE_SLUG_PATTERN.test(slug) || (BUSINESS_SECOND_SEGMENTS as readonly string[]).includes(slug))
  ) {
    throw noPage();
  }
  const menus = deps.menus ?? NO_MENUS;
  const entry = await openHandle(deps.db, handle, async (tx, workspaceId, propertyId) => {
    if (!(await isLive(tx, workspaceId))) return undefined;
    const apps = await installedHospitalityApps(tx, workspaceId);
    const [row] = await tx
      .select({
        handle: businessPages.handle,
        published: businessPages.published,
        publishedAt: businessPages.publishedAt,
      })
      .from(businessPages)
      .where(thePage(workspaceId, propertyId));
    const property = await currentProperty(tx, workspaceId, propertyId);
    if (
      row === undefined ||
      row.handle === null ||
      row.published === null ||
      row.publishedAt === null ||
      property.name === null ||
      property.kind === null
    ) {
      return undefined;
    }
    const content = businessContentOf(row.published);
    // Only places Publish saw (its snapshot names them): a place added or given an address since waits for Publish.
    const publishedPlaces = publishedPlaceIds(row.published);
    const shown = (await pagePlaces(tx, workspaceId, property.id)).filter(
      (place) => place.slug !== null && (publishedPlaces === undefined || publishedPlaces.has(place.id)),
    );
    if (shown.length === 0) return undefined;
    let placeId = shown[0]?.id ?? '';
    if (slug !== undefined) {
      const [held] = await tx
        .select({ placeId: placeSlugs.placeId })
        .from(placeSlugs)
        .where(and(eq(placeSlugs.workspaceId, workspaceId), eq(placeSlugs.slug, slug)));
      if (held === undefined || !shown.some((place) => place.id === held.placeId)) return undefined;
      placeId = held.placeId;
    }
    // Only pictures still kept: one removed since (it can't be, Publish keeps what it shows) is left out, not broken.
    const kept = new Set(
      (
        await tx
          .select({ id: businessPhotos.id })
          .from(businessPhotos)
          .where(and(eq(businessPhotos.workspaceId, workspaceId), eq(businessPhotos.propertyId, property.id)))
      ).map((photo) => photo.id),
    );
    const current = row.handle;
    const menu = apps.has('menu') ? await menus(tx, workspaceId, placeId) : undefined;
    // Reserve opens the place's reservation page (spec 0066 B7, `/r/<public key>`) once its table service takes
    // reservations online; installed but not yet taking them, the page offers Call to book or Directions instead.
    // At the business's own address with two or more places, Reserve asks for the place first (AC-6593): each place
    // that takes reservations online; with only one of them, Reserve goes straight to it.
    const choosing = slug === undefined && shown.length > 1;
    const open =
      apps.has('table_seating') && choosing
        ? (
            await Promise.all(
              shown.map(async (place) => ({ place, path: await reservePathOf(tx, workspaceId, place.id) })),
            )
          ).flatMap(({ place, path }) => (path === undefined ? [] : [{ id: place.id, name: place.name, path }]))
        : [];
    const reservePath = choosing
      ? open.length === 1
        ? open[0]?.path
        : undefined
      : apps.has('table_seating')
        ? await reservePathOf(tx, workspaceId, placeId)
        : undefined;
    const brand = await businessBrandOf(tx, workspaceId, property.id);
    const page: PublicBusinessPage = {
      handle: current,
      name: property.name,
      kind: property.kind as BusinessKind,
      ...(property.description === null ? {} : { description: property.description }),
      ...(content.about === undefined ? {} : { about: content.about }),
      ...(property.phone === null ? {} : { phone: property.phone }),
      ...(property.website === null ? {} : { website: property.website }),
      gallery: content.gallery
        .filter((photo) => kept.has(photo.id))
        .map((photo) => ({ ...photo, src: businessPhotoSrc(current, photo.id) })),
      // The business's own cover (AC-6513), while its picture is still kept; absent, the gallery's first leads.
      ...(content.cover === undefined || !kept.has(content.cover.id)
        ? {}
        : { cover: { ...content.cover, src: businessPhotoSrc(current, content.cover.id) } }),
      amenities: content.amenities,
      places: shown.map((place) => ({
        id: place.id,
        slug: place.slug ?? '',
        name: place.name,
        ...(place.addressLine === null ? {} : { addressLine: place.addressLine }),
        ...(place.city === null ? {} : { city: place.city }),
        ...(place.postcode === null ? {} : { postcode: place.postcode }),
        country: place.country,
        ...(place.phone === null ? {} : { phone: place.phone }),
        timeZone: place.timeZone,
        hours: place.hours as PlaceHoursShape,
        seoHidden: content.hiddenPlaces.includes(place.id),
      })),
      placeId,
      ...(menu === undefined || menu.sections.length === 0 ? {} : { menu }),
      // Table seating is on by default, so "soon" is only for a business that seats people: a salon's page shows
      // Reserve only once it really opens reservations.
      ...(open.length > 1
        ? { reserve: 'open' as const, reservePlaces: open }
        : reservePath !== undefined
          ? { reserve: 'open' as const, reservePath }
          : apps.has('table_seating') && !APPOINTMENT_KINDS.includes(property.kind as BusinessKind)
            ? { reserve: 'soon' as const }
            : {}),
      ...(brand.answer === undefined ? {} : { brand: brand.answer }),
      indexable: !content.hiddenPlaces.includes(placeId),
      publishedAt: new Date(row.publishedAt).toISOString(),
      // This business's own tags (owner decision, 10 Nov 2026): never one another business of the workspace shares.
      tags: businessCacheTags(workspaceId, property.id, [placeId]),
    };
    return { page, workspaceId, propertyId: property.id, brand };
  });
  if (entry === undefined) throw noPage();
  return entry;
}

/** The place's reservation page's path while its table service takes reservations online, else undefined. */
export async function reservePathOf(
  tx: WorkspaceTx,
  workspaceId: string,
  placeId: string,
): Promise<string | undefined> {
  const service = await readTableService(tx, placeId);
  if (service?.rules.online !== true) return undefined;
  const [place] = await tx
    .select({ publicKey: places.publicKey })
    .from(places)
    .where(and(eq(places.workspaceId, workspaceId), eq(places.id, placeId)));
  return place === undefined ? undefined : `/r/${encodeURIComponent(place.publicKey)}`;
}

/** A published gallery picture's address on our own origin, under the business's current handle. */
export function businessPhotoSrc(handle: string, photoId: string): string {
  return `/api/public/business/${encodeURIComponent(handle)}/photos/${encodeURIComponent(photoId)}`;
}

/**
 * One picture of a business's published gallery (`GET /api/public/business/:handle/photos/:id`): its stored path and
 * type, or undefined for anything else (a draft's picture, another business's, a page not live).
 */
export async function publicBusinessPhoto(
  deps: { readonly db: Database },
  handle: string,
  photoId: string,
): Promise<
  | { readonly path: string; readonly type: string; readonly workspaceId: string; readonly propertyId: string }
  | undefined
> {
  if (!isUuid(photoId)) return undefined;
  return openHandle(deps.db, handle, async (tx, workspaceId, propertyId) => {
    if (!(await isLive(tx, workspaceId))) return undefined;
    const [row] = await tx
      .select({ published: businessPages.published })
      .from(businessPages)
      .where(thePage(workspaceId, propertyId));
    if (row === undefined || row.published === null) return undefined;
    const published = businessContentOf(row.published);
    if (published.cover?.id !== photoId && !published.gallery.some((photo) => photo.id === photoId)) return undefined;
    // Only this business's own picture: another business's, even of the same workspace, is none.
    const [photo] = await tx
      .select({ path: businessPhotos.path, type: businessPhotos.type })
      .from(businessPhotos)
      .where(
        and(
          eq(businessPhotos.workspaceId, workspaceId),
          eq(businessPhotos.propertyId, propertyId),
          eq(businessPhotos.id, photoId),
        ),
      );
    return photo === undefined ? undefined : { ...photo, workspaceId, propertyId };
  });
}

/** The brand of the business a handle names (its own look), for its stylesheet and logo routes, or undefined. */
export async function publicBusinessBrand(
  deps: { readonly db: Database },
  handle: string,
): Promise<{ readonly brand: PageBrand; readonly workspaceId: string; readonly propertyId: string } | undefined> {
  return openHandle(deps.db, handle, async (tx, workspaceId, propertyId) => {
    const [row] = await tx
      .select({ published: businessPages.publishedAt })
      .from(businessPages)
      .where(thePage(workspaceId, propertyId));
    if (row === undefined || row.published === null || !(await isLive(tx, workspaceId))) return undefined;
    return { brand: await businessBrandOf(tx, workspaceId, propertyId), workspaceId, propertyId };
  });
}

/** The listed businesses for `sitemap-handles.xml` (AC-6644): each handle, its listed places' slugs, its last change. */
export async function listSitemapBusinesses(
  deps: { readonly db: Database },
  query: { readonly after?: string; readonly max: number },
): Promise<readonly { readonly handle: string; readonly places: readonly string[]; readonly changedAt: string }[]> {
  const after = query.after !== undefined && HANDLE_PATTERN.test(query.after) ? query.after : null;
  const found = await deps.db.withWorkspace(NO_WORKSPACE, (tx) =>
    tx.execute<{ handle: string; places: string[] | null; changed_at: string | Date }>(
      sql`select handle, places, changed_at from crm_sitemap_businesses(${after}, ${Math.max(1, Math.min(query.max, 50_000))}::integer)`,
    ),
  );
  return found.rows.map((row) => ({
    handle: row.handle,
    places: (row.places ?? []).filter((slug) => PLACE_SLUG_PATTERN.test(slug)),
    changedAt: (row.changed_at instanceof Date ? row.changed_at : new Date(row.changed_at)).toISOString(),
  }));
}

/**
 * The company page a workspace's link pages lock up to (AC-6646): its first business's handle while its page is
 * published, else undefined (the lockup then links the company site as today). Read in the caller's workspace
 * transaction. The first business keeps the workspace's handle (spec 0065 H7), so this is the workspace's page.
 */
export async function publishedBusinessHandle(tx: WorkspaceTx, workspaceId: string): Promise<string | undefined> {
  const first = await currentProperty(tx, workspaceId);
  const [row] = await tx
    .select({ handle: businessPages.handle })
    .from(businessPages)
    .where(and(thePage(workspaceId, first.id), sql`${businessPages.publishedAt} is not null`));
  if (row?.handle === null || row?.handle === undefined) return undefined;
  return (await isLive(tx, workspaceId)) ? row.handle : undefined;
}

/**
 * The company page a booking page's logo links to (AC-6646), gated exactly as a link page's lockup: the business's
 * handle while its page is published and live, with the business's name for the link; else undefined. Read through
 * the booking page's own entry, inside its workspace.
 */
export async function bookingCompanyOf(entry: {
  readonly scope: EngineScope;
}): Promise<{ readonly name: string; readonly path: string } | undefined> {
  return inWorkspace(entry.scope, async (tx) => {
    const handle = await publishedBusinessHandle(tx, entry.scope.workspaceId);
    if (handle === undefined || !HANDLE_PATTERN.test(handle)) return undefined;
    const { name } = await currentProperty(tx, entry.scope.workspaceId);
    return name === null ? undefined : { name, path: `/${handle}` };
  });
}

/** The places a published snapshot names (`placeIds`, written by Publish), or undefined for a snapshot without them. */
function publishedPlaceIds(published: unknown): ReadonlySet<string> | undefined {
  if (typeof published !== 'object' || published === null) return undefined;
  const ids = (published as Record<string, unknown>).placeIds;
  return Array.isArray(ids) ? new Set(ids.filter((id): id is string => typeof id === 'string')) : undefined;
}
