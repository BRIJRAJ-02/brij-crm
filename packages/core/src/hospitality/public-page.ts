// The public business page's reads (spec 0066, B4 lite): `/<company-handle>` and `/<company-handle>/<place-slug>`.
// No session and no scope: the handle is the only key. A business handle (current or old) names its workspace through
// crm_handle's definer (`crm_business_handle_owner`), and everything after is read inside that one workspace, under
// its row level security, and only from what was published: a draft is never read here. A page that was never
// published, a deleted workspace, and a business whose apps are all off answer the same NOT_FOUND as no page at all.
import {
  BUSINESS_SECOND_SEGMENTS,
  businessCacheTags,
  businessContentOf,
  HANDLE_PATTERN,
  PLACE_SLUG_PATTERN,
  type BusinessKind,
  type PlaceHoursShape,
  type PublicBusinessPage,
  type PublicMenu,
} from '@crm/contracts';
import { schema, type Database, type WorkspaceTx } from '@crm/db';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { businessBrandOf, type PageBrand } from '../brand/public.ts';
import { isUuid } from '../engine/ids.ts';
import { refuse } from '../engine/refusals.ts';
import { pagePlaces } from './business-page.ts';
import { installedHospitalityApps } from './gate.ts';

const { businessPages, businessPhotos, businessProfiles, placeSlugs, workspaces } = schema;

/** The id `withWorkspace` takes for a read that belongs to no workspace: the definer reads past it. */
const NO_WORKSPACE = '00000000-0000-0000-0000-000000000000';

/** The one answer for every address with no live page behind it. */
const noPage = () => refuse('NOT_FOUND', 'There’s no page at this address.');

/**
 * A place's published menu, read through this one seam so the page works before the Menu app's menus (0065 H1) land:
 * the default answers nothing, and the page then shows no Menu section. H1 passes its own reader of the published
 * menu snapshot. Called only while the Menu app is installed, inside the business's own workspace transaction.
 */
export type MenuSource = (tx: WorkspaceTx, workspaceId: string, placeId: string) => Promise<PublicMenu | undefined>;

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

/**
 * Whether the business's page may be served at all: its workspace not deleted and some business app installed (its
 * early access open). Every public read asks it first, so a page, its photos, its brand and the lockup that links it
 * all go together.
 */
async function isLive(tx: WorkspaceTx, workspaceId: string): Promise<boolean> {
  const [workspace] = await tx
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(and(eq(workspaces.id, workspaceId), isNull(workspaces.deletedAt)));
  return workspace !== undefined && (await installedHospitalityApps(tx, workspaceId)).size > 0;
}

/** What the public page's entry found: the page, its workspace (for the cache tags and the brand), and its brand. */
export interface BusinessPageEntry {
  readonly page: PublicBusinessPage;
  readonly workspaceId: string;
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
  const workspaceId = await workspaceOfHandle(deps.db, handle);
  if (workspaceId === undefined) throw noPage();
  const menus = deps.menus ?? NO_MENUS;
  return deps.db.withWorkspace(workspaceId, async (tx) => {
    if (!(await isLive(tx, workspaceId))) throw noPage();
    const apps = await installedHospitalityApps(tx, workspaceId);
    const [row] = await tx
      .select({
        handle: businessPages.handle,
        published: businessPages.published,
        publishedAt: businessPages.publishedAt,
        name: businessProfiles.name,
        kind: businessProfiles.kind,
        description: businessProfiles.description,
        phone: businessProfiles.phone,
        website: businessProfiles.website,
      })
      .from(businessPages)
      .innerJoin(businessProfiles, eq(businessProfiles.workspaceId, businessPages.workspaceId))
      .where(eq(businessPages.workspaceId, workspaceId));
    if (row === undefined || row.handle === null || row.published === null || row.publishedAt === null) throw noPage();
    const content = businessContentOf(row.published);
    // Only places Publish saw (its snapshot names them): a place added or given an address since waits for Publish.
    const publishedPlaces = publishedPlaceIds(row.published);
    const shown = (await pagePlaces(tx, workspaceId)).filter(
      (place) => place.slug !== null && (publishedPlaces === undefined || publishedPlaces.has(place.id)),
    );
    if (shown.length === 0) throw noPage();
    let placeId = shown[0]?.id ?? '';
    if (slug !== undefined) {
      const [held] = await tx
        .select({ placeId: placeSlugs.placeId })
        .from(placeSlugs)
        .where(and(eq(placeSlugs.workspaceId, workspaceId), eq(placeSlugs.slug, slug)));
      if (held === undefined || !shown.some((place) => place.id === held.placeId)) throw noPage();
      placeId = held.placeId;
    }
    // Only pictures still kept: one removed since (it can't be, Publish keeps what it shows) is left out, not broken.
    const kept = new Set(
      (
        await tx
          .select({ id: businessPhotos.id })
          .from(businessPhotos)
          .where(eq(businessPhotos.workspaceId, workspaceId))
      ).map((photo) => photo.id),
    );
    const current = row.handle;
    const menu = apps.has('menu') ? await menus(tx, workspaceId, placeId) : undefined;
    const brand = await businessBrandOf(tx, workspaceId);
    const page: PublicBusinessPage = {
      handle: current,
      name: row.name,
      kind: row.kind as BusinessKind,
      ...(row.description === null ? {} : { description: row.description }),
      ...(content.about === undefined ? {} : { about: content.about }),
      ...(row.phone === null ? {} : { phone: row.phone }),
      ...(row.website === null ? {} : { website: row.website }),
      gallery: content.gallery
        .filter((photo) => kept.has(photo.id))
        .map((photo) => ({ ...photo, src: businessPhotoSrc(current, photo.id) })),
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
      ...(apps.has('table_seating') ? { reserve: 'soon' as const } : {}),
      ...(brand.answer === undefined ? {} : { brand: brand.answer }),
      indexable: !content.hiddenPlaces.includes(placeId),
      publishedAt: new Date(row.publishedAt).toISOString(),
      tags: businessCacheTags(workspaceId, [placeId]),
    };
    return { page, workspaceId, brand };
  });
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
): Promise<{ readonly path: string; readonly type: string; readonly workspaceId: string } | undefined> {
  if (!isUuid(photoId)) return undefined;
  const workspaceId = await workspaceOfHandle(deps.db, handle);
  if (workspaceId === undefined) return undefined;
  return deps.db.withWorkspace(workspaceId, async (tx) => {
    if (!(await isLive(tx, workspaceId))) return undefined;
    const [row] = await tx
      .select({ published: businessPages.published })
      .from(businessPages)
      .where(eq(businessPages.workspaceId, workspaceId));
    if (row === undefined || row.published === null) return undefined;
    if (!businessContentOf(row.published).gallery.some((photo) => photo.id === photoId)) return undefined;
    const [photo] = await tx
      .select({ path: businessPhotos.path, type: businessPhotos.type })
      .from(businessPhotos)
      .where(and(eq(businessPhotos.workspaceId, workspaceId), eq(businessPhotos.id, photoId)));
    return photo === undefined ? undefined : { ...photo, workspaceId };
  });
}

/** The brand of the business a handle names, for its stylesheet and logo routes, or undefined. */
export async function publicBusinessBrand(
  deps: { readonly db: Database },
  handle: string,
): Promise<{ readonly brand: PageBrand; readonly workspaceId: string } | undefined> {
  const workspaceId = await workspaceOfHandle(deps.db, handle);
  if (workspaceId === undefined) return undefined;
  return deps.db.withWorkspace(workspaceId, async (tx) => {
    const [row] = await tx
      .select({ published: businessPages.publishedAt })
      .from(businessPages)
      .where(eq(businessPages.workspaceId, workspaceId));
    if (row === undefined || row.published === null || !(await isLive(tx, workspaceId))) return undefined;
    return { brand: await businessBrandOf(tx, workspaceId), workspaceId };
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
 * The company page a workspace's link pages lock up to (AC-6646): its business handle while its page is published,
 * else undefined (the lockup then links the company site as today). Read in the caller's workspace transaction.
 */
export async function publishedBusinessHandle(tx: WorkspaceTx, workspaceId: string): Promise<string | undefined> {
  const [row] = await tx
    .select({ handle: businessPages.handle })
    .from(businessPages)
    .where(and(eq(businessPages.workspaceId, workspaceId), sql`${businessPages.publishedAt} is not null`));
  if (row?.handle === null || row?.handle === undefined) return undefined;
  return (await isLive(tx, workspaceId)) ? row.handle : undefined;
}

/** The places a published snapshot names (`placeIds`, written by Publish), or undefined for a snapshot without them. */
function publishedPlaceIds(published: unknown): ReadonlySet<string> | undefined {
  if (typeof published !== 'object' || published === null) return undefined;
  const ids = (published as Record<string, unknown>).placeIds;
  return Array.isArray(ids) ? new Set(ids.filter((id): id is string => typeof id === 'string')) : undefined;
}
