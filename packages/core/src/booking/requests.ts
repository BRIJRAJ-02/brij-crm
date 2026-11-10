// A page's requests (spec 0062, AC-6203): the bookings on a page that requires confirmation that still wait for
// their host's Confirm or Decline, soonest first, for the page editor's Requests card. Confirm and Decline
// themselves are `confirmBooking` and `declineBooking` in `change.ts`, under the one booking rule.
import { and, asc, eq, isNull, or, sql } from 'drizzle-orm';
import { schema } from '@crm/db';
import {
  WAITING_REQUESTS_MAX,
  type BookingRequestView,
  type ListRequestsInput,
  type WaitingRequestView,
} from '@crm/contracts';
import { requirePermission } from '../access/check.ts';
import { inWorkspace } from '../access/run.ts';
import { isRefusal } from '../engine/refusals.ts';
import type { EngineScope } from '../engine/scope.ts';
import { REQUEST_LEAD_MS, REQUEST_WAIT_MS } from './mail.ts';
import { editablePage, pagesToChange } from './pages.ts';

const { bookingPages, bookings } = schema;

/** The most requests the card lists at once. */
const REQUESTS_MAX = 50;

/** When a request declines itself: 24 hours after it was made, or an hour before it starts, whichever is first. */
export function requestExpiry(createdAt: Date, startsAt: Date): Date {
  return new Date(Math.min(createdAt.getTime() + REQUEST_WAIT_MS, startsAt.getTime() - REQUEST_LEAD_MS));
}

/** The page's requests still waiting, soonest first. */
export async function listRequests(
  scope: EngineScope,
  input: Pick<ListRequestsInput, 'pageId'>,
): Promise<BookingRequestView[]> {
  return inWorkspace(scope, async (tx) => {
    // The page's editors see every request on it; a host who may not change the page sees their own (the one
    // booking rule: its host answers it), and a page they can't reach answers as if it had none.
    const editable = await editablePage(tx, scope, input.pageId).then(
      () => true,
      (error: unknown) => {
        if (isRefusal(error) && error.refusal.code === 'NOT_FOUND') return false;
        throw error;
      },
    );
    const me = scope.access.principal.kind === 'member' ? scope.access.principal.memberId : undefined;
    if (!editable && me === undefined) return [];
    const rows = await tx
      .select({
        id: bookings.id,
        startsAt: bookings.startsAt,
        endsAt: bookings.endsAt,
        createdAt: bookings.createdAt,
        visitorName: bookings.visitorName,
        visitorEmail: bookings.visitorEmail,
      })
      .from(bookings)
      .where(
        and(
          eq(bookings.pageId, input.pageId),
          eq(bookings.approval, 'pending'),
          eq(bookings.status, 'confirmed'),
          editable || me === undefined ? undefined : eq(bookings.hostMemberId, me),
        ),
      )
      .orderBy(asc(bookings.startsAt), asc(bookings.id))
      .limit(REQUESTS_MAX);
    return rows.map((row) => ({
      bookingId: row.id,
      start: row.startsAt.toISOString(),
      end: row.endsAt.toISOString(),
      visitorName: row.visitorName,
      visitorEmail: row.visitorEmail,
      expiresAt: requestExpiry(row.createdAt, row.startsAt).toISOString(),
    }));
  });
}

/**
 * Every request the reader may answer, across the pages, soonest first (Meetings › Requests, the Bookings redesign),
 * at most `WAITING_REQUESTS_MAX`: as `listRequests` answers page by page, every request on a page the reader may change,
 * and their own on any other. A page that is deleted or a managed template lists none. One read of the pending index
 * (`bookings_pending`) plus the page rule's fixed few, whatever the pages.
 */
export async function listWaitingRequests(scope: EngineScope): Promise<WaitingRequestView[]> {
  // As every Bookings read: booking.manage first (403), as `listRequests` refuses through `editablePage`.
  requirePermission(scope, 'booking.manage');
  return inWorkspace(scope, async (tx) => {
    const me = scope.access.principal.kind === 'member' ? scope.access.principal.memberId : undefined;
    const pages = await pagesToChange(tx, scope);
    // `where` undefined is every page (booking.admin); otherwise their pages or their own requests.
    const reach =
      pages.where === undefined
        ? undefined
        : or(pages.where, me === undefined ? undefined : eq(bookings.hostMemberId, me));
    const rows = await tx
      .select({
        id: bookings.id,
        startsAt: bookings.startsAt,
        endsAt: bookings.endsAt,
        createdAt: bookings.createdAt,
        visitorName: bookings.visitorName,
        visitorEmail: bookings.visitorEmail,
        hostMemberId: bookings.hostMemberId,
        pageId: bookingPages.id,
        ownerMemberId: bookingPages.ownerMemberId,
        kind: bookingPages.kind,
        scope: bookingPages.scope,
      })
      .from(bookings)
      .innerJoin(
        bookingPages,
        and(eq(bookingPages.workspaceId, bookings.workspaceId), eq(bookingPages.id, bookings.pageId)),
      )
      .where(
        and(
          // A literal, so the planner matches the partial index `bookings_pending`.
          sql`${bookings.approval} = 'pending'`,
          eq(bookings.status, 'confirmed'),
          isNull(bookingPages.deletedAt),
          sql`${bookingPages.kind} <> 'managed'`,
          reach,
        ),
      )
      .orderBy(asc(bookings.startsAt), asc(bookings.id))
      .limit(WAITING_REQUESTS_MAX);
    const distinct = [
      ...new Map(
        rows.map((row) => [
          row.pageId,
          { id: row.pageId, ownerMemberId: row.ownerMemberId, kind: row.kind, scope: row.scope },
        ]),
      ).values(),
    ];
    const changeable = await pages.changeable(distinct);
    return rows
      .filter((row) => changeable.has(row.pageId) || (me !== undefined && row.hostMemberId === me))
      .map((row) => ({
        bookingId: row.id,
        pageId: row.pageId,
        start: row.startsAt.toISOString(),
        end: row.endsAt.toISOString(),
        visitorName: row.visitorName,
        visitorEmail: row.visitorEmail,
        expiresAt: requestExpiry(row.createdAt, row.startsAt).toISOString(),
      }));
  });
}
