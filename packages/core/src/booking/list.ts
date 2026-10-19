// Bookings, the workspace's list (spec 0025, AC-646): every booking the
// reader may see, upcoming, past or cancelled, with its page's title and
// location. A member with `booking.manage` sees the bookings of their own
// pages and the ones they host; `booking.admin` sees everyone's. Deleted
// pages' bookings stay listed (AC-648). Bookings are settings, not CRM data:
// no outbox row, so the screen reads again when the person comes back to it.
import { and, asc, desc, eq, gte, lt, or } from 'drizzle-orm';
import {
  BOOKINGS_LIST_MAX,
  BookingLocation,
  type BookingListItem,
  type ListWorkspaceBookingsInput,
} from '@crm/contracts';
import { schema } from '@crm/db';
import { requirePermission } from '../access/check.ts';
import type { EngineScope } from '../access/mint.ts';
import { can } from '../access/policy.ts';
import { inWorkspace } from '../access/run.ts';

const { bookingPages, bookings } = schema;

/** The guests and note a booking keeps among its answers. */
function guestsAndNote(answers: unknown): { readonly guests: string[]; readonly note?: string } {
  if (typeof answers !== 'object' || answers === null) return { guests: [] };
  const { guests, note } = answers as { readonly guests?: unknown; readonly note?: unknown };
  return {
    guests: Array.isArray(guests) ? guests.filter((guest): guest is string => typeof guest === 'string') : [],
    ...(typeof note === 'string' && note !== '' ? { note } : {}),
  };
}

/** The reader's bookings on one of Bookings' tabs (see the header), at most `BOOKINGS_LIST_MAX`. */
export async function listWorkspaceBookings(
  scope: EngineScope,
  input: Pick<ListWorkspaceBookingsInput, 'when'>,
  now: Date = new Date(),
): Promise<readonly BookingListItem[]> {
  requirePermission(scope, 'booking.manage');
  const { principal } = scope.access;
  const member = principal.kind === 'member' ? principal.memberId : undefined;
  const everyone = can(scope.access, 'booking.admin');
  if (!everyone && member === undefined) return [];
  const upcoming = input.when === 'upcoming';
  const shown =
    input.when === 'cancelled'
      ? eq(bookings.status, 'cancelled')
      : and(eq(bookings.status, 'confirmed'), upcoming ? gte(bookings.endsAt, now) : lt(bookings.endsAt, now));
  return inWorkspace(scope, async (tx) => {
    const rows = await tx
      .select({ booking: bookings, pageTitle: bookingPages.title, location: bookingPages.location })
      .from(bookings)
      .innerJoin(bookingPages, eq(bookingPages.id, bookings.pageId))
      .where(
        and(
          shown,
          everyone || member === undefined
            ? undefined
            : or(eq(bookingPages.ownerMemberId, member), eq(bookings.hostMemberId, member)),
        ),
      )
      .orderBy(upcoming ? asc(bookings.startsAt) : desc(bookings.startsAt), asc(bookings.id))
      .limit(BOOKINGS_LIST_MAX);
    return rows.map(({ booking: row, pageTitle, location }): BookingListItem => {
      const place = BookingLocation.safeParse(location);
      return {
        id: row.id,
        pageId: row.pageId,
        pageTitle,
        location: place.success ? place.data : { type: 'video' },
        hostMemberId: row.hostMemberId,
        startsAt: row.startsAt.toISOString(),
        endsAt: row.endsAt.toISOString(),
        visitorName: row.visitorName,
        visitorEmail: row.visitorEmail,
        visitorTimeZone: row.visitorTimeZone,
        status: row.status === 'cancelled' ? 'cancelled' : 'confirmed',
        ...(row.personRecordId === null ? {} : { personRecordId: row.personRecordId }),
        ...(row.companyRecordId === null ? {} : { companyRecordId: row.companyRecordId }),
        ...(row.videoUrl === null ? {} : { videoUrl: row.videoUrl }),
        ...(row.cancelReason === null ? {} : { cancelReason: row.cancelReason }),
        ...guestsAndNote(row.answers),
        eventFailed: row.eventFailedAt !== null,
        createdAt: row.createdAt.toISOString(),
      };
    });
  });
}
