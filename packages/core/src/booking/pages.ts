// Booking pages for members (spec 0025, AC-623, AC-624, AC-645, AC-646,
// AC-648): list, read, make, change and delete pages, and list a page's
// bookings. `booking.manage` covers the member's own pages; `booking.admin`
// everyone's. A page the reader may not see answers as absent (NOT_FOUND).
// Pages are settings, not CRM data: their writes store no outbox row.
import { randomBytes } from 'node:crypto';
import { and, asc, desc, eq, gte, inArray, isNull, like, lt, sql } from 'drizzle-orm';
import {
  defaultAvailability,
  PERMISSIONS,
  slugFromTitle,
  type BookingPageSettings,
  type BookingPageView,
  type BookingView,
  type CreateBookingPageInput,
  type DeleteBookingPageInput,
  type GetBookingPageInput,
  type ListBookingsInput,
  type TeamHosts,
  type UpdateBookingPageInput,
  BOOKINGS_PAGE_MAX,
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
import { actorRow } from '../engine/scope.ts';
import type { RemovalEffect } from '../members/removal-effect.ts';
import { linksOf, seenLinks } from './links.ts';
import { ROTATION_ROLES, TEAM_LIMITS } from '../rotation/team.ts';
import { loadPage, pagesOf, type PageRecord } from './slots.ts';

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
 * `booking.admin`'s alone (spec 0029, AC-751), whoever made it.
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

/** A page as the reader sees it. */
function viewOf(scope: EngineScope, page: PageRecord, count: number, hosts?: TeamHosts): BookingPageView {
  return {
    id: page.id,
    publicKey: page.publicKey,
    kind: page.kind,
    ownerMemberId: page.ownerMemberId,
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
    ...(page.status === 'paused' && page.pausedReason !== undefined ? { pausedReason: page.pausedReason } : {}),
    ...(hosts === undefined ? {} : { hosts }),
    ...(page.kind === 'round_robin' ? { routing: { rules: [...(page.routingRules ?? [])] } } : {}),
    bookingsThisMonth: count,
    canChange: mayChange(scope, page),
    createdAt: page.createdAt.toISOString(),
    updatedAt: page.updatedAt.toISOString(),
  };
}

/** The pages the reader may see (AC-645): their own, or every live page with `booking.admin`; newest first. */
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
      .where(and(isNull(bookingPages.deletedAt), mine === undefined ? undefined : eq(bookingPages.ownerMemberId, mine)))
      .orderBy(desc(bookingPages.createdAt), asc(bookingPages.id))
      .limit(500);
    const pages = await pagesOf(tx, rows);
    const ids = pages.map((page) => page.id);
    const counts = await monthCounts(tx, ids, now);
    const hosts = await pageHosts(tx, pages);
    return pages.map((page) => viewOf(scope, page, counts.get(page.id) ?? 0, hosts.get(page.id)));
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

/** One page's view with its month's count and rotation. */
async function viewWithCounts(tx: WorkspaceTx, scope: EngineScope, page: PageRecord, now: Date) {
  const counts = await monthCounts(tx, [page.id], now);
  const hosts = await pageHosts(tx, [page]);
  return viewOf(scope, page, counts.get(page.id) ?? 0, hosts.get(page.id));
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
 * A team page books each member by their own default schedule (spec 0037, AC-1336's rule for members, read for
 * round robin: the open question in spec 0029 notes it), so it names no schedule of its owner.
 */
function checkTeamSchedule(kind: PageRecord['kind'], scheduleId: string | null | undefined): void {
  if (kind === 'round_robin' && scheduleId !== undefined && scheduleId !== null) {
    throw refuseOn('CONFIG_INVALID', 'A team page books each member by their own working hours.', 'scheduleId');
  }
}

/** A slug free among the workspace's live pages: the wanted one, else it with -2, -3 … */
async function freeSlug(tx: WorkspaceTx, wanted: string): Promise<string> {
  const base = wanted.slice(0, 56).replace(/-+$/, '');
  const taken = new Set(
    (
      await tx
        .select({ slug: bookingPages.slug })
        .from(bookingPages)
        .where(and(isNull(bookingPages.deletedAt), like(bookingPages.slug, `${base}%`)))
    ).map((row) => row.slug),
  );
  if (!taken.has(wanted)) return wanted;
  for (let n = 2; ; n += 1) if (!taken.has(`${base}-${String(n)}`)) return `${base}-${String(n)}`;
}

/** A slug refusal for a taken slug, on the `slug` field. */
const slugTaken = () => refuseOn('SLUG_TAKEN', 'Another booking page in this workspace has that web address.', 'slug');

/**
 * A new page for the caller (AC-623): the settings given, the rest
 * defaulted. A personal page has the caller as its one member; a round robin
 * page (spec 0029, AC-732) needs `booking.admin` and books from the rotation
 * named, each member by their own hours unless told otherwise. The same id
 * again answers the page it made (a retry).
 */
export async function createBookingPage(
  scope: EngineScope,
  input: Pick<CreateBookingPageInput, 'id' | 'title' | 'timeZone' | 'settings' | 'kind' | 'hosts'>,
  now: Date = new Date(),
): Promise<BookingPageView> {
  requirePermission(scope, 'booking.manage');
  const owner = memberOf(scope);
  if (owner === undefined) throw refuse('FORBIDDEN', PERMISSIONS['booking.manage'].message);
  const kind = input.kind ?? 'personal';
  if (kind === 'round_robin') requirePermission(scope, 'booking.admin');
  if (kind === 'round_robin' && input.hosts === undefined) {
    throw refuseOn('VALUE_REQUIRED', 'Pick the rotation this page books from.', 'hosts');
  }
  checkTeamSchedule(kind, input.settings?.scheduleId);
  return inWorkspace(scope, async (tx) => {
    const [existing] = await tx.select().from(bookingPages).where(eq(bookingPages.id, input.id));
    if (existing !== undefined) {
      if (existing.ownerMemberId !== owner) throw refuse('ID_TAKEN', 'A booking page with that id already exists.');
      const [page] = await pagesOf(tx, [existing]);
      if (page === undefined) throw refuse('ID_TAKEN', 'A booking page with that id already exists.');
      return viewWithCounts(tx, scope, page, now);
    }
    const given = input.settings ?? {};
    const settings: BookingPageSettings = {
      title: input.title,
      description: given.description ?? '',
      slug: given.slug ?? (await freeSlug(tx, slugFromTitle(input.title))),
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
    };
    if (settings.scheduleId !== null) await checkPageSchedule(tx, owner, settings.scheduleId);
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
          createdByType: by.type,
          createdById: by.id,
          createdByMemberId: by.memberId,
          updatedByType: by.type,
          updatedById: by.id,
          updatedByMemberId: by.memberId,
        })
        .returning();
      if (row === undefined) throw new Error('The booking page was not created.');
      if (kind === 'round_robin' && input.hosts !== undefined) {
        await setPageHosts(tx, scope.workspaceId, row.id, input.hosts);
        const [team] = await pagesOf(tx, [row]);
        if (team === undefined) throw new Error('The booking page was not created.');
        return await viewWithCounts(tx, scope, team, now);
      }
      await tx
        .insert(bookingPageMembers)
        .values({ workspaceId: scope.workspaceId, pageId: row.id, memberId: owner, position: 0 });
      const [page] = await pagesOf(tx, [row]);
      if (page === undefined) throw new Error('The booking page was not created.');
      return viewOf(scope, page, 0);
    } catch (error) {
      if (postgresError(error)?.constraint === 'booking_pages_slug') throw slugTaken();
      throw error;
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
    checkTeamSchedule(page.kind, settings.scheduleId);
    if (settings.scheduleId !== undefined && settings.scheduleId !== null) {
      await checkPageSchedule(tx, page.ownerMemberId, settings.scheduleId);
    }
    if (input.hosts !== undefined) {
      if (page.kind !== 'round_robin') {
        throw refuseOn('CONFIG_INVALID', 'Only a round robin page books from rotations.', 'hosts');
      }
      await setPageHosts(tx, scope.workspaceId, page.id, input.hosts);
    }
    // Routing rules (spec 0043, AC-1608): only a round robin page's, each naming members of its rotations; audited.
    const routing = input.routing;
    if (routing !== undefined) {
      if (page.kind !== 'round_robin') {
        throw refuseOn('CONFIG_INVALID', 'Only a team page has routing rules.', 'routing');
      }
      await checkPageRoutes(tx, page.id, routing.rules);
      const before = page.routingRules ?? [];
      if (rulesChanged(before, routing.rules)) {
        await writeAudit(tx, scope.workspaceId, scope.actor, {
          action: 'routing.changed',
          targetType: 'booking_page',
          targetId: page.id,
          before: { rules: before.length },
          after: { rules: routing.rules.length, changed: changedRuleIds(before, routing.rules) },
        });
      }
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
      return await viewWithCounts(tx, scope, changed, now);
    } catch (error) {
      if (postgresError(error)?.constraint === 'booking_pages_slug') throw slugTaken();
      throw error;
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

/** The live pages nobody would be left to host once `memberId` is gone: theirs alone, or pools they were the last of. */
const hostlessPages = (memberId: string) => sql`
  p.status = 'live' and p.deleted_at is null
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
