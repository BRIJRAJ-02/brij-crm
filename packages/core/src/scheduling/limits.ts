// Meeting limits (spec 0037, AC-1297, AC-1298): at most N meetings a day and N a week for one member, across every
// page they host. One row per member in `member_booking_limits`, each limit optional; a row with neither is deleted.
// Days and weeks are counted in the member's default schedule's zone, weeks from Monday; confirmed bookings they
// host (`booking_hosts`, so a collective meeting counts for each required member) count, cancelled ones don't.
//
// The slot engine reads `limitChecks` for the members a page books: one query for the limits (by the primary key)
// and, only for members who have one, one for their zones and one grouped count over `booking_hosts` per local day,
// across the range widened to whole weeks. A day at the day limit, or a week at the week limit, offers nothing for
// that member; rotations skip them as they skip a member at their daily cap. The booking's recheck reads it again
// under the host lock, so two guests never both take the last one.
//
// A member sets their own (with `availability.own`); anyone with Manage over their hours sets them for them. Each
// change writes one `limits.changed` audit row, one `time_off` outbox row naming nothing (limits are settings, as
// time off is: spec 0037 adds no outbox kind for them, so they share time off's, and open Limits sections read
// again) and, when someone else made it, queues the member's scheduling notice (AC-1264).
import { and, eq, inArray, sql } from 'drizzle-orm';
import { DateTime } from 'luxon';
import { isTimeZone, MEETING_LIMITS, PERMISSIONS, type MeetingLimits } from '@crm/contracts';
import { schema, type WorkspaceTx } from '@crm/db';
import { inWorkspace } from '../access/run.ts';
import type { EngineScope } from '../access/mint.ts';
import { actingFor, canActFor } from '../access/scheduling.ts';
import { resolveMany } from '../availability/resolve.ts';
import { mayEditOwnHours, ownHoursRefusal } from '../availability/schedules.ts';
import { isUuid, uuidArray } from '../engine/ids.ts';
import { refuse, refuseOn } from '../engine/refusals.ts';
import { actorRow } from '../engine/scope.ts';
import { runWrite, type AfterWrite, type WriteContext } from '../engine/write.ts';
import type { RemovalEffect } from '../members/removal-effect.ts';
import { writeAudit } from '../members/audit.ts';
import { queueSchedulingNotice } from './notice.ts';

const { memberBookingLimits } = schema;

const DAY_MS = 86_400_000;

/** One member's limits; absent is no limit. */
export interface LimitValues {
  readonly perDay?: number | undefined;
  readonly perWeek?: number | undefined;
}

/** Whether a meeting starting at `at` keeps the member under their limits. */
export type LimitCheck = (at: Date) => boolean;

/** The member the scope acts as: a key or the system has no limits of its own. */
function actorOf(scope: EngineScope): string {
  const { principal } = scope.access;
  if (principal.kind !== 'member') throw refuse('FORBIDDEN', PERMISSIONS['booking.manage'].message);
  return principal.memberId;
}

/** A local day's key, and its week's (Monday's date), in `zone`. */
function keysOf(at: Date, zone: string): { readonly day: string; readonly week: string } {
  const local = DateTime.fromJSDate(at, { zone });
  return { day: local.toISODate() ?? '', week: local.startOf('week').toISODate() ?? '' };
}

/**
 * A member's limit check (pure): their confirmed meetings by local day (`YYYY-MM-DD` in `zone`) summed into weeks
 * from Monday, so a slot is two lookups. A slot is offered while the day's count is under the day limit and the
 * week's under the week limit.
 */
export function limitCheck(limits: LimitValues, perDay: ReadonlyMap<string, number>, zone: string): LimitCheck {
  const { perDay: dayLimit, perWeek: weekLimit } = limits;
  if (dayLimit === undefined && weekLimit === undefined) return () => true;
  const weeks = new Map<string, number>();
  for (const [day, count] of perDay) {
    const week = DateTime.fromISO(day, { zone }).startOf('week').toISODate() ?? '';
    weeks.set(week, (weeks.get(week) ?? 0) + count);
  }
  return (at) => {
    const keys = keysOf(at, zone);
    return (
      (dayLimit === undefined || (perDay.get(keys.day) ?? 0) < dayLimit) &&
      (weekLimit === undefined || (weeks.get(keys.week) ?? 0) < weekLimit)
    );
  };
}

/** The members' stored limits, by member: one query through the primary key; members with none are left out. */
export async function memberLimits(
  tx: WorkspaceTx,
  memberIds: readonly string[],
): Promise<ReadonlyMap<string, LimitValues>> {
  const ids = [...new Set(memberIds)].filter(isUuid);
  if (ids.length === 0) return new Map();
  const rows = await tx
    .select({
      memberId: memberBookingLimits.memberId,
      perDay: memberBookingLimits.perDay,
      perWeek: memberBookingLimits.perWeek,
    })
    .from(memberBookingLimits)
    .where(inArray(memberBookingLimits.memberId, ids));
  return new Map(
    rows.map((row) => [
      row.memberId,
      {
        ...(row.perDay === null ? {} : { perDay: row.perDay }),
        ...(row.perWeek === null ? {} : { perWeek: row.perWeek }),
      },
    ]),
  );
}

/**
 * The zone each member's days are counted in: their default schedule's, else (no schedule saved yet) their
 * profile's, else the workspace's. Two queries however many members.
 */
export async function limitZones(tx: WorkspaceTx, memberIds: readonly string[]): Promise<ReadonlyMap<string, string>> {
  const ids = [...new Set(memberIds)].filter(isUuid);
  if (ids.length === 0) return new Map();
  const found = await tx.execute<{ id: string; zone: string | null }>(sql`
    select m.id::text as id, coalesce(m.time_zone, w.time_zone) as zone
    from members m join workspaces w on w.id = m.workspace_id
    where m.id = any(${uuidArray(ids)})
  `);
  const fallback = new Map(
    found.rows.map((row) => [row.id, row.zone !== null && isTimeZone(row.zone) ? row.zone : 'UTC']),
  );
  const resolved = await resolveMany(
    tx,
    ids.map((memberId) => ({ memberId, fallbackZone: fallback.get(memberId) ?? 'UTC' })),
  );
  return new Map(ids.map((memberId, index) => [memberId, resolved[index]?.availability.timeZone ?? 'UTC']));
}

/**
 * The confirmed meetings each member hosts that start in [from, to), counted by local day in their zone: one
 * grouped query over `booking_hosts` (its `booking_hosts_by_member` index), the meeting's own start deciding the day.
 */
export async function hostedByDay(
  tx: WorkspaceTx,
  zones: ReadonlyMap<string, string>,
  from: Date,
  to: Date,
  /** A booking being moved: it doesn't count against its own new time. */
  except?: string,
): Promise<ReadonlyMap<string, ReadonlyMap<string, number>>> {
  const ids = [...zones.keys()].filter(isUuid);
  const counts = new Map<string, Map<string, number>>(ids.map((id) => [id, new Map()]));
  if (ids.length === 0) return counts;
  const zoneRows = sql.join(
    ids.map((id) => sql`(${id}::uuid, ${zones.get(id) ?? 'UTC'}::text)`),
    sql`, `,
  );
  const found = await tx.execute<{ member_id: string; day: string; n: number }>(sql`
    select h.member_id::text as member_id, (b.starts_at at time zone z.zone)::date::text as day, count(*)::int as n
    from booking_hosts h
    join bookings b on b.workspace_id = h.workspace_id and b.id = h.booking_id
    join (values ${zoneRows}) as z(member_id, zone) on z.member_id = h.member_id
    where h.member_id = any(${uuidArray(ids)}) and h.status = 'confirmed'
      and h.starts_at < ${to.toISOString()}::timestamptz and h.ends_at > ${from.toISOString()}::timestamptz
      and b.starts_at >= ${from.toISOString()}::timestamptz and b.starts_at < ${to.toISOString()}::timestamptz
      ${except === undefined || !isUuid(except) ? sql`` : sql`and h.booking_id <> ${except}::uuid`}
    group by 1, 2
  `);
  for (const row of found.rows) counts.get(row.member_id)?.set(row.day, row.n);
  return counts;
}

/**
 * Each limited member's check over [from, to) (AC-1298), for the slots read and the booking's recheck: members with
 * no limit are left out, and nothing is counted when nobody has one (one query). The count covers the range
 * widened by eight days either side, so every whole week it touches is counted, in any zone.
 */
export async function limitChecks(
  tx: WorkspaceTx,
  memberIds: readonly string[],
  from: Date,
  to: Date,
  except?: string,
): Promise<ReadonlyMap<string, LimitCheck>> {
  const limits = await memberLimits(tx, memberIds);
  if (limits.size === 0) return new Map();
  const zones = await limitZones(tx, [...limits.keys()]);
  const counts = await hostedByDay(
    tx,
    zones,
    new Date(from.getTime() - 8 * DAY_MS),
    new Date(to.getTime() + 8 * DAY_MS),
    except,
  );
  return new Map(
    [...limits].map(([memberId, values]) => [
      memberId,
      limitCheck(values, counts.get(memberId) ?? new Map(), zones.get(memberId) ?? 'UTC'),
    ]),
  );
}

/** Today's and this week's counts for one member, in their zone at `now`. */
async function countsNow(
  tx: WorkspaceTx,
  memberId: string,
  zone: string,
  now: Date,
): Promise<{ readonly today: number; readonly thisWeek: number }> {
  const local = DateTime.fromJSDate(now, { zone });
  const weekStart = local.startOf('week');
  const byDay = await hostedByDay(
    tx,
    new Map([[memberId, zone]]),
    weekStart.toJSDate(),
    weekStart.plus({ weeks: 1 }).toJSDate(),
  );
  const days = byDay.get(memberId) ?? new Map<string, number>();
  const today = local.toISODate() ?? '';
  return { today: days.get(today) ?? 0, thisWeek: [...days.values()].reduce((sum, n) => sum + n, 0) };
}

type LimitsRow = typeof memberBookingLimits.$inferSelect;

async function limitsRow(tx: WorkspaceTx, memberId: string): Promise<LimitsRow | undefined> {
  const [row] = await tx.select().from(memberBookingLimits).where(eq(memberBookingLimits.memberId, memberId));
  return row;
}

/** What one side of an audit row keeps: whose, and each limit set. */
function auditSide(memberId: string, values: LimitValues): Readonly<Record<string, unknown>> {
  return {
    memberId,
    ...(values.perDay === undefined ? {} : { perDay: values.perDay }),
    ...(values.perWeek === undefined ? {} : { perWeek: values.perWeek }),
  };
}

const valuesOf = (row: LimitsRow | undefined): LimitValues =>
  row === undefined
    ? {}
    : {
        ...(row.perDay === null ? {} : { perDay: row.perDay }),
        ...(row.perWeek === null ? {} : { perWeek: row.perWeek }),
      };

/** A limit outside its range (the contract checks it first; a direct caller is refused the same way). */
function checkRange(
  value: number | undefined,
  range: { readonly min: number; readonly max: number },
  field: string,
  message: string,
): void {
  if (value === undefined) return;
  if (!Number.isInteger(value) || value < range.min || value > range.max)
    throw refuseOn('CONFIG_INVALID', message, field);
}

/** The answer both procedures give. */
async function viewOf(
  tx: WorkspaceTx,
  memberId: string,
  canChange: boolean,
  now: Date,
  showChangedBy: boolean,
): Promise<MeetingLimits> {
  const row = await limitsRow(tx, memberId);
  const zone = (await limitZones(tx, [memberId])).get(memberId) ?? 'UTC';
  const counts = await countsNow(tx, memberId, zone, now);
  const values = valuesOf(row);
  const changedBy =
    showChangedBy && row !== undefined && row.updatedByMemberId !== null && row.updatedByMemberId !== memberId
      ? { changedBy: { memberId: row.updatedByMemberId, at: row.updatedAt.toISOString() } }
      : {};
  return {
    memberId,
    ...(values.perDay === undefined ? {} : { perDay: values.perDay }),
    ...(values.perWeek === undefined ? {} : { perWeek: values.perWeek }),
    today: counts.today,
    thisWeek: counts.thisWeek,
    timeZone: zone,
    canChange,
    ...changedBy,
  };
}

/**
 * A member's meeting limits and this day's and week's counts (AC-1299): their own, or a colleague's in the caller's
 * See reach (outside it, NOT_FOUND). `canChange` says whether the caller may set them.
 */
export async function getLimits(
  scope: EngineScope,
  deps: { readonly now: () => Date },
  input: { readonly memberId?: string | undefined },
): Promise<MeetingLimits> {
  const actor = actorOf(scope);
  const member = input.memberId ?? actor;
  return inWorkspace(scope, async (tx) => {
    if (member === actor) return viewOf(tx, member, mayEditOwnHours(scope), deps.now(), true);
    const reach = await actingFor(tx, scope, member, 'view');
    const canChange = canActFor(reach, member, 'manage', 'hours');
    // "Changed by" with Manage, as time off shows it (AC-1265).
    return viewOf(tx, member, canChange, deps.now(), canChange);
  });
}

/**
 * Sets a member's meeting limits (AC-1297): both as they should be, absent being no limit, for the caller (with
 * `availability.own`) or a colleague they Manage. Both absent deletes the row. A save that changes nothing writes
 * nothing: no audit row, no event, no notice.
 */
export async function setLimits(
  scope: EngineScope,
  deps: { readonly now: () => Date },
  input: LimitValues & { readonly memberId?: string | undefined },
  hooks: readonly AfterWrite[] = [],
): Promise<MeetingLimits> {
  const actor = actorOf(scope);
  const member = input.memberId ?? actor;
  const by = actorRow(scope.actor);
  checkRange(input.perDay, MEETING_LIMITS.perDay, 'perDay', 'Use 1 to 50 meetings a day.');
  checkRange(input.perWeek, MEETING_LIMITS.perWeek, 'perWeek', 'Use 1 to 200 meetings a week.');
  const { result } = await runWrite(
    scope,
    async (context) => {
      const { tx } = context;
      if (member === actor) {
        if (!mayEditOwnHours(scope)) throw ownHoursRefusal(scope);
      } else {
        await actingFor(tx, scope, member, 'manage', 'hours');
      }
      const before = await limitsRow(tx, member);
      const was = valuesOf(before);
      const next: LimitValues = {
        ...(input.perDay === undefined ? {} : { perDay: input.perDay }),
        ...(input.perWeek === undefined ? {} : { perWeek: input.perWeek }),
      };
      const same = was.perDay === next.perDay && was.perWeek === next.perWeek;
      if (!same) {
        if (next.perDay === undefined && next.perWeek === undefined) {
          await tx.delete(memberBookingLimits).where(eq(memberBookingLimits.memberId, member));
        } else {
          const values = { perDay: next.perDay ?? null, perWeek: next.perWeek ?? null };
          const updated = {
            ...values,
            updatedAt: sql`now()`,
            updatedByType: by.type,
            updatedById: by.id,
            updatedByMemberId: by.memberId,
          };
          await tx
            .insert(memberBookingLimits)
            .values({
              workspaceId: scope.workspaceId,
              memberId: member,
              ...values,
              createdByType: by.type,
              createdById: by.id,
              createdByMemberId: by.memberId,
              updatedByType: by.type,
              updatedById: by.id,
              updatedByMemberId: by.memberId,
            })
            .onConflictDoUpdate({
              target: [memberBookingLimits.workspaceId, memberBookingLimits.memberId],
              set: updated,
            });
        }
        await writeAudit(tx, scope.workspaceId, scope.actor, {
          action: 'limits.changed',
          targetType: 'member',
          targetId: member,
          before: auditSide(member, was),
          after: auditSide(member, next),
        });
        if (actor !== member) await queueSchedulingNotice(tx, actor, member);
        // Limits share time off's event (no outbox kind of their own): open Limits sections read again.
        context.record({ timeOff: [member] });
      }
      // Whoever just set them may set them again.
      return viewOf(tx, member, true, deps.now(), true);
    },
    hooks,
  );
  return result;
}

/** A removed member's limits go with them (spec 0037, AC-814 widened): nobody books them any more. */
async function deleteMemberLimits(context: WriteContext, memberId: string): Promise<void> {
  await context.tx
    .delete(memberBookingLimits)
    .where(
      and(eq(memberBookingLimits.workspaceId, context.scope.workspaceId), eq(memberBookingLimits.memberId, memberId)),
    );
}

/** The limits' part of a member's removal (AC-1440). */
export const limitsRemoval: RemovalEffect = {
  feature: 'meeting limits',
  constraints: ['member_booking_limits_member'],
  run: deleteMemberLimits,
};
