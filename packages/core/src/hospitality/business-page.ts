// Settings › Business › Page (spec 0066, B4 lite): the business page's address, its draft, each place's slug and
// Publish. `hospitality.manage` only, checked before any input is read, and only while some business app is installed
// (`requireAnyApp`). The handle and slugs are claimed at once (spec 0068, AC-6813); the content is a draft that guests
// never see until Publish, which refuses a page that would be broken with one line saying what to fix (the
// Foolproof rule). Publish keeps the snapshot guests read and lists or unlists the business for search engines.
//
// The draft and snapshot live on the page's own row (`draft`, `published`, `version`) until spec 0068's shared
// `page_versions` lands; moving them there is a copy of these two columns.
//
// One page per business (spec 0065 H7, AC-6592): every call works in the business it names (`propertyId`, the
// switcher's choice), else the first. The first business keeps the workspace's handle and claims a new one at once, as
// before. Another business's address is only a wish (`pending_handle`) until its first Publish claims it, so nobody can
// hold names by the dozen; a workspace makes at most 5 new handles a day (crm_claim_business_handle), and a person at
// most 10 across every workspace (`HandleBudget`, owner decision 10 Nov 2026). Which business
// a handle belongs to is `property_handles`, so an old handle keeps finding its own business's page.
import {
  APPOINTMENT_KINDS,
  BUSINESS_PAGE_LIMITS,
  businessContentOf,
  businessPageChanges,
  businessPublishProblem,
  handleCandidatesFromName,
  hasWeeklyHours,
  isReservedHandle,
  placeSlugFromName,
  type BusinessKind,
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
import { auditSetup, hospitalityMember, installedHospitalityApps, requireAnyApp, requireBusiness } from './gate.ts';
import { PLACE_NOT_FOUND } from './places.ts';
import { currentProperty, type CurrentProperty } from './property.ts';
import { propertyInReach, propertyReachSql, reachOf } from './reach.ts';

const { businessPages, businessPhotos, placePages, placeSlugs, places, propertyHandles } = schema;

/** A condition naming one business's page row. */
export const thePage = (workspaceId: string, propertyId: string) =>
  and(eq(businessPages.workspaceId, workspaceId), eq(businessPages.propertyId, propertyId));

/** Which business a page call works in: the one it names, else the first (spec 0065 H7). */
export interface InBusiness {
  readonly propertyId?: string | undefined;
}

/**
 * The business a call names (another workspace's, or one outside the member's reach, reads as none: `NOT_FOUND`),
 * else the first the member sees. The page is the whole business's: changing it needs all of it in reach (AC-6594).
 */
const businessOf = (
  tx: WorkspaceTx,
  scope: EngineScope,
  where: InBusiness,
  need: 'see' | 'whole' = 'whole',
): Promise<CurrentProperty> => propertyInReach(tx, scope, where.propertyId, need);

/** Whether a business is its workspace's first: the one that keeps the workspace's handle and claims at once. */
async function isFirst(tx: WorkspaceTx, workspaceId: string, property: CurrentProperty): Promise<boolean> {
  return (await currentProperty(tx, workspaceId)).id === property.id;
}

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

/** A business's places in order, each with its current slug. */
export async function pagePlaces(
  tx: WorkspaceTx,
  workspaceId: string,
  propertyId: string,
): Promise<readonly PagePlaceRow[]> {
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
    .where(and(eq(places.workspaceId, workspaceId), eq(places.propertyId, propertyId)))
    .orderBy(asc(places.position), asc(places.id));
}

interface PageRow {
  readonly handle: string | null;
  readonly pendingHandle: string | null;
  readonly draft: unknown;
  readonly published: unknown;
  readonly publishedAt: Date | string | null;
  readonly version: number;
}

/** The page's row, or undefined before anything was saved. */
async function pageRowOf(tx: WorkspaceTx, workspaceId: string, propertyId: string): Promise<PageRow | undefined> {
  const [row] = await tx
    .select({
      handle: businessPages.handle,
      pendingHandle: businessPages.pendingHandle,
      draft: businessPages.draft,
      published: businessPages.published,
      publishedAt: businessPages.publishedAt,
      version: businessPages.version,
    })
    .from(businessPages)
    .where(thePage(workspaceId, propertyId));
  return row;
}

/** Makes the page's row when there is none, so every write below can update it. */
async function ensurePageRow(tx: WorkspaceTx, workspaceId: string, propertyId: string, by: string): Promise<void> {
  await tx
    .insert(businessPages)
    .values({ workspaceId, propertyId, updatedByMemberId: by })
    .onConflictDoNothing({ target: [businessPages.workspaceId, businessPages.propertyId] });
}

/** Whether two contents are the same page (key order aside). */
const sameContent = (a: BusinessPageContentShape, b: BusinessPageContentShape) =>
  JSON.stringify(businessContentOf(a)) === JSON.stringify(businessContentOf(b));

/** The editor's view of a business's page, read in the caller's transaction. */
async function viewOf(tx: WorkspaceTx, workspaceId: string, property: CurrentProperty): Promise<BusinessPageView> {
  const row = await pageRowOf(tx, workspaceId, property.id);
  const placeRows = await pagePlaces(tx, workspaceId, property.id);
  const { name: propertyName, kind: propertyKind } = property;
  // A business other than the first keeps the address it chose until its first Publish takes it (AC-6592).
  const handle = row?.handle ?? row?.pendingHandle ?? null;
  const onPublish = (row?.handle ?? null) === null && !(await isFirst(tx, workspaceId, property));
  const apps = await installedHospitalityApps(tx, workspaceId);
  // Every app is on by default, so what the page says and asks for follows the kind of business: a restaurant is never
  // asked for a service, and a salon's page never offers a table.
  const booksPeople = propertyKind !== null && APPOINTMENT_KINDS.includes(propertyKind as BusinessKind);
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
    ...(handle === null ? {} : { handle }),
    ...(propertyName === null ? {} : { name: propertyName }),
    places: placeRows.map((place) => ({
      id: place.id,
      name: place.name,
      ...(place.addressLine === null ? {} : { addressLine: place.addressLine }),
      ...(place.city === null ? {} : { city: place.city }),
      hours: place.hours as PlaceHours,
    })),
    // With Appointments, Book needs something bookable behind it (spec 0066 B1; spec 0068, Foolproof).
    ...(apps.has('appointments') && booksPeople ? { appointments: await appointmentsReadiness(tx) } : {}),
  });
  const suggested = handle !== null || propertyName === null ? undefined : await freeHandleFor(tx, propertyName);
  return {
    ...(handle === null ? {} : { handle }),
    ...(onPublish ? { handleOnPublish: true as const } : {}),
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
    showsMenu: apps.has('menu') && !booksPeople,
    showsReserve: apps.has('table_seating') && !booksPeople,
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

/** Settings › Business › Page: a business's address, its draft, what is live and what Publish needs. */
export async function getBusinessPage(scope: EngineScope, where: InBusiness = {}): Promise<BusinessPageView> {
  requirePermission(scope, 'hospitality.manage');
  return inWorkspace(scope, async (tx) => {
    await requireAnyApp(tx, scope.workspaceId);
    return viewOf(tx, scope.workspaceId, await businessOf(tx, scope, where, 'see'));
  });
}

/** The refusals a handle claim answers, by what crm_claim_business_handle raised. */
function claimRefusal(error: unknown): Error {
  const pg = postgresError(error);
  if (pg?.code === '23505') return refuseOn('SLUG_TAKEN', 'That address is taken. Pick another.', 'handle');
  if (pg?.code === 'P0001') {
    return (error as { readonly message?: unknown }).message === 'BUSINESS_HANDLE_DAILY' ||
      (pg as { readonly message?: unknown }).message === 'BUSINESS_HANDLE_DAILY'
      ? refuseOn('LIMIT_REACHED', 'Your workspace has taken 5 new addresses today. Try again tomorrow.', 'handle')
      : refuseOn('LIMIT_REACHED', 'A business can change its address up to 20 times.', 'handle');
  }
  if (pg?.code === '22023') return inputInvalid('handle', 'Use lowercase letters, numbers and single hyphens.');
  return error instanceof Error ? error : new Error('The address couldn’t be claimed.');
}

/** How many addresses one business may have held (AC-6640's 20, now per business). */
const HANDLES_PER_BUSINESS = 20;

/** How many new business addresses one person may take a day, across every workspace (owner decision, 10 Nov 2026). */
export const BUSINESS_HANDLES_PER_PERSON_DAILY = 10;

/** The refusal for a person past their daily new addresses, in the one error shape. */
const PERSON_DAILY_REFUSAL = `You’ve taken ${String(BUSINESS_HANDLES_PER_PERSON_DAILY)} new addresses today. Try again tomorrow.`;

/**
 * The person's own budget of new business addresses (owner decision, 10 Nov 2026): 10 a day across every workspace
 * they work in, on top of each workspace's 5. The api backs it with the durable limiter keyed by the person's user id,
 * so it holds across instances and workspaces. `take` spends one at once and answers whether it was there to spend,
 * in one atomic step, so parallel claims can never pass the cap together; a claim refused after it (the workspace's 5,
 * an address taken meanwhile) still costs the person one, the price of a cap nobody can race.
 */
export interface HandleBudget {
  readonly take: () => Promise<boolean>;
}

/** What the page's handle writes take beyond the scope: the person's budget, when the caller has one. */
export interface HandleDeps {
  readonly handleBudget?: HandleBudget | undefined;
}

/**
 * Takes `handle` for `property` (AC-6592): held for the workspace through crm_handle's definer (anybody else's is
 * `SLUG_TAKEN`; past 5 new ones today, `LIMIT_REACHED`; a new one past the person's budget, `LIMIT_REACHED` first), then for this business in `property_handles`: one another of
 * the workspace's businesses holds or held is `SLUG_TAKEN` too, and one business holds at most 20. Its own old one is
 * its own again, free. Answers whether the handle was a new one (nobody held it before).
 */
async function takeHandle(
  tx: WorkspaceTx,
  workspaceId: string,
  propertyId: string,
  handle: string,
  budget?: HandleBudget,
): Promise<boolean> {
  // A handle nobody holds or held is a new one, the only kind the person's daily budget counts: their own business's
  // old address is theirs again for free, and one somebody else holds is refused below whatever the budget says.
  const taken = await tx.execute<{ taken: boolean }>(sql`select crm_handle_taken(${handle}) as taken`);
  const isNew = taken.rows[0]?.taken !== true;
  if (isNew && budget !== undefined && !(await budget.take())) {
    throw refuseOn('LIMIT_REACHED', PERSON_DAILY_REFUSAL, 'handle');
  }
  try {
    await tx.transaction((savepoint) =>
      savepoint.execute(sql`select crm_claim_business_handle(${workspaceId}::uuid, ${handle})`),
    );
  } catch (error) {
    throw claimRefusal(error);
  }
  // After the definer, which holds the workspace's handle lock until commit, so two businesses never take one handle.
  const [holder] = await tx
    .select({ propertyId: propertyHandles.propertyId })
    .from(propertyHandles)
    .where(and(eq(propertyHandles.workspaceId, workspaceId), eq(propertyHandles.handle, handle)));
  if (holder !== undefined) {
    if (holder.propertyId !== propertyId) {
      throw refuseOn('SLUG_TAKEN', 'Another of your businesses has, or had, this address. Pick another.', 'handle');
    }
    return false;
  }
  const [held] = await tx
    .select({ n: count() })
    .from(propertyHandles)
    .where(and(eq(propertyHandles.workspaceId, workspaceId), eq(propertyHandles.propertyId, propertyId)));
  if ((held?.n ?? 0) >= HANDLES_PER_BUSINESS) {
    throw refuseOn('LIMIT_REACHED', 'A business can change its address up to 20 times.', 'handle');
  }
  await tx.insert(propertyHandles).values({ workspaceId, handle, propertyId });
  return isNew;
}

/**
 * Whether a business other than the first may wish for `handle` now (it is taken only at Publish): nobody holds or
 * held it, or it is this business's own. Answers the refusal, or undefined.
 */
async function wishRefusal(
  tx: WorkspaceTx,
  workspaceId: string,
  propertyId: string,
  handle: string,
): Promise<Error | undefined> {
  const [holder] = await tx
    .select({ propertyId: propertyHandles.propertyId })
    .from(propertyHandles)
    .where(and(eq(propertyHandles.workspaceId, workspaceId), eq(propertyHandles.handle, handle)));
  if (holder?.propertyId === propertyId) return undefined;
  const taken = await tx.execute<{ taken: boolean }>(sql`select crm_handle_taken(${handle}) as taken`);
  if (holder !== undefined || taken.rows[0]?.taken === true) {
    return refuseOn('SLUG_TAKEN', 'That address is taken. Pick another.', 'handle');
  }
  return undefined;
}

/** What a write of the page answers: the view, and the edge cache tags it made stale. */
export interface BusinessPageChange {
  readonly view: BusinessPageView;
  /** The handles whose public answers changed (the old one too, after a new address). */
  readonly stale: boolean;
  /** Whether the write took an address nobody held before (and so spent one of the person's daily budget). */
  readonly madeHandle?: true;
}

/**
 * Claims the page's address (AC-6640): at once, not drafted, since an address must be held before it is shared. An
 * address anybody holds or held (a person's or another business's) is `SLUG_TAKEN` on `handle`; the business's own
 * old one is its own again; past 20 held, `LIMIT_REACHED`. The old address keeps finding the page.
 */
export async function claimBusinessHandle(
  scope: EngineScope,
  input: { readonly handle: string } & InBusiness,
  deps: HandleDeps = {},
): Promise<BusinessPageChange> {
  requirePermission(scope, 'hospitality.manage');
  const by = hospitalityMember(scope);
  return inWorkspace(scope, async (tx) => {
    await requireAnyApp(tx, scope.workspaceId);
    await requireBusiness(tx, scope.workspaceId);
    const property = await businessOf(tx, scope, input);
    if (property.name === null) throw refuse('CONFLICT', 'Set up your business first.');
    await ensurePageRow(tx, scope.workspaceId, property.id, by);
    const before = await pageRowOf(tx, scope.workspaceId, property.id);
    const audit = { propertyId: property.id, handle: input.handle };
    if ((before?.handle ?? null) === null && !(await isFirst(tx, scope.workspaceId, property))) {
      // Another business's first address waits for its first Publish (AC-6592): checked now, held for nobody.
      const refused = await wishRefusal(tx, scope.workspaceId, property.id, input.handle);
      if (refused !== undefined) throw refused;
      await tx
        .update(businessPages)
        .set({ pendingHandle: input.handle, updatedAt: sql`now()`, updatedByMemberId: by })
        .where(thePage(scope.workspaceId, property.id));
      await auditSetup(tx, scope, 'business_page.address', audit);
      return { view: await viewOf(tx, scope.workspaceId, property), stale: false };
    }
    const made = await takeHandle(tx, scope.workspaceId, property.id, input.handle, deps.handleBudget);
    await tx
      .update(businessPages)
      .set({ handle: input.handle, pendingHandle: null, updatedAt: sql`now()`, updatedByMemberId: by })
      .where(thePage(scope.workspaceId, property.id));
    // A first address gives each place its first slug, so the page has every address it needs from the start.
    await ensurePlaceSlugs(tx, scope.workspaceId, property.id);
    if (before?.publishedAt !== null && before?.publishedAt !== undefined) {
      await listBusiness(tx, scope.workspaceId, property.id);
    }
    await auditSetup(tx, scope, 'business_page.address', audit);
    return {
      view: await viewOf(tx, scope.workspaceId, property),
      stale: before?.handle !== input.handle,
      ...(made ? { madeHandle: true as const } : {}),
    };
  });
}

/** Gives every place of a business without a slug its first one, from its name, unique in the workspace. */
async function ensurePlaceSlugs(tx: WorkspaceTx, workspaceId: string, propertyId: string): Promise<void> {
  await lockKey(tx, `place-slugs:${workspaceId}`);
  const rows = await pagePlaces(tx, workspaceId, propertyId);
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
 * Sets a place's address on its business's page, `/<handle>/<slug>` (AC-6640): at once, and its old slug keeps finding
 * it. A slug another place of the workspace holds or held is `SLUG_TAKEN` on `slug`; the place's own old one is its
 * own again. A place of another business than the one named is `NOT_FOUND`, as one that doesn't exist.
 */
export async function setPlaceSlug(
  scope: EngineScope,
  input: { readonly placeId: string; readonly slug: string } & InBusiness,
): Promise<BusinessPageChange> {
  requirePermission(scope, 'hospitality.manage');
  const by = hospitalityMember(scope);
  const placeId = checkId(input.placeId, PLACE_NOT_FOUND);
  return inWorkspace(scope, async (tx) => {
    await requireAnyApp(tx, scope.workspaceId);
    const property = await businessOf(tx, scope, input);
    await lockKey(tx, `place-slugs:${scope.workspaceId}`);
    const [place] = await tx
      .select({ id: places.id, propertyId: places.propertyId })
      .from(places)
      .where(
        and(eq(places.workspaceId, scope.workspaceId), eq(places.id, placeId), eq(places.propertyId, property.id)),
      );
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
    await ensurePageRow(tx, scope.workspaceId, property.id, by);
    const row = await pageRowOf(tx, scope.workspaceId, property.id);
    if (row?.publishedAt !== null && row?.publishedAt !== undefined) {
      await listBusiness(tx, scope.workspaceId, property.id);
    }
    await auditSetup(tx, scope, 'business_page.place_address', { placeId, propertyId: property.id });
    return { view: await viewOf(tx, scope.workspaceId, property), stale: true };
  });
}

/**
 * Saves the draft, whole (spec 0068, AC-6810): guests keep seeing the published page. Every gallery picture and the
 * cover (AC-6513) must be one of the business's own, and every hidden place one of its places.
 */
export async function saveBusinessPage(
  scope: EngineScope,
  input: { readonly draft: BusinessPageContent } & InBusiness,
): Promise<BusinessPageView> {
  requirePermission(scope, 'hospitality.manage');
  const by = hospitalityMember(scope);
  return inWorkspace(scope, async (tx) => {
    await requireAnyApp(tx, scope.workspaceId);
    const property = await businessOf(tx, scope, input);
    // The gallery's pictures and the cover (AC-6513): each one of this business's own uploads.
    const photoIds = [
      ...input.draft.gallery.map((photo) => photo.id),
      ...(input.draft.cover === undefined ? [] : [input.draft.cover.id]),
    ];
    if (photoIds.length > 0) {
      const found = await tx
        .select({ id: businessPhotos.id })
        .from(businessPhotos)
        .where(
          and(
            eq(businessPhotos.workspaceId, scope.workspaceId),
            eq(businessPhotos.propertyId, property.id),
            sql`${businessPhotos.id} = any(${`{${photoIds.join(',')}}`}::uuid[])`,
          ),
        )
        // Held until the draft commits: the daily cleanup's delete of an unused picture waits, then finds it used.
        .for('key share');
      if (found.length !== new Set(photoIds).size) {
        const coverGone = input.draft.cover !== undefined && !found.some((photo) => photo.id === input.draft.cover?.id);
        throw coverGone
          ? inputInvalid('cover', 'The cover photo was removed. Add it again.')
          : inputInvalid('gallery', 'A photo was removed. Add it again.');
      }
    }
    if (input.draft.hiddenPlaces.length > 0) {
      const ids = new Set((await pagePlaces(tx, scope.workspaceId, property.id)).map((place) => place.id));
      if (input.draft.hiddenPlaces.some((id) => !ids.has(id))) throw refuse('NOT_FOUND', PLACE_NOT_FOUND);
    }
    await ensurePageRow(tx, scope.workspaceId, property.id, by);
    await tx
      .update(businessPages)
      .set({
        draft: businessContentOf(input.draft),
        draftChangedAt: sql`now()`,
        updatedAt: sql`now()`,
        updatedByMemberId: by,
      })
      .where(thePage(scope.workspaceId, property.id));
    await auditSetup(tx, scope, 'business_page.draft_saved', { propertyId: property.id });
    return viewOf(tx, scope.workspaceId, property);
  });
}

/** What Publish answers: the view, and the stored pictures no draft or snapshot uses any more (to delete). */
export interface BusinessPagePublished extends BusinessPageChange {
  readonly unusedPaths: readonly string[];
}

/** Lists or unlists one business for search engines from its published snapshot (AC-6644). */
async function listBusiness(tx: WorkspaceTx, workspaceId: string, propertyId: string): Promise<void> {
  const row = await pageRowOf(tx, workspaceId, propertyId);
  const published =
    row?.published === null || row?.published === undefined ? undefined : businessContentOf(row.published);
  const placeRows = await pagePlaces(tx, workspaceId, propertyId);
  const listed = placeRows.filter(
    (place) => place.slug !== null && !(published?.hiddenPlaces ?? []).includes(place.id),
  );
  // A business with one place is listed at its handle alone; with several, each listed place has its own address.
  const slugs = placeRows.length > 1 ? listed.flatMap((place) => (place.slug === null ? [] : [place.slug])) : [];
  const isListed = published !== undefined && row?.handle !== null && row?.handle !== undefined && listed.length > 0;
  await tx.execute(
    sql`select crm_list_business(${workspaceId}::uuid, ${propertyId}::uuid, ${row?.handle ?? null}, ${`{${slugs.join(',')}}`}::text[], ${isListed})`,
  );
}

/**
 * Brings the business's search listing in line with its apps (spec 0066, AC-6644), in the apps write's transaction:
 * with no business app left the page is not live (the public reads answer 404), so the sitemap drops it; with one
 * back, a published page is listed again from its snapshot. Answers whether the business has a page row at all, so
 * the caller knows whether there are public copies at the edge to delete.
 */
export async function syncBusinessListing(tx: WorkspaceTx, workspaceId: string, hasApps: boolean): Promise<boolean> {
  const rows = await tx
    .select({ propertyId: businessPages.propertyId })
    .from(businessPages)
    .where(eq(businessPages.workspaceId, workspaceId));
  if (rows.length === 0) return false;
  if (hasApps) for (const row of rows) await listBusiness(tx, workspaceId, row.propertyId);
  else await tx.execute(sql`select crm_list_business(${workspaceId}::uuid, null, null, '{}'::text[], false)`);
  return true;
}

/**
 * Publishes the draft (spec 0068, AC-6810, AC-6816): the snapshot guests read, a new version, and the business
 * listed or unlisted for search engines. A page that would be broken is refused `VALIDATION_FAILED` with the one line
 * that says what to fix (no address, no name, no place, a place with no address or hours). Publishing an unchanged
 * page publishes it again, harmlessly. Pictures neither the draft nor the snapshot uses any more are dropped, and
 * their paths answered so the caller removes them from the store.
 */
export async function publishBusinessPage(
  scope: EngineScope,
  where: InBusiness = {},
  deps: HandleDeps = {},
): Promise<BusinessPagePublished> {
  requirePermission(scope, 'hospitality.manage');
  const by = hospitalityMember(scope);
  return inWorkspace(scope, async (tx) => {
    await requireAnyApp(tx, scope.workspaceId);
    const property = await businessOf(tx, scope, where);
    await lockKey(tx, `business-page:${scope.workspaceId}`);
    await ensurePageRow(tx, scope.workspaceId, property.id, by);
    await ensurePlaceSlugs(tx, scope.workspaceId, property.id);
    const before = await viewOf(tx, scope.workspaceId, property);
    if (before.problem !== undefined) throw refuseOn('VALIDATION_FAILED', before.problem.message, before.problem.fix);
    let made = false;
    if (before.handleOnPublish === true && before.handle !== undefined) {
      // The first Publish takes the address it waited for (AC-6592); taken since, it says so on the address. A word
      // kept for Timefix since the wish is refused as a claim would be.
      if (isReservedHandle(before.handle)) {
        throw refuseOn('SLUG_TAKEN', 'That address is kept for Timefix. Pick another.', 'handle');
      }
      made = await takeHandle(tx, scope.workspaceId, property.id, before.handle, deps.handleBudget);
      await tx
        .update(businessPages)
        .set({ handle: before.handle, pendingHandle: null })
        .where(thePage(scope.workspaceId, property.id));
    }
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
      .where(thePage(scope.workspaceId, property.id));
    await listBusiness(tx, scope.workspaceId, property.id);
    const used = new Set([
      ...before.draft.gallery.map((photo) => photo.id),
      ...(before.draft.cover === undefined ? [] : [before.draft.cover.id]),
    ]);
    const unused = await tx
      .delete(businessPhotos)
      .where(
        and(
          eq(businessPhotos.workspaceId, scope.workspaceId),
          eq(businessPhotos.propertyId, property.id),
          // A picture uploaded in the last ten minutes may not be in the draft yet: it stays until a later Publish.
          sql`${businessPhotos.createdAt} < now() - interval '10 minutes'`,
          ...(used.size === 0 ? [] : [sql`not (${businessPhotos.id} = any(${`{${[...used].join(',')}}`}::uuid[]))`]),
        ),
      )
      .returning({ path: businessPhotos.path });
    await auditSetup(tx, scope, 'business_page.published', {
      propertyId: property.id,
      ...(before.handle === undefined ? {} : { handle: before.handle }),
    });
    return {
      view: await viewOf(tx, scope.workspaceId, property),
      stale: true,
      unusedPaths: unused.map((row) => row.path),
      ...(made ? { madeHandle: true as const } : {}),
    };
  });
}

/** Discards the draft (AC-6811): it goes back to what guests see. Nothing published yet empties it. */
export async function discardBusinessPage(scope: EngineScope, where: InBusiness = {}): Promise<BusinessPageView> {
  requirePermission(scope, 'hospitality.manage');
  const by = hospitalityMember(scope);
  return inWorkspace(scope, async (tx) => {
    await requireAnyApp(tx, scope.workspaceId);
    const property = await businessOf(tx, scope, where);
    await tx
      .update(businessPages)
      .set({
        draft: sql`coalesce(${businessPages.published}, '{}'::jsonb)`,
        draftChangedAt: null,
        updatedAt: sql`now()`,
        updatedByMemberId: by,
      })
      .where(thePage(scope.workspaceId, property.id));
    await auditSetup(tx, scope, 'business_page.discarded', { propertyId: property.id });
    return viewOf(tx, scope.workspaceId, property);
  });
}

/**
 * Keeps one uploaded gallery picture's row for a business (the API stored its bytes at `businessPhotoPath` first). At
 * most 60 kept at once per business (`LIMIT_REACHED`): a Publish drops those nothing uses. Answers the path it must be
 * stored at.
 */
export async function addBusinessPhoto(
  scope: EngineScope,
  input: {
    readonly id: string;
    readonly type: 'image/jpeg' | 'image/png' | 'image/webp';
    readonly bytes: number;
    readonly width: number;
    readonly height: number;
  } & InBusiness,
): Promise<{ readonly path: string }> {
  requirePermission(scope, 'hospitality.manage');
  const by = hospitalityMember(scope);
  const id = checkId(input.id, 'That photo doesn’t exist.');
  return inWorkspace(scope, async (tx) => {
    await requireAnyApp(tx, scope.workspaceId);
    const property = await businessOf(tx, scope, input);
    await lockKey(tx, `business-page:${scope.workspaceId}`);
    const [held] = await tx
      .select({ n: count() })
      .from(businessPhotos)
      .where(and(eq(businessPhotos.workspaceId, scope.workspaceId), eq(businessPhotos.propertyId, property.id)));
    if ((held?.n ?? 0) >= BUSINESS_PAGE_LIMITS.photosStored) {
      throw refuse('LIMIT_REACHED', 'Publish or discard your changes before adding more photos.');
    }
    const path = businessPhotoPath(scope.workspaceId, id, input.type);
    await tx.insert(businessPhotos).values({
      workspaceId: scope.workspaceId,
      id,
      propertyId: property.id,
      path,
      type: input.type,
      bytes: input.bytes,
      width: input.width,
      height: input.height,
      createdByMemberId: by,
    });
    await auditSetup(tx, scope, 'business_page.photo_added', { photoId: id, propertyId: property.id });
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
      .where(
        and(
          eq(businessPhotos.workspaceId, scope.workspaceId),
          eq(businessPhotos.id, id),
          // A picture of a business outside the reader's reach is absent (AC-6595).
          propertyReachSql(await reachOf(tx, scope), businessPhotos.propertyId),
        ),
      );
    return row;
  });
}
