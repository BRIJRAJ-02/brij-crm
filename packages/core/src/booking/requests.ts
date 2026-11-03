// A page's requests (spec 0062, AC-6203): the bookings on a page that requires confirmation that still wait for
// their host's Confirm or Decline, soonest first, for the page editor's Requests card. Confirm and Decline
// themselves are `confirmBooking` and `declineBooking` in `change.ts`, under the one booking rule.
import { and, asc, eq } from 'drizzle-orm';
import { schema } from '@crm/db';
import type { BookingRequestView, ListRequestsInput } from '@crm/contracts';
import { inWorkspace } from '../access/run.ts';
import { isRefusal } from '../engine/refusals.ts';
import type { EngineScope } from '../engine/scope.ts';
import { REQUEST_LEAD_MS, REQUEST_WAIT_MS } from './mail.ts';
import { editablePage } from './pages.ts';

const { bookings } = schema;

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
