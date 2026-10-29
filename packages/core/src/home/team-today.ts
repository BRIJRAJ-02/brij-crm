// Team today (spec 0041): the day of every active member the reader may view
// (`canActFor` over the scheduling reach, `access/scheduling.ts`: a member
// sees only themself, an owner or admin with `booking.admin` everyone; the
// owner's ask of 29 October 2026, "don't show someone else's booking"), in
// four reads whatever the team's size (no read per member). Each member's
// bookings, hosted or co-hosted (by `booking_hosts_by_member`), the meetings
// their connected calendars hold (by `meetings_by_start`) and their busy
// times with nobody else invited (by `calendar_busy_times_by_end`). A title
// shows only where the reader may see it: everything of their own; a booking
// they may see (`booking/seen.ts`: its host, a co-host, its page's owner, or
// `booking.admin`); a meeting the reader's own calendar holds too, or one
// that isn't private and whose every holding calendar of that member shows
// Full details to teammates (sharing `shared`, the setting Teammates see:
// Full details, the owner's call of 22 October 2026). Anything else is Busy,
// by its time alone: never its title, place, link or attendees. It needs
// `booking.manage` (scheduling: Bookings' own gate), only a member reads it (a
// key reads an empty team), the day must be today's (within 36 hours of now),
// and it writes nothing.
import { sql } from 'drizzle-orm';
import {
  TEAM_TODAY_ITEMS_MAX,
  TEAM_TODAY_MEMBERS_MAX,
  type TeamTodayItem,
  type TeamTodayMember,
  type TeamTodayView,
} from '@crm/contracts';
import type { EngineScope } from '../access/mint.ts';
import { requirePermission } from '../access/check.ts';
import { inWorkspace } from '../access/run.ts';
import { canActFor, schedulingReach } from '../access/scheduling.ts';
import { shownAsEvent } from '../booking/owned.ts';
import { bookingAlias, bookingReaderWith, seesBookingSql } from '../booking/seen.ts';
import { inputInvalid } from '../engine/refusals.ts';

/** How far before the day a meeting may start and still reach into it (all day and multi day events). */
const LOOKBACK_MS = 48 * 3_600_000;

/** How far from now the day may start: today's midnight in any time zone. */
const TODAY_MS = 36 * 3_600_000;

/** How far before the day a booking may start and still reach into it (a booking is at most a day). */
const BOOKING_LOOKBACK_MS = 24 * 3_600_000;

/** The most rows each read answers: members times items, so a busy team is cut, never slow. */
const ROWS_MAX = TEAM_TODAY_MEMBERS_MAX * TEAM_TODAY_ITEMS_MAX;

const iso = (value: Date | string) => new Date(value).toISOString();

interface BookingRow extends Record<string, unknown> {
  readonly id: string;
  readonly member_id: string;
  readonly starts_at: Date | string;
  readonly ends_at: Date | string;
  readonly title: string;
  readonly seen: boolean;
}

interface MeetingRow extends Record<string, unknown> {
  readonly id: string;
  readonly member_id: string;
  readonly starts_at: Date | string;
  readonly ends_at: Date | string;
  readonly all_day: boolean;
  readonly title: string;
  readonly open: boolean;
}

interface BusyRow extends Record<string, unknown> {
  readonly member_id: string;
  readonly starts_at: Date | string;
  readonly ends_at: Date | string;
}

/**
 * The day in [from, to) of every active member the reader may view, the reader first, each by start; nothing for
 * anyone but a member.
 */
export async function readTeamToday(
  scope: EngineScope,
  input: { readonly from: string; readonly to: string },
  deps: { readonly now?: Date } = {},
): Promise<TeamTodayView> {
  requirePermission(scope, 'booking.manage');
  const { principal } = scope.access;
  if (principal.kind !== 'member') return { members: [] };
  const reader = principal.memberId;
  const from = new Date(input.from);
  const to = new Date(input.to);
  const now = deps.now ?? new Date();
  if (Number.isNaN(from.getTime()) || Math.abs(from.getTime() - now.getTime()) > TODAY_MS) {
    throw inputInvalid('from', 'Ask for today.');
  }
  return inWorkspace(scope, async (tx) => {
    const reach = await schedulingReach(tx, scope);
    // A booking's title shows to whoever may see it (`seen.ts`): theirs, their page's, or a host in their See reach.
    const seer = bookingReaderWith(scope.access, reach);
    // Only those the reach shows (spec 0037's one check): without a reach over everyone, the reader and the members
    // reached one by one, named in the read so the cut never fills with members left out.
    const named = reach.all === undefined ? [reader, ...reach.members.keys()] : undefined;
    const within =
      named === undefined
        ? sql`true`
        : sql`id = any(array[${sql.join(
            named.map((id) => sql`${id}`),
            sql`, `,
          )}]::uuid[])`;
    const roster = (
      await tx.execute<{ id: string }>(sql`
        select id::text as id from members
        where status = 'active' and ${within}
        order by (id = ${reader}::uuid) desc, lower(name), id
        limit ${TEAM_TODAY_MEMBERS_MAX}
      `)
    ).rows
      .map((row) => row.id)
      .filter((id) => canActFor(reach, id, 'view'));
    if (roster.length === 0) return { members: [] };
    const ids = sql`array[${sql.join(
      roster.map((id) => sql`${id}`),
      sql`, `,
    )}]::uuid[]`;
    // Every booking each member hosts or co-hosts (`booking_hosts`, the host's row and a collective page's other
    // members'), so a co-host's day holds it too and its event synced back to their calendar shows once.
    const bookingRows = (
      await tx.execute<BookingRow>(sql`
        select b.id::text as id, h.member_id::text as member_id, b.starts_at, b.ends_at, p.title,
          ${seesBookingSql(seer, bookingAlias('b'))} as seen
        from booking_hosts h
        join bookings b on b.workspace_id = h.workspace_id and b.id = h.booking_id
        join booking_pages p on p.workspace_id = b.workspace_id and p.id = b.page_id
        where h.status = 'confirmed' and h.member_id = any(${ids})
          -- Widened by the page's buffers, so a day further back than the booking's own bound.
          and h.starts_at >= ${iso(new Date(from.getTime() - LOOKBACK_MS))}::timestamptz
          and h.starts_at < ${to.toISOString()}::timestamptz
          and b.starts_at >= ${iso(new Date(from.getTime() - BOOKING_LOOKBACK_MS))}::timestamptz
          and b.starts_at < ${to.toISOString()}::timestamptz and b.ends_at > ${from.toISOString()}::timestamptz
        order by b.starts_at, b.id, h.member_id
        limit ${ROWS_MAX}
      `)
    ).rows;
    // One row per member and meeting, however many of their calendars hold it: open only when every one shows
    // Full details and none marks it private, or when one of the reader's own calendars holds it too.
    const meetingRows = (
      await tx.execute<MeetingRow>(sql`
        select m.id::text as id, c.member_id::text as member_id, m.starts_at, m.ends_at, m.all_day, m.title,
          (
            bool_and(c.sharing = 'shared' and not s.marked_private and not m.is_private)
            or exists (
              select 1 from meeting_sources rs
              join calendar_connections rc on rc.workspace_id = rs.workspace_id and rc.id = rs.connection_id
              where rs.workspace_id = m.workspace_id and rs.meeting_id = m.id and rc.member_id = ${reader}::uuid
            )
          ) as open
        from meetings m
        join meeting_sources s on s.workspace_id = m.workspace_id and s.meeting_id = m.id
        join calendar_connections c on c.workspace_id = s.workspace_id and c.id = s.connection_id
        where m.starts_at >= ${iso(new Date(from.getTime() - LOOKBACK_MS))}::timestamptz
          and m.starts_at < ${to.toISOString()}::timestamptz and m.ends_at > ${from.toISOString()}::timestamptz
          and m.status <> 'cancelled' and ${shownAsEvent()}
          and c.member_id = any(${ids})
        group by m.workspace_id, m.id, c.member_id
        order by m.starts_at, m.id
        limit ${ROWS_MAX}
      `)
    ).rows;
    const busyRows = (
      await tx.execute<BusyRow>(sql`
        select distinct c.member_id::text as member_id, b.starts_at, b.ends_at
        from calendar_connections c
        join calendar_busy_times b on b.workspace_id = c.workspace_id and b.connection_id = c.id
        where c.member_id = any(${ids})
          and b.ends_at > ${from.toISOString()}::timestamptz
          and b.ends_at < ${iso(new Date(to.getTime() + LOOKBACK_MS))}::timestamptz
          and b.starts_at < ${to.toISOString()}::timestamptz
        order by b.starts_at, b.ends_at, member_id
        limit ${ROWS_MAX}
      `)
    ).rows;
    return { members: teamDays(roster, reader, bookingRows, meetingRows, busyRows) };
  });
}

/** The rows sorted into each member's day: a booking's own event synced back shows once, as the booking. */
function teamDays(
  roster: readonly string[],
  reader: string,
  bookingRows: readonly BookingRow[],
  meetingRows: readonly MeetingRow[],
  busyRows: readonly BusyRow[],
): TeamTodayMember[] {
  const days = new Map<string, TeamTodayItem[]>(roster.map((id) => [id, []]));
  const booked = new Set<string>();
  for (const row of bookingRows) {
    const startsAt = iso(row.starts_at);
    const endsAt = iso(row.ends_at);
    booked.add(`${row.member_id}:${startsAt}:${endsAt}`);
    days.get(row.member_id)?.push({
      id: row.id,
      kind: 'booking',
      ...(row.seen || row.member_id === reader ? { title: row.title } : {}),
      startsAt,
      endsAt,
      allDay: false,
    });
  }
  for (const row of meetingRows) {
    const startsAt = iso(row.starts_at);
    const endsAt = iso(row.ends_at);
    if (booked.has(`${row.member_id}:${startsAt}:${endsAt}`)) continue;
    days.get(row.member_id)?.push({
      id: row.id,
      kind: 'meeting',
      ...(row.open || row.member_id === reader ? { title: row.title } : {}),
      startsAt,
      endsAt,
      allDay: row.all_day,
    });
  }
  for (const row of busyRows) {
    const startsAt = iso(row.starts_at);
    const endsAt = iso(row.ends_at);
    days.get(row.member_id)?.push({ id: `busy:${startsAt}:${endsAt}`, kind: 'busy', startsAt, endsAt, allDay: false });
  }
  return roster.map((memberId) => ({
    memberId,
    items: (days.get(memberId) ?? [])
      .toSorted((a, b) => a.startsAt.localeCompare(b.startsAt) || a.id.localeCompare(b.id))
      .slice(0, TEAM_TODAY_ITEMS_MAX),
  }));
}
