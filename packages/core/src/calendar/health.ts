// Calendar health for a team (spec 0037, AC-1307, job J3): the one calendar
// read about other members, and it carries a status and since when, nothing
// else. Never an account's address, a calendar's name, a provider's words or
// an event: what a colleague may know of someone's calendars is whether
// scheduling around them can be trusted (AC-1306, AC-1312).
//
// One query reads the asked members' connections and the calendars that check
// for conflicts or take bookings, and each member folds to one of four:
//   1. no connection: `none`;
//   2. the account holding their destination, or the account of every conflict
//      calendar, is expired, revoked or failed, or every conflict calendar is
//      failing: `reconnect`, since the earliest failure;
//   3. some conflict calendar failing (spec 0024, AC-995) or its account
//      stopped: `skipped`, since the earliest;
//   4. otherwise `connected`.
//
// Whose health a reader may ask after is their See reach (spec 0037, job J1):
// `canActFor` over `schedulingReach`, the one scheduling check, so the reader
// themself, owners and admins over everyone (`schedule.view`), and delegates
// over whom their delegations name. A member outside the reach, or not an
// active member, is left out of the answer, never refused, so the answer never
// says who exists.
import { sql } from 'drizzle-orm';
import type { CalendarHealthStatus, MemberCalendarHealth } from '@crm/contracts';
import { checkScope, type EngineScope } from '../access/mint.ts';
import { inWorkspace } from '../access/run.ts';
import { canActFor, schedulingReach } from '../access/scheduling.ts';
import { isUuid, uuidList } from '../engine/ids.ts';

/** The statuses that stop an account until its member acts. */
const STOPPED: ReadonlySet<string> = new Set(['expired', 'revoked', 'failed']);

/** One account or calendar as the health fold reads it. */
interface HealthRow extends Record<string, unknown> {
  readonly member_id: string;
  readonly connection_status: string | null;
  readonly connection_failing_since: string | null;
  readonly connection_changed_at: string | null;
  readonly calendar_id: string | null;
  readonly check_conflicts: boolean | null;
  readonly is_destination: boolean | null;
  readonly calendar_failing: boolean | null;
  readonly calendar_failing_since: string | null;
}

/** The earliest of some moments, or undefined. */
function earliest(values: readonly (string | null | undefined)[]): string | undefined {
  const times = values.flatMap((value) => {
    const at = value === null || value === undefined ? Number.NaN : Date.parse(value);
    return Number.isFinite(at) ? [at] : [];
  });
  return times.length === 0 ? undefined : new Date(Math.min(...times)).toISOString();
}

/** One member's rows folded to a status and since when (the fold in the header). */
export function foldHealth(memberId: string, rows: readonly HealthRow[]): MemberCalendarHealth {
  const accounts = rows.filter((row) => row.connection_status !== null);
  if (accounts.length === 0) return { memberId, status: 'none' };
  const since = (row: HealthRow) =>
    row.connection_status !== null && STOPPED.has(row.connection_status)
      ? (row.connection_failing_since ?? row.connection_changed_at)
      : row.calendar_failing_since;
  const broken = (row: HealthRow) =>
    (row.connection_status !== null && STOPPED.has(row.connection_status)) || row.calendar_failing === true;
  const destination = rows.find((row) => row.is_destination === true);
  const conflicts = rows.filter((row) => row.check_conflicts === true && row.calendar_id !== null);
  const failing = conflicts.filter(broken);
  const answer = (status: CalendarHealthStatus, of: readonly HealthRow[]): MemberCalendarHealth => {
    const at = earliest(of.map(since));
    return { memberId, status, ...(at === undefined ? {} : { since: at }) };
  };
  if (
    destination !== undefined &&
    destination.connection_status !== null &&
    STOPPED.has(destination.connection_status)
  ) {
    return answer('reconnect', [destination]);
  }
  if (conflicts.length > 0 && failing.length === conflicts.length) return answer('reconnect', failing);
  // No conflict calendars at all, yet every account stopped: nothing can be read or written.
  if (conflicts.length === 0 && accounts.every((row) => STOPPED.has(row.connection_status ?? ''))) {
    return answer('reconnect', accounts);
  }
  if (failing.length > 0) return answer('skipped', failing);
  return { memberId, status: 'connected' };
}

/**
 * The asked members' calendar health (AC-1307), in the order asked, leaving out anyone outside the reader's reach
 * or not an active member. Statuses and times only.
 */
export async function readCalendarHealth(
  scope: EngineScope,
  input: { readonly memberIds: readonly string[] } = { memberIds: [] },
): Promise<readonly MemberCalendarHealth[]> {
  checkScope(scope);
  const named = [...new Set(input.memberIds.filter(isUuid).map((id) => id.toLowerCase()))];
  if (named.length === 0) return [];
  const { asked, rows } = await inWorkspace(scope, async (tx) => {
    const reach = await schedulingReach(tx, scope);
    const inReach = named.filter((id) => canActFor(reach, id, 'view'));
    if (inReach.length === 0) return { asked: inReach, rows: { rows: [] as HealthRow[] } };
    const read = await tx.execute<HealthRow>(sql`
      select m.id::text as member_id, c.status::text as connection_status,
        to_char(c.failing_since at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as connection_failing_since,
        to_char(c.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as connection_changed_at,
        k.id::text as calendar_id, k.check_conflicts, k.is_destination,
        (k.last_error ->> 'source' in ('busy', 'sync')) is true as calendar_failing,
        to_char(k.failing_since at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as calendar_failing_since
      from members m
      left join calendar_connections c on c.workspace_id = m.workspace_id and c.member_id = m.id
      left join calendar_calendars k on k.workspace_id = c.workspace_id and k.connection_id = c.id
        and (k.check_conflicts or k.is_destination)
      where m.id = any(${uuidList(inReach)}) and m.status = 'active'
    `);
    return { asked: inReach, rows: read };
  });
  const found = new Set(rows.rows.map((row) => row.member_id));
  return asked
    .filter((id) => found.has(id))
    .map((id) =>
      foldHealth(
        id,
        rows.rows.filter((row) => row.member_id === id),
      ),
    );
}
