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
  type MeetingListItem,
  type MeetingListPage,
  type MeetingSource,
} from '@crm/contracts';
import { schema } from '@crm/db';
import { requirePermission } from '../access/check.ts';
import type { EngineScope } from '../access/mint.ts';
import { can } from '../access/policy.ts';
import { inWorkspace } from '../access/run.ts';
import { checkId, isUuid } from '../engine/ids.ts';
import { inputInvalid } from '../engine/refusals.ts';
import { blockOccurrences } from './blocks.ts';
import { linksOf, seenLinks } from './links.ts';

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
function itemOf(
  {
    booking: row,
    pageTitle,
    location,
  }: {
    readonly booking: typeof bookings.$inferSelect;
    readonly pageTitle: string;
    readonly location: unknown;
  },
  seen: ReadonlySet<string>,
): BookingListItem {
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
    ...linksOf(row, seen),
    ...(row.videoUrl === null ? {} : { videoUrl: row.videoUrl }),
    ...(row.cancelReason === null ? {} : { cancelReason: row.cancelReason }),
    ...(row.cancelledBy === 'guest' || row.cancelledBy === 'host' || row.cancelledBy === 'calendar'
      ? { cancelledBy: row.cancelledBy }
      : {}),
    reschedules: row.reschedules,
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
    const seen = await seenLinks(
      tx,
      scope.access,
      rows.map(({ booking }) => booking),
    );
    return rows.map((row) => itemOf(row, seen));
  });
}

/** The most calendar events one read answers. */
const CALENDAR_EVENTS_MAX = 1_000;

/** One of the reader's own calendar events, as Postgres answers it. */
interface EventRow extends Record<string, unknown> {
  readonly id: string;
  readonly connection_id: string;
  readonly calendar_id: string;
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
 * calendar never shows here, private or not. Milestone 5 (AC-1001): only from the calendars the reader shows on
 * their week, each event and busy time with the calendar that holds it (the main one first when several do).
 */
export async function readBookingsCalendar(
  scope: EngineScope,
  input: { readonly from: string; readonly to: string },
): Promise<BookingsCalendarView> {
  const reader = readerOf(scope);
  if (reader === undefined) return { bookings: [], events: [], busy: [], blocks: [] };
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
              select distinct on (m.id) m.id::text as id, s.connection_id::text as connection_id,
                k.id::text as calendar_id, m.title, m.starts_at, m.ends_at, m.all_day, m.status, m.location,
                m.video_url
              from meetings m
              join meeting_sources s on s.workspace_id = m.workspace_id and s.meeting_id = m.id
              join calendar_connections c on c.workspace_id = s.workspace_id and c.id = s.connection_id
              join calendar_calendars k on k.workspace_id = s.workspace_id and k.connection_id = s.connection_id
                and k.provider_calendar_id = s.calendar_id and k.show_in_week
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
              order by m.id, c.created_at, k.is_primary desc, k.name
              limit ${CALENDAR_EVENTS_MAX}
            `)
          ).rows;
    const events = found
      .map((row): CalendarEventItem => ({
        id: row.id,
        connectionId: row.connection_id,
        calendarId: row.calendar_id,
        title: row.title,
        startsAt: iso(row.starts_at),
        endsAt: iso(row.ends_at),
        allDay: row.all_day,
        status: row.status,
        ...(row.location === null ? {} : { location: row.location }),
        ...(row.video_url === null ? {} : { videoUrl: row.video_url }),
      }))
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    // The reader's own time with nobody else invited, as Busy (the owner's call, 20 October 2026): never anyone else's.
    const busy =
      member === undefined
        ? []
        : (
            await tx.execute<{ connection_id: string; calendar_id: string; starts_at: string; ends_at: string }>(sql`
              select distinct b.connection_id::text as connection_id, k.id::text as calendar_id, b.starts_at,
                b.ends_at
              from calendar_calendars k
              join calendar_busy_times b on b.workspace_id = k.workspace_id and b.connection_id = k.connection_id
                and b.calendar_id = k.provider_calendar_id
              where k.member_id = ${member}::uuid and k.show_in_week
                and b.ends_at > ${from.toISOString()}::timestamptz and b.starts_at < ${to.toISOString()}::timestamptz
              order by b.starts_at, b.ends_at, connection_id, calendar_id
              limit ${CALENDAR_EVENTS_MAX}
            `)
          ).rows.map((row) => ({
            connectionId: row.connection_id,
            calendarId: row.calendar_id,
            startsAt: iso(row.starts_at),
            endsAt: iso(row.ends_at),
          }));
    // The reader's own closed time only (AC-712): another member's blocks never show, whatever the reader may see.
    const blocks = member === undefined ? [] : await blockOccurrences(tx, member, from, to);
    const seen = await seenLinks(
      tx,
      scope.access,
      rows.map(({ booking }) => booking),
    );
    return { bookings: rows.map((row) => itemOf(row, seen)), events, busy, blocks: [...blocks] };
  });
}

/** What a page of Bookings' list says when its cursor isn't one this read gave. */
const BAD_CURSOR = 'That page of meetings no longer exists. Start from the first page.';

/** A page's last meeting, where the next page begins: its start and its id. */
function cursorOf(startsAt: string, id: string): string {
  return Buffer.from(`${startsAt}|${id}`, 'utf8').toString('base64url');
}

/** Reads a cursor back, refusing one this read didn't give. */
function readCursor(cursor: string): { readonly at: Date; readonly id: string } {
  const [at, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  const when = new Date(at ?? '');
  if (id === undefined || !isUuid(id) || Number.isNaN(when.getTime())) throw inputInvalid('cursor', BAD_CURSOR);
  return { at: when, id: id.toLowerCase() };
}

/** A meeting with what orders it: its start and id. */
interface Listed {
  readonly at: string;
  readonly id: string;
  readonly item: MeetingListItem;
}

interface ListedEventRow extends EventRow {
  readonly attendees: string[] | null;
  readonly attendee_count: number;
}

/**
 * Bookings' list (the owner's ask of 21 October 2026): every meeting on one tab, the bookings the reader may see and
 * the reader's own calendar events from the calendars on their week, a page at a time by start (soonest first
 * upcoming; latest first past and cancelled), then id. Each source reads one more than the page from the cursor on,
 * by its own index (`bookings_by_host`, `bookings_by_page`; `meeting_sources_event` then `meetings_by_start`), and
 * the two merge. Never another member's calendar event; a show only calendar's meetings carry no record here either.
 */
export async function listMeetings(
  scope: EngineScope,
  input: {
    readonly when: 'upcoming' | 'past' | 'cancelled';
    readonly source?: MeetingSource;
    readonly calendarIds?: readonly string[];
    readonly cursor?: string;
    readonly limit?: number;
  },
  now: Date = new Date(),
): Promise<MeetingListPage> {
  const reader = readerOf(scope);
  if (reader === undefined) return { items: [] };
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 100);
  const source = input.source ?? 'all';
  const ascending = input.when === 'upcoming';
  const after = input.cursor === undefined ? undefined : readCursor(input.cursor);
  const calendarIds = input.calendarIds?.map((id) => checkId(id, 'Pick one of your calendars.'));
  return inWorkspace(scope, async (tx) => {
    // Bookings: the tab's, those the reader may see, from the cursor on.
    const shown =
      input.when === 'cancelled'
        ? eq(bookings.status, 'cancelled')
        : and(eq(bookings.status, 'confirmed'), ascending ? gte(bookings.endsAt, now) : lt(bookings.endsAt, now));
    const past =
      after === undefined
        ? undefined
        : ascending
          ? or(gt(bookings.startsAt, after.at), and(eq(bookings.startsAt, after.at), gt(bookings.id, after.id)))
          : or(lt(bookings.startsAt, after.at), and(eq(bookings.startsAt, after.at), lt(bookings.id, after.id)));
    const rows =
      source === 'calendar'
        ? []
        : await tx
            .select({ booking: bookings, pageTitle: bookingPages.title, location: bookingPages.location })
            .from(bookings)
            .innerJoin(bookingPages, eq(bookingPages.id, bookings.pageId))
            .where(and(shown, visibleTo(reader), past))
            .orderBy(
              ascending ? asc(bookings.startsAt) : desc(bookings.startsAt),
              ascending ? asc(bookings.id) : desc(bookings.id),
            )
            .limit(limit + 1);
    const seen = await seenLinks(
      tx,
      scope.access,
      rows.map(({ booking }) => booking),
    );
    const bookingItems: Listed[] = rows.map((row) => ({
      at: row.booking.startsAt.toISOString(),
      id: row.booking.id,
      item: { kind: 'booking', booking: itemOf(row, seen) },
    }));

    // The reader's own calendar events, from the calendars on their week (and the panel's pick).
    const member = reader.member;
    const tab =
      input.when === 'cancelled'
        ? sql`m.status = 'cancelled'`
        : ascending
          ? sql`m.status <> 'cancelled' and m.ends_at >= ${now.toISOString()}::timestamptz`
          : sql`m.status <> 'cancelled' and m.ends_at < ${now.toISOString()}::timestamptz`;
    const picked =
      calendarIds === undefined
        ? sql`true`
        : calendarIds.length === 0
          ? sql`false`
          : sql`k.id = any(${`{${calendarIds.join(',')}}`}::uuid[])`;
    // Inside the distinct subquery (each group is one meeting, so its start and id are the meeting's): a later page
    // reads only from the cursor on.
    const keyset =
      after === undefined
        ? sql`true`
        : ascending
          ? sql`(m.starts_at, m.id) > (${after.at.toISOString()}::timestamptz, ${after.id}::uuid)`
          : sql`(m.starts_at, m.id) < (${after.at.toISOString()}::timestamptz, ${after.id}::uuid)`;
    const events =
      member === undefined || source === 'bookings'
        ? []
        : (
            await tx.execute<ListedEventRow>(sql`
              select * from (
                select distinct on (m.id) m.id::text as id, s.connection_id::text as connection_id,
                  k.id::text as calendar_id, m.title, m.starts_at, m.ends_at, m.all_day, m.status, m.location,
                  m.video_url,
                  array(
                    select a.email from meeting_attendees a
                    where a.workspace_id = m.workspace_id and a.meeting_id = m.id
                      and a.member_id is distinct from ${member}::uuid
                    order by a.position limit 6
                  ) as attendees,
                  (
                    select count(*)::int from meeting_attendees a
                    where a.workspace_id = m.workspace_id and a.meeting_id = m.id
                      and a.member_id is distinct from ${member}::uuid
                  ) as attendee_count
                from meetings m
                join meeting_sources s on s.workspace_id = m.workspace_id and s.meeting_id = m.id
                join calendar_connections c on c.workspace_id = s.workspace_id and c.id = s.connection_id
                join calendar_calendars k on k.workspace_id = s.workspace_id and k.connection_id = s.connection_id
                  and k.provider_calendar_id = s.calendar_id and k.show_in_week
                where c.member_id = ${member}::uuid and ${tab} and ${picked} and ${keyset}
                  and m.booking_id is null and not m.created_by_crm
                  -- A booking's own event, synced back: the booking shows instead (as on the week).
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
                order by m.id, c.created_at, k.is_primary desc, k.name
              ) e
              order by e.starts_at ${ascending ? sql`asc` : sql`desc`}, e.id::uuid ${ascending ? sql`asc` : sql`desc`}
              limit ${limit + 1}
            `)
          ).rows;
    const eventItems: Listed[] = events.map((row) => ({
      at: iso(row.starts_at),
      id: row.id,
      item: {
        kind: 'event',
        event: {
          id: row.id,
          connectionId: row.connection_id,
          calendarId: row.calendar_id,
          title: row.title,
          startsAt: iso(row.starts_at),
          endsAt: iso(row.ends_at),
          allDay: row.all_day,
          status: row.status,
          ...(row.location === null ? {} : { location: row.location }),
          ...(row.video_url === null ? {} : { videoUrl: row.video_url }),
        },
        attendees: row.attendees ?? [],
        attendeeCount: row.attendee_count,
      },
    }));

    // The two merged by start then id, the tab's way round; a page of `limit`, the rest for the next.
    const sign = ascending ? 1 : -1;
    const merged = [...bookingItems, ...eventItems].sort(
      (a, b) => sign * (Date.parse(a.at) - Date.parse(b.at) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    );
    const page = merged.slice(0, limit);
    const last = page[page.length - 1];
    return {
      items: page.map((entry) => entry.item),
      ...(merged.length > limit && last !== undefined ? { nextCursor: cursorOf(last.at, last.id) } : {}),
    };
  });
}
