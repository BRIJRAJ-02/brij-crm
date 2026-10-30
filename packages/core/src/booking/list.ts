// Bookings, the workspace's list (spec 0025, AC-646): every booking the
// reader may see, upcoming, past or cancelled, with its page's title and
// location. A member with `booking.manage` sees the bookings of their own
// pages, the ones they host and the ones they co-host (`seen.ts`, the one
// rule); `booking.admin` may ask for everyone's (`hosts: 'all'`; the week and
// the list read Mine unless asked). Deleted
// pages' bookings stay listed (AC-648). Bookings are settings, not CRM data:
// no outbox row, so the screen reads again when the person comes back to it.
// The week view reads a range: its bookings, and the reader's own calendar
// events from spec 0024's sync beside them.
import { and, asc, desc, eq, gt, gte, lt, or, sql } from 'drizzle-orm';
import type { RecordRefDisplay } from '@crm/contracts/values';
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
import { schema, type WorkspaceTx } from '@crm/db';
import { requirePermission } from '../access/check.ts';
import type { EngineScope } from '../access/mint.ts';
import { inWorkspace } from '../access/run.ts';
import { checkId, isUuid, uuidList } from '../engine/ids.ts';
import { inputInvalid } from '../engine/refusals.ts';
import { blockOccurrences } from './blocks.ts';
import { handLinkOf, linkedRecords, linksOf, seenLinks } from './links.ts';
import { shownAsEvent } from './owned.ts';
import { shownAnswers } from './questions.ts';
import { bookingAccess, bookingReaderIn, bookingReaderOf, seesBookingSql, type BookingReader } from './seen.ts';

const { bookingPages, bookings, members } = schema;

/** One line of a booking's chat (spec 0042). */
type ChatLine = { role: 'visitor' | 'assistant'; text: string };

/** A stored chat line, or undefined for anything else. */
function chatLine(line: unknown): ChatLine | undefined {
  if (typeof line !== 'object' || line === null) return undefined;
  const { role, text } = line as { readonly role?: unknown; readonly text?: unknown };
  return (role === 'visitor' || role === 'assistant') && typeof text === 'string' ? { role, text } : undefined;
}

/** The guests, note and chat (spec 0042, AC-1522) a booking keeps among its answers. */
function guestsAndNote(answers: unknown): {
  readonly guests: string[];
  readonly note?: string;
  readonly chat?: ChatLine[];
} {
  if (typeof answers !== 'object' || answers === null) return { guests: [] };
  const { guests, note, chat } = answers as {
    readonly guests?: unknown;
    readonly note?: unknown;
    readonly chat?: unknown;
  };
  const lines = Array.isArray(chat) ? chat.map(chatLine).filter((line) => line !== undefined) : [];
  return {
    guests: Array.isArray(guests) ? guests.filter((guest): guest is string => typeof guest === 'string') : [],
    ...(typeof note === 'string' && note !== '' ? { note } : {}),
    ...(lines.length === 0 ? {} : { chat: lines }),
  };
}

/** Whose bookings a read asks for: the reader's own (their pages', hosted and co-hosted), or everyone's they may see. */
export type BookingHosts = 'mine' | 'all';

/** Who the reader is, before their reach is read; undefined when they see no bookings at all. */
function readerOf(scope: EngineScope): BookingReader | undefined {
  requirePermission(scope, 'booking.manage');
  const reader = bookingReaderOf(scope.access);
  if (!reader.admin && reader.member === undefined) return undefined;
  return reader;
}

/**
 * The reader for one read: with `hosts: 'all'` their scheduling reach too (spec 0037, AC-1262: Everyone is everyone
 * in their See reach), read once in the read's transaction; Mine needs none.
 */
async function readerIn(
  tx: WorkspaceTx,
  scope: EngineScope,
  reader: BookingReader,
  hosts: BookingHosts,
): Promise<BookingReader> {
  return hosts === 'all' && !reader.admin ? bookingReaderIn(tx, scope) : reader;
}

/**
 * The bookings the reader may see (`seen.ts`): with `hosts: 'mine'` (the default) only their own pages', the ones
 * they host and the ones they co-host, even for an admin; `'all'` is everyone's with `booking.admin`, and otherwise
 * theirs plus the hosts in their See reach. A reader who is no member (a key) has no "mine", so an admin key reads
 * everyone's.
 */
function visibleTo(reader: BookingReader, hosts: BookingHosts = 'mine') {
  return seesBookingSql(
    reader,
    {
      workspaceId: bookings.workspaceId,
      id: bookings.id,
      pageId: bookings.pageId,
      hostMemberId: bookings.hostMemberId,
      // Every Bookings read joins the page already.
      pageOwnerMemberId: bookingPages.ownerMemberId,
    },
    { everyone: hosts === 'all' || reader.member === undefined },
  );
}

/**
 * The listed bookings the reader may only See (spec 0037's Booking actions table): neither theirs, their page's,
 * a co-host's nor a host's they Manage. One read of the co-hosts of the rows in question, none when the reader
 * reaches nobody.
 */
async function seeOnlyOf(
  tx: WorkspaceTx,
  reader: BookingReader,
  rows: readonly { readonly booking: typeof bookings.$inferSelect; readonly pageOwner: string }[],
): Promise<ReadonlySet<string>> {
  const me = reader.member;
  if (reader.admin || me === undefined || reader.everyone === 'manage') return new Set();
  if ((reader.sees ?? []).length === 0 && reader.everyone === undefined) return new Set();
  const asked = rows.filter(({ booking, pageOwner }) => booking.hostMemberId !== me && pageOwner !== me);
  if (asked.length === 0) return new Set();
  const found = await tx.execute<{ booking_id: string; member_id: string }>(sql`
    select h.booking_id::text as booking_id, h.member_id::text as member_id from booking_hosts h
    where h.booking_id = any(${uuidList(asked.map(({ booking }) => booking.id))})
  `);
  const coHosts = new Map<string, string[]>();
  for (const row of found.rows) coHosts.set(row.booking_id, [...(coHosts.get(row.booking_id) ?? []), row.member_id]);
  return new Set(
    asked
      .filter(
        ({ booking, pageOwner }) =>
          bookingAccess(reader, {
            hostMemberId: booking.hostMemberId,
            ownerMemberId: pageOwner,
            coHostIds: coHosts.get(booking.id) ?? [],
          }) === 'see',
      )
      .map(({ booking }) => booking.id),
  );
}

/**
 * Whether the booking's host has time off over it (spec 0037, AC-1285): "Host away", flagged for someone to move or
 * reassign it, never moved by itself. Plain comparisons on the stored ends reach the blocks' btree index.
 */
const hostAwayColumn = sql<boolean>`exists (
  select 1 from booking_time_blocks a
  where a.workspace_id = ${bookings.workspaceId} and a.member_id = ${bookings.hostMemberId}
    and a.repeat = 'once' and a.kind = 'away'
    and a.ends_at > ${bookings.startsAt} and a.starts_at < ${bookings.endsAt}
)`;

/**
 * Whom a reader may see as away (spec 0037, AC-1286): themself, and hosts in their scheduling reach. A page's owner or
 * a co-host without reach over the host sees the booking, never the host's time off.
 */
function awayShownTo(reader: BookingReader): (hostId: string) => boolean {
  return (hostId) =>
    reader.admin || reader.everyone !== undefined || hostId === reader.member || (reader.sees ?? []).includes(hostId);
}

/** A booking row and its page as Bookings shows it. */
function itemOf(
  {
    booking: row,
    pageTitle,
    location,
    hostStatus,
    hostName,
    hostAway,
  }: {
    readonly booking: typeof bookings.$inferSelect;
    readonly pageTitle: string;
    readonly location: unknown;
    readonly hostStatus?: string | null;
    readonly hostName: string | null;
    readonly hostAway?: boolean;
  },
  seen: ReadonlySet<string>,
  linked: ReadonlyMap<string, RecordRefDisplay>,
  answersOf: (stored: unknown) => BookingListItem['answers'],
  seeOnly: ReadonlySet<string> = new Set(),
  showsAway: (hostId: string) => boolean = () => false,
): BookingListItem {
  const place = BookingLocation.safeParse(location);
  const away = hostAway === true && row.status === 'confirmed' && showsAway(row.hostMemberId) ? { hostAway: true } : {};
  // See over the host (spec 0037, AC-1262): the guest's name, the page's title, the time and status only.
  if (seeOnly.has(row.id)) {
    return {
      id: row.id,
      pageId: row.pageId,
      pageTitle,
      location: place.success ? place.data : { type: 'video' },
      hostMemberId: row.hostMemberId,
      hostName: hostName ?? '',
      needsHost: row.needsHostAt !== null,
      ...away,
      startsAt: row.startsAt.toISOString(),
      endsAt: row.endsAt.toISOString(),
      visitorName: row.visitorName,
      visitorEmail: '',
      visitorTimeZone: '',
      status: row.status === 'cancelled' ? 'cancelled' : 'confirmed',
      reschedules: row.reschedules,
      guests: [],
      eventFailed: row.eventFailedAt !== null,
      createdAt: row.createdAt.toISOString(),
      seeOnly: true,
      ...(hostStatus === undefined || hostStatus === null || hostStatus === 'active' ? {} : { hostRemoved: true }),
    };
  }
  // The answers to the page's own questions (spec 0057, AC-5714), those the reader may see.
  const answers = answersOf(row.answers) ?? [];
  return {
    id: row.id,
    pageId: row.pageId,
    pageTitle,
    location: place.success ? place.data : { type: 'video' },
    hostMemberId: row.hostMemberId,
    hostName: hostName ?? '',
    needsHost: row.needsHostAt !== null,
    ...away,
    ...(row.noShowAt === null ? {} : { noShow: true }),
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    visitorName: row.visitorName,
    visitorEmail: row.visitorEmail,
    visitorTimeZone: row.visitorTimeZone,
    status: row.status === 'cancelled' ? 'cancelled' : 'confirmed',
    ...linksOf(row, seen),
    ...handLinkOf(row, linked),
    ...(row.videoUrl === null ? {} : { videoUrl: row.videoUrl }),
    ...(row.cancelReason === null ? {} : { cancelReason: row.cancelReason }),
    ...(row.cancelledBy === 'guest' || row.cancelledBy === 'host' || row.cancelledBy === 'calendar'
      ? { cancelledBy: row.cancelledBy }
      : {}),
    reschedules: row.reschedules,
    ...guestsAndNote(row.answers),
    ...(answers.length === 0 ? {} : { answers }),
    eventFailed: row.eventFailedAt !== null,
    createdAt: row.createdAt.toISOString(),
    ...(hostStatus === undefined || hostStatus === null || hostStatus === 'active' ? {} : { hostRemoved: true }),
  };
}

/** The reader's bookings on one of Bookings' tabs (see the header), at most `BOOKINGS_LIST_MAX`; everyone's they may see unless `hosts: 'mine'`. */
export async function listWorkspaceBookings(
  scope: EngineScope,
  input: Pick<ListWorkspaceBookingsInput, 'when'> & { readonly hosts?: BookingHosts },
  now: Date = new Date(),
): Promise<readonly BookingListItem[]> {
  const base = readerOf(scope);
  if (base === undefined) return [];
  const upcoming = input.when === 'upcoming';
  const shown =
    input.when === 'cancelled'
      ? eq(bookings.status, 'cancelled')
      : and(eq(bookings.status, 'confirmed'), upcoming ? gte(bookings.endsAt, now) : lt(bookings.endsAt, now));
  return inWorkspace(scope, async (tx) => {
    const hosts = input.hosts ?? 'all';
    const reader = await readerIn(tx, scope, base, hosts);
    const rows = await tx
      .select({
        booking: bookings,
        pageTitle: bookingPages.title,
        pageOwner: bookingPages.ownerMemberId,
        location: bookingPages.location,
        // Whether the host is still here (spec 0031, AC-815): a removed host's bookings say so.
        hostStatus: members.status,
        hostName: members.name,
        hostAway: hostAwayColumn,
      })
      .from(bookings)
      .innerJoin(bookingPages, eq(bookingPages.id, bookings.pageId))
      .leftJoin(members, and(eq(members.workspaceId, bookings.workspaceId), eq(members.id, bookings.hostMemberId)))
      .where(and(shown, visibleTo(reader, hosts)))
      .orderBy(upcoming ? asc(bookings.startsAt) : desc(bookings.startsAt), asc(bookings.id))
      .limit(BOOKINGS_LIST_MAX);
    const seen = await seenLinks(
      tx,
      scope.access,
      rows.map(({ booking }) => booking),
    );
    const linked = await linkedRecords(
      tx,
      scope.access,
      rows.map(({ booking }) => booking),
    );
    const answers = await shownAnswers(
      tx,
      scope.access,
      rows.map(({ booking }) => booking.answers),
    );
    const seeOnly = await seeOnlyOf(tx, reader, rows);
    return rows.map((row) => itemOf(row, seen, linked, answers, seeOnly, awayShownTo(reader)));
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
  input: { readonly from: string; readonly to: string; readonly hosts?: BookingHosts },
): Promise<BookingsCalendarView> {
  const base = readerOf(scope);
  if (base === undefined) return { bookings: [], events: [], busy: [], blocks: [] };
  const from = new Date(input.from);
  const to = new Date(input.to);
  return inWorkspace(scope, async (tx) => {
    const reader = await readerIn(tx, scope, base, input.hosts ?? 'mine');
    const rows = await tx
      .select({
        booking: bookings,
        pageTitle: bookingPages.title,
        pageOwner: bookingPages.ownerMemberId,
        location: bookingPages.location,
        hostName: members.name,
        hostAway: hostAwayColumn,
      })
      .from(bookings)
      .innerJoin(bookingPages, eq(bookingPages.id, bookings.pageId))
      .leftJoin(members, and(eq(members.workspaceId, bookings.workspaceId), eq(members.id, bookings.hostMemberId)))
      .where(and(lt(bookings.startsAt, to), gt(bookings.endsAt, from), visibleTo(reader, input.hosts)))
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
                and m.status <> 'cancelled' and ${shownAsEvent()}
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
    const linked = await linkedRecords(
      tx,
      scope.access,
      rows.map(({ booking }) => booking),
    );
    const answers = await shownAnswers(
      tx,
      scope.access,
      rows.map(({ booking }) => booking.answers),
    );
    const seeOnly = await seeOnlyOf(tx, reader, rows);
    return {
      bookings: rows.map((row) => itemOf(row, seen, linked, answers, seeOnly, awayShownTo(reader))),
      events,
      busy,
      blocks: [...blocks],
    };
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
    readonly hosts?: BookingHosts;
    readonly calendarIds?: readonly string[];
    readonly cursor?: string;
    readonly limit?: number;
  },
  now: Date = new Date(),
): Promise<MeetingListPage> {
  const base = readerOf(scope);
  if (base === undefined) return { items: [] };
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 100);
  const source = input.source ?? 'all';
  const ascending = input.when === 'upcoming';
  const after = input.cursor === undefined ? undefined : readCursor(input.cursor);
  const calendarIds = input.calendarIds?.map((id) => checkId(id, 'Pick one of your calendars.'));
  return inWorkspace(scope, async (tx) => {
    const reader = await readerIn(tx, scope, base, input.hosts ?? 'mine');
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
            .select({
              booking: bookings,
              pageTitle: bookingPages.title,
              pageOwner: bookingPages.ownerMemberId,
              location: bookingPages.location,
              // The host, for a colleague's booking and a removed host's (spec 0031, AC-815; spec 0037).
              hostStatus: members.status,
              hostName: members.name,
              hostAway: hostAwayColumn,
            })
            .from(bookings)
            .innerJoin(bookingPages, eq(bookingPages.id, bookings.pageId))
            .leftJoin(
              members,
              and(eq(members.workspaceId, bookings.workspaceId), eq(members.id, bookings.hostMemberId)),
            )
            .where(and(shown, visibleTo(reader, input.hosts), past))
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
    const linked = await linkedRecords(
      tx,
      scope.access,
      rows.map(({ booking }) => booking),
    );
    const answers = await shownAnswers(
      tx,
      scope.access,
      rows.map(({ booking }) => booking.answers),
    );
    const seeOnly = await seeOnlyOf(tx, reader, rows);
    const bookingItems: Listed[] = rows.map((row) => ({
      at: row.booking.startsAt.toISOString(),
      id: row.booking.id,
      item: { kind: 'booking', booking: itemOf(row, seen, linked, answers, seeOnly, awayShownTo(reader)) },
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
                  and ${shownAsEvent()}
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
