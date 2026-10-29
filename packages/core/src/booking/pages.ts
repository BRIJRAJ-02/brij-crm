// Booking pages for members (spec 0025, AC-623, AC-624, AC-645, AC-646,
// AC-648): list, read, make, change and delete pages, list a page's
// bookings, and put the owner's pages in their profile's order (owner ask
// A102). `booking.manage` covers the member's own pages; `booking.admin`
// everyone's. A page the reader may not see answers as absent (NOT_FOUND).
// Pages are settings, not CRM data: their writes store no outbox row.
import { randomBytes } from 'node:crypto';
import { and, asc, desc, eq, gte, inArray, isNull, like, lt, notInArray, sql } from 'drizzle-orm';
import {
  defaultAvailability,
  PERMISSIONS,
  slugFromTitle,
  type BookingPageSettings,
  type BookingPageView,
  type BookingView,
  type CreateBookingPageInput,
  type DeleteBookingPageInput,
  type FormTargetChoices,
  type GetBookingPageInput,
  type ListBookingsInput,
  type ProfileOrder,
  type ReorderProfileInput,
  type RoutingRule,
  type TeamHosts,
  type UpdateBookingPageInput,
  BOOKINGS_PAGE_MAX,
  BOOKING_DURATIONS_MAX,
  PROFILE_ORDER_MAX,
  ROUTING_RULES_MAX,
} from '@crm/contracts';
import { schema, type WorkspaceTx } from '@crm/db';
import { requirePermission } from '../access/check.ts';
import { withoutNotes } from '../availability/resolve.ts';
import { checkPageSchedule } from '../availability/schedules.ts';
import type { EngineScope } from '../access/mint.ts';
import { can } from '../access/policy.ts';
import { inWorkspace } from '../access/run.ts';
import { postgresError, refuse, refuseOn } from '../engine/refusals.ts';
import { writeAudit } from '../members/audit.ts';
import { changedRuleIds, checkPageRoutes, rulesChanged } from '../routing/check.ts';
import { NONE_UNSEEN, rulesSeen, unseenRules, withUnseenRules, type UnseenRule } from '../routing/seen.ts';
import { actorRow } from '../engine/scope.ts';
import type { RemovalEffect } from '../members/removal-effect.ts';
import { ownerSlugs, publicProfilesOf } from './handles.ts';
import { placeNewPage } from '../profile/items.ts';
import { linksOf, seenLinks } from './links.ts';
import { lockKey } from './locks.ts';
import { lockRotations } from '../rotation/assign.ts';
import { everyoneRotation } from '../rotation/roster.ts';
import { eligibleMembers, pageRotations, ROTATION_ROLES, TEAM_LIMITS } from '../rotation/team.ts';
import { loadPage, pagesOf, type PageRecord } from './slots.ts';
import {
  checkAnswersObject,
  checkPageCanGoLive,
  checkPageQuestions,
  questionsSeenBy,
  questionTargets,
  refiledOnto,
  attributeIdsOf,
  withHiddenFilings,
} from './questions.ts';

const { bookingPageMembers, bookingPageRotations, bookingPages, bookings, members, rotations } = schema;

/** A public key: 16 URL safe characters from 12 random bytes. */
export function newPublicKey(): string {
  return randomBytes(12).toString('base64url');
}

/** The member the scope acts for, or undefined (a key, the system). */
function memberOf(scope: EngineScope): string | undefined {
  return scope.access.principal.kind === 'member' ? scope.access.principal.memberId : undefined;
}

/**
 * Whether the reader may see and change the page: their own with
 * `booking.manage`, anyone's with `booking.admin`. A round robin page is
 * `booking.admin`'s alone (spec 0029, AC-751), whoever made it, and so is a
 * workspace link, which is always round robin.
 */
function mayChange(scope: EngineScope, page: { readonly ownerMemberId: string; readonly kind: string }): boolean {
  if (can(scope.access, 'booking.admin')) return true;
  return page.kind !== 'round_robin' && page.ownerMemberId === memberOf(scope);
}

const NOT_FOUND_MESSAGE = 'That booking page doesn’t exist, or isn’t yours.';

/**
 * Whether a form may send its visitors on to a booking page (spec 0023,
 * AC-1056): `seen` asks the access door too (the member has
 * `booking.manage` and the page is theirs, or they have `booking.admin`),
 * as a save does; `live` asks only that the page exists here, isn't deleted
 * and takes bookings, as a publish does. Answers `missing`, `hidden` or
 * `paused`, or undefined when it may.
 */
export async function bookingTargetProblem(
  tx: WorkspaceTx,
  scope: EngineScope,
  pageId: string,
  check: 'seen' | 'live',
): Promise<'missing' | 'hidden' | 'paused' | undefined> {
  if (check === 'seen' && !can(scope.access, 'booking.manage') && !can(scope.access, 'booking.admin')) return 'hidden';
  const [row] = await tx
    .select({ ownerMemberId: bookingPages.ownerMemberId, kind: bookingPages.kind, status: bookingPages.status })
    .from(bookingPages)
    .where(and(eq(bookingPages.id, pageId), isNull(bookingPages.deletedAt)));
  if (row === undefined) return 'missing';
  if (check === 'seen' && !mayChange(scope, row)) return 'hidden';
  return row.status === 'live' ? undefined : 'paused';
}

/** The page, live and the reader's to change, or NOT_FOUND. */
async function pageToChange(tx: WorkspaceTx, scope: EngineScope, pageId: string, lock: boolean): Promise<PageRecord> {
  const query = tx
    .select()
    .from(bookingPages)
    .where(and(eq(bookingPages.id, pageId), isNull(bookingPages.deletedAt)));
  const [row] = lock ? await query.for('no key update') : await query;
  if (row === undefined || !mayChange(scope, row)) throw refuse('NOT_FOUND', NOT_FOUND_MESSAGE);
  const [page] = await pagesOf(tx, [row]);
  if (page === undefined) throw refuse('NOT_FOUND', NOT_FOUND_MESSAGE);
  return page;
}

/** The first moment of this UTC month and of the next. */
function thisMonth(now: Date): { readonly from: Date; readonly to: Date } {
  return {
    from: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
    to: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)),
  };
}

/** Confirmed bookings starting this month, per page. */
async function monthCounts(
  tx: WorkspaceTx,
  pageIds: readonly string[],
  now: Date,
): Promise<ReadonlyMap<string, number>> {
  if (pageIds.length === 0) return new Map();
  const { from, to } = thisMonth(now);
  const rows = await tx
    .select({ pageId: bookings.pageId, count: sql<number>`count(*)::int` })
    .from(bookings)
    .where(
      and(
        inArray(bookings.pageId, [...pageIds]),
        eq(bookings.status, 'confirmed'),
        gte(bookings.startsAt, from),
        lt(bookings.startsAt, to),
      ),
    )
    .groupBy(bookings.pageId);
  return new Map(rows.map((row) => [row.pageId, row.count]));
}

/** Each round robin page's hosts (spec 0037, AC-1319): its fixed hosts and its rotations, each by position. */
async function pageHosts(
  tx: WorkspaceTx,
  pages: readonly Pick<PageRecord, 'id' | 'kind'>[],
): Promise<ReadonlyMap<string, TeamHosts>> {
  const ids = pages.filter((page) => page.kind === 'round_robin').map((page) => page.id);
  if (ids.length === 0) return new Map();
  const linked = await tx
    .select({ pageId: bookingPageRotations.pageId, rotationId: bookingPageRotations.rotationId })
    .from(bookingPageRotations)
    .where(inArray(bookingPageRotations.pageId, ids))
    .orderBy(asc(bookingPageRotations.position));
  const fixed = await tx
    .select({ pageId: bookingPageMembers.pageId, memberId: bookingPageMembers.memberId })
    .from(bookingPageMembers)
    .where(inArray(bookingPageMembers.pageId, ids))
    .orderBy(asc(bookingPageMembers.position));
  return new Map(
    ids.map((id) => [
      id,
      {
        fixed: fixed.filter((row) => row.pageId === id).map((row) => row.memberId),
        rotations: linked.filter((row) => row.pageId === id).map((row) => row.rotationId),
      },
    ]),
  );
}

/** A page as the reader sees it: a team page's rules without those `unseen` hides from them (`routing/seen.ts`). */
function viewOf(
  scope: EngineScope,
  page: PageRecord,
  count: number,
  hosts: TeamHosts | undefined,
  handle: string | undefined,
  unseen: UnseenRule,
  seen: (questions: PageRecord['questions'], named?: string | null) => PageRecord['questions'],
): BookingPageView {
  return {
    id: page.id,
    publicKey: page.publicKey,
    kind: page.kind,
    scope: page.scope,
    ownerMemberId: page.ownerMemberId,
    ...(handle === undefined ? {} : { handle }),
    title: page.title,
    description: page.description,
    slug: page.slug,
    durations: page.durations,
    location: page.location,
    // A day off's note is its owner's alone (spec 0035, AC-971): an admin reading the page sees the days, not why.
    availability: memberOf(scope) === page.ownerMemberId ? page.availability : withoutNotes(page.availability),
    bufferBefore: page.bufferBefore,
    bufferAfter: page.bufferAfter,
    minNoticeMinutes: page.minNoticeMinutes,
    windowDays: page.windowDays,
    dailyLimit: page.dailyLimit,
    slotStep: page.slotStep,
    status: page.status,
    scheduleId: page.scheduleId,
    scheduleName: page.scheduleName,
    rescheduleHost: page.rescheduleHost,
    isPrivate: page.isPrivate,
    showSocials: page.showSocials,
    defaultView: page.defaultView,
    profileSection: page.profileSection,
    profilePosition: page.profilePosition,
    // A filing onto a field hidden from the reader is absent, not even its id (spec 0057, as the rules below).
    questions: seen(page.questions, page.answersObjectId),
    fileToCrm: page.fileToCrm,
    answersObjectId: page.answersObjectId,
    ...(page.status === 'paused' && page.pausedReason !== undefined ? { pausedReason: page.pausedReason } : {}),
    ...(hosts === undefined ? {} : { hosts }),
    // Hidden means absent (spec 0009): a rule over a field the reader can't see isn't sent, not even its id.
    ...(page.kind === 'round_robin' ? { routing: { rules: [...rulesSeen(page.routingRules ?? [], unseen)] } } : {}),
    bookingsThisMonth: count,
    canChange: mayChange(scope, page),
    createdAt: page.createdAt.toISOString(),
    updatedAt: page.updatedAt.toISOString(),
  };
}

/**
 * The pages the reader may see (AC-645): their own, or every live page with `booking.admin` (workspace links
 * included); newest first.
 */
export async function listBookingPages(
  scope: EngineScope,
  now: Date = new Date(),
): Promise<readonly BookingPageView[]> {
  requirePermission(scope, 'booking.manage');
  const member = memberOf(scope);
  return inWorkspace(scope, async (tx) => {
    const mine = can(scope.access, 'booking.admin') ? undefined : (member ?? '00000000-0000-0000-0000-000000000000');
    const rows = await tx
      .select()
      .from(bookingPages)
      .where(
        and(
          isNull(bookingPages.deletedAt),
          // A workspace link is nobody's own: only `booking.admin` lists it, whoever made it.
          mine === undefined ? undefined : and(eq(bookingPages.ownerMemberId, mine), eq(bookingPages.scope, 'member')),
        ),
      )
      .orderBy(desc(bookingPages.createdAt), asc(bookingPages.id))
      .limit(500);
    const pages = await pagesOf(tx, rows);
    const ids = pages.map((page) => page.id);
    const counts = await monthCounts(tx, ids, now);
    const hosts = await pageHosts(tx, pages);
    const handles = await publicProfilesOf(
      tx,
      scope.workspaceId,
      pages.map((page) => page.ownerUserId),
    );
    // One read of the fields every page's rules name.
    const unseen = await unseenRules(
      tx,
      scope.access,
      pages.flatMap((page) => page.routingRules ?? []),
    );
    const seen = await questionsSeenBy(tx, scope.access);
    return pages.map((page) =>
      viewOf(
        scope,
        page,
        counts.get(page.id) ?? 0,
        hosts.get(page.id),
        page.ownerUserId === null ? undefined : handles.get(page.ownerUserId)?.handle,
        unseen,
        seen,
      ),
    );
  });
}

/** One page the reader may see. */
export async function getBookingPage(
  scope: EngineScope,
  input: Pick<GetBookingPageInput, 'pageId'>,
  now: Date = new Date(),
): Promise<BookingPageView> {
  requirePermission(scope, 'booking.manage');
  return inWorkspace(scope, async (tx) => {
    const page = await pageToChange(tx, scope, input.pageId, false);
    return viewWithCounts(tx, scope, page, now);
  });
}

/** One page's view with its month's count, its rotation, and the rules the reader may see. */
async function viewWithCounts(tx: WorkspaceTx, scope: EngineScope, page: PageRecord, now: Date) {
  const counts = await monthCounts(tx, [page.id], now);
  const hosts = await pageHosts(tx, [page]);
  const unseen = await unseenRules(tx, scope.access, page.routingRules ?? []);
  const seen = await questionsSeenBy(tx, scope.access);
  return viewOf(scope, page, counts.get(page.id) ?? 0, hosts.get(page.id), await ownerHandle(tx, page), unseen, seen);
}

/**
 * Where a page's answers may be filed (spec 0057, AC-5706): the page's object (People unless it names another)
 * and its attributes, as the reader may write them,
 * for a page they may change; NOT_FOUND otherwise.
 */
export async function bookingPageAttributes(
  scope: EngineScope,
  input: Pick<GetBookingPageInput, 'pageId'>,
): Promise<FormTargetChoices> {
  requirePermission(scope, 'booking.manage');
  return inWorkspace(scope, async (tx) => {
    const page = await pageToChange(tx, scope, input.pageId, false);
    return questionTargets(tx, scope, page.answersObjectId);
  });
}

/** The page owner's handle, when they have one: the page's address is then `/<handle>/<slug>`. */
async function ownerHandle(
  tx: WorkspaceTx,
  page: Pick<PageRecord, 'ownerUserId' | 'workspaceId'>,
): Promise<string | undefined> {
  if (page.ownerUserId === null) return undefined;
  return (await publicProfilesOf(tx, page.workspaceId, [page.ownerUserId])).get(page.ownerUserId)?.handle;
}

const HOSTS_INVALID = 'A round robin page needs 1 to 3 rotations and at most 8 hosts in all.';

/**
 * Sets a round robin page's hosts (spec 0037, AC-1319), replacing them: 0 to
 * 7 fixed hosts (active members, not guests, each once) and 1 to 3 live
 * rotations (each once), at most 8 people a booking can seat. HOSTS_INVALID
 * otherwise; a rotation that is gone is NOT_FOUND.
 */
async function setPageHosts(tx: WorkspaceTx, workspaceId: string, pageId: string, hosts: TeamHosts): Promise<void> {
  const fixed = [...new Set(hosts.fixed)];
  const linked = [...new Set(hosts.rotations)];
  if (
    fixed.length !== hosts.fixed.length ||
    linked.length !== hosts.rotations.length ||
    linked.length < 1 ||
    linked.length > TEAM_LIMITS.rotations ||
    fixed.length > TEAM_LIMITS.fixed ||
    fixed.length + linked.length > TEAM_LIMITS.hosts
  ) {
    throw refuseOn('HOSTS_INVALID', HOSTS_INVALID, 'hosts');
  }
  const live = await tx
    .select({ id: rotations.id })
    .from(rotations)
    .where(and(inArray(rotations.id, linked), isNull(rotations.deletedAt)))
    // Shares the row with deleteRotation's lock, so a rotation is never deleted while a page takes it up.
    .for('share');
  if (live.length !== linked.length) {
    throw refuseOn('NOT_FOUND', 'That rotation doesn’t exist any more. Pick another.', 'hosts');
  }
  if (fixed.length > 0) {
    const people = await tx
      .select({ id: members.id })
      .from(members)
      .where(
        and(
          inArray(members.id, fixed),
          eq(members.status, 'active'),
          sql`${members.role}::text in (${sql.join(
            ROTATION_ROLES.map((role) => sql`${role}`),
            sql`, `,
          )})`,
        ),
      );
    if (people.length !== fixed.length) {
      throw refuseOn('HOSTS_INVALID', 'Only active members of this workspace can be fixed hosts.', 'hosts');
    }
  }
  await tx.delete(bookingPageRotations).where(eq(bookingPageRotations.pageId, pageId));
  await tx.delete(bookingPageMembers).where(eq(bookingPageMembers.pageId, pageId));
  await tx
    .insert(bookingPageRotations)
    .values(linked.map((rotationId, position) => ({ workspaceId, pageId, rotationId, position })));
  if (fixed.length > 0) {
    await tx
      .insert(bookingPageMembers)
      .values(fixed.map((memberId, position) => ({ workspaceId, pageId, memberId, position })));
  }
}

/**
 * Refuses HOSTS_INVALID when a round robin page that is, or is going, live books through a rotation with nobody who may
 * take work (late trap #22): every booking seats one of each, so the page would offer no times at all. Under each
 * rotation's lock, so a rotation change that switches its last member off waits for this page's write, and its own
 * check (`updateRotation`) then sees the page live.
 */
async function checkRotationsBook(tx: WorkspaceTx, workspaceId: string, pageId: string): Promise<void> {
  const rules = await pageRotations(tx, pageId);
  await lockRotations(
    tx,
    workspaceId,
    rules.map((rule) => rule.id),
  );
  const eligible = await eligibleMembers(
    tx,
    rules.map((rule) => rule.id),
  );
  const empty = rules.find((rule) => (eligible.get(rule.id)?.length ?? 0) === 0);
  if (empty !== undefined) {
    throw refuseOn(
      'HOSTS_INVALID',
      `Nobody is switched on in ${empty.name}, so this page would offer no times. Switch someone on there, or pick another rotation.`,
      'hosts',
    );
  }
}

/**
 * A team page books each member by their own default schedule (spec 0037, AC-1336's rule for members, read for
 * round robin: the open question in spec 0029 notes it), so it names no schedule of its owner.
 */
function checkTeamSchedule(kind: PageRecord['kind'], scheduleId: string | null | undefined): void {
  if (kind === 'round_robin' && scheduleId !== undefined && scheduleId !== null) {
    throw refuseOn('CONFIG_INVALID', 'A team page books each member by their own working hours.', 'scheduleId');
  }
}

/**
 * A workspace link is on nobody's profile, so it takes no place on one (CONFIG_INVALID on the field). Its address
 * is the workspace's slug.
 */
function checkWorkspaceSettings(settings: NonNullable<CreateBookingPageInput['settings']>): void {
  const placement = (['profileSection', 'profilePosition'] as const).find((key) => settings[key] !== undefined);
  if (placement !== undefined) {
    throw refuseOn('CONFIG_INVALID', 'A workspace link isn’t on anyone’s profile.', placement);
  }
}

/**
 * A page offers one to `BOOKING_DURATIONS_MAX` (4) lengths, each once: the
 * database's `booking_pages_durations` check, refused here first as a typed
 * `CONFIG_INVALID` on `durations` for a caller that skipped the contract.
 */
export function checkDurations(durations: readonly number[] | undefined): void {
  if (durations === undefined) return;
  if (durations.length < 1) throw refuseOn('CONFIG_INVALID', 'Offer at least one meeting length.', 'durations');
  if (durations.length > BOOKING_DURATIONS_MAX) {
    throw refuseOn('CONFIG_INVALID', `A page offers at most ${String(BOOKING_DURATIONS_MAX)} lengths.`, 'durations');
  }
  if (new Set(durations).size !== durations.length) {
    throw refuseOn('CONFIG_INVALID', 'Offer each length once.', 'durations');
  }
}

/**
 * A slug free among the owner's live pages, so `/<handle>/<slug>` names one page: in this workspace, including the
 * ones their pages used to hold (`crm_booking_owner_slugs`). A slug may repeat across a person's workspaces (spec 0056). The wanted one, else it with -2, -3 …
 */
async function freeSlug(tx: WorkspaceTx, workspaceId: string, ownerMemberId: string, wanted: string): Promise<string> {
  const base = wanted.slice(0, 56).replace(/-+$/, '');
  const [owner] = await tx.select({ userId: members.userId }).from(members).where(eq(members.id, ownerMemberId));
  const here = await tx
    .select({ slug: bookingPages.slug })
    .from(bookingPages)
    .where(
      and(
        isNull(bookingPages.deletedAt),
        eq(bookingPages.ownerMemberId, ownerMemberId),
        like(bookingPages.slug, `${base}%`),
      ),
    );
  const elsewhere =
    owner?.userId === null || owner === undefined ? [] : await ownerSlugs(tx, owner.userId, workspaceId, base);
  const taken = new Set([...here.map((row) => row.slug), ...elsewhere]);
  if (!taken.has(wanted)) return wanted;
  for (let n = 2; ; n += 1) if (!taken.has(`${base}-${String(n)}`)) return `${base}-${String(n)}`;
}

/** A slug free among the workspace's own links (`booking_pages_workspace_slug`): the wanted one, else it with -2, -3 … */
async function freeWorkspaceSlug(tx: WorkspaceTx, wanted: string): Promise<string> {
  const base = wanted.slice(0, 56).replace(/-+$/, '');
  const here = await tx
    .select({ slug: bookingPages.slug })
    .from(bookingPages)
    .where(
      and(isNull(bookingPages.deletedAt), eq(bookingPages.scope, 'workspace'), like(bookingPages.slug, `${base}%`)),
    );
  const taken = new Set(here.map((row) => row.slug));
  if (!taken.has(wanted)) return wanted;
  for (let n = 2; ; n += 1) if (!taken.has(`${base}-${String(n)}`)) return `${base}-${String(n)}`;
}

/** The last place on a profile (`booking_pages_profile_position`: 0 to 999). */
const PROFILE_POSITION_MAX = 999;

/**
 * Where a new page joins its owner's profile: after their last page here, so an order they arranged keeps its top
 * (a page made before any reorder sat at 0, ahead of everything but the oldest).
 */
async function nextProfilePosition(tx: WorkspaceTx, ownerMemberId: string): Promise<number> {
  const [row] = await tx
    .select({ last: sql<number | null>`max(${bookingPages.profilePosition})::int` })
    .from(bookingPages)
    .where(and(eq(bookingPages.ownerMemberId, ownerMemberId), isNull(bookingPages.deletedAt)));
  const last = row?.last ?? null;
  return last === null ? 0 : Math.min(last + 1, PROFILE_POSITION_MAX);
}

/** The unique indexes a taken slug is refused on: the owner's in this workspace, and the owner's everywhere. */
const SLUG_CONSTRAINTS: ReadonlySet<string | undefined> = new Set(['booking_pages_slug', 'booking_pages_owner_slug']);

/** The unique index a workspace link's slug is refused on: another of the workspace's links holds it. */
const WORKSPACE_SLUG_CONSTRAINT = 'booking_pages_workspace_slug';

/** The unique index an old slug of another of the owner's pages is refused on (slug history, migration 0087). */
const OLD_SLUG_CONSTRAINT = 'booking_page_slugs_owner_slug';

/**
 * The refusal, on the `slug` field, for a slug the owner's other page holds now, or held and still redirects from;
 * undefined for any other error.
 */
function slugRefusal(error: unknown) {
  const constraint = postgresError(error)?.constraint;
  if (SLUG_CONSTRAINTS.has(constraint)) {
    return refuseOn('SLUG_TAKEN', 'You have another booking page at that address.', 'slug');
  }
  if (constraint === WORKSPACE_SLUG_CONSTRAINT) {
    return refuseOn('SLUG_TAKEN', 'Another workspace link has that address.', 'slug');
  }
  if (constraint === OLD_SLUG_CONSTRAINT) {
    return refuseOn(
      'SLUG_TAKEN',
      'Another of your booking pages used this address before, so it stays with that page. Pick another.',
      'slug',
    );
  }
  return undefined;
}

/**
 * A new page for the caller (AC-623): the settings given, the rest
 * defaulted. A personal page has the caller as its one member; a round robin
 * page (spec 0029, AC-732) needs `booking.admin` and books from the rotation
 * named, each member by their own hours unless told otherwise. The same id
 * again answers the page it made (a retry).
 */
export async function createBookingPage(
  scope: EngineScope,
  input: Pick<CreateBookingPageInput, 'id' | 'title' | 'timeZone' | 'settings' | 'kind' | 'hosts' | 'scope'>,
  now: Date = new Date(),
): Promise<BookingPageView> {
  requirePermission(scope, 'booking.manage');
  const owner = memberOf(scope);
  if (owner === undefined) throw refuse('FORBIDDEN', PERMISSIONS['booking.manage'].message);
  const isWorkspace = input.scope === 'workspace';
  // A workspace link is always round robin, and booking.admin's alone (team scheduling brief, decision 3).
  const kind = isWorkspace ? 'round_robin' : (input.kind ?? 'personal');
  if (kind === 'round_robin') requirePermission(scope, 'booking.admin');
  if (isWorkspace && input.kind === 'personal') {
    throw refuseOn('CONFIG_INVALID', 'A workspace link books round robin.', 'kind');
  }
  if (kind === 'round_robin' && input.hosts === undefined && !isWorkspace) {
    throw refuseOn('VALUE_REQUIRED', 'Pick the rotation this page books from.', 'hosts');
  }
  if (isWorkspace) checkWorkspaceSettings(input.settings ?? {});
  checkTeamSchedule(kind, input.settings?.scheduleId);
  checkDurations(input.settings?.durations);
  return inWorkspace(scope, async (tx) => {
    const [existing] = await tx.select().from(bookingPages).where(eq(bookingPages.id, input.id));
    if (existing !== undefined) {
      if (existing.ownerMemberId !== owner || existing.scope !== (isWorkspace ? 'workspace' : 'member')) {
        throw refuse('ID_TAKEN', 'A booking page with that id already exists.');
      }
      const [page] = await pagesOf(tx, [existing]);
      if (page === undefined) throw refuse('ID_TAKEN', 'A booking page with that id already exists.');
      return viewWithCounts(tx, scope, page, now);
    }
    const given = input.settings ?? {};
    const settings: BookingPageSettings = {
      title: input.title,
      description: given.description ?? '',
      slug:
        given.slug ??
        (isWorkspace
          ? await freeWorkspaceSlug(tx, slugFromTitle(input.title))
          : await freeSlug(tx, scope.workspaceId, owner, slugFromTitle(input.title))),
      durations: given.durations ?? [30],
      location: given.location ?? { type: 'video' },
      bufferBefore: given.bufferBefore ?? 0,
      bufferAfter: given.bufferAfter ?? 0,
      minNoticeMinutes: given.minNoticeMinutes ?? 0,
      windowDays: given.windowDays ?? 60,
      dailyLimit: given.dailyLimit ?? null,
      slotStep: given.slotStep ?? null,
      status: given.status ?? 'live',
      scheduleId: given.scheduleId ?? null,
      rescheduleHost: given.rescheduleHost ?? 'same',
      isPrivate: given.isPrivate ?? false,
      showSocials: given.showSocials ?? true,
      // Every new page opens in Month, the one view the page had before the host could choose.
      defaultView: given.defaultView ?? 'month',
      profileSection: given.profileSection ?? null,
      // A workspace link is on nobody's profile.
      profilePosition: given.profilePosition ?? (isWorkspace ? 0 : await nextProfilePosition(tx, owner)),
      questions: given.questions ?? [],
      fileToCrm: given.fileToCrm ?? true,
      answersObjectId: given.answersObjectId ?? null,
    };
    if (settings.scheduleId !== null) await checkPageSchedule(tx, owner, settings.scheduleId);
    if (settings.answersObjectId !== null) await checkAnswersObject(tx, scope, settings.answersObjectId);
    await checkPageQuestions(tx, scope, settings.questions, [], settings.answersObjectId);
    // A new page is live at once, so the wall a form's publish refuses is refused here (27 October 2026).
    if (settings.status === 'live') {
      await checkPageCanGoLive(tx, scope, settings.questions, settings.answersObjectId);
    }
    const by = actorRow(scope.actor);
    try {
      const [row] = await tx
        .insert(bookingPages)
        .values({
          workspaceId: scope.workspaceId,
          id: input.id,
          publicKey: newPublicKey(),
          slug: settings.slug,
          kind,
          scope: isWorkspace ? 'workspace' : 'member',
          // On a workspace link, only who made it: nothing manages, addresses or pauses it by this.
          ownerMemberId: owner,
          title: settings.title,
          description: settings.description,
          durations: [...settings.durations],
          location: settings.location,
          // The creator's zone, which the virtual default takes on this page until its owner saves hours (spec 0035).
          availability: defaultAvailability(input.timeZone),
          bufferBefore: settings.bufferBefore,
          bufferAfter: settings.bufferAfter,
          minNoticeMinutes: settings.minNoticeMinutes,
          windowDays: settings.windowDays,
          dailyLimit: settings.dailyLimit,
          slotStep: settings.slotStep,
          status: settings.status,
          scheduleId: settings.scheduleId,
          // Mirrored for one release, while `hours_mode` stays readable (spec 0035, AC-975).
          hoursMode: settings.scheduleId === null ? 'mine' : 'own',
          rescheduleHost: settings.rescheduleHost,
          isPrivate: settings.isPrivate,
          showSocials: settings.showSocials,
          defaultView: settings.defaultView,
          profileSection: settings.profileSection,
          profilePosition: settings.profilePosition,
          questions: settings.questions,
          fileToCrm: settings.fileToCrm,
          answersObjectId: settings.answersObjectId,
          createdByType: by.type,
          createdById: by.id,
          createdByMemberId: by.memberId,
          updatedByType: by.type,
          updatedById: by.id,
          updatedByMemberId: by.memberId,
        })
        .returning();
      if (row === undefined) throw new Error('The booking page was not created.');
      // A Public page joins the end of its owner's link page (spec 0051), as the profile always listed new pages.
      if (!row.isPrivate && !isWorkspace) await placeNewPage(tx, scope, row);
      // A workspace link with no hosts named books "Everyone on the roster", made with the workspace's first link.
      const hosts =
        input.hosts ?? (isWorkspace ? { fixed: [], rotations: [await everyoneRotation(tx, scope)] } : undefined);
      if (kind === 'round_robin' && hosts !== undefined) {
        await setPageHosts(tx, scope.workspaceId, row.id, hosts);
        if (row.status === 'live') await checkRotationsBook(tx, scope.workspaceId, row.id);
        const [team] = await pagesOf(tx, [row]);
        if (team === undefined) throw new Error('The booking page was not created.');
        return await viewWithCounts(tx, scope, team, now);
      }
      await tx
        .insert(bookingPageMembers)
        .values({ workspaceId: scope.workspaceId, pageId: row.id, memberId: owner, position: 0 });
      const [page] = await pagesOf(tx, [row]);
      if (page === undefined) throw new Error('The booking page was not created.');
      // A personal page has no rules.
      return viewOf(
        scope,
        page,
        0,
        undefined,
        await ownerHandle(tx, page),
        NONE_UNSEEN,
        await questionsSeenBy(tx, scope.access),
      );
    } catch (error) {
      throw slugRefusal(error) ?? error;
    }
  });
}

/** A change to a page the reader may change (AC-623, AC-624): only the settings given. */
export async function updateBookingPage(
  scope: EngineScope,
  input: Pick<UpdateBookingPageInput, 'pageId' | 'settings' | 'hosts' | 'routing'>,
  now: Date = new Date(),
): Promise<BookingPageView> {
  requirePermission(scope, 'booking.manage');
  return inWorkspace(scope, async (tx) => {
    const page = await pageToChange(tx, scope, input.pageId, true);
    const { settings } = input;
    // The address after the owner's handle, where the page sits on their profile, and whether it shows their social
    // links, are the owner's alone: an admin of a workspace may change the page, never what is published under the
    // person's name.
    const placement = (['slug', 'profileSection', 'profilePosition', 'showSocials'] as const).find(
      (key) => settings[key] !== undefined,
    );
    // A workspace link is on nobody's profile and shows nobody's links; its address (`slug`) is the workspace's,
    // so any `booking.admin` holder changes it.
    if (page.scope === 'workspace' && placement !== undefined && placement !== 'slug') {
      throw refuseOn('CONFIG_INVALID', 'A workspace link isn’t on anyone’s profile.', placement);
    }
    if (placement !== undefined && page.scope === 'member' && memberOf(scope) !== page.ownerMemberId) {
      throw refuseOn(
        'FORBIDDEN',
        placement === 'showSocials'
          ? 'Only the page’s owner chooses whether it shows their social links.'
          : 'Only the page’s owner changes its address and its place on their profile.',
        placement,
      );
    }
    checkTeamSchedule(page.kind, settings.scheduleId);
    checkDurations(settings.durations);
    if (settings.scheduleId !== undefined && settings.scheduleId !== null) {
      await checkPageSchedule(tx, page.ownerMemberId, settings.scheduleId);
    }
    // Where the answers are filed (booking answers parity, 27 Oct 2026): null is People, which is what every page
    // did before. A page pointed at another object keeps its questions and loses the filings that object has no
    // attribute for, exactly as a form's "Where the answers go" does; every filing is then checked afresh against
    // the new object, since an attribute id belongs to one object.
    const target = settings.answersObjectId === undefined ? page.answersObjectId : settings.answersObjectId;
    const moved = settings.answersObjectId !== undefined && settings.answersObjectId !== page.answersObjectId;
    if (moved && target !== null) await checkAnswersObject(tx, scope, target);
    // The questions as the writer sent them, with the filings a field hidden from them kept, then checked: what changed
    // against the writer's own access (spec 0057, AC-5717), the rest as a form's publish checks it.
    const seen = await questionsSeenBy(tx, scope.access);
    const sent =
      settings.questions === undefined
        ? moved
          ? page.questions
          : undefined
        : withHiddenFilings(page.questions, settings.questions, seen(page.questions, page.answersObjectId));
    const questions =
      sent === undefined ? undefined : moved ? refiledOnto(sent, await attributeIdsOf(tx, target)) : sent;
    if (questions !== undefined) {
      await checkPageQuestions(tx, scope, questions, moved ? [] : page.questions, target);
    }
    // Only on the way to live: a page already live onto such an object keeps working, and its other settings save.
    if (settings.status === 'live' && page.status !== 'live') {
      await checkPageCanGoLive(tx, scope, questions ?? page.questions, target);
    }
    if (input.hosts !== undefined) {
      if (page.kind !== 'round_robin') {
        throw refuseOn('CONFIG_INVALID', 'Only a round robin page books from rotations.', 'hosts');
      }
      await setPageHosts(tx, scope.workspaceId, page.id, input.hosts);
    }
    // Live afterwards, with its rotations new or the page just turned on: each has to have someone to seat.
    if (
      page.kind === 'round_robin' &&
      (settings.status ?? page.status) === 'live' &&
      (input.hosts !== undefined || page.status !== 'live')
    ) {
      await checkRotationsBook(tx, scope.workspaceId, page.id);
    }
    // Routing rules (spec 0043, AC-1608): only a round robin page's, each naming members of its rotations; audited.
    // The writer sends the rules they see; those over a field hidden from them are put back as they were, in place.
    let routing: { readonly rules: readonly RoutingRule[] } | undefined;
    if (input.routing !== undefined) {
      if (page.kind !== 'round_robin') {
        throw refuseOn('CONFIG_INVALID', 'Only a team page has routing rules.', 'routing');
      }
      const before = page.routingRules ?? [];
      // Checked as sent, so a refusal names a rule by its place in the writer's own list.
      await checkPageRoutes(tx, page.id, input.routing.rules, { access: scope.access, before });
      const rules = withUnseenRules(before, input.routing.rules, await unseenRules(tx, scope.access, before));
      if (rules.length > ROUTING_RULES_MAX) {
        throw refuseOn(
          'CONFIG_INVALID',
          `This page holds the most rules it can, ${String(ROUTING_RULES_MAX)}. Remove one to add another.`,
          'routing',
        );
      }
      if (rulesChanged(before, rules)) {
        await writeAudit(tx, scope.workspaceId, scope.actor, {
          action: 'routing.changed',
          targetType: 'booking_page',
          targetId: page.id,
          before: { rules: before.length },
          after: { rules: rules.length, changed: changedRuleIds(before, rules) },
        });
      }
      routing = { rules };
    }
    const by = actorRow(scope.actor);
    try {
      const [row] = await tx
        .update(bookingPages)
        .set({
          ...(settings.title === undefined ? {} : { title: settings.title }),
          ...(settings.description === undefined ? {} : { description: settings.description }),
          ...(settings.slug === undefined ? {} : { slug: settings.slug }),
          ...(settings.durations === undefined ? {} : { durations: [...settings.durations] }),
          ...(settings.location === undefined ? {} : { location: settings.location }),
          ...(settings.bufferBefore === undefined ? {} : { bufferBefore: settings.bufferBefore }),
          ...(settings.bufferAfter === undefined ? {} : { bufferAfter: settings.bufferAfter }),
          ...(settings.minNoticeMinutes === undefined ? {} : { minNoticeMinutes: settings.minNoticeMinutes }),
          ...(settings.windowDays === undefined ? {} : { windowDays: settings.windowDays }),
          ...(settings.dailyLimit === undefined ? {} : { dailyLimit: settings.dailyLimit }),
          ...(settings.slotStep === undefined ? {} : { slotStep: settings.slotStep }),
          // A status set by a person clears the system's reason for a pause (spec 0031, AC-814).
          ...(settings.status === undefined ? {} : { status: settings.status, pausedReason: null }),
          ...(settings.scheduleId === undefined
            ? {}
            : { scheduleId: settings.scheduleId, hoursMode: settings.scheduleId === null ? 'mine' : 'own' }),
          ...(settings.rescheduleHost === undefined ? {} : { rescheduleHost: settings.rescheduleHost }),
          ...(settings.isPrivate === undefined ? {} : { isPrivate: settings.isPrivate }),
          ...(settings.showSocials === undefined ? {} : { showSocials: settings.showSocials }),
          ...(settings.defaultView === undefined ? {} : { defaultView: settings.defaultView }),
          ...(settings.profileSection === undefined ? {} : { profileSection: settings.profileSection }),
          ...(settings.profilePosition === undefined ? {} : { profilePosition: settings.profilePosition }),
          ...(questions === undefined ? {} : { questions }),
          ...(settings.fileToCrm === undefined ? {} : { fileToCrm: settings.fileToCrm }),
          ...(settings.answersObjectId === undefined ? {} : { answersObjectId: settings.answersObjectId }),
          ...(routing === undefined ? {} : { routing }),
          updatedAt: sql`now()`,
          updatedByType: by.type,
          updatedById: by.id,
          updatedByMemberId: by.memberId,
        })
        .where(eq(bookingPages.id, input.pageId))
        .returning();
      const [changed] = row === undefined ? [] : await pagesOf(tx, [row]);
      if (changed === undefined) throw refuse('NOT_FOUND', NOT_FOUND_MESSAGE);
      // Link only made Public: the page joins the end of its owner's link page, once (spec 0051).
      if (row !== undefined && page.isPrivate && !row.isPrivate) await placeNewPage(tx, scope, row);
      return await viewWithCounts(tx, scope, changed, now);
    } catch (error) {
      throw slugRefusal(error) ?? error;
    }
  });
}

/**
 * Deletes a page (AC-648): hidden from every list, its slug freed, its link
 * answering "This page is no longer available"; its bookings stay.
 */
export async function deleteBookingPage(
  scope: EngineScope,
  input: Pick<DeleteBookingPageInput, 'pageId'>,
): Promise<{ readonly pageId: string }> {
  requirePermission(scope, 'booking.manage');
  return inWorkspace(scope, async (tx) => {
    await pageToChange(tx, scope, input.pageId, true);
    const by = actorRow(scope.actor);
    await tx
      .update(bookingPages)
      .set({
        deletedAt: sql`now()`,
        updatedAt: sql`now()`,
        updatedByType: by.type,
        updatedById: by.id,
        updatedByMemberId: by.memberId,
      })
      .where(eq(bookingPages.id, input.pageId));
    return { pageId: input.pageId };
  });
}

/** The lock one person's profile order takes in a workspace, so two moves of it queue rather than cross. */
const profileLockKey = (workspaceId: string, memberId: string) => `booking:profile:${workspaceId}:${memberId}`;

/** The most page ids an audit entry of a reorder keeps, each way. */
const AUDIT_ORDER_IDS = 50;

/**
 * Puts the caller's own pages in their profile's new order (owner ask A102, 22 Oct 2026: drag to reorder, in place
 * of an Order number), in one transaction. The pages named go first, at 0, 1, 2 …, and the caller's other pages here
 * (Link only ones, one made since their list was read) after them in the order they had, so positions stay dense
 * under the 999 cap and a page made Public later joins the end. Placement is the owner's alone, whatever the page's
 * kind (as `updateBookingPage` says: an admin may change a colleague's page, never where it sits on the colleague's
 * profile). An id that isn't one of the caller's live pages here, another member's, another workspace's or a deleted
 * one, refuses the whole move as NOT_FOUND, saying nothing of whose it is. One audit entry when anything moved; no
 * outbox row (pages are settings). Answers every page it placed, in its new order, with its version.
 */
export async function reorderProfilePages(
  scope: EngineScope,
  input: Pick<ReorderProfileInput, 'pageIds'>,
): Promise<ProfileOrder> {
  requirePermission(scope, 'booking.manage');
  const owner = memberOf(scope);
  if (owner === undefined) throw refuse('FORBIDDEN', PERMISSIONS['booking.manage'].message);
  const named = [...new Set(input.pageIds)];
  // The contract refuses these first; a caller that skipped it is refused here too.
  if (named.length === 0 || named.length !== input.pageIds.length || named.length > PROFILE_ORDER_MAX) {
    throw refuseOn('CONFIG_INVALID', 'Name each of your pages once.', 'pageIds');
  }
  return inWorkspace(scope, async (tx) => {
    await lockKey(tx, profileLockKey(scope.workspaceId, owner));
    // A workspace link is nobody's to place: it is on no profile.
    const mine = and(
      eq(bookingPages.ownerMemberId, owner),
      eq(bookingPages.scope, 'member'),
      isNull(bookingPages.deletedAt),
    );
    const place = { id: bookingPages.id, profilePosition: bookingPages.profilePosition };
    const found = await tx
      .select(place)
      .from(bookingPages)
      .where(and(mine, inArray(bookingPages.id, named)));
    if (found.length !== named.length) throw refuse('NOT_FOUND', NOT_FOUND_MESSAGE);
    const rest = await tx
      .select(place)
      .from(bookingPages)
      .where(and(mine, notInArray(bookingPages.id, named)))
      .orderBy(asc(bookingPages.profilePosition), asc(bookingPages.id))
      .limit(PROFILE_POSITION_MAX + 1);
    const order = [...named, ...rest.map((row) => row.id)];
    const was = new Map([...found, ...rest].map((row) => [row.id, row.profilePosition]));
    const moved = order.flatMap((id, index) => {
      const position = Math.min(index, PROFILE_POSITION_MAX);
      return was.get(id) === position ? [] : [{ id, position }];
    });
    if (moved.length > 0) {
      const by = actorRow(scope.actor);
      const values = sql.join(
        moved.map((move) => sql`(${move.id}::uuid, ${move.position}::smallint)`),
        sql`, `,
      );
      await tx.execute(sql`
        update booking_pages p
        set profile_position = v.position, updated_at = now(),
          updated_by_type = ${by.type}, updated_by_id = ${by.id}::uuid, updated_by_member_id = ${by.memberId}::uuid
        from (values ${values}) as v (id, position)
        where p.workspace_id = ${scope.workspaceId}::uuid and p.id = v.id
          and p.owner_member_id = ${owner}::uuid and p.scope = 'member' and p.deleted_at is null
      `);
      // The named pages' order before and after: what the person changed, and nothing of the pages it left alone.
      const before = [...found]
        .sort((left, right) => left.profilePosition - right.profilePosition || (left.id < right.id ? -1 : 1))
        .map((row) => row.id);
      await writeAudit(tx, scope.workspaceId, scope.actor, {
        action: 'booking_page.profile_reordered',
        targetType: 'member',
        targetId: owner,
        before: { pageIds: before.slice(0, AUDIT_ORDER_IDS) },
        after: { pageIds: named.slice(0, AUDIT_ORDER_IDS), moved: moved.length },
      });
    }
    const placed = await tx
      .select({ ...place, updatedAt: bookingPages.updatedAt })
      .from(bookingPages)
      .where(and(mine, inArray(bookingPages.id, order)));
    const byId = new Map(placed.map((row) => [row.id, row]));
    return {
      pages: order.flatMap((id) => {
        const row = byId.get(id);
        return row === undefined
          ? []
          : [{ id, profilePosition: row.profilePosition, updatedAt: row.updatedAt.toISOString() }];
      }),
    };
  });
}

/** One page's bookings (AC-646): upcoming soonest first, or past latest first, at most 100. */
export async function listBookings(
  scope: EngineScope,
  input: Pick<ListBookingsInput, 'pageId' | 'when'>,
  now: Date = new Date(),
): Promise<readonly BookingView[]> {
  requirePermission(scope, 'booking.manage');
  return inWorkspace(scope, async (tx) => {
    const page = await loadPage(tx, input.pageId);
    // A deleted page's bookings stay readable to whoever could change it.
    if (page === undefined || !mayChange(scope, page)) throw refuse('NOT_FOUND', NOT_FOUND_MESSAGE);
    const upcoming = input.when === 'upcoming';
    const rows = await tx
      .select()
      .from(bookings)
      .where(and(eq(bookings.pageId, page.id), upcoming ? gte(bookings.endsAt, now) : lt(bookings.endsAt, now)))
      .orderBy(upcoming ? asc(bookings.startsAt) : desc(bookings.startsAt), asc(bookings.id))
      .limit(BOOKINGS_PAGE_MAX);
    const seen = await seenLinks(tx, scope.access, rows);
    return rows.map((row): BookingView => ({
      id: row.id,
      pageId: row.pageId,
      hostMemberId: row.hostMemberId,
      startsAt: row.startsAt.toISOString(),
      endsAt: row.endsAt.toISOString(),
      visitorName: row.visitorName,
      visitorEmail: row.visitorEmail,
      visitorTimeZone: row.visitorTimeZone,
      status: row.status === 'cancelled' ? 'cancelled' : 'confirmed',
      ...linksOf(row, seen),
      eventFailed: row.eventFailedAt !== null,
      createdAt: row.createdAt.toISOString(),
    }));
  });
}

/**
 * The live pages nobody would be left to host once `memberId` is gone: theirs alone, or pools they were the last of.
 * A round robin page books a seat from every one of its groups, so it is left with nobody when a group they were the
 * last one switched on in empties (late trap #22: it stayed live, offering an empty calendar for ever); its fixed
 * hosts are extras, and it never stops for losing one.
 */
const hostlessPages = (memberId: string) => sql`
  p.status = 'live' and p.deleted_at is null
  and (
    (
      p.kind <> 'round_robin'
      and (
        p.owner_member_id = ${memberId}::uuid
        or exists (
          select 1 from booking_page_members pool
          where pool.workspace_id = p.workspace_id and pool.page_id = p.id and pool.member_id = ${memberId}::uuid
        )
      )
      and not exists (
        select 1 from booking_page_members m
        join members h on h.workspace_id = m.workspace_id and h.id = m.member_id and h.status = 'active'
        where m.workspace_id = p.workspace_id and m.page_id = p.id and m.member_id <> ${memberId}::uuid
      )
    )
    or (
      p.kind = 'round_robin'
      and exists (
        select 1 from booking_page_rotations pr
        join rotations r on r.workspace_id = pr.workspace_id and r.id = pr.rotation_id and r.deleted_at is null
        -- Through rotation_roster: "Everyone on the roster" holds every active member who isn't a guest, stored or not.
        join rotation_roster theirs on theirs.workspace_id = pr.workspace_id and theirs.rotation_id = pr.rotation_id
          and theirs.member_id = ${memberId}::uuid and theirs.is_on
        where pr.workspace_id = p.workspace_id and pr.page_id = p.id
          and not exists (
            select 1 from rotation_roster other
            join members h on h.workspace_id = other.workspace_id and h.id = other.member_id and h.status = 'active'
              and h.role::text in (${sql.join(
                ROTATION_ROLES.map((role) => sql`${role}`),
                sql`, `,
              )})
            where other.workspace_id = pr.workspace_id and other.rotation_id = pr.rotation_id
              and other.member_id <> ${memberId}::uuid and other.is_on
          )
      )
    )
  )
`;

/**
 * The booking pages' part of a removal (spec 0031, AC-814; spec 0037,
 * AC-1440): they leave every page's host pool, and each live page left with
 * nobody to host it (their own, or a pool they were the last of) pauses with
 * `paused_reason = 'host_removed'`, which the public page answers as it does
 * any paused page. Pages others still host stay live; their bookings stay,
 * naming them as host for admins to hand on.
 */
export const bookingPagesRemoval: RemovalEffect = {
  feature: 'booking pages',
  // Pools and the pages they own; their bookings, hours and holds stay (see `KEPT_ON_REMOVAL`).
  constraints: ['booking_page_members_member', 'booking_pages_owner'],
  count: async (tx, workspaceId, memberId) => {
    const found = await tx.execute<{ n: number }>(sql`
      select count(*)::int as n from booking_pages p where p.workspace_id = ${workspaceId}::uuid and ${hostlessPages(memberId)}
    `);
    return { pausedPages: found.rows[0]?.n ?? 0 };
  },
  run: async (context, memberId) => {
    const { tx, scope } = context;
    const by = actorRow(scope.actor);
    // Their rotations' locks first, as `rotationsRemoval` takes them: a rotation change switching off the one other
    // member waits, and then sees them gone, so no page is left live on a rotation with nobody (late trap #22).
    const theirs = await tx.execute<{ id: string }>(
      sql`select rotation_id::text as id from rotation_members where member_id = ${memberId}::uuid`,
    );
    await lockRotations(
      tx,
      scope.workspaceId,
      theirs.rows.map((row) => row.id),
    );
    // Paused first, while the pools still say whom they held; then they leave every pool.
    await tx.execute(sql`
      update booking_pages p
      set status = 'paused', paused_reason = 'host_removed', updated_at = now(),
        updated_by_type = ${by.type}, updated_by_id = ${by.id}::uuid, updated_by_member_id = ${by.memberId}::uuid
      where p.workspace_id = ${scope.workspaceId}::uuid and ${hostlessPages(memberId)}
    `);
    await tx.execute(sql`
      delete from booking_page_members where workspace_id = ${scope.workspaceId}::uuid and member_id = ${memberId}::uuid
    `);
  },
};
