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
  type UpdateBookingPageInput,
  BOOKINGS_PAGE_MAX,
} from '@crm/contracts';
import { schema, type WorkspaceTx } from '@crm/db';
import { requirePermission } from '../access/check.ts';
import type { EngineScope } from '../access/mint.ts';
import { can } from '../access/policy.ts';
import { inWorkspace } from '../access/run.ts';
import { postgresError, refuse, refuseOn } from '../engine/refusals.ts';
import { actorRow } from '../engine/scope.ts';
import { loadPage, pageOf, type PageRecord } from './slots.ts';

const { bookingPageMembers, bookingPages, bookings } = schema;

/** A public key: 16 URL safe characters from 12 random bytes. */
export function newPublicKey(): string {
  return randomBytes(12).toString('base64url');
}

/** The member the scope acts for, or undefined (a key, the system). */
function memberOf(scope: EngineScope): string | undefined {
  return scope.access.principal.kind === 'member' ? scope.access.principal.memberId : undefined;
}

/** Whether the reader may see and change the page: their own with `booking.manage`, anyone's with `booking.admin`. */
function mayChange(scope: EngineScope, page: Pick<PageRecord, 'ownerMemberId'>): boolean {
  return can(scope.access, 'booking.admin') || page.ownerMemberId === memberOf(scope);
}

const NOT_FOUND_MESSAGE = 'That booking page doesn’t exist, or isn’t yours.';

/** The page, live and the reader's to change, or NOT_FOUND. */
async function pageToChange(tx: WorkspaceTx, scope: EngineScope, pageId: string, lock: boolean): Promise<PageRecord> {
  const query = tx
    .select()
    .from(bookingPages)
    .where(and(eq(bookingPages.id, pageId), isNull(bookingPages.deletedAt)));
  const [row] = lock ? await query.for('no key update') : await query;
  if (row === undefined) throw refuse('NOT_FOUND', NOT_FOUND_MESSAGE);
  const page = pageOf(row);
  if (!mayChange(scope, page)) throw refuse('NOT_FOUND', NOT_FOUND_MESSAGE);
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

/** A page as the reader sees it. */
function viewOf(scope: EngineScope, page: PageRecord, count: number): BookingPageView {
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
    availability: page.availability,
    bufferBefore: page.bufferBefore,
    bufferAfter: page.bufferAfter,
    minNoticeMinutes: page.minNoticeMinutes,
    windowDays: page.windowDays,
    dailyLimit: page.dailyLimit,
    slotStep: page.slotStep,
    status: page.status,
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
    const pages = rows.map(pageOf);
    const counts = await monthCounts(
      tx,
      pages.map((page) => page.id),
      now,
    );
    return pages.map((page) => viewOf(scope, page, counts.get(page.id) ?? 0));
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
    const counts = await monthCounts(tx, [page.id], now);
    return viewOf(scope, page, counts.get(page.id) ?? 0);
  });
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
 * A new personal page for the caller (AC-623): the settings given, the rest
 * defaulted, the caller as its one member. The same id again answers the
 * page it made (a retry).
 */
export async function createBookingPage(
  scope: EngineScope,
  input: Pick<CreateBookingPageInput, 'id' | 'title' | 'timeZone' | 'settings'>,
  now: Date = new Date(),
): Promise<BookingPageView> {
  requirePermission(scope, 'booking.manage');
  const owner = memberOf(scope);
  if (owner === undefined) throw refuse('FORBIDDEN', PERMISSIONS['booking.manage'].message);
  return inWorkspace(scope, async (tx) => {
    const [existing] = await tx.select().from(bookingPages).where(eq(bookingPages.id, input.id));
    if (existing !== undefined) {
      if (existing.ownerMemberId !== owner) throw refuse('ID_TAKEN', 'A booking page with that id already exists.');
      return viewOf(scope, pageOf(existing), (await monthCounts(tx, [existing.id], now)).get(existing.id) ?? 0);
    }
    const given = input.settings ?? {};
    const settings: BookingPageSettings = {
      title: input.title,
      description: given.description ?? '',
      slug: given.slug ?? (await freeSlug(tx, slugFromTitle(input.title))),
      durations: given.durations ?? [30],
      location: given.location ?? { type: 'video' },
      availability: given.availability ?? defaultAvailability(input.timeZone),
      bufferBefore: given.bufferBefore ?? 0,
      bufferAfter: given.bufferAfter ?? 0,
      minNoticeMinutes: given.minNoticeMinutes ?? 0,
      windowDays: given.windowDays ?? 60,
      dailyLimit: given.dailyLimit ?? null,
      slotStep: given.slotStep ?? null,
      status: given.status ?? 'live',
    };
    const by = actorRow(scope.actor);
    try {
      const [row] = await tx
        .insert(bookingPages)
        .values({
          workspaceId: scope.workspaceId,
          id: input.id,
          publicKey: newPublicKey(),
          slug: settings.slug,
          kind: 'personal',
          ownerMemberId: owner,
          title: settings.title,
          description: settings.description,
          durations: [...settings.durations],
          location: settings.location,
          availability: settings.availability,
          bufferBefore: settings.bufferBefore,
          bufferAfter: settings.bufferAfter,
          minNoticeMinutes: settings.minNoticeMinutes,
          windowDays: settings.windowDays,
          dailyLimit: settings.dailyLimit,
          slotStep: settings.slotStep,
          status: settings.status,
          createdByType: by.type,
          createdById: by.id,
          createdByMemberId: by.memberId,
          updatedByType: by.type,
          updatedById: by.id,
          updatedByMemberId: by.memberId,
        })
        .returning();
      if (row === undefined) throw new Error('The booking page was not created.');
      await tx
        .insert(bookingPageMembers)
        .values({ workspaceId: scope.workspaceId, pageId: row.id, memberId: owner, position: 0 });
      return viewOf(scope, pageOf(row), 0);
    } catch (error) {
      if (postgresError(error)?.constraint === 'booking_pages_slug') throw slugTaken();
      throw error;
    }
  });
}

/** A change to a page the reader may change (AC-623, AC-624): only the settings given. */
export async function updateBookingPage(
  scope: EngineScope,
  input: Pick<UpdateBookingPageInput, 'pageId' | 'settings'>,
  now: Date = new Date(),
): Promise<BookingPageView> {
  requirePermission(scope, 'booking.manage');
  return inWorkspace(scope, async (tx) => {
    await pageToChange(tx, scope, input.pageId, true);
    const { settings } = input;
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
          ...(settings.availability === undefined ? {} : { availability: settings.availability }),
          ...(settings.bufferBefore === undefined ? {} : { bufferBefore: settings.bufferBefore }),
          ...(settings.bufferAfter === undefined ? {} : { bufferAfter: settings.bufferAfter }),
          ...(settings.minNoticeMinutes === undefined ? {} : { minNoticeMinutes: settings.minNoticeMinutes }),
          ...(settings.windowDays === undefined ? {} : { windowDays: settings.windowDays }),
          ...(settings.dailyLimit === undefined ? {} : { dailyLimit: settings.dailyLimit }),
          ...(settings.slotStep === undefined ? {} : { slotStep: settings.slotStep }),
          ...(settings.status === undefined ? {} : { status: settings.status }),
          updatedAt: sql`now()`,
          updatedByType: by.type,
          updatedById: by.id,
          updatedByMemberId: by.memberId,
        })
        .where(eq(bookingPages.id, input.pageId))
        .returning();
      if (row === undefined) throw refuse('NOT_FOUND', NOT_FOUND_MESSAGE);
      return viewOf(scope, pageOf(row), (await monthCounts(tx, [row.id], now)).get(row.id) ?? 0);
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
      ...(row.personRecordId === null ? {} : { personRecordId: row.personRecordId }),
      ...(row.companyRecordId === null ? {} : { companyRecordId: row.companyRecordId }),
      eventFailed: row.eventFailedAt !== null,
      createdAt: row.createdAt.toISOString(),
    }));
  });
}
