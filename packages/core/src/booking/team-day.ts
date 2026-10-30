// The Team day (spec 0030, as spec 0037's Amends 0030 changes it, job J12): one day of everyone the reader may See,
// one column each, in one request whatever the team's size (AC-778): the reach (none for owners and admins), the
// columns with their default schedules, their time off, their booked seats, the lane's flagged bookings, the
// bookings themselves through Bookings' own masking, their blocks, the reader's own calendar time, and colleagues'
// conflict calendars as Busy. No read per member.
//
// Who is in it is the scheduling reach (`canActFor`, the one check): a member asked for outside it is left out, never
// refused (AC-769). A colleague's outside calendar is a span and nothing else: no title, place, link or attendee is
// read from it (AC-770). A booking is as Bookings shows it to this reader (`booking/seen.ts`, AC-771, AC-1262); a
// block's label and time off's reason only to the member and Manage over them (AC-772, AC-1286). Issues are derived
// here, nothing stored (AC-1436). It writes nothing.
import { sql } from 'drizzle-orm';
import { DateTime } from 'luxon';
import {
  BookingAvailability,
  defaultAvailability,
  isTimeZone,
  TEAM_DAY,
  TimeOffReason,
  WEEKDAYS,
  type BookingAvailability as Hours,
  type TeamDay,
  type TeamDayColumn,
  type TeamDayInput,
  type TeamDayIssue,
  type TeamDayItem,
  type TeamDaySpan,
} from '@crm/contracts';
import { requirePermission } from '../access/check.ts';
import type { EngineScope } from '../access/mint.ts';
import { inWorkspace } from '../access/run.ts';
import { canActFor, schedulingReach } from '../access/scheduling.ts';
import { uuidList } from '../engine/ids.ts';
import { inputInvalid } from '../engine/refusals.ts';
import { blockOccurrencesOfMembers } from './blocks.ts';
import { bookingItemsOf, ownCalendarTime } from './list.ts';
import { shownAsEvent } from './owned.ts';
import { bookingAlias, bookingReaderWith, seesBookingSql } from './seen.ts';

/** How far from now a day may be: a year either way (the roster's reach is less; bookings go back further). */
const REACH_DAYS = 366;

/** How far before the day a meeting or seat may start and still reach into it (buffers, long events). */
const LOOKBACK_MS = 48 * 3_600_000;

/** The most bookings the Needs a host lane lists. */
const LANE_MAX = 100;

/** The most colleagues' busy spans one read answers: the items cap, so a busy team is cut, never slow. */
const ROWS_MAX = TEAM_DAY.items;

const iso = (value: Date | string): string => new Date(value).toISOString();

/** A stretch of time in milliseconds, the end exclusive. */
interface Ms {
  readonly start: number;
  readonly end: number;
}

/** "09:30" (or "24:00") as minutes from midnight. */
function minutesOf(time: string): number {
  const [hours, minutes] = time.split(':');
  return Number(hours) * 60 + Number(minutes);
}

/** Spans merged where they touch or overlap, by start (pure). */
export function mergeSpans(spans: readonly Ms[]): readonly Ms[] {
  const sorted = spans.filter((span) => span.end > span.start).toSorted((a, b) => a.start - b.start);
  const merged: Ms[] = [];
  for (const span of sorted) {
    const last = merged.at(-1);
    if (last !== undefined && span.start <= last.end)
      merged[merged.length - 1] = { ...last, end: Math.max(last.end, span.end) };
    else merged.push(span);
  }
  return merged;
}

/**
 * A member's open hours over [from, to) (pure): each local date the day touches in their schedule's zone, its date
 * override when it has one, else its weekday's hours, read in that zone and cut to the day.
 */
export function openSpans(hours: Hours, from: Date, to: Date): readonly Ms[] {
  const zone = hours.timeZone;
  const overrides = new Map(hours.overrides.map((override) => [override.date, override.ranges]));
  const first = DateTime.fromJSDate(from, { zone }).startOf('day').minus({ days: 1 });
  const spans: Ms[] = [];
  for (let step = 0; step < 4; step += 1) {
    const date = first.plus({ days: step });
    const key = date.toISODate() ?? '';
    const weekday = WEEKDAYS[date.weekday - 1] ?? 'mon';
    for (const [start, end] of overrides.get(key) ?? hours.weekly[weekday]) {
      const at = (minutes: number) =>
        minutes >= 1440
          ? date.plus({ days: 1 }).toMillis()
          : date.set({ hour: Math.floor(minutes / 60), minute: minutes % 60 }).toMillis();
      const span = {
        start: Math.max(at(minutesOf(start)), from.getTime()),
        end: Math.min(at(minutesOf(end)), to.getTime()),
      };
      if (span.end > span.start) spans.push(span);
    }
  }
  return mergeSpans(spans);
}

/** One member's day as the issues read it: open hours, time off, confirmed bookings and calendar time. */
export interface IssueColumn {
  readonly memberId: string;
  readonly open: readonly Ms[];
  readonly away?: Ms;
  readonly bookings: readonly ({ readonly id: string } & Ms)[];
  readonly calendar: readonly Ms[];
}

/**
 * The day's issues (pure, AC-1436): each confirmed booking outside its host's open hours (not one their time off
 * covers, which Bookings already flags Host away), and each clash, a booking overlapping another of the same member's
 * (once a pair) or their calendar time (once a booking).
 */
export function teamDayIssues(columns: readonly IssueColumn[]): readonly TeamDayIssue[] {
  const issues: TeamDayIssue[] = [];
  for (const column of columns) {
    const sorted = column.bookings.toSorted((a, b) => a.start - b.start || a.id.localeCompare(b.id));
    for (const booking of sorted) {
      const isAway = column.away !== undefined && column.away.start < booking.end && column.away.end > booking.start;
      const inside = column.open.some((span) => span.start <= booking.start && booking.end <= span.end);
      if (!inside && !isAway) issues.push({ kind: 'outsideHours', memberId: column.memberId, bookingId: booking.id });
    }
    sorted.forEach((booking, index) => {
      for (const other of sorted.slice(index + 1)) {
        if (other.start >= booking.end) break;
        issues.push({ kind: 'clash', memberId: column.memberId, bookingId: booking.id, withBookingId: other.id });
      }
      if (column.calendar.some((span) => span.start < booking.end && span.end > booking.start)) {
        issues.push({ kind: 'clash', memberId: column.memberId, bookingId: booking.id });
      }
    });
  }
  return issues;
}

/** A stored schedule's hours, or the virtual default's in `zone` (damaged hours too, as the slot engine reads them). */
function hoursIn(stored: unknown, zone: string): Hours {
  if (stored === null || stored === undefined) return defaultAvailability(zone);
  const parsed = BookingAvailability.safeParse(stored);
  return parsed.success ? parsed.data : defaultAvailability(zone);
}

/** A member's fallback zone: theirs, else the workspace's, else UTC. */
const zoneOrUtc = (zone: string | null): string => (zone !== null && isTimeZone(zone) ? zone : 'UTC');

const spanOf = (span: Ms): TeamDaySpan => ({ startsAt: iso(new Date(span.start)), endsAt: iso(new Date(span.end)) });

/** The day [from, to) in `zone`, refused when it isn't within a year of now. */
function dayBounds(day: string, zone: string, now: Date): { readonly from: Date; readonly to: Date } {
  const start = DateTime.fromISO(day, { zone }).startOf('day');
  if (!start.isValid) throw inputInvalid('day', 'Give a real date, such as 2026-10-08.');
  if (Math.abs(start.toMillis() - now.getTime()) > REACH_DAYS * 86_400_000) {
    throw inputInvalid('day', 'Pick a day within a year of today.');
  }
  return { from: start.toJSDate(), to: start.plus({ days: 1 }).toJSDate() };
}

interface MemberRow extends Record<string, unknown> {
  readonly id: string;
  readonly name: string;
  readonly job_title: string | null;
  readonly zone: string | null;
  readonly availability: unknown;
  readonly total: number;
}

/**
 * The Team day (AC-760 to AC-781, AC-1287, AC-1434 to AC-1438): the reader's See reach, at most 50 columns (`truncated`
 * past that), each member's day as the header says. Needs `booking.manage` (Bookings' own gate); only a member reads
 * it (a key reads an empty day).
 */
export async function readTeamDay(
  scope: EngineScope,
  input: Pick<TeamDayInput, 'day' | 'timeZone' | 'memberIds' | 'withBookings' | 'order'>,
  deps: { readonly now?: Date } = {},
): Promise<TeamDay> {
  requirePermission(scope, 'booking.manage');
  const { from, to } = dayBounds(input.day, input.timeZone, deps.now ?? new Date());
  const empty: TeamDay = { day: input.day, from: iso(from), to: iso(to), columns: [], bookings: [], issues: [] };
  const { principal } = scope.access;
  if (principal.kind !== 'member') return empty;
  const me = principal.memberId;
  const fromAt = from.toISOString();
  const toAt = to.toISOString();
  return inWorkspace(scope, async (tx) => {
    const reach = await schedulingReach(tx, scope);
    const reader = bookingReaderWith(scope.access, reach);
    // Without a reach over everyone, only the reader and the members reached one by one, named in the read, so the
    // cut never fills with members left out (AC-769: never anyone outside it, whatever `memberIds` asks).
    const named = reach.all === undefined ? [me, ...reach.members.keys()] : undefined;
    const within = named === undefined ? sql`true` : sql`m.id = any(${uuidList(named)})`;
    const asked = input.memberIds === undefined ? sql`true` : sql`m.id = any(${uuidList(input.memberIds)})`;
    const booked =
      input.withBookings === true
        ? sql`exists (
            select 1 from booking_hosts h
            where h.workspace_id = m.workspace_id and h.member_id = m.id and h.status = 'confirmed'
              and h.starts_at >= ${iso(new Date(from.getTime() - LOOKBACK_MS))}::timestamptz
              and h.starts_at < ${toAt}::timestamptz and h.ends_at > ${fromAt}::timestamptz
          )`
        : sql`true`;
    // Me first, then by name; or by job title (those without one last), then by name (AC-1438).
    const order =
      input.order === 'title'
        ? sql`lower(m.job_title) nulls last, lower(m.name), m.id`
        : sql`(m.id = ${me}::uuid) desc, lower(m.name), m.id`;
    // One query: the members, their default schedules, and how many matched in all (for "Showing 50 of 64").
    const found = (
      await tx.execute<MemberRow>(sql`
        select m.id::text as id, m.name, m.job_title, coalesce(m.time_zone, w.time_zone) as zone, s.availability,
          (count(*) over ())::int as total
        from members m
        join workspaces w on w.id = m.workspace_id
        left join availability_schedules s on s.workspace_id = m.workspace_id and s.member_id = m.id and s.is_default
        where m.workspace_id = ${scope.workspaceId}::uuid and m.status = 'active'
          and (m.role::text <> 'guest' or m.id = ${me}::uuid)
          and ${within} and ${asked} and ${booked}
        order by ${order}
        limit ${TEAM_DAY.members}
      `)
    ).rows.filter((row) => canActFor(reach, row.id, 'view'));
    const total = found[0]?.total ?? 0;
    const ids = found.map((row) => row.id);
    // The lane (AC-1435): only for people who manage someone (or `booking.admin`), who can do something about it.
    const managesSomeone =
      reader.admin || reach.all === 'manage' || [...reach.members.values()].some((level) => level === 'manage');
    if (ids.length === 0 && !managesSomeone) return empty;

    // Each member's confirmed seats over the day (`booking_hosts_by_member`): a co-host's column holds it too.
    const seats =
      ids.length === 0
        ? []
        : (
            await tx.execute<{ booking_id: string; member_id: string; starts_at: string; ends_at: string }>(sql`
              select h.booking_id::text as booking_id, h.member_id::text as member_id, b.starts_at, b.ends_at
              from booking_hosts h
              join bookings b on b.workspace_id = h.workspace_id and b.id = h.booking_id
              where h.workspace_id = ${scope.workspaceId}::uuid and h.status = 'confirmed'
                and h.member_id = any(${uuidList(ids)})
                -- Widened by the page's buffers, so a day further back than the booking's own bound.
                and h.starts_at >= ${iso(new Date(from.getTime() - LOOKBACK_MS))}::timestamptz
                and h.starts_at < ${toAt}::timestamptz
                and b.status = 'confirmed' and b.starts_at < ${toAt}::timestamptz and b.ends_at > ${fromAt}::timestamptz
              order by b.starts_at, h.booking_id, h.member_id
              limit ${TEAM_DAY.items}
            `)
          ).rows;
    // Bookings flagged Needs a host over the day (`bookings_needs_host`), the reader may see: a host who left isn't a
    // column. Host away comes from the columns' own bookings, as Bookings flags it.
    const flagged = managesSomeone
      ? (
          await tx.execute<{ id: string }>(sql`
            select b.id::text as id from bookings b
            where b.workspace_id = ${scope.workspaceId}::uuid and b.needs_host_at is not null
              and b.starts_at >= ${iso(new Date(from.getTime() - LOOKBACK_MS))}::timestamptz
              and b.starts_at < ${toAt}::timestamptz and b.ends_at > ${fromAt}::timestamptz
              and b.status = 'confirmed' and ${seesBookingSql(reader, bookingAlias('b'))}
            order by b.starts_at, b.id
            limit ${LANE_MAX}
          `)
        ).rows.map((row) => row.id)
      : [];
    const bookingIds = [...new Set([...seats.map((seat) => seat.booking_id), ...flagged])];
    // As Bookings shows each to this reader (masked to See where that is all they have), and only those they may see.
    const bookings = await bookingItemsOf(tx, scope, reader, bookingIds);
    const byId = new Map(bookings.map((booking) => [booking.id, booking]));

    // Time off touching the day: the Away band and the header's status (AC-1287, AC-1437).
    const awayRows =
      ids.length === 0
        ? []
        : (
            await tx.execute<{
              member_id: string;
              starts_at: string;
              ends_at: string;
              reason: string | null;
              note: string | null;
            }>(sql`
              select member_id::text as member_id, starts_at, ends_at, reason, note from booking_time_blocks
              where workspace_id = ${scope.workspaceId}::uuid and kind = 'away' and repeat = 'once'
                and member_id = any(${uuidList(ids)})
                and ends_at > ${fromAt}::timestamptz and starts_at < ${toAt}::timestamptz
              order by starts_at, id
            `)
          ).rows;
    // Every member's blocks and holds in one read; time off draws as the band instead.
    const closed = await blockOccurrencesOfMembers(tx, ids, from, to);
    // The reader's own calendar time in full, as their week shows it.
    const own = ids.includes(me) ? await ownCalendarTime(tx, me, from, to) : { events: [], busy: [] };
    // Colleagues' conflict calendars (spec 0024 M5's `check_conflicts`) as spans: meetings (not ones a booking made,
    // nor all day ones, which would close a whole day) and busy times. No title or other detail is read (AC-770).
    const colleagues = ids.filter((id) => id !== me);
    const busyRows =
      colleagues.length === 0
        ? []
        : (
            await tx.execute<{ member_id: string; starts_at: string; ends_at: string }>(sql`
              select distinct c.member_id::text as member_id, m.starts_at, m.ends_at
              from meetings m
              join meeting_sources s on s.workspace_id = m.workspace_id and s.meeting_id = m.id
              join calendar_connections c on c.workspace_id = s.workspace_id and c.id = s.connection_id
              join calendar_calendars k on k.workspace_id = s.workspace_id and k.connection_id = s.connection_id
                and k.provider_calendar_id = s.calendar_id and k.check_conflicts
              where c.member_id = any(${uuidList(colleagues)})
                and m.starts_at >= ${iso(new Date(from.getTime() - LOOKBACK_MS))}::timestamptz
                and m.starts_at < ${toAt}::timestamptz and m.ends_at > ${fromAt}::timestamptz
                and m.status <> 'cancelled' and not m.all_day and ${shownAsEvent()}
              union
              select c.member_id::text as member_id, b.starts_at, b.ends_at
              from calendar_connections c
              join calendar_calendars k on k.workspace_id = c.workspace_id and k.connection_id = c.id and k.check_conflicts
              join calendar_busy_times b on b.workspace_id = k.workspace_id and b.connection_id = k.connection_id
                and b.calendar_id = k.provider_calendar_id
              where c.member_id = any(${uuidList(colleagues)})
                and b.ends_at > ${fromAt}::timestamptz and b.starts_at < ${toAt}::timestamptz
              order by starts_at, ends_at, member_id
              limit ${ROWS_MAX}
            `)
          ).rows;

    const clip = (start: number, end: number): Ms => ({
      start: Math.max(start, from.getTime()),
      end: Math.min(end, to.getTime()),
    });
    const columns: TeamDayColumn[] = [];
    const issueColumns: IssueColumn[] = [];
    for (const row of found) {
      const full = row.id === me || canActFor(reach, row.id, 'manage');
      const hours = hoursIn(row.availability, zoneOrUtc(row.zone));
      const open = openSpans(hours, from, to);
      const awayOf = awayRows.filter((away) => away.member_id === row.id);
      const awaySpan =
        awayOf.length === 0
          ? undefined
          : clip(
              Math.min(...awayOf.map((away) => Date.parse(away.starts_at))),
              Math.max(...awayOf.map((away) => Date.parse(away.ends_at))),
            );
      const firstAway = awayOf[0];
      const reason = TimeOffReason.safeParse(firstAway?.reason);
      // Their seats, and the bookings among them the reader may see (all of them, by the reach; checked again here).
      const mine = seats.filter((seat) => seat.member_id === row.id && byId.has(seat.booking_id));
      // A booking's own event synced back to a colleague's calendar shows once, as the booking.
      const seatKeys = new Set(mine.map((seat) => `${iso(seat.starts_at)}|${iso(seat.ends_at)}`));
      const busy = busyRows.filter(
        (busyRow) => busyRow.member_id === row.id && !seatKeys.has(`${iso(busyRow.starts_at)}|${iso(busyRow.ends_at)}`),
      );
      const items: TeamDayItem[] = [
        ...mine.map((seat): TeamDayItem => ({
          kind: 'booking',
          bookingId: seat.booking_id,
          startsAt: iso(seat.starts_at),
          endsAt: iso(seat.ends_at),
        })),
        ...(closed.get(row.id) ?? [])
          .filter((turn) => turn.kind !== 'away')
          .map((turn): TeamDayItem => ({
            kind: turn.kind === 'hold' ? 'hold' : 'block',
            key: turn.key,
            blockId: turn.blockId,
            repeat: turn.repeat,
            // A block's label only to the member and Manage over them (AC-772): others read Blocked or Held.
            ...(full && turn.label !== undefined ? { label: turn.label } : {}),
            startsAt: turn.startsAt,
            endsAt: turn.endsAt,
          })),
        ...(row.id === me
          ? [
              ...own.events.map((event): TeamDayItem => ({ kind: 'event', event })),
              ...own.busy.map((span): TeamDayItem => ({ kind: 'busy', startsAt: span.startsAt, endsAt: span.endsAt })),
            ]
          : busy.map((span): TeamDayItem => ({
              kind: 'busy',
              startsAt: iso(span.starts_at),
              endsAt: iso(span.ends_at),
            }))),
      ];
      columns.push({
        memberId: row.id,
        name: row.name,
        ...(row.job_title === null ? {} : { jobTitle: row.job_title }),
        timeZone: hours.timeZone,
        canManage: canActFor(reach, row.id, 'manage'),
        open: open.map(spanOf),
        ...(awaySpan === undefined || awaySpan.end <= awaySpan.start
          ? {}
          : {
              away: {
                // The reason and the note only to the member and Manage over them (AC-1286); See reads Away.
                ...(full && reason.success ? { reason: reason.data } : {}),
                ...(full && firstAway?.note !== null && firstAway?.note !== undefined ? { note: firstAway.note } : {}),
                span: spanOf(awaySpan),
              },
            }),
        booked: mine.length,
        items: items.toSorted((a, b) => startOf(a).localeCompare(startOf(b))),
      });
      issueColumns.push({
        memberId: row.id,
        open,
        ...(awaySpan === undefined ? {} : { away: awaySpan }),
        bookings: mine.map((seat) => ({
          id: seat.booking_id,
          start: Date.parse(byId.get(seat.booking_id)?.startsAt ?? iso(seat.starts_at)),
          end: Date.parse(byId.get(seat.booking_id)?.endsAt ?? iso(seat.ends_at)),
        })),
        calendar: [
          ...busy.map((span) => ({ start: Date.parse(iso(span.starts_at)), end: Date.parse(iso(span.ends_at)) })),
          ...(row.id === me
            ? [...own.events.filter((event) => !event.allDay), ...own.busy].map((span) => ({
                start: Date.parse(span.startsAt),
                end: Date.parse(span.endsAt),
              }))
            : []),
        ],
      });
    }
    // The lane: flagged, and Host away where the reader may see it (Bookings' masking decides), by start.
    const lane = bookings
      .filter((booking) => booking.status === 'confirmed' && (booking.needsHost || booking.hostAway === true))
      .map((booking) => booking.id);
    return {
      ...empty,
      columns,
      bookings: [...bookings],
      ...(managesSomeone ? { needsHost: lane } : {}),
      issues: [...teamDayIssues(issueColumns)],
      ...(total > found.length ? { truncated: { shown: found.length, total } } : {}),
    };
  });
}

/** Where an item starts, for ordering a column. */
function startOf(item: TeamDayItem): string {
  return item.kind === 'event' ? item.event.startsAt : item.startsAt;
}
