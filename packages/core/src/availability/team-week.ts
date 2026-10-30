// The Team week (spec 0037, job J6, AC-1289 to AC-1296): the roster, read and written on spec 0035's own data. A
// cell is one date of a member's default schedule: its override when it has one ("this week only"), else its weekly
// hours; Away when time off covers it. Every write goes through the schedules' one write path (`writeSchedules`): the
// member's schedules lock, the stale check, `keptHours` (old overrides dropped, the 400 cap), one `schedule.changed`
// audit row per member and, when someone else made it, the member's notice. The roster has no table of its own.
//
// The read is one request for up to 50 members (AC-1296): the reach (none for owners and admins), one query for the
// members with their default schedules and their pages on other schedules, and one for their time off; none per
// member.
import { sql } from 'drizzle-orm';
import { DateTime } from 'luxon';
import {
  BookingAvailability,
  defaultAvailability,
  isTimeZone,
  minutesOf,
  PERMISSIONS,
  TEAM_WEEK,
  TimeOffReason,
  WEEKDAYS,
  type BulkHoursResult,
  type DayHours,
  type SetDayResult,
  type TeamWeek,
  type TeamWeekDay,
  type TeamWeekRow,
  type WeeklyHours,
  type BookingAvailability as Hours,
} from '@crm/contracts';
import type { WorkspaceTx } from '@crm/db';
import { requirePermission } from '../access/check.ts';
import { checkScope, type EngineScope } from '../access/mint.ts';
import { can } from '../access/policy.ts';
import { inWorkspace } from '../access/run.ts';
import { actingFor, canActFor, schedulingReach } from '../access/scheduling.ts';
import { isUuid, uuidList } from '../engine/ids.ts';
import { refuse, refuseOn } from '../engine/refusals.ts';
import type { AfterWrite } from '../engine/write.ts';
import { hoursOf } from './resolve.ts';
import {
  mayEditOwnHours,
  ownHoursRefusal,
  schedulesLock,
  storedDefault,
  saveScheduleHours,
  storeVirtualDefault,
  writeSchedules,
  type ScheduleChange,
  type ScheduleRow,
} from './schedules.ts';

const OUT_OF_REACH = 'That week is out of reach: the roster goes back 8 weeks and forward a year.';
const READ_ONLY_WEEK = 'Weeks before this one are read only.';
const STALE_MESSAGE = 'These hours changed since you opened them. Close this and try again.';

/** The member a scope acts as, or undefined (a key, the system). */
const memberOf = (scope: EngineScope): string | undefined =>
  scope.access.principal.kind === 'member' ? scope.access.principal.memberId : undefined;

/** The Monday of the week holding `date` (`YYYY-MM-DD`), read as a calendar date. */
export function mondayOf(date: string): string {
  const day = DateTime.fromISO(date, { zone: 'UTC' });
  return day.minus({ days: day.weekday - 1 }).toISODate() ?? date;
}

/** `weeks` weeks after the Monday `monday` (before, when negative). */
const plusWeeks = (monday: string, weeks: number): string =>
  DateTime.fromISO(monday, { zone: 'UTC' }).plus({ weeks }).toISODate() ?? monday;

/** The seven dates of the week starting `monday`. */
export function weekDates(monday: string): readonly string[] {
  const start = DateTime.fromISO(monday, { zone: 'UTC' });
  return WEEKDAYS.map((_, index) => start.plus({ days: index }).toISODate() ?? monday);
}

/** Today's Monday in `zone` at `now`. */
const thisMondayIn = (now: Date, zone: string): string =>
  mondayOf(DateTime.fromJSDate(now, { zone }).toISODate() ?? now.toISOString().slice(0, 10));

/**
 * A day's minutes once its ranges are merged (pure, AC-1290: merged, not summed): ranges that overlap or touch count
 * once, so legacy hours stored before the overlap check never double a person's day.
 */
export function mergedMinutes(ranges: readonly (readonly [string, string])[]): number {
  const spans = ranges
    .map(([start, end]) => [minutesOf(start), minutesOf(end)] as const)
    .filter(([start, end]) => end > start)
    .sort((a, b) => a[0] - b[0]);
  let total = 0;
  let open: number | undefined;
  let close = 0;
  for (const [start, end] of spans) {
    if (open === undefined || start > close) {
      if (open !== undefined) total += close - open;
      open = start;
      close = end;
    } else close = Math.max(close, end);
  }
  if (open !== undefined) total += close - open;
  return total;
}

/** One away block as the read takes it. */
interface AwayBlock {
  readonly memberId: string;
  readonly startsAt: number;
  readonly endsAt: number;
  readonly reason: string | null;
  readonly note: string | null;
}

/** Whether a block covers the local midday of `date` in `zone`: time off is whole days, read in the zone they were. */
const covers = (block: AwayBlock, date: string, zone: string): boolean => {
  const noon = DateTime.fromISO(date, { zone }).set({ hour: 12 }).toMillis();
  return block.startsAt <= noon && noon < block.endsAt;
};

/**
 * The cells of one week for one member (pure): each date's override, else the weekly hours for its weekday; Away
 * from the blocks covering it, with the reason and note only when `full` (the member, or Manage over them).
 */
export function daysOf(
  hours: Hours,
  dates: readonly string[],
  blocks: readonly AwayBlock[],
  full: boolean,
): readonly TeamWeekDay[] {
  const overrides = new Map(hours.overrides.map((override) => [override.date, override.ranges]));
  return dates.map((date, index) => {
    const own = overrides.get(date);
    const day = WEEKDAYS[index] ?? 'mon';
    const block = blocks.find((each) => covers(each, date, hours.timeZone));
    const reason = TimeOffReason.safeParse(block?.reason);
    const away =
      block === undefined
        ? undefined
        : full
          ? {
              ...(reason.success ? { reason: reason.data } : {}),
              ...(block.note === null ? {} : { note: block.note }),
            }
          : {};
    return {
      date,
      ranges: (own ?? hours.weekly[day]).map(([start, end]) => [start, end] as [string, string]),
      source: own === undefined ? ('usual' as const) : ('override' as const),
      ...(away === undefined ? {} : { away }),
    };
  });
}

/** A day's working minutes: none while Away. */
const workingMinutes = (day: TeamWeekDay): number => (day.away === undefined ? mergedMinutes(day.ranges) : 0);

/** The footer over a page of rows (pure, AC-1294): per day, the people working and their merged minutes added. */
export function footerOf(dates: readonly string[], rows: readonly Pick<TeamWeekRow, 'days'>[]): TeamWeek['footer'] {
  return dates.map((date, index) => {
    let working = 0;
    let minutes = 0;
    for (const row of rows) {
      const day = row.days[index];
      const worked = day === undefined ? 0 : workingMinutes(day);
      if (worked > 0) {
        working += 1;
        minutes += worked;
      }
    }
    return { date, working, minutes };
  });
}

/** The zone's offset from UTC, in minutes, at midday on `date` (AC-1290: on that week's Monday). */
const offsetOn = (date: string, zone: string): number => DateTime.fromISO(date, { zone }).set({ hour: 12 }).offset;

/** A page's cursor: the last row's lower cased name and id. */
function encodeCursor(name: string, id: string): string {
  return Buffer.from(JSON.stringify([name.toLowerCase(), id])).toString('base64url');
}

/** A cursor back to its name and id; anything else is refused. */
function decodeCursor(cursor: string): { readonly name: string; readonly id: string } {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (Array.isArray(parsed) && typeof parsed[0] === 'string' && typeof parsed[1] === 'string' && isUuid(parsed[1])) {
      return { name: parsed[0], id: parsed[1] };
    }
  } catch {
    // Falls through to the refusal.
  }
  throw refuseOn('CONFIG_INVALID', 'Load the roster again from the start.', 'cursor');
}

/** `%` and `_` taken literally in an `ilike`. */
const likeText = (text: string): string => `%${text.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;

/** A stored schedule's hours, or the virtual default's in `zone` (damaged hours too, as the slot engine reads them). */
const hoursIn = (stored: unknown, zone: string): Hours => {
  if (stored === null || stored === undefined) return defaultAvailability(zone);
  const parsed = BookingAvailability.safeParse(stored);
  return parsed.success ? parsed.data : defaultAvailability(zone);
};

/** A member's fallback zone: theirs, else the workspace's, else UTC. */
const zoneOrUtc = (zone: string | null | undefined): string =>
  zone !== null && zone !== undefined && isTimeZone(zone) ? zone : 'UTC';

/**
 * A week of the roster (AC-1289 to AC-1296): the active non guest members in the reader's See reach, the reader first
 * and then by name, 50 a page, searched by name; each with that week's cells, their zone's offset, merged hours,
 * pages on other schedules and whether the reader may change them; and the footer over the page. Any member may read
 * it: someone who reaches nobody else sees themself. Weeks more than 8 back or 52 ahead are refused.
 */
export async function readTeamWeek(
  scope: EngineScope,
  deps: { readonly now: () => Date },
  input: { readonly weekStart: string; readonly search?: string | undefined; readonly cursor?: string | undefined },
): Promise<TeamWeek> {
  checkScope(scope);
  const now = deps.now();
  const thisWeek = thisMondayIn(now, 'UTC');
  const earliest = plusWeeks(thisWeek, -TEAM_WEEK.backWeeks);
  const latest = plusWeeks(thisWeek, TEAM_WEEK.forwardWeeks);
  const weekStart = mondayOf(input.weekStart);
  if (weekStart !== input.weekStart) throw refuseOn('CONFIG_INVALID', 'Pick a week by its Monday.', 'weekStart');
  if (weekStart < earliest || weekStart > latest) throw refuseOn('CONFIG_INVALID', OUT_OF_REACH, 'weekStart');
  const dates = weekDates(weekStart);
  const me = memberOf(scope);
  const empty: TeamWeek = { weekStart, thisWeek, earliest, latest, rows: [], footer: footerOf(dates, []) };
  if (me === undefined) return empty;
  const after = input.cursor === undefined ? undefined : decodeCursor(input.cursor);
  const search = input.search?.trim() ?? '';
  return inWorkspace(scope, async (tx) => {
    const reach = await schedulingReach(tx, scope);
    const named = reach.all === undefined ? [me, ...reach.members.keys()].filter(isUuid) : undefined;
    const within = named === undefined ? sql`true` : sql`m.id = any(${uuidList(named)})`;
    const matching = search === '' ? sql`true` : sql`m.name ilike ${likeText(search)}`;
    // The reader first on the first page; later pages carry on by name after the cursor, the reader left out.
    const paged =
      after === undefined
        ? sql`true`
        : sql`m.id <> ${me}::uuid and (lower(m.name), m.id) > (${after.name}, ${after.id}::uuid)`;
    const order = after === undefined ? sql`(m.id = ${me}::uuid) desc, lower(m.name), m.id` : sql`lower(m.name), m.id`;
    // One query: the members, their default schedules and how many of their live pages book by another schedule.
    const found = await tx.execute<{
      id: string;
      name: string;
      zone: string | null;
      schedule_id: string | null;
      availability: unknown;
      updated_at: string | null;
      other: string;
    }>(sql`
      select m.id::text, m.name, coalesce(m.time_zone, w.time_zone) as zone, s.id::text as schedule_id,
        s.availability, s.updated_at::text as updated_at,
        (select count(*) from booking_pages p
          where p.workspace_id = m.workspace_id and p.owner_member_id = m.id and p.deleted_at is null
            and p.schedule_id is not null and p.schedule_id is distinct from s.id)::text as other
      from members m
      join workspaces w on w.id = m.workspace_id
      left join availability_schedules s on s.workspace_id = m.workspace_id and s.member_id = m.id and s.is_default
      where m.workspace_id = ${scope.workspaceId}::uuid and m.status = 'active' and m.role::text <> 'guest'
        and ${within} and ${matching} and ${paged}
      order by ${order}
      limit ${TEAM_WEEK.rowsPerPage + 1}
    `);
    const visible = found.rows.filter((row) => canActFor(reach, row.id, 'view'));
    const page = visible.slice(0, TEAM_WEEK.rowsPerPage);
    const ids = page.map((row) => row.id);
    // One query: their time off touching the week, a day either side for the zones.
    const from = DateTime.fromISO(weekStart, { zone: 'UTC' }).minus({ days: 1 }).toISO() ?? '';
    const to = DateTime.fromISO(weekStart, { zone: 'UTC' }).plus({ days: 8 }).toISO() ?? '';
    const away =
      ids.length === 0
        ? { rows: [] }
        : await tx.execute<{
            member_id: string;
            starts_at: string;
            ends_at: string;
            reason: string | null;
            note: string | null;
          }>(sql`
            select member_id::text, starts_at::text, ends_at::text, reason, note from booking_time_blocks
            where kind = 'away' and repeat = 'once' and member_id = any(${uuidList(ids)})
              and starts_at < ${to}::timestamptz and ends_at > ${from}::timestamptz
          `);
    const blocks: AwayBlock[] = away.rows.map((row) => ({
      memberId: row.member_id,
      startsAt: Date.parse(row.starts_at),
      endsAt: Date.parse(row.ends_at),
      reason: row.reason,
      note: row.note,
    }));
    const changesOwn = mayEditOwnHours(scope);
    const changesOthers = can(scope.access, 'booking.manage');
    const rows: TeamWeekRow[] = page.map((row) => {
      const hours = hoursIn(row.availability, zoneOrUtc(row.zone));
      const full = row.id === me || canActFor(reach, row.id, 'manage');
      const days = daysOf(
        hours,
        dates,
        blocks.filter((block) => block.memberId === row.id),
        full,
      );
      return {
        memberId: row.id,
        name: row.name,
        timeZone: hours.timeZone,
        offsetMinutes: offsetOn(weekStart, hours.timeZone),
        days: [...days],
        weekMinutes: days.reduce((sum, day) => sum + workingMinutes(day), 0),
        otherSchedules: Number(row.other),
        canChange: row.id === me ? changesOwn : changesOthers && canActFor(reach, row.id, 'manage', 'hours'),
        schedule: {
          id: row.schedule_id,
          updatedAt: row.updated_at === null ? null : new Date(row.updated_at).toISOString(),
        },
      };
    });
    const last = page.at(-1);
    return {
      ...empty,
      rows,
      footer: footerOf(dates, rows),
      ...(visible.length > TEAM_WEEK.rowsPerPage && last !== undefined
        ? { nextCursor: encodeCursor(last.name, last.id) }
        : {}),
    };
  });
}

/**
 * The check before a Team week write to `memberId`'s hours (AC-1291): their own with `availability.own`, or Manage over
 * their hours (`actingFor`: outside See NOT_FOUND, Seen only FORBIDDEN). Answers the member's fallback zone.
 */
async function mayWrite(tx: WorkspaceTx, scope: EngineScope, memberId: string): Promise<string> {
  if (memberId === memberOf(scope)) {
    if (!mayEditOwnHours(scope)) throw ownHoursRefusal(scope);
  } else {
    await actingFor(tx, scope, memberId, 'manage', 'hours');
  }
  const found = await tx.execute<{ zone: string | null }>(sql`
    select coalesce(m.time_zone, w.time_zone) as zone
    from members m join workspaces w on w.id = m.workspace_id where m.id = ${memberId}::uuid
  `);
  return zoneOrUtc(found.rows[0]?.zone);
}

/**
 * The member's default schedule, under their schedules lock, ready for a write: the stored one, or, the first time, the
 * virtual default stored in their zone (AC-1291, spec 0035 AC-963), noted as made.
 */
async function defaultToWrite(
  tx: WorkspaceTx,
  scope: EngineScope,
  memberId: string,
  zone: string,
): Promise<{ readonly row: ScheduleRow; readonly made: boolean }> {
  await schedulesLock(tx, scope.workspaceId, memberId);
  const stored = await storedDefault(tx, memberId);
  if (stored !== undefined) return { row: stored, made: false };
  return { row: await storeVirtualDefault(tx, scope, memberId, zone), made: true };
}

/** The overrides with `date` set to `ranges` (or removed when undefined), kept in date order, its note kept. */
function withDate(hours: Hours, date: string, ranges: readonly (readonly [string, string])[] | undefined): Hours {
  const had = hours.overrides.find((override) => override.date === date);
  const rest = hours.overrides.filter((override) => override.date !== date);
  const overrides =
    ranges === undefined
      ? rest
      : [
          ...rest,
          {
            date,
            ranges: ranges.map(([start, end]) => [start, end] as [string, string]),
            ...(had?.note === undefined ? {} : { note: had.note }),
          },
        ].sort((a, b) => a.date.localeCompare(b.date));
  return { ...hours, overrides };
}

/** Refuses a date before this week's Monday in the member's zone, or past the stepper's reach (AC-1293). */
function checkWritable(now: Date, zone: string, dates: readonly string[]): void {
  const thisWeek = thisMondayIn(now, zone);
  const last = DateTime.fromISO(plusWeeks(thisWeek, TEAM_WEEK.forwardWeeks), { zone: 'UTC' })
    .plus({ days: 6 })
    .toISODate();
  for (const date of dates) {
    if (date < thisWeek) throw refuseOn('CONFIG_INVALID', READ_ONLY_WEEK, 'date');
    if (last !== null && date > last) throw refuseOn('CONFIG_INVALID', OUT_OF_REACH, 'date');
  }
}

/** The member's away blocks over `dates`, for the answer's day. */
async function awayOver(tx: WorkspaceTx, memberId: string, dates: readonly string[]): Promise<AwayBlock[]> {
  const first = dates[0] ?? '';
  const last = dates.at(-1) ?? first;
  const from = DateTime.fromISO(first, { zone: 'UTC' }).minus({ days: 1 }).toISO() ?? '';
  const to = DateTime.fromISO(last, { zone: 'UTC' }).plus({ days: 2 }).toISO() ?? '';
  const found = await tx.execute<{
    starts_at: string;
    ends_at: string;
    reason: string | null;
    note: string | null;
  }>(sql`
    select starts_at::text, ends_at::text, reason, note from booking_time_blocks
    where kind = 'away' and repeat = 'once' and member_id = ${memberId}::uuid
      and starts_at < ${to}::timestamptz and ends_at > ${from}::timestamptz
  `);
  return found.rows.map((row) => ({
    memberId,
    startsAt: Date.parse(row.starts_at),
    endsAt: Date.parse(row.ends_at),
    reason: row.reason,
    note: row.note,
  }));
}

/**
 * One cell's change (AC-1291): that date's own ranges ("this week only"), Off, or back to usual hours (its override
 * removed), on the member's default schedule, checked against the `updatedAt` the reader saw (409 STALE). The first
 * write for a member who never saved hours stores their default first. Weeks before this one are read only.
 */
export async function setDayHours(
  scope: EngineScope,
  deps: { readonly now: () => Date },
  input: {
    readonly memberId: string;
    readonly date: string;
    readonly hours: DayHours;
    readonly updatedAt: string | null;
  },
  hooks: readonly AfterWrite[] = [],
): Promise<SetDayResult> {
  requirePermission(scope, 'booking.manage');
  if (memberOf(scope) === undefined) throw refuse('FORBIDDEN', PERMISSIONS['booking.manage'].message);
  return writeSchedules(scope, hooks, async ({ tx }) => {
    const zone = await mayWrite(tx, scope, input.memberId);
    const target = await defaultToWrite(tx, scope, input.memberId, zone);
    const seen = input.updatedAt === null ? undefined : Date.parse(input.updatedAt);
    if (target.made ? seen !== undefined : seen !== target.row.updatedAt.getTime())
      throw refuse('STALE', STALE_MESSAGE);
    const hours = hoursOf(target.row.availability, zone);
    checkWritable(deps.now(), hours.timeZone, [input.date]);
    const next = withDate(
      hours,
      input.date,
      input.hours === 'usual' ? undefined : input.hours === 'off' ? [] : input.hours,
    );
    const saved = await saveScheduleHours(tx, scope, target, next);
    const row = saved?.row ?? target.row;
    const now = hoursOf(row.availability, zone);
    const monday = mondayOf(input.date);
    const dates = weekDates(monday);
    const index = dates.indexOf(input.date);
    const day = daysOf(now, dates, await awayOver(tx, input.memberId, [input.date]), true)[index];
    if (day === undefined) throw new Error('The day fell outside its week.');
    return {
      result: { day, schedule: { id: row.id, updatedAt: row.updatedAt.toISOString() } },
      ...(saved === undefined ? {} : { change: saved.change }),
    };
  });
}

/** Each member once, in id order, so two bulk writes take the members' locks in the same order. */
const inLockOrder = (ids: readonly string[]): readonly string[] => [...new Set(ids)].sort();

/**
 * "Copy this week to next week" (AC-1292), for one member or several: each day of `fromWeekStart` onto the same weekday
 * of `toWeekStart`: a day with an override copies it, a day on usual hours removes the other date's override. One
 * transaction, one audited write per member it changed; any member the reader may not change refuses the whole.
 */
export async function copyWeek(
  scope: EngineScope,
  deps: { readonly now: () => Date },
  input: { readonly memberIds: readonly string[]; readonly fromWeekStart: string; readonly toWeekStart: string },
  hooks: readonly AfterWrite[] = [],
): Promise<BulkHoursResult> {
  requirePermission(scope, 'booking.manage');
  if (memberOf(scope) === undefined) throw refuse('FORBIDDEN', PERMISSIONS['booking.manage'].message);
  if (mondayOf(input.fromWeekStart) !== input.fromWeekStart || mondayOf(input.toWeekStart) !== input.toWeekStart) {
    throw refuseOn('CONFIG_INVALID', 'Pick a week by its Monday.', 'toWeekStart');
  }
  const from = weekDates(input.fromWeekStart);
  const to = weekDates(input.toWeekStart);
  return writeSchedules(scope, hooks, async ({ tx }) => {
    const changes: ScheduleChange[] = [];
    for (const memberId of inLockOrder(input.memberIds)) {
      const zone = await mayWrite(tx, scope, memberId);
      const target = await defaultToWrite(tx, scope, memberId, zone);
      const hours = hoursOf(target.row.availability, zone);
      checkWritable(deps.now(), hours.timeZone, to);
      const own = new Map(hours.overrides.map((override) => [override.date, override.ranges]));
      const next = to.reduce((acc, date, index) => withDate(acc, date, own.get(from[index] ?? '')), hours);
      const saved = await saveScheduleHours(tx, scope, target, next);
      if (saved !== undefined) changes.push(saved.change);
    }
    return { result: { changed: changes.length }, change: changes };
  });
}

/**
 * "Set usual hours" and "Set usual hours for…" (AC-1292): one week of hours as each member's default schedule's weekly
 * hours, their own zone and date overrides kept. One transaction, one audited write per member it changed; any member
 * the reader may not change refuses the whole.
 */
export async function setUsualHours(
  scope: EngineScope,
  input: { readonly memberIds: readonly string[]; readonly weekly: WeeklyHours },
  hooks: readonly AfterWrite[] = [],
): Promise<BulkHoursResult> {
  requirePermission(scope, 'booking.manage');
  if (memberOf(scope) === undefined) throw refuse('FORBIDDEN', PERMISSIONS['booking.manage'].message);
  return writeSchedules(scope, hooks, async ({ tx }) => {
    const changes: ScheduleChange[] = [];
    for (const memberId of inLockOrder(input.memberIds)) {
      const zone = await mayWrite(tx, scope, memberId);
      const target = await defaultToWrite(tx, scope, memberId, zone);
      const hours = hoursOf(target.row.availability, zone);
      const weekly = Object.fromEntries(
        WEEKDAYS.map((day) => [day, input.weekly[day].map(([start, end]) => [start, end] as [string, string])]),
      ) as Hours['weekly'];
      const saved = await saveScheduleHours(tx, scope, target, { ...hours, weekly });
      if (saved !== undefined) changes.push(saved.change);
    }
    return { result: { changed: changes.length }, change: changes };
  });
}
