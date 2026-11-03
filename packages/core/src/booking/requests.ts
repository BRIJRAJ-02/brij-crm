// A page's requests (spec 0062, AC-6203): the bookings on a page that requires confirmation that still wait for
// their host's Confirm or Decline, soonest first, for the page editor's Requests card. Confirm and Decline
// themselves are `confirmBooking` and `declineBooking` in `change.ts`, under the one booking rule.
import { and, asc, eq } from 'drizzle-orm';
import { schema } from '@crm/db';
import type { BookingRequestView, ListRequestsInput } from '@crm/contracts';
import { inWorkspace } from '../access/run.ts';
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
    const page = await editablePage(tx, scope, input.pageId);
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
      .where(and(eq(bookings.pageId, page.id), eq(bookings.approval, 'pending'), eq(bookings.status, 'confirmed')))
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
