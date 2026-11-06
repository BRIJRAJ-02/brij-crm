// Settings › Business › Page (spec 0066, B4 lite): the business page's address, its draft, each place's slug and
// Publish. `hospitality.manage` only, checked before any input is read, and only while some business app is installed
// (`requireAnyApp`). The handle and slugs are claimed at once (spec 0068, AC-6813); the content is a draft that guests
// never see until Publish, which refuses a page that would be broken with one line saying what to fix (the
// Foolproof rule). Publish keeps the snapshot guests read and lists or unlists the business for search engines.
//
// The draft and snapshot live on the page's own row (`draft`, `published`, `version`) until spec 0068's shared
// `page_versions` lands; moving them there is a copy of these two columns.
import {
  BUSINESS_PAGE_LIMITS,
  businessContentOf,
  businessPageChanges,
  businessPublishProblem,
  handleCandidatesFromName,
  hasWeeklyHours,
  isReservedHandle,
  placeSlugFromName,
  type BusinessPageContent,
  type BusinessPageContentShape,
  type BusinessPageView,
  type PlaceHours,
} from '@crm/contracts';
import { schema, type WorkspaceTx } from '@crm/db';
import { and, asc, count, eq, sql } from 'drizzle-orm';
import { requirePermission } from '../access/check.ts';
import type { EngineScope } from '../access/mint.ts';
import { inWorkspace } from '../access/run.ts';
import { lockKey } from '../booking/locks.ts';
import { checkId } from '../engine/ids.ts';
import { inputInvalid, postgresError, refuse, refuseOn } from '../engine/refusals.ts';
import { appointmentsReadiness } from '../visits/readiness.ts';
import { auditSetup, hospitalityMember, installedHospitalityApps, requireAnyApp } from './gate.ts';
import { PLACE_NOT_FOUND } from './places.ts';
import { currentProperty, currentPropertyRef } from './property.ts';

const { businessPages, businessPhotos, placePages, placeSlugs, places } = schema;

/** A condition naming this workspace's business page row. */
export const thePage = (workspaceId: string) =>
  and(eq(businessPages.workspaceId, workspaceId), eq(businessPages.propertyId, currentPropertyRef(workspaceId)));

/** The folder a business's pictures are kept under in the private store. */
export function businessPhotoFolder(workspaceId: string): string {
  return `business-page/${workspaceId}/`;
}

/** A gallery picture's path in the store: the workspace's folder and the picture's own id (the database checks it). */
export function businessPhotoPath(workspaceId: string, photoId: string, type: string): string {
  const extension = type === 'image/jpeg' ? 'jpg' : type === 'image/png' ? 'png' : 'webp';
  return `${businessPhotoFolder(workspaceId)}${photoId}.${extension}`;
}

/** One place as the editor and the public read take it, with its current slug when it has one. */
export interface PagePlaceRow {
  readonly id: string;
  readonly propertyId: string;
  readonly name: string;
  readonly addressLine: string | null;
  readonly city: string | null;
  readonly postcode: string | null;
  readonly country: string;
  readonly timeZone: string;
  readonly phone: string | null;
  readonly hours: unknown;
  readonly slug: string | null;
}

/** The workspace's places in order, each with its current slug. */
export async function pagePlaces(tx: WorkspaceTx, workspaceId: string): Promise<readonly PagePlaceRow[]> {
  return tx
    .select({
      id: places.id,
      propertyId: places.propertyId,
      name: places.name,
      addressLine: places.addressLine,
      city: places.city,
      postcode: places.postcode,
      country: places.country,
      timeZone: places.timeZone,
      phone: places.phone,
      hours: places.hours,
      slug: placePages.slug,
    })
    .from(places)
    .leftJoin(placePages, and(eq(placePages.workspaceId, places.workspaceId), eq(placePages.placeId, places.id)))
    .where(eq(places.workspaceId, workspaceId))
    .orderBy(asc(places.position), asc(places.id));
}

interface PageRow {
  readonly handle: string | null;
  readonly draft: unknown;
  readonly published: unknown;
  readonly publishedAt: Date | string | null;
  readonly version: number;
}

/** The page's row, or undefined before anything was saved. */
async function pageRowOf(tx: WorkspaceTx, workspaceId: string): Promise<PageRow | undefined> {
  const [row] = await tx
    .select({
      handle: businessPages.handle,
      draft: businessPages.draft,
      published: businessPages.published,
      publishedAt: businessPages.publishedAt,
      version: businessPages.version,
    })
    .from(businessPages)
    .where(thePage(workspaceId));
  return row;
}

/** Makes the page's row when there is none, so every write below can update it. */
async function ensurePageRow(tx: WorkspaceTx, workspaceId: string, by: string): Promise<void> {
  await tx
    .insert(businessPages)
    .values({ workspaceId, propertyId: currentPropertyRef(workspaceId), updatedByMemberId: by })
    .onConflictDoNothing({ target: [businessPages.workspaceId, businessPages.propertyId] });
}

/** Whether two contents are the same page (key order aside). */
const sameContent = (a: BusinessPageContentShape, b: BusinessPageContentShape) =>
  JSON.stringify(businessContentOf(a)) === JSON.stringify(businessContentOf(b));

/** The editor's view of the page, read in the caller's transaction. */
async function viewOf(tx: WorkspaceTx, workspaceId: string): Promise<BusinessPageView> {
  const row = await pageRowOf(tx, workspaceId);
  const placeRows = await pagePlaces(tx, workspaceId);
  const { name: propertyName } = await currentProperty(tx, workspaceId);
  const apps = await installedHospitalityApps(tx, workspaceId);
  const draft = businessContentOf(row?.draft);
  const published =
    row?.published === null || row?.published === undefined ? undefined : businessContentOf(row.published);
  const names = new Map(placeRows.map((place) => [place.id, place.name]));
  // A place Publish didn't see (added since) waits for the next Publish, and says so.
  const placeIds = (row?.published as { readonly placeIds?: unknown } | null | undefined)?.placeIds;
  const waiting = Array.isArray(placeIds) ? placeRows.filter((place) => !placeIds.includes(place.id)) : [];
  const changes = [
    ...businessPageChanges(published, draft, (id) => names.get(id) ?? 'A place'),
    ...waiting.map((place) => `${place.name}: added to the page`),
  ];
  const problem = businessPublishProblem({
    ...(row?.handle === null || row?.handle === undefined ? {} : { handle: row.handle }),
    ...(propertyName === null ? {} : { name: propertyName }),
    places: placeRows.map((place) => ({
      id: place.id,
      name: place.name,
      ...(place.addressLine === null ? {} : { addressLine: place.addressLine }),
      ...(place.city === null ? {} : { city: place.city }),
      hours: place.hours as PlaceHours,
    })),
    // With Appointments, Book needs something bookable behind it (spec 0066 B1; spec 0068, Foolproof).
    ...(apps.has('appointments') ? { appointments: await appointmentsReadiness(tx) } : {}),
  });
  const hasHandle = row?.handle !== null && row?.handle !== undefined;
  const suggested = hasHandle || propertyName === null ? undefined : await freeHandleFor(tx, propertyName);
  return {
    ...(row?.handle === null || row?.handle === undefined ? {} : { handle: row.handle }),
    ...(suggested === undefined ? {} : { suggestedHandle: suggested }),
    draft: draft as BusinessPageContent,
    ...(row?.publishedAt === null || row?.publishedAt === undefined
      ? {}
      : { published: { at: new Date(row.publishedAt).toISOString(), version: Math.max(1, row.version) } }),
    hasChanges: published === undefined ? true : !sameContent(published, draft) || waiting.length > 0,
    changes: [...changes],
    places: placeRows.map((place) => ({
      id: place.id,
      name: place.name,
      ...(place.slug === null ? {} : { slug: place.slug }),
      hasAddress: (place.addressLine ?? '').trim() !== '' && (place.city ?? '').trim() !== '',
      hasHours: hasWeeklyHours(place.hours as PlaceHours),
    })),
    showsMenu: apps.has('menu'),
    showsReserve: apps.has('table_seating'),
    ...(problem === undefined ? {} : { problem }),
  };
}

/**
 * The first free handle the business's name suggests (Foolproof: the address field starts filled), or undefined. A
 * reserved word or a handle anybody holds or held (`crm_handle_taken`, a boolean through crm_handle's definer) is
 * skipped; at most five are asked, in one statement.
 */
async function freeHandleFor(tx: WorkspaceTx, name: string): Promise<string | undefined> {
  const candidates = handleCandidatesFromName(name).filter((handle) => !isReservedHandle(handle));
  if (candidates.length === 0) return undefined;
  const found = await tx.execute<{ handle: string }>(
    sql`select c.handle from unnest(${`{${candidates.join(',')}}`}::text[]) with ordinality as c(handle, n)
        where not crm_handle_taken(c.handle) order by c.n limit 1`,
  );
  return found.rows[0]?.handle;
}

/** Settings › Business › Page: the address, the draft, what is live and what Publish needs. */
export async function getBusinessPage(scope: EngineScope): Promise<BusinessPageView> {
  requirePermission(scope, 'hospitality.manage');
  return inWorkspace(scope, async (tx) => {
    await requireAnyApp(tx, scope.workspaceId);
    return viewOf(tx, scope.workspaceId);
  });
}

/** What a write of the page answers: the view, and the edge cache tags it made stale. */
export interface BusinessPageChange {
  readonly view: BusinessPageView;
  /** The handles whose public answers changed (the old one too, after a new address). */
  readonly stale: boolean;
}

/**
 * Claims the page's address (AC-6640): at once, not drafted, since an address must be held before it is shared. An
 * address anybody holds or held (a person's or another business's) is `SLUG_TAKEN` on `handle`; the business's own
 * old one is its own again; past 20 held, `LIMIT_REACHED`. The old address keeps finding the page.
 */
export async function claimBusinessHandle(
  scope: EngineScope,
  input: { readonly handle: string },
): Promise<BusinessPageChange> {
  requirePermission(scope, 'hospitality.manage');
  const by = hospitalityMember(scope);
  return inWorkspace(scope, async (tx) => {
    await requireAnyApp(tx, scope.workspaceId);
    await ensurePageRow(tx, scope.workspaceId, by);
    try {
      await tx.transaction((savepoint) =>
        savepoint.execute(sql`select crm_claim_business_handle(${scope.workspaceId}::uuid, ${input.handle})`),
      );
    } catch (error) {
      const pg = postgresError(error);
      if (pg?.code === '23505') throw refuseOn('SLUG_TAKEN', 'That address is taken. Pick another.', 'handle');
      if (pg?.code === 'P0001') {
        throw refuseOn('LIMIT_REACHED', 'A business can change its address up to 20 times.', 'handle');
      }
      if (pg?.code === '22023') throw inputInvalid('handle', 'Use lowercase letters, numbers and single hyphens.');
      throw error;
    }
    const before = await pageRowOf(tx, scope.workspaceId);
    await tx
      .update(businessPages)
      .set({ handle: input.handle, updatedAt: sql`now()`, updatedByMemberId: by })
      .where(thePage(scope.workspaceId));
    // A first address gives each place its first slug, so the page has every address it needs from the start.
    await ensurePlaceSlugs(tx, scope.workspaceId);
    if (before?.publishedAt !== null && before?.publishedAt !== undefined) await listBusiness(tx, scope.workspaceId);
    await auditSetup(tx, scope, 'business_page.address');
    return { view: await viewOf(tx, scope.workspaceId), stale: before?.handle !== input.handle };
  });
}

/** Gives every place without a slug its first one, from its name, made unique in the workspace with a number. */
async function ensurePlaceSlugs(tx: WorkspaceTx, workspaceId: string): Promise<void> {
  await lockKey(tx, `place-slugs:${workspaceId}`);
  const rows = await pagePlaces(tx, workspaceId);
  const held = new Set(
    (await tx.select({ slug: placeSlugs.slug }).from(placeSlugs).where(eq(placeSlugs.workspaceId, workspaceId))).map(
      (row) => row.slug,
    ),
  );
  for (const place of rows) {
    if (place.slug !== null) continue;
    const base = placeSlugFromName(place.name);
    let slug = base;
    for (let n = 2; held.has(slug); n += 1) {
      const suffix = `-${String(n)}`;
      slug = `${base.slice(0, BUSINESS_PAGE_LIMITS.slugMax - suffix.length).replace(/-+$/, '')}${suffix}`;
    }
    held.add(slug);
    await tx.insert(placeSlugs).values({ workspaceId, slug, placeId: place.id });
    await tx.insert(placePages).values({ workspaceId, placeId: place.id, propertyId: place.propertyId, slug });
  }
}

/**
 * Sets a place's address on the page, `/<handle>/<slug>` (AC-6640): at once, and its old slug keeps finding it. A
 * slug another place of the business holds or held is `SLUG_TAKEN` on `slug`; the place's own old one is its own again.
 */
export async function setPlaceSlug(
  scope: EngineScope,
  input: { readonly placeId: string; readonly slug: string },
): Promise<BusinessPageChange> {
  requirePermission(scope, 'hospitality.manage');
  const by = hospitalityMember(scope);
  const placeId = checkId(input.placeId, PLACE_NOT_FOUND);
  return inWorkspace(scope, async (tx) => {
    await requireAnyApp(tx, scope.workspaceId);
    await lockKey(tx, `place-slugs:${scope.workspaceId}`);
    const [place] = await tx
      .select({ id: places.id, propertyId: places.propertyId })
      .from(places)
      .where(and(eq(places.workspaceId, scope.workspaceId), eq(places.id, placeId)));
    if (place === undefined) throw refuse('NOT_FOUND', PLACE_NOT_FOUND);
    const [holder] = await tx
      .select({ placeId: placeSlugs.placeId })
      .from(placeSlugs)
      .where(and(eq(placeSlugs.workspaceId, scope.workspaceId), eq(placeSlugs.slug, input.slug)));
    if (holder !== undefined && holder.placeId !== placeId) {
      throw refuseOn('SLUG_TAKEN', 'Another place has, or had, this address. Pick another.', 'slug');
    }
    if (holder === undefined) {
      await tx.insert(placeSlugs).values({ workspaceId: scope.workspaceId, slug: input.slug, placeId });
    }
    await tx
      .insert(placePages)
      .values({ workspaceId: scope.workspaceId, placeId, propertyId: place.propertyId, slug: input.slug })
      .onConflictDoUpdate({
        target: [placePages.workspaceId, placePages.placeId],
        set: { slug: input.slug, updatedAt: sql`now()` },
      });
    await ensurePageRow(tx, scope.workspaceId, by);
    const row = await pageRowOf(tx, scope.workspaceId);
    if (row?.publishedAt !== null && row?.publishedAt !== undefined) await listBusiness(tx, scope.workspaceId);
    await auditSetup(tx, scope, 'business_page.place_address', { placeId });
    return { view: await viewOf(tx, scope.workspaceId), stale: true };
  });
}

/**
 * Saves the draft, whole (spec 0068, AC-6810): guests keep seeing the published page. Every gallery picture must be
 * one of the business's own, and every hidden place one of its places.
 */
export async function saveBusinessPage(
  scope: EngineScope,
  input: { readonly draft: BusinessPageContent },
): Promise<BusinessPageView> {
  requirePermission(scope, 'hospitality.manage');
  const by = hospitalityMember(scope);
  return inWorkspace(scope, async (tx) => {
    await requireAnyApp(tx, scope.workspaceId);
    const photoIds = input.draft.gallery.map((photo) => photo.id);
    if (photoIds.length > 0) {
      const found = await tx
        .select({ id: businessPhotos.id })
        .from(businessPhotos)
        .where(
          and(
            eq(businessPhotos.workspaceId, scope.workspaceId),
            eq(businessPhotos.propertyId, currentPropertyRef(scope.workspaceId)),
            sql`${businessPhotos.id} = any(${`{${photoIds.join(',')}}`}::uuid[])`,
          ),
        );
      if (found.length !== new Set(photoIds).size) throw inputInvalid('gallery', 'A photo was removed. Add it again.');
    }
    if (input.draft.hiddenPlaces.length > 0) {
      const ids = new Set((await pagePlaces(tx, scope.workspaceId)).map((place) => place.id));
      if (input.draft.hiddenPlaces.some((id) => !ids.has(id))) throw refuse('NOT_FOUND', PLACE_NOT_FOUND);
    }
    await ensurePageRow(tx, scope.workspaceId, by);
    await tx
      .update(businessPages)
      .set({
        draft: businessContentOf(input.draft),
        draftChangedAt: sql`now()`,
        updatedAt: sql`now()`,
        updatedByMemberId: by,
      })
      .where(thePage(scope.workspaceId));
    await auditSetup(tx, scope, 'business_page.draft_saved');
    return viewOf(tx, scope.workspaceId);
  });
}

/** What Publish answers: the view, and the stored pictures no draft or snapshot uses any more (to delete). */
export interface BusinessPagePublished extends BusinessPageChange {
  readonly unusedPaths: readonly string[];
}

/** Lists or unlists the business for search engines from its published snapshot (AC-6644). */
async function listBusiness(tx: WorkspaceTx, workspaceId: string): Promise<void> {
  const row = await pageRowOf(tx, workspaceId);
  const published =
    row?.published === null || row?.published === undefined ? undefined : businessContentOf(row.published);
  const placeRows = await pagePlaces(tx, workspaceId);
  const listed = placeRows.filter(
    (place) => place.slug !== null && !(published?.hiddenPlaces ?? []).includes(place.id),
  );
  // A business with one place is listed at its handle alone; with several, each listed place has its own address.
  const slugs = placeRows.length > 1 ? listed.flatMap((place) => (place.slug === null ? [] : [place.slug])) : [];
  const isListed = published !== undefined && row?.handle !== null && row?.handle !== undefined && listed.length > 0;
  await tx.execute(
    sql`select crm_list_business(${workspaceId}::uuid, ${row?.handle ?? null}, ${`{${slugs.join(',')}}`}::text[], ${isListed})`,
  );
}

/**
 * Brings the business's search listing in line with its apps (spec 0066, AC-6644), in the apps write's transaction:
 * with no business app left the page is not live (the public reads answer 404), so the sitemap drops it; with one
 * back, a published page is listed again from its snapshot. Answers whether the business has a page row at all, so
 * the caller knows whether there are public copies at the edge to delete.
 */
export async function syncBusinessListing(tx: WorkspaceTx, workspaceId: string, hasApps: boolean): Promise<boolean> {
  const row = await pageRowOf(tx, workspaceId);
  if (row === undefined) return false;
  if (hasApps) await listBusiness(tx, workspaceId);
  else await tx.execute(sql`select crm_list_business(${workspaceId}::uuid, null, '{}'::text[], false)`);
  return true;
}

/**
 * Publishes the draft (spec 0068, AC-6810, AC-6816): the snapshot guests read, a new version, and the business
 * listed or unlisted for search engines. A page that would be broken is refused `VALIDATION_FAILED` with the one line
 * that says what to fix (no address, no name, no place, a place with no address or hours). Publishing an unchanged
 * page publishes it again, harmlessly. Pictures neither the draft nor the snapshot uses any more are dropped, and
 * their paths answered so the caller removes them from the store.
 */
export async function publishBusinessPage(scope: EngineScope): Promise<BusinessPagePublished> {
  requirePermission(scope, 'hospitality.manage');
  const by = hospitalityMember(scope);
  return inWorkspace(scope, async (tx) => {
    await requireAnyApp(tx, scope.workspaceId);
    await lockKey(tx, `business-page:${scope.workspaceId}`);
    await ensurePageRow(tx, scope.workspaceId, by);
    await ensurePlaceSlugs(tx, scope.workspaceId);
    const before = await viewOf(tx, scope.workspaceId);
    if (before.problem !== undefined) throw refuseOn('VALIDATION_FAILED', before.problem.message, before.problem.fix);
    await tx
      .update(businessPages)
      .set({
        // The snapshot names the places it was published with, so a place added later waits for the next Publish.
        published: sql`${businessPages.draft} || jsonb_build_object('placeIds', (select coalesce(jsonb_agg(pp.place_id), '[]'::jsonb) from place_pages pp where pp.workspace_id = ${scope.workspaceId}::uuid and pp.property_id = ${businessPages.propertyId}))`,
        publishedAt: sql`now()`,
        publishedByMemberId: by,
        version: sql`${businessPages.version} + 1`,
        updatedAt: sql`now()`,
        updatedByMemberId: by,
      })
      .where(thePage(scope.workspaceId));
    await listBusiness(tx, scope.workspaceId);
    const used = new Set(before.draft.gallery.map((photo) => photo.id));
    const unused = await tx
      .delete(businessPhotos)
      .where(
        and(
          eq(businessPhotos.workspaceId, scope.workspaceId),
          eq(businessPhotos.propertyId, currentPropertyRef(scope.workspaceId)),
          // A picture uploaded in the last ten minutes may not be in the draft yet: it stays until a later Publish.
          sql`${businessPhotos.createdAt} < now() - interval '10 minutes'`,
          ...(used.size === 0 ? [] : [sql`not (${businessPhotos.id} = any(${`{${[...used].join(',')}}`}::uuid[]))`]),
        ),
      )
      .returning({ path: businessPhotos.path });
    await auditSetup(tx, scope, 'business_page.published');
    return { view: await viewOf(tx, scope.workspaceId), stale: true, unusedPaths: unused.map((row) => row.path) };
  });
}

/** Discards the draft (AC-6811): it goes back to what guests see. Nothing published yet empties it. */
export async function discardBusinessPage(scope: EngineScope): Promise<BusinessPageView> {
  requirePermission(scope, 'hospitality.manage');
  const by = hospitalityMember(scope);
  return inWorkspace(scope, async (tx) => {
    await requireAnyApp(tx, scope.workspaceId);
    await tx
      .update(businessPages)
      .set({
        draft: sql`coalesce(${businessPages.published}, '{}'::jsonb)`,
        draftChangedAt: null,
        updatedAt: sql`now()`,
        updatedByMemberId: by,
      })
      .where(thePage(scope.workspaceId));
    await auditSetup(tx, scope, 'business_page.discarded');
    return viewOf(tx, scope.workspaceId);
  });
}

/**
 * Keeps one uploaded gallery picture's row (the API stored its bytes at `businessPhotoPath` first). At most 60 kept
 * at once (`LIMIT_REACHED`): a Publish drops those nothing uses. Answers the path it must be stored at.
 */
export async function addBusinessPhoto(
  scope: EngineScope,
  input: {
    readonly id: string;
    readonly type: 'image/jpeg' | 'image/png' | 'image/webp';
    readonly bytes: number;
    readonly width: number;
    readonly height: number;
  },
): Promise<{ readonly path: string }> {
  requirePermission(scope, 'hospitality.manage');
  const by = hospitalityMember(scope);
  const id = checkId(input.id, 'That photo doesn’t exist.');
  return inWorkspace(scope, async (tx) => {
    await requireAnyApp(tx, scope.workspaceId);
    await lockKey(tx, `business-page:${scope.workspaceId}`);
    const [held] = await tx
      .select({ n: count() })
      .from(businessPhotos)
      .where(eq(businessPhotos.workspaceId, scope.workspaceId));
    if ((held?.n ?? 0) >= BUSINESS_PAGE_LIMITS.photosStored) {
      throw refuse('LIMIT_REACHED', 'Publish or discard your changes before adding more photos.');
    }
    const path = businessPhotoPath(scope.workspaceId, id, input.type);
    await tx.insert(businessPhotos).values({
      workspaceId: scope.workspaceId,
      id,
      propertyId: currentPropertyRef(scope.workspaceId),
      path,
      type: input.type,
      bytes: input.bytes,
      width: input.width,
      height: input.height,
      createdByMemberId: by,
    });
    await auditSetup(tx, scope, 'business_page.photo_added', { photoId: id });
    return { path };
  });
}

/** One of the business's own pictures for its editor (any it keeps, drafted or not), or undefined. */
export async function readBusinessPhoto(
  scope: EngineScope,
  input: { readonly id: string },
): Promise<{ readonly path: string; readonly type: string } | undefined> {
  requirePermission(scope, 'hospitality.manage');
  const id = checkId(input.id, 'That photo doesn’t exist.');
  return inWorkspace(scope, async (tx) => {
    const [row] = await tx
      .select({ path: businessPhotos.path, type: businessPhotos.type })
      .from(businessPhotos)
      .where(and(eq(businessPhotos.workspaceId, scope.workspaceId), eq(businessPhotos.id, id)));
    return row;
  });
}
