// Bookings, the workspace's list (spec 0025, AC-646): every booking the
// reader may see, upcoming, past or cancelled, with its page's title and
// location. A member with `booking.manage` sees the bookings of their own
// pages and the ones they host; `booking.admin` sees everyone's. Deleted
// pages' bookings stay listed (AC-648). Bookings are settings, not CRM data:
// no outbox row, so the screen reads again when the person comes back to it.
// The week view reads a range: its bookings, and the reader's own calendar
// events from spec 0024's sync beside them.
import { and, asc, desc, eq, gt, gte, lt, or, sql } from 'drizzle-orm';
import {
  BOOKINGS_LIST_MAX,
  BookingLocation,
  type BookingListItem,
  type BookingsCalendarView,
  type CalendarEventItem,
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

/** Who the reader is and whether they see everyone's bookings; undefined when they see none. */
function readerOf(scope: EngineScope): { readonly member?: string; readonly everyone: boolean } | undefined {
  requirePermission(scope, 'booking.manage');
  const { principal } = scope.access;
  const member = principal.kind === 'member' ? principal.memberId : undefined;
  const everyone = can(scope.access, 'booking.admin');
  if (!everyone && member === undefined) return undefined;
  return { ...(member === undefined ? {} : { member }), everyone };
}

/** The bookings the reader may see: their own pages' and the ones they host, or everyone's. */
function visibleTo(reader: { readonly member?: string; readonly everyone: boolean }) {
  return reader.everyone || reader.member === undefined
    ? undefined
    : or(eq(bookingPages.ownerMemberId, reader.member), eq(bookings.hostMemberId, reader.member));
}

/** A booking row and its page as Bookings shows it. */
function itemOf({
  booking: row,
  pageTitle,
  location,
}: {
  readonly booking: typeof bookings.$inferSelect;
  readonly pageTitle: string;
  readonly location: unknown;
}): BookingListItem {
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
}

/** The reader's bookings on one of Bookings' tabs (see the header), at most `BOOKINGS_LIST_MAX`. */
export async function listWorkspaceBookings(
  scope: EngineScope,
  input: Pick<ListWorkspaceBookingsInput, 'when'>,
  now: Date = new Date(),
): Promise<readonly BookingListItem[]> {
  const reader = readerOf(scope);
  if (reader === undefined) return [];
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
      .where(and(shown, visibleTo(reader)))
      .orderBy(upcoming ? asc(bookings.startsAt) : desc(bookings.startsAt), asc(bookings.id))
      .limit(BOOKINGS_LIST_MAX);
    return rows.map(itemOf);
  });
}

/** The most calendar events one read answers. */
const CALENDAR_EVENTS_MAX = 1_000;

/** One of the reader's own calendar events, as Postgres answers it. */
interface EventRow extends Record<string, unknown> {
  readonly id: string;
  readonly connection_id: string;
  readonly title: string;
  readonly starts_at: Date | string;
  readonly ends_at: Date | string;
  readonly all_day: boolean;
  readonly status: 'confirmed' | 'tentative' | 'cancelled';
  readonly location: string | null;
  readonly video_url: string | null;
}

const iso = (value: Date | string) => new Date(value).toISOString();

/**
 * Bookings' week (the calendar view): every booking the reader may see that
 * overlaps [from, to), cancelled ones too, and the reader's own calendar
 * events in it from their connected calendars (spec 0024's meetings held by
 * one of their connections), leaving out the ones a booking made (marked
 * so, or the booking's own event synced back: same host, start and end, and
 * its video link or its visitor), so a booking never shows twice. Only the reader's own events: another member's
 * calendar never shows here, private or not.
 */
export async function readBookingsCalendar(
  scope: EngineScope,
  input: { readonly from: string; readonly to: string },
): Promise<BookingsCalendarView> {
  const reader = readerOf(scope);
  if (reader === undefined) return { bookings: [], events: [] };
  const from = new Date(input.from);
  const to = new Date(input.to);
  return inWorkspace(scope, async (tx) => {
    const rows = await tx
      .select({ booking: bookings, pageTitle: bookingPages.title, location: bookingPages.location })
      .from(bookings)
      .innerJoin(bookingPages, eq(bookingPages.id, bookings.pageId))
      .where(and(lt(bookings.startsAt, to), gt(bookings.endsAt, from), visibleTo(reader)))
      .orderBy(asc(bookings.startsAt), asc(bookings.id))
      .limit(BOOKINGS_LIST_MAX);
    const member = reader.member;
    const found =
      member === undefined
        ? []
        : (
            await tx.execute<EventRow>(sql`
              select distinct on (m.id) m.id::text as id, s.connection_id::text as connection_id, m.title,
                m.starts_at, m.ends_at, m.all_day, m.status, m.location, m.video_url
              from meetings m
              join meeting_sources s on s.workspace_id = m.workspace_id and s.meeting_id = m.id
              join calendar_connections c on c.workspace_id = s.workspace_id and c.id = s.connection_id
              where c.member_id = ${member}::uuid
                and m.starts_at < ${to.toISOString()}::timestamptz and m.ends_at > ${from.toISOString()}::timestamptz
                and m.booking_id is null and not m.created_by_crm and m.status <> 'cancelled'
                -- A booking's own event, synced back from the calendar it was written to: the same host, start and
                -- end, and the booking's video link or its visitor among the attendees. The booking shows instead.
                and not exists (
                  select 1 from bookings b
                  where b.workspace_id = m.workspace_id and b.host_member_id = c.member_id
                    and b.status = 'confirmed' and b.starts_at = m.starts_at and b.ends_at = m.ends_at
                    and (
                      (b.video_url is not null and b.video_url = m.video_url)
                      or exists (
                        select 1 from meeting_attendees a
                        where a.workspace_id = m.workspace_id and a.meeting_id = m.id and a.email = b.visitor_email
                      )
                    )
                )
              order by m.id, c.created_at
              limit ${CALENDAR_EVENTS_MAX}
            `)
          ).rows;
    const events = found
      .map((row): CalendarEventItem => ({
        id: row.id,
        connectionId: row.connection_id,
        title: row.title,
        startsAt: iso(row.starts_at),
        endsAt: iso(row.ends_at),
        allDay: row.all_day,
        status: row.status,
        ...(row.location === null ? {} : { location: row.location }),
        ...(row.video_url === null ? {} : { videoUrl: row.video_url }),
      }))
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    return { bookings: rows.map(itemOf), events };
  });
}
