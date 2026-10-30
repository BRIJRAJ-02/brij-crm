// Time off (spec 0037, AC-1281 to AC-1288): a member's whole days away, as an `away` row on `booking_time_blocks`,
// the table every slot read already loads. The slot engine reads any kind but `hold` as busy, so time off closes
// every page that books the member, private ones included, and round robin's per member read skips them, with no
// new query. A member adds, changes and removes their own (with `booking.manage`); anyone with Manage over them
// does the same for them (and needs `booking.manage` of their own, AC-1275). Each change writes one audit row
// (the dates, the reason code and the stand in, never the note) and, when someone else made it, queues the member's
// scheduling notice (AC-1264). A stand in is emailed once when they are named or the dates change.
//
// The dates are calendar dates read in the zone of the member's default schedule at save (stored in `time_zone`):
// the span runs from the first day's midnight to the midnight after the last. Nothing booked inside moves: the save
// answers the meetings inside (AC-1285), and Bookings flags them Host away.
import { and, asc, desc, eq, gt, lte, sql } from 'drizzle-orm';
import { DateTime } from 'luxon';
import {
  isTimeZone,
  PERMISSIONS,
  TIME_OFF_LIMITS,
  type TimeOffBooking,
  type TimeOffEntry,
  type TimeOffList,
  type TimeOffReason,
  type TimeOffSaved,
} from '@crm/contracts';
import { schema, type WorkspaceTx } from '@crm/db';
import { can } from '../access/policy.ts';
import { requirePermission } from '../access/check.ts';
import type { EngineScope } from '../access/mint.ts';
import { inWorkspace } from '../access/run.ts';
import { actingFor, canActFor } from '../access/scheduling.ts';
import { defaultSchedule } from '../availability/resolve.ts';
import { hostLockKey, lockKey } from '../booking/locks.ts';
import { queueEmail } from '../emails/queue.ts';
import { isUuid, uuidArray } from '../engine/ids.ts';
import { isRefusal, refuse, refuseOn } from '../engine/refusals.ts';
import { actorRow } from '../engine/scope.ts';
import { writeAudit } from '../members/audit.ts';
import { queueSchedulingNotice } from './notice.ts';

const { bookingTimeBlocks } = schema;

const NOT_FOUND_MESSAGE = 'That time off could not be found.';
const LIMIT_MESSAGE = 'Someone can have at most 50 upcoming time off entries.';
const STALE_MESSAGE = 'This time off changed since you opened it. Close it and try again.';
/** The most meetings inside a saved entry the answer lists (the rest are counted). */
const INSIDE_MAX = 50;

/** What an entry is drawn with. */
export interface TimeOffDraft {
  readonly fromDate: string;
  readonly toDate: string;
  readonly reason: TimeOffReason;
  readonly note?: string | undefined;
  readonly standinMemberId?: string | undefined;
}

type AwayRow = Pick<
  typeof bookingTimeBlocks.$inferSelect,
  | 'id'
  | 'memberId'
  | 'startsAt'
  | 'endsAt'
  | 'timeZone'
  | 'reason'
  | 'note'
  | 'standinMemberId'
  | 'updatedAt'
  | 'updatedByMemberId'
>;

const awayColumns = {
  id: bookingTimeBlocks.id,
  memberId: bookingTimeBlocks.memberId,
  startsAt: bookingTimeBlocks.startsAt,
  endsAt: bookingTimeBlocks.endsAt,
  timeZone: bookingTimeBlocks.timeZone,
  reason: bookingTimeBlocks.reason,
  note: bookingTimeBlocks.note,
  standinMemberId: bookingTimeBlocks.standinMemberId,
  updatedAt: bookingTimeBlocks.updatedAt,
  updatedByMemberId: bookingTimeBlocks.updatedByMemberId,
};

const REASONS: readonly string[] = ['vacation', 'sick', 'travel', 'holiday', 'other'];

/** A stored row as a screen shows it; `full` is false for See, which reads "Away" and the dates alone (AC-1286). */
export function entryOf(row: AwayRow, full: boolean): TimeOffEntry {
  const zone = row.timeZone ?? 'UTC';
  const starts = row.startsAt ?? new Date(0);
  const ends = row.endsAt ?? new Date(0);
  const fromDate = DateTime.fromJSDate(starts, { zone }).toISODate() ?? '';
  // The span ends at the midnight after the last day.
  const toDate = DateTime.fromJSDate(ends, { zone }).minus({ days: 1 }).toISODate() ?? '';
  const changedBy =
    full && row.updatedByMemberId !== null && row.updatedByMemberId !== row.memberId
      ? { changedBy: { memberId: row.updatedByMemberId, at: row.updatedAt.toISOString() } }
      : {};
  return {
    id: row.id,
    memberId: row.memberId,
    fromDate,
    toDate,
    timeZone: zone,
    startsAt: starts.toISOString(),
    endsAt: ends.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    ...(full && row.reason !== null && REASONS.includes(row.reason) ? { reason: row.reason as TimeOffReason } : {}),
    ...(full && row.note !== null ? { note: row.note } : {}),
    ...(full && row.standinMemberId !== null ? { standinMemberId: row.standinMemberId } : {}),
    ...changedBy,
  };
}

/** The member the scope acts as: a key or the system has no time off of its own. */
function actorOf(scope: EngineScope): string {
  const { principal } = scope.access;
  if (principal.kind !== 'member') throw refuse('FORBIDDEN', PERMISSIONS['booking.manage'].message);
  return principal.memberId;
}

/** The zone the member's dates are read in: their default schedule's, else their profile's, else the workspace's. */
async function zoneOf(tx: WorkspaceTx, member: string): Promise<string> {
  const found = await tx.execute<{ zone: string | null }>(sql`
    select coalesce(m.time_zone, w.time_zone) as zone
    from members m join workspaces w on w.id = m.workspace_id
    where m.id = ${member}::uuid
  `);
  const fallback = found.rows[0]?.zone;
  const schedule = await defaultSchedule(
    tx,
    member,
    fallback !== null && fallback !== undefined && isTimeZone(fallback) ? fallback : 'UTC',
  );
  return schedule.availability.timeZone;
}

/** `[first day's midnight, the midnight after the last)` in `zone`. */
function spanOf(draft: TimeOffDraft, zone: string): { readonly start: DateTime; readonly end: DateTime } {
  const start = DateTime.fromISO(draft.fromDate, { zone }).startOf('day');
  const end = DateTime.fromISO(draft.toDate, { zone }).startOf('day').plus({ days: 1 });
  if (!start.isValid || !end.isValid) throw refuseOn('CONFIG_INVALID', 'Pick the days you’re away.', 'fromDate');
  if (end <= start) throw refuseOn('CONFIG_INVALID', 'The last day can’t be before the first.', 'toDate');
  if (end.diff(start, 'days').days > TIME_OFF_LIMITS.days + 1) {
    throw refuseOn('CONFIG_INVALID', 'Time off is at most 366 days. Add another entry for more.', 'toDate');
  }
  return { start, end };
}

/** A stand in is an active member who isn't a guest and isn't the member themself (AC-1281). */
async function checkStandin(tx: WorkspaceTx, member: string, standin: string | undefined): Promise<void> {
  if (standin === undefined) return;
  const message = 'Pick someone else to cover: an active member who isn’t a guest.';
  if (standin === member || !isUuid(standin)) throw refuseOn('CONFIG_INVALID', message, 'standinMemberId');
  const found = await tx.execute<{ id: string }>(sql`
    select id::text from members where id = ${standin}::uuid and status = 'active' and role::text <> 'guest'
  `);
  if (found.rows.length === 0) throw refuseOn('CONFIG_INVALID', message, 'standinMemberId');
}

/** The note as stored: trimmed, and none when empty. */
const noteOf = (note: string | undefined): string | null => {
  const trimmed = note?.trim() ?? '';
  return trimmed === '' ? null : trimmed.slice(0, TIME_OFF_LIMITS.note);
};

/** What an audit row keeps of an entry: whose, the dates, the reason code and the stand in; never the note. */
function auditFieldsOf(entry: TimeOffEntry): Readonly<Record<string, unknown>> {
  return {
    memberId: entry.memberId,
    timeOffId: entry.id,
    fromDate: entry.fromDate,
    toDate: entry.toDate,
    timeZone: entry.timeZone,
    ...(entry.reason === undefined ? {} : { reason: entry.reason }),
    ...(entry.standinMemberId === undefined ? {} : { standinMemberId: entry.standinMemberId }),
  };
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

/** Time off's days in words, read as calendar dates: "on 3 November", "from 3 to 7 November", across months and years. */
export function awayDates(fromDate: string, toDate: string): string {
  const [fy = 0, fm = 1, fd = 1] = fromDate.split('-').map(Number);
  const [ty = 0, tm = 1, td = 1] = toDate.split('-').map(Number);
  const month = (m: number) => MONTHS[m - 1] ?? '';
  if (fromDate === toDate) return `on ${String(fd)} ${month(fm)}`;
  if (fy !== ty) return `from ${String(fd)} ${month(fm)} ${String(fy)} to ${String(td)} ${month(tm)} ${String(ty)}`;
  if (fm !== tm) return `from ${String(fd)} ${month(fm)} to ${String(td)} ${month(tm)}`;
  return `from ${String(fd)} to ${String(td)} ${month(tm)}`;
}

/** Emails the stand in (AC-1282), once per entry, stand in and dates: a retry or an unchanged save sends nothing new. */
async function tellStandin(tx: WorkspaceTx, entry: TimeOffEntry, standin: string): Promise<void> {
  const found = await tx.execute<{ name: string; slug: string }>(sql`
    select m.name, w.slug from members m join workspaces w on w.id = m.workspace_id where m.id = ${entry.memberId}::uuid
  `);
  const row = found.rows[0];
  if (row === undefined) return;
  await queueEmail(tx, {
    kind: 'standin_covering',
    ids: [entry.id, standin, entry.fromDate.replaceAll('-', ''), entry.toDate.replaceAll('-', '')],
    to: { memberId: standin },
    params: {
      memberName: row.name.trim().split(/\s+/)[0] ?? row.name,
      dates: awayDates(entry.fromDate, entry.toDate),
      bookingsPath: `/w/${row.slug}/bookings`,
    },
  });
}

/** The confirmed meetings the member hosts inside `[start, end)` (AC-1285), soonest first. */
async function bookingsInside(
  tx: WorkspaceTx,
  member: string,
  start: Date,
  end: Date,
): Promise<{ readonly bookings: TimeOffBooking[]; readonly more: number }> {
  const found = await tx.execute<{
    id: string;
    visitor_name: string;
    title: string;
    starts_at: string;
    ends_at: string;
    total: string;
  }>(sql`
    select b.id::text, b.visitor_name, p.title, b.starts_at::text, b.ends_at::text, count(*) over () as total
    from bookings b join booking_pages p on p.workspace_id = b.workspace_id and p.id = b.page_id
    where b.host_member_id = ${member}::uuid and b.status = 'confirmed'
      and b.starts_at < ${end.toISOString()}::timestamptz and b.ends_at > ${start.toISOString()}::timestamptz
      -- A lower bound on the index's start too (a booking is at most a day), so the host's history isn't walked.
      and b.starts_at > ${start.toISOString()}::timestamptz - interval '1 day'
    order by b.starts_at, b.id
    limit ${INSIDE_MAX}
  `);
  const total = Number(found.rows[0]?.total ?? 0);
  return {
    bookings: found.rows.map((row) => ({
      id: row.id,
      visitorName: row.visitor_name,
      pageTitle: row.title,
      startsAt: new Date(row.starts_at).toISOString(),
      endsAt: new Date(row.ends_at).toISOString(),
    })),
    more: Math.max(0, total - found.rows.length),
  };
}

/** The member's away row with this id, or undefined. */
async function awayRow(tx: WorkspaceTx, id: string, member?: string): Promise<AwayRow | undefined> {
  if (!isUuid(id)) return undefined;
  const [row] = await tx
    .select(awayColumns)
    .from(bookingTimeBlocks)
    .where(
      and(
        eq(bookingTimeBlocks.id, id),
        eq(bookingTimeBlocks.kind, 'away'),
        ...(member === undefined ? [] : [eq(bookingTimeBlocks.memberId, member)]),
      ),
    );
  return row;
}

/**
 * The check before any change: the caller's own `booking.manage`, then themself, or Manage over the member (a member
 * outside their See reach answers as an entry that doesn't exist when `missing` is given).
 */
async function mayChange(tx: WorkspaceTx, scope: EngineScope, member: string, missing?: string): Promise<void> {
  if (member === actorOf(scope)) return;
  try {
    await actingFor(tx, scope, member, 'manage');
  } catch (error) {
    if (missing !== undefined && isRefusal(error) && error.refusal.code === 'NOT_FOUND')
      throw refuse('NOT_FOUND', missing);
    throw error;
  }
}

/** After a change someone else made, the member is told (AC-1264); the audit row is the notice's source. */
async function afterChange(tx: WorkspaceTx, scope: EngineScope, member: string): Promise<void> {
  const actor = actorOf(scope);
  if (actor !== member) await queueSchedulingNotice(tx, actor, member);
}

/**
 * A member's time off (AC-1286): their own, or a colleague's in the caller's See reach (outside it, NOT_FOUND).
 * Upcoming entries soonest first, then the last 20 past ones, latest first. Reason, note and stand in only for
 * the member and for Manage over them.
 */
export async function listTimeOff(
  scope: EngineScope,
  deps: { readonly now: () => Date },
  input: { readonly memberId?: string | undefined },
): Promise<TimeOffList> {
  const actor = actorOf(scope);
  const member = input.memberId ?? actor;
  return inWorkspace(scope, async (tx) => {
    let full = true;
    let canManage = can(scope.access, 'booking.manage');
    if (member !== actor) {
      const reach = await actingFor(tx, scope, member, 'view');
      full = canActFor(reach, member, 'manage');
      canManage = canManage && full;
    }
    const now = deps.now().toISOString();
    // `repeat = 'once'` too, so both reads reach `booking_time_blocks_once` (a partial index on it).
    const away = and(
      eq(bookingTimeBlocks.memberId, member),
      eq(bookingTimeBlocks.repeat, 'once'),
      eq(bookingTimeBlocks.kind, 'away'),
    );
    const upcoming = await tx
      .select(awayColumns)
      .from(bookingTimeBlocks)
      .where(and(away, gt(bookingTimeBlocks.endsAt, sql`${now}::timestamptz`)))
      .orderBy(asc(bookingTimeBlocks.startsAt), asc(bookingTimeBlocks.id))
      .limit(TIME_OFF_LIMITS.upcoming * 2);
    const past = await tx
      .select(awayColumns)
      .from(bookingTimeBlocks)
      .where(and(away, lte(bookingTimeBlocks.endsAt, sql`${now}::timestamptz`)))
      .orderBy(desc(bookingTimeBlocks.endsAt), asc(bookingTimeBlocks.id))
      .limit(TIME_OFF_LIMITS.past);
    return {
      memberId: member,
      upcoming: upcoming.map((row) => entryOf(row, full)),
      past: past.map((row) => entryOf(row, full)),
      canManage,
    };
  });
}

/**
 * Adds whole days away (AC-1281, AC-1282, AC-1288) for the caller, or for a colleague they Manage. A retry with
 * the same id answers the entry the first made. Past 50 upcoming entries: 409 TIME_OFF_LIMIT.
 */
export async function createTimeOff(
  scope: EngineScope,
  deps: { readonly now: () => Date },
  input: TimeOffDraft & { readonly id: string; readonly memberId?: string | undefined },
): Promise<TimeOffSaved> {
  requirePermission(scope, 'booking.manage');
  const actor = actorOf(scope);
  const member = input.memberId ?? actor;
  const by = actorRow(scope.actor);
  return inWorkspace(scope, async (tx) => {
    await mayChange(tx, scope, member);
    // A visitor's booking rechecks under this lock: the time off lands wholly before or after it.
    await lockKey(tx, hostLockKey(scope.workspaceId, member));
    const again = await awayRow(tx, input.id, member);
    if (again !== undefined) {
      const entry = entryOf(again, true);
      const inside = await bookingsInside(tx, member, new Date(entry.startsAt), new Date(entry.endsAt));
      return { entry, bookingsInside: inside.bookings, moreInside: inside.more };
    }
    // An id another block (or someone else's time off) holds is refused, never a failed insert.
    const taken = await tx.execute(sql`select 1 from booking_time_blocks where id = ${input.id}::uuid`);
    if (taken.rows.length > 0) throw refuseOn('CONFIG_INVALID', 'Close this and add the time off again.', 'id');
    await checkStandin(tx, member, input.standinMemberId);
    const zone = await zoneOf(tx, member);
    const { start, end } = spanOf(input, zone);
    const counted = await tx.execute<{ n: string }>(sql`
      select count(*)::text as n from booking_time_blocks
      where member_id = ${member}::uuid and kind = 'away' and repeat = 'once'
        and ends_at > ${deps.now().toISOString()}::timestamptz
    `);
    if (Number(counted.rows[0]?.n ?? 0) >= TIME_OFF_LIMITS.upcoming) throw refuse('TIME_OFF_LIMIT', LIMIT_MESSAGE);
    const [row] = await tx
      .insert(bookingTimeBlocks)
      .values({
        workspaceId: scope.workspaceId,
        id: input.id,
        memberId: member,
        kind: 'away',
        repeat: 'once',
        during: sql`tstzrange(${start.toUTC().toISO()}::timestamptz, ${end.toUTC().toISO()}::timestamptz, '[)')`,
        timeZone: zone,
        reason: input.reason,
        note: noteOf(input.note),
        standinMemberId: input.standinMemberId ?? null,
        createdByType: by.type,
        createdById: by.id,
        createdByMemberId: by.memberId,
        updatedByType: by.type,
        updatedById: by.id,
        updatedByMemberId: by.memberId,
      })
      .returning(awayColumns);
    if (row === undefined) throw new Error('booking_time_blocks insert returned no row');
    const entry = entryOf(row, true);
    await writeAudit(tx, scope.workspaceId, scope.actor, {
      action: 'time_off.created',
      targetType: 'member',
      targetId: member,
      after: auditFieldsOf(entry),
    });
    await afterChange(tx, scope, member);
    if (input.standinMemberId !== undefined) await tellStandin(tx, entry, input.standinMemberId);
    const inside = await bookingsInside(tx, member, start.toJSDate(), end.toJSDate());
    return { entry, bookingsInside: inside.bookings, moreInside: inside.more };
  });
}

/** Changes an entry's dates, reason, note and stand in (AC-1282), checked against `updatedAt` (409 STALE). */
export async function updateTimeOff(
  scope: EngineScope,
  input: TimeOffDraft & { readonly id: string; readonly updatedAt: string },
): Promise<TimeOffSaved> {
  requirePermission(scope, 'booking.manage');
  const by = actorRow(scope.actor);
  return inWorkspace(scope, async (tx) => {
    const found = await awayRow(tx, input.id);
    if (found === undefined) throw refuse('NOT_FOUND', NOT_FOUND_MESSAGE);
    const member = found.memberId;
    await mayChange(tx, scope, member, NOT_FOUND_MESSAGE);
    await lockKey(tx, hostLockKey(scope.workspaceId, member));
    // Read again under the lock: a change meanwhile is a stale editor.
    const current = await awayRow(tx, input.id, member);
    if (current === undefined) throw refuse('NOT_FOUND', NOT_FOUND_MESSAGE);
    if (current.updatedAt.getTime() !== Date.parse(input.updatedAt)) throw refuse('STALE', STALE_MESSAGE);
    await checkStandin(tx, member, input.standinMemberId);
    // The dates keep the zone they were chosen in.
    const zone = current.timeZone ?? (await zoneOf(tx, member));
    const { start, end } = spanOf(input, zone);
    const before = entryOf(current, true);
    const [row] = await tx
      .update(bookingTimeBlocks)
      .set({
        during: sql`tstzrange(${start.toUTC().toISO()}::timestamptz, ${end.toUTC().toISO()}::timestamptz, '[)')`,
        reason: input.reason,
        note: noteOf(input.note),
        standinMemberId: input.standinMemberId ?? null,
        // Always later than what the editor held, so a second save from the same editor is stale.
        updatedAt: sql`greatest(now(), ${bookingTimeBlocks.updatedAt} + interval '1 microsecond')`,
        updatedByType: by.type,
        updatedById: by.id,
        updatedByMemberId: by.memberId,
      })
      .where(and(eq(bookingTimeBlocks.id, input.id), eq(bookingTimeBlocks.memberId, member)))
      .returning(awayColumns);
    if (row === undefined) throw refuse('NOT_FOUND', NOT_FOUND_MESSAGE);
    const entry = entryOf(row, true);
    await writeAudit(tx, scope.workspaceId, scope.actor, {
      action: 'time_off.changed',
      targetType: 'member',
      targetId: member,
      before: auditFieldsOf(before),
      after: auditFieldsOf(entry),
    });
    await afterChange(tx, scope, member);
    const standin = input.standinMemberId;
    const datesMoved = before.fromDate !== entry.fromDate || before.toDate !== entry.toDate;
    if (standin !== undefined && (standin !== before.standinMemberId || datesMoved)) {
      await tellStandin(tx, entry, standin);
    }
    const inside = await bookingsInside(tx, member, start.toJSDate(), end.toJSDate());
    return { entry, bookingsInside: inside.bookings, moreInside: inside.more };
  });
}

/** Removes an entry (AC-1282): the time it closed opens again. Someone the caller can't see answers NOT_FOUND. */
export async function deleteTimeOff(
  scope: EngineScope,
  input: { readonly id: string },
): Promise<{ readonly id: string }> {
  requirePermission(scope, 'booking.manage');
  return inWorkspace(scope, async (tx) => {
    const found = await awayRow(tx, input.id);
    if (found === undefined) throw refuse('NOT_FOUND', NOT_FOUND_MESSAGE);
    const member = found.memberId;
    await mayChange(tx, scope, member, NOT_FOUND_MESSAGE);
    await lockKey(tx, hostLockKey(scope.workspaceId, member));
    const [row] = await tx
      .delete(bookingTimeBlocks)
      .where(
        and(
          eq(bookingTimeBlocks.id, input.id),
          eq(bookingTimeBlocks.memberId, member),
          eq(bookingTimeBlocks.kind, 'away'),
        ),
      )
      .returning(awayColumns);
    if (row === undefined) throw refuse('NOT_FOUND', NOT_FOUND_MESSAGE);
    await writeAudit(tx, scope.workspaceId, scope.actor, {
      action: 'time_off.deleted',
      targetType: 'member',
      targetId: member,
      before: auditFieldsOf(entryOf(row, true)),
    });
    await afterChange(tx, scope, member);
    return { id: input.id };
  });
}

/**
 * The members away at `at`, among `memberIds`, with their stand in when they named one who is still an active
 * non guest member (AC-1283, AC-1284): one query, read by rotations for owners, last hosts and leads.
 */
export async function awayAt(
  tx: WorkspaceTx,
  memberIds: readonly string[],
  at: Date,
): Promise<ReadonlyMap<string, string | undefined>> {
  const ids = [...new Set(memberIds)].filter(isUuid);
  if (ids.length === 0) return new Map();
  const found = await tx.execute<{ member_id: string; standin: string | null }>(sql`
    select a.member_id::text, s.id::text as standin
    from booking_time_blocks a
    left join members s on s.workspace_id = a.workspace_id and s.id = a.standin_member_id
      and s.status = 'active' and s.role::text <> 'guest'
    where a.kind = 'away' and a.repeat = 'once'
      and a.member_id = any(${uuidArray(ids)})
      and a.starts_at <= ${at.toISOString()}::timestamptz and a.ends_at > ${at.toISOString()}::timestamptz
    order by a.member_id, a.starts_at desc, a.id
  `);
  const away = new Map<string, string | undefined>();
  for (const row of found.rows) {
    // Overlapping entries: the latest begun names the stand in, unless it names none and another does.
    const had = away.get(row.member_id);
    if (!away.has(row.member_id) || had === undefined) away.set(row.member_id, row.standin ?? undefined);
  }
  return away;
}
