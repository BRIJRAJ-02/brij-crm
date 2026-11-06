// Table seating on the visit engine (spec 0066 B7 lite; spec 0065 AC-6550, AC-6560, AC-6561): a place's Table
// service with sensible defaults, the setup checklist and the problems Publish refuses, the day's reservations for
// the Service list and floor, and the status moves a host makes. Setup is `hospitality.manage`'s, the Service list
// and status moves `hospitality.service`'s (Run service), each behind the Table seating gate.
//
// Ported from checklabs' reservation rules (src/lib/availability.ts and its booking policy): the policy ranges (step
// 5 to 240, hold 15 to 600, advance 1 to 730 days, party 1 to 100), hold by size thresholds, last seating = close less
// the hold, pacing as a covers cap. The defaults are 0065 AC-6550's: parties 1 to 8, a 15 minute step, holds 90 (1 to
// 2), 105 (3 to 4), 120 (5 to 6) and 150 (7 and more), 2 hours' notice, 60 days ahead.
import {
  APPOINTMENT_STATUSES,
  holdBySizeProblem,
  spanOf,
  VISIT_LIMITS,
  WEEK_DAYS,
  type AppointmentStatus,
  type HoldBySize,
  type PlaceHours,
  type PlaceHoursShape,
  type ServiceFloor,
  type ServicePlaces,
} from '@crm/contracts';
import { sql } from 'drizzle-orm';
import type { WorkspaceTx } from '@crm/db';
import { requirePermission } from '../access/check.ts';
import type { EngineScope } from '../access/mint.ts';
import { can } from '../access/policy.ts';
import { inWorkspace } from '../access/run.ts';
import { checkId, newId } from '../engine/ids.ts';
import { inputInvalid, postgresError, refuse } from '../engine/refusals.ts';
import { runWrite, type AfterWrite } from '../engine/write.ts';
import { auditSetup, hospitalityMember, requireApp } from '../hospitality/gate.ts';
import { addDays, wallToInstant } from '../hospitality/hours.ts';
import { requireVisitApp, type SlotCache } from './book.ts';
import { loadVisitInputs } from './load.ts';
import { lockVisit } from './locks.ts';
import { partyGroups, type PlannerResource } from './planner.ts';
import { currentPropertyRef } from '../hospitality/property.ts';

/** The Table service's defaults (0065 AC-6550): what a first try books with. */
export const TABLE_DEFAULTS = {
  minutes: 90,
  holds: [
    { size: 3, minutes: 105 },
    { size: 5, minutes: 120 },
    { size: 7, minutes: 150 },
  ] satisfies readonly HoldBySize[],
  partyMin: 1,
  partyMax: 8,
  stepMinutes: 30,
  noticeMinutes: 120,
  windowDays: 60,
  changeCutoffMinutes: 120,
  cancelCutoffMinutes: 120,
} as const;

/** A place's Table rules, as the setup screen edits them. */
export interface TableRules {
  /** How long a party of one or two holds its table. */
  readonly minutes: number;
  /** Longer holds for larger parties. */
  readonly holds: readonly HoldBySize[];
  readonly partyMin: number;
  readonly partyMax: number;
  readonly stepMinutes: number;
  readonly noticeMinutes: number;
  readonly windowDays: number;
  /** The most guests whose visits overlap, or none. */
  readonly coversCap?: number | undefined;
  readonly changeCutoffMinutes: number;
  readonly cancelCutoffMinutes: number;
  /** Bookable by guests online. */
  readonly online: boolean;
}

/** One step of the setup checklist, with a one line fix when it isn't done. */
export interface SetupStep {
  readonly step: 'hours' | 'tables' | 'rules';
  readonly done: boolean;
  /** The one line fix, and where it is (`hours`, `tables` or `rules` on the place's page). */
  readonly fix?: string;
}

/** A place's Table setup: the rules (the defaults until saved), the checklist and whether it can take reservations. */
export interface TableSetup {
  readonly placeId: string;
  readonly serviceId?: string;
  readonly rules: TableRules;
  readonly saved: boolean;
  readonly steps: readonly SetupStep[];
  /** True when every step is done: Publish may go ahead. */
  readonly ready: boolean;
  /** The guest page's address key: timefix.com/r/<publicKey>. */
  readonly publicKey: string;
  /** Whether the reader gets an email for each new online reservation here (no choice yet: on for the owner). */
  readonly notifyMe: boolean;
}

const DEFAULT_RULES: TableRules = {
  minutes: TABLE_DEFAULTS.minutes,
  holds: TABLE_DEFAULTS.holds,
  partyMin: TABLE_DEFAULTS.partyMin,
  partyMax: TABLE_DEFAULTS.partyMax,
  stepMinutes: TABLE_DEFAULTS.stepMinutes,
  noticeMinutes: TABLE_DEFAULTS.noticeMinutes,
  windowDays: TABLE_DEFAULTS.windowDays,
  changeCutoffMinutes: TABLE_DEFAULTS.changeCutoffMinutes,
  cancelCutoffMinutes: TABLE_DEFAULTS.cancelCutoffMinutes,
  // Off line until Publish (spec 0068, foolproof): a first save never shows a half set up page to guests.
  online: false,
};

/** What is wrong with a set of rules, as one sentence on its field, or undefined (checklabs' policy ranges). */
export function tableRulesProblem(rules: TableRules): { readonly field: string; readonly message: string } | undefined {
  const within = (value: number, low: number, high: number) => Number.isInteger(value) && value >= low && value <= high;
  if (!within(rules.minutes, 15, 600)) return { field: 'minutes', message: 'Hold a table 15 minutes to 10 hours.' };
  const holds = holdBySizeProblem(rules.holds);
  if (holds !== undefined) return { field: 'holds', message: holds };
  if (rules.holds.some((row) => row.minutes < 15))
    return { field: 'holds', message: 'Hold a table at least 15 minutes.' };
  if (!within(rules.partyMin, 1, 100) || !within(rules.partyMax, rules.partyMin, 100)) {
    return { field: 'partyMax', message: 'Take parties from 1 to 100, the smallest no larger than the largest.' };
  }
  if (!within(rules.stepMinutes, 5, 240))
    return { field: 'stepMinutes', message: 'Offer a time every 5 to 240 minutes.' };
  if (!within(rules.noticeMinutes, 0, 43_200))
    return { field: 'noticeMinutes', message: 'Ask for up to 30 days’ notice.' };
  if (!within(rules.windowDays, 1, 730))
    return { field: 'windowDays', message: 'Take reservations 1 to 730 days ahead.' };
  if (rules.coversCap !== undefined && !within(rules.coversCap, 1, 1000)) {
    return { field: 'coversCap', message: 'Pace at 1 to 1,000 guests at once.' };
  }
  if (!within(rules.changeCutoffMinutes, 0, 10_080) || !within(rules.cancelCutoffMinutes, 0, 10_080)) {
    return { field: 'cancelCutoffMinutes', message: 'Allow changes until up to a week before.' };
  }
  return undefined;
}

/** The longest hold a party in range takes. */
const longestHold = (rules: TableRules): number =>
  Math.max(rules.minutes, ...rules.holds.filter((row) => row.size <= rules.partyMax).map((row) => row.minutes));

/**
 * The setup checklist (pure): opening hours with at least one range as long as the longest hold; an online table,
 * and tables (alone or joined) that seat the largest party; rules that hold together. Each step not done carries its
 * one line fix.
 */
export function setupSteps(
  hours: PlaceHoursShape,
  tables: readonly PlannerResource[],
  rules: TableRules,
): readonly SetupStep[] {
  const spans = [
    ...WEEK_DAYS.flatMap((day) => hours.weekly[day] ?? []),
    ...hours.exceptions.flatMap((day) => day.ranges ?? []),
  ]
    .map((range) => spanOf(range))
    .filter((span) => span !== undefined);
  const longest = Math.max(0, ...spans.map((span) => span.end - span.start));
  const hoursStep: SetupStep =
    spans.length === 0
      ? { step: 'hours', done: false, fix: 'Set your opening hours, so guests see times.' }
      : longest < longestHold(rules)
        ? { step: 'hours', done: false, fix: 'Open at least as long as a table is held, or shorten the hold.' }
        : { step: 'hours', done: true };
  const online = tables.filter((table) => table.online !== false);
  const tablesStep: SetupStep =
    online.length === 0
      ? { step: 'tables', done: false, fix: 'Add a table guests can book online.' }
      : partyGroups(online, 'table', rules.partyMax).length === 0
        ? {
            step: 'tables',
            done: false,
            fix: `No table seats ${String(rules.partyMax)}. Add a larger table, join tables, or lower the largest party.`,
          }
        : { step: 'tables', done: true };
  const problem = tableRulesProblem(rules);
  const rulesStep: SetupStep =
    problem === undefined ? { step: 'rules', done: true } : { step: 'rules', done: false, fix: problem.message };
  return [hoursStep, tablesStep, rulesStep];
}

interface ServiceRow extends Record<string, unknown> {
  readonly id: string;
  readonly variant_id: string;
  readonly minutes: number;
  readonly hold_by_size: HoldBySize[];
  readonly party_min: number;
  readonly party_max: number;
  readonly step_min: number;
  readonly notice_min: number;
  readonly window_days: number;
  readonly covers_cap: number | null;
  readonly change_cutoff_min: number;
  readonly cancel_cutoff_min: number;
  readonly online: boolean;
}

/** The place's Table service (a live party service with no staff, offered at the place), or undefined. */
async function tableServiceOf(tx: WorkspaceTx, placeId: string): Promise<ServiceRow | undefined> {
  const [row] = (
    await tx.execute<ServiceRow>(sql`
      select s.id::text as id, v.id::text as variant_id, v.minutes, s.hold_by_size, s.party_min, s.party_max, s.step_min,
        s.notice_min, s.window_days, s.covers_cap, s.change_cutoff_min, s.cancel_cutoff_min, s.online
      from services s
      join service_places sp on sp.workspace_id = s.workspace_id and sp.service_id = s.id and sp.place_id = ${placeId}::uuid
      join service_variants v on v.workspace_id = s.workspace_id and v.service_id = s.id and v.archived_at is null
      where s.capacity_mode = 'party' and s.staff_rule = 'none' and s.archived_at is null
      order by s.position, s.id, v.position
      limit 1
    `)
  ).rows;
  return row;
}

const rulesOf = (row: ServiceRow): TableRules => ({
  minutes: row.minutes,
  holds: row.hold_by_size,
  partyMin: row.party_min,
  partyMax: row.party_max,
  stepMinutes: row.step_min,
  noticeMinutes: row.notice_min,
  windowDays: row.window_days,
  ...(row.covers_cap === null ? {} : { coversCap: row.covers_cap }),
  changeCutoffMinutes: row.change_cutoff_min,
  cancelCutoffMinutes: row.cancel_cutoff_min,
  online: row.online,
});

/** The place's Table service as the guest's door reads it: its ids and rules, or undefined before the first save. */
export async function readTableService(
  tx: WorkspaceTx,
  placeId: string,
): Promise<{ readonly serviceId: string; readonly variantId: string; readonly rules: TableRules } | undefined> {
  const row = await tableServiceOf(tx, placeId);
  return row === undefined ? undefined : { serviceId: row.id, variantId: row.variant_id, rules: rulesOf(row) };
}

/**
 * The party sizes a guest is offered online (AC-6550): the rules' range, narrowed at both ends to the sizes an online
 * table seats, alone or joined. A place whose smallest table seats two never offers a party of one. Undefined when no
 * online table seats any size in the range.
 */
export function guestPartyRange(
  tables: readonly PlannerResource[],
  rules: Pick<TableRules, 'partyMin' | 'partyMax'>,
): { readonly min: number; readonly max: number } | undefined {
  const online = tables.filter((table) => table.online !== false);
  const sizes = Array.from({ length: rules.partyMax - rules.partyMin + 1 }, (_, index) => rules.partyMin + index);
  const seated = sizes.filter((size) => partyGroups(online, 'table', size).length > 0);
  // Joining tables for a party smaller than any one table takes is never what a guest is offered.
  const alone = seated.filter((size) =>
    online.some((table) => table.kind === 'table' && table.minCapacity <= size && size <= table.maxCapacity),
  );
  const min = alone[0] ?? seated[0];
  const max = seated.at(-1);
  return min === undefined || max === undefined ? undefined : { min, max };
}

/** The place's live tables, as planner resources with nothing busy. */
export async function placeTables(tx: WorkspaceTx, placeId: string): Promise<readonly PlannerResource[]> {
  return (
    await tx.execute<{
      id: string;
      min_capacity: number;
      max_capacity: number;
      joins: string[];
      position: number;
      online: boolean;
    }>(sql`
      select id::text, min_capacity, max_capacity, joins::text[] as joins, position, online from resources
      where place_id = ${placeId}::uuid and kind = 'table' and archived_at is null
      order by position, id
    `)
  ).rows.map((row): PlannerResource => ({
    id: row.id,
    kind: 'table',
    minCapacity: row.min_capacity,
    maxCapacity: row.max_capacity,
    joins: row.joins,
    order: row.position,
    online: row.online,
    busy: [],
  }));
}

/** The place's hours and live tables, as the checklist reads them; NOT_FOUND for a place that isn't there. */
async function placeFacts(tx: WorkspaceTx, placeId: string) {
  const [place] = (
    await tx.execute<{ hours: PlaceHoursShape; time_zone: string; public_key: string }>(
      sql`select hours, time_zone, public_key from places where id = ${placeId}::uuid`,
    )
  ).rows;
  if (place === undefined) throw refuse('NOT_FOUND', 'That place doesn’t exist.');
  const tables = await placeTables(tx, placeId);
  return { hours: place.hours, zone: place.time_zone, publicKey: place.public_key, tables };
}

/** Whether `memberId` gets new reservation emails at the place: their choice, else on for the owner only. */
async function notifyOf(tx: WorkspaceTx, placeId: string, memberId: string | undefined): Promise<boolean> {
  if (memberId === undefined) return false;
  const [row] = (
    await tx.execute<{ on: boolean }>(sql`
      select coalesce(
        (select ra.enabled from reservation_alerts ra where ra.place_id = ${placeId}::uuid and ra.member_id = m.id),
        m.role = 'owner'
      ) as on
      from members m where m.id = ${memberId}::uuid and m.status = 'active'
    `)
  ).rows;
  return row?.on === true;
}

/** The reading member, when a member reads. */
const readerOf = (scope: EngineScope): string | undefined =>
  scope.access.principal.kind === 'member' ? scope.access.principal.memberId : undefined;

/** The setup as read in the caller's transaction. */
async function readSetup(tx: WorkspaceTx, placeId: string, reader: string | undefined): Promise<TableSetup> {
  const facts = await placeFacts(tx, placeId);
  const row = await tableServiceOf(tx, placeId);
  const rules = row === undefined ? DEFAULT_RULES : rulesOf(row);
  const steps = setupSteps(facts.hours, facts.tables, rules);
  return {
    placeId,
    ...(row === undefined ? {} : { serviceId: row.id }),
    rules,
    saved: row !== undefined,
    steps,
    ready: row !== undefined && steps.every((step) => step.done),
    publicKey: facts.publicKey,
    notifyMe: await notifyOf(tx, placeId, reader),
  };
}

/** A place's Table setup (B7 lite): the rules (the defaults until saved) and the checklist. */
export async function getTableSetup(scope: EngineScope, input: { readonly placeId: string }): Promise<TableSetup> {
  requirePermission(scope, 'hospitality.manage');
  const placeId = checkId(input.placeId, 'That place doesn’t exist.');
  return inWorkspace(scope, async (tx) => {
    await requireApp(tx, scope.workspaceId, 'table_seating');
    return readSetup(tx, placeId, readerOf(scope));
  });
}

/**
 * Saves a place's Table rules, making its Table service on the first save (a party service with no staff, needing
 * one table, offered at the place). Refuses an input problem on its field. Answers the setup as saved; the slot
 * cache drops the place's answers.
 */
export async function saveTableSetup(
  scope: EngineScope,
  input: { readonly placeId: string; readonly rules: TableRules },
  deps: { readonly slotCache?: SlotCache } = {},
): Promise<TableSetup> {
  requirePermission(scope, 'hospitality.manage');
  const by = hospitalityMember(scope);
  const placeId = checkId(input.placeId, 'That place doesn’t exist.');
  const problem = tableRulesProblem(input.rules);
  if (problem !== undefined) throw inputInvalid(problem.field, problem.message);
  const { rules } = input;
  const holds = JSON.stringify([...rules.holds].sort((a, b) => a.size - b.size));
  const { result } = await runWrite(scope, async ({ tx }) => {
    await requireApp(tx, scope.workspaceId, 'table_seating');
    const facts = await placeFacts(tx, placeId);
    await lockVisit(tx, scope.workspaceId, placeId, []);
    // Publish refuses a page that would be broken (spec 0068): the first step not done, as its one line fix.
    if (rules.online) {
      const missing = setupSteps(facts.hours, facts.tables, rules).find((step) => !step.done);
      if (missing !== undefined) {
        throw Object.assign(refuse('CONFLICT', missing.fix ?? 'Finish the setup first.'), { step: missing.step });
      }
    }
    const row = await tableServiceOf(tx, placeId);
    const columns = sql`hold_by_size = ${holds}::jsonb, party_min = ${rules.partyMin}, party_max = ${rules.partyMax},
      step_min = ${rules.stepMinutes}, notice_min = ${rules.noticeMinutes}, window_days = ${rules.windowDays},
      covers_cap = ${rules.coversCap ?? null}, change_cutoff_min = ${rules.changeCutoffMinutes},
      cancel_cutoff_min = ${rules.cancelCutoffMinutes}, online = ${rules.online}, updated_at = now(),
      updated_by_member_id = ${by}::uuid`;
    if (row === undefined) {
      const serviceId = newId();
      await tx.execute(sql`
        insert into services (workspace_id, id, property_id, name, slug, capacity_mode, staff_rule, position,
          created_by_member_id)
        values (${scope.workspaceId}::uuid, ${serviceId}::uuid, ${currentPropertyRef(scope.workspaceId)}, 'Table', ${`table-${serviceId.slice(-8)}`}, 'party', 'none',
          0, ${by}::uuid)
      `);
      await tx.execute(sql`update services set ${columns} where id = ${serviceId}::uuid`);
      await tx.execute(sql`
        insert into service_variants (workspace_id, service_id, name, minutes, price_type, position)
        values (${scope.workspaceId}::uuid, ${serviceId}::uuid, 'Table', ${rules.minutes}, 'free', 0)
      `);
      await tx.execute(sql`
        insert into service_places (workspace_id, service_id, place_id, property_id)
        values (${scope.workspaceId}::uuid, ${serviceId}::uuid, ${placeId}::uuid, ${currentPropertyRef(scope.workspaceId)})
      `);
      await tx.execute(sql`
        insert into service_resources (workspace_id, service_id, kind, count) values (${scope.workspaceId}::uuid, ${serviceId}::uuid, 'table', 1)
      `);
      await auditSetup(tx, scope, 'table_service.created', { placeId, serviceId });
    } else {
      await tx.execute(sql`update services set ${columns} where id = ${row.id}::uuid`);
      await tx.execute(
        sql`update service_variants set minutes = ${rules.minutes}, updated_at = now() where id = ${row.variant_id}::uuid`,
      );
      await auditSetup(tx, scope, 'table_service.updated', { placeId, serviceId: row.id });
    }
    return readSetup(tx, placeId, by);
  });
  deps.slotCache?.purge(placeId);
  return result;
}

/**
 * Turns the reader's new reservation emails at a place on or off (Run service: they come to whoever runs the floor).
 * Audited. Answers the state now.
 */
export async function setReservationAlert(
  scope: EngineScope,
  input: { readonly placeId: string; readonly on: boolean },
): Promise<{ readonly placeId: string; readonly notifyMe: boolean }> {
  requirePermission(scope, 'hospitality.service');
  const memberId = hospitalityMember(scope);
  const placeId = checkId(input.placeId, 'That place doesn’t exist.');
  if (typeof input.on !== 'boolean') throw inputInvalid('on', 'Choose on or off.');
  const { result } = await runWrite(scope, async ({ tx }) => {
    await requireApp(tx, scope.workspaceId, 'table_seating');
    await placeFacts(tx, placeId);
    await tx.execute(sql`
      insert into reservation_alerts (workspace_id, place_id, member_id, enabled)
      values (${scope.workspaceId}::uuid, ${placeId}::uuid, ${memberId}::uuid, ${input.on})
      on conflict (workspace_id, place_id, member_id) do update set enabled = excluded.enabled, updated_at = now()
    `);
    await auditSetup(tx, scope, 'reservation_alert.set', { placeId, on: String(input.on) });
    return { placeId, notifyMe: input.on };
  });
  return result;
}

/**
 * Whether the appointment `a` is a table reservation: every item a party service with no staff (the Table preset).
 * Run service (`hospitality.service`) reaches only these; a salon or clinic visit at the same place needs
 * `services.calendar`, so a waiter never sees a client's haircut or consultation.
 */
const TABLE_ONLY = sql`not exists (
  select 1 from appointment_items ti
  join services ts on ts.workspace_id = ti.workspace_id and ts.id = ti.service_id
  where ti.workspace_id = a.workspace_id and ti.appointment_id = a.id
    and not (ts.capacity_mode = 'party' and ts.staff_rule = 'none')
)`;

/** The most reservations one day lists; more is said (`truncated`), never cut silently. */
export const SERVICE_DAY_CAP = 500;

/** One reservation as the Service list and floor show it. */
export interface DayVisit {
  readonly id: string;
  readonly start: string;
  readonly end: string;
  readonly name: string;
  readonly party: number;
  readonly status: AppointmentStatus;
  readonly resourceIds: readonly string[];
  readonly note?: string;
  readonly occasion?: string;
  readonly phone?: string;
  readonly email?: string;
  readonly lookupCode: string;
  readonly seatedAt?: string;
  readonly source: string;
}

/** A place's day for the Service list: its reservations by time, and the covers booked, seated and to come. */
export interface ServiceDay {
  readonly date: string;
  readonly zone: string;
  readonly visits: readonly DayVisit[];
  readonly covers: { readonly booked: number; readonly seated: number; readonly toCome: number };
  /** True when the day holds more than `SERVICE_DAY_CAP` reservations and only the first are listed. */
  readonly truncated: boolean;
}

const HOUR = 3_600_000;
/**
 * How long past its planned hold a seated party keeps its table with nobody pressing Finish. Long enough for no real
 * party to outstay it, short enough that a forgotten Finish last night never closes a table at this morning's opening.
 */
export const SEATED_OVERSTAY_HOURS = 6;
/** The longest a hold runs (`appointment_holds_during`), which bounds how far back a still seated party's can start. */
const HOLD_MAX_HOURS = 24;

/**
 * The tables a seated party sits at now, whatever its hold's range says (spec 0065 "Late, overstay, early"): `during`
 * is the plan, so a party past it, or seated before it, is invisible to the planner's busy and to the exclusion
 * constraint. What guards these is the check, under the place lock every visit write takes first. Table reservations
 * at tables only, the ones Run service's day shows and can Finish: a salon's room isn't a seat, and a staffed visit's
 * plan stays the plan. Online times keep using the plan, as the spec says.
 */
export async function seatedTables(
  tx: WorkspaceTx,
  workspaceId: string,
  placeId: string,
  now: Date,
  except?: string,
): Promise<ReadonlySet<string>> {
  const stale = new Date(now.getTime() - SEATED_OVERSTAY_HOURS * HOUR).toISOString();
  const oldest = new Date(now.getTime() - (SEATED_OVERSTAY_HOURS + HOLD_MAX_HOURS) * HOUR).toISOString();
  const rows = (
    await tx.execute<{ resource_id: string }>(sql`
      select distinct h.resource_id::text as resource_id
      from appointment_holds h
      join appointments a on a.workspace_id = h.workspace_id and a.id = h.appointment_id
      join resources r on r.workspace_id = h.workspace_id and r.id = h.resource_id
      where h.workspace_id = ${workspaceId}::uuid and h.place_id = ${placeId}::uuid and h.live
        and h.starts_at > ${oldest}::timestamptz and h.ends_at > ${stale}::timestamptz
        and a.status = 'started' and r.kind = 'table' and ${TABLE_ONLY}
        ${except === undefined ? sql`` : sql`and a.id <> ${except}::uuid`}
    `)
  ).rows;
  return new Set(rows.map((row) => row.resource_id));
}

/** Refuses a reader who opens Reservations for neither reason: Run service, or Online booking's `hospitality.manage`. */
function requireFloorReader(scope: EngineScope): void {
  if (!can(scope.access, 'hospitality.manage')) requirePermission(scope, 'hospitality.service');
}

/** The places the Reservations page picks between: only what it draws (AC-6560). Whoever opens the page. */
export async function listServicePlaces(scope: EngineScope): Promise<ServicePlaces> {
  requireFloorReader(scope);
  return inWorkspace(scope, async (tx) => {
    await requireApp(tx, scope.workspaceId, 'table_seating');
    const rows = (
      await tx.execute<{ id: string; name: string; time_zone: string; hours: PlaceHours }>(sql`
        select id::text as id, name, time_zone, hours from places
        where workspace_id = ${scope.workspaceId}::uuid order by position, id
      `)
    ).rows;
    return {
      places: rows.map((row) => ({ id: row.id, name: row.name, timeZone: row.time_zone, hours: row.hours })),
    };
  });
}

/** One place's areas and live tables for the Reservations page: only what it draws (AC-6560). Whoever opens the page. */
export async function readServiceFloor(scope: EngineScope, input: { readonly placeId: string }): Promise<ServiceFloor> {
  requireFloorReader(scope);
  const placeId = checkId(input.placeId, 'That place doesn’t exist.');
  return inWorkspace(scope, async (tx) => {
    await requireApp(tx, scope.workspaceId, 'table_seating');
    await placeFacts(tx, placeId);
    const areas = (
      await tx.execute<{ id: string; name: string; position: number }>(sql`
        select id::text as id, name, position from areas
        where workspace_id = ${scope.workspaceId}::uuid and place_id = ${placeId}::uuid order by position, id
      `)
    ).rows;
    const tables = (
      await tx.execute<{
        id: string;
        label: string;
        area_id: string | null;
        min_capacity: number;
        max_capacity: number;
      }>(sql`
        select id::text as id, label, area_id::text as area_id, min_capacity, max_capacity from resources
        where workspace_id = ${scope.workspaceId}::uuid and place_id = ${placeId}::uuid and kind = 'table'
          and archived_at is null
        order by position, id
      `)
    ).rows;
    return {
      placeId,
      areas: areas.map((row) => ({ id: row.id, name: row.name, position: row.position })),
      resources: tables.map((row) => ({
        id: row.id,
        label: row.label,
        ...(row.area_id === null ? {} : { areaId: row.area_id }),
        minCapacity: row.min_capacity,
        maxCapacity: row.max_capacity,
      })),
    };
  });
}

/**
 * The day's reservations at a place (AC-6560), by time, every status, and the day's covers. Run service. Today's also
 * leads with a party still seated from an earlier day and still holding its table (`seatedTables`), the one way the
 * host can Finish it: a past day reads only.
 */
export async function listServiceDay(
  scope: EngineScope,
  input: { readonly placeId: string; readonly date: string },
  deps: { readonly now?: () => Date } = {},
): Promise<ServiceDay> {
  requirePermission(scope, 'hospitality.service');
  const placeId = checkId(input.placeId, 'That place doesn’t exist.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw inputInvalid('date', 'Pick a day.');
  return inWorkspace(scope, async (tx) => {
    await requireApp(tx, scope.workspaceId, 'table_seating');
    const { zone } = await placeFacts(tx, placeId);
    const from = wallToInstant(input.date, 0, zone);
    const to = wallToInstant(addDays(input.date, 1), 0, zone);
    const now = deps.now?.() ?? new Date();
    const isToday = from.getTime() <= now.getTime() && now.getTime() < to.getTime();
    // Today reaches back as far as a hold still seated can start, so the place and time index still bounds the read.
    const back = isToday ? new Date(from.getTime() - (SEATED_OVERSTAY_HOURS + HOLD_MAX_HOURS) * HOUR) : from;
    const stale = new Date(now.getTime() - SEATED_OVERSTAY_HOURS * HOUR);
    const rows = (
      await tx.execute<{
        id: string;
        starts_at: string;
        ends_at: string;
        client_name: string;
        party_size: number;
        status: AppointmentStatus;
        note: string | null;
        occasion: string | null;
        client_phone: string | null;
        client_email: string | null;
        lookup_code: string;
        seated_at: string | null;
        source: string;
        resource_ids: string[] | null;
      }>(sql`
        select a.id::text, a.starts_at, a.ends_at, a.client_name, a.party_size, a.status, a.note, a.occasion, a.client_phone,
          a.client_email, a.lookup_code, a.seated_at, a.source,
          (select array_agg(distinct h.resource_id::text) from appointment_holds h
            where h.workspace_id = a.workspace_id and h.appointment_id = a.id and h.resource_id is not null) as resource_ids
        from appointments a
        where a.place_id = ${placeId}::uuid and a.starts_at >= ${back.toISOString()}::timestamptz
          and a.starts_at < ${to.toISOString()}::timestamptz and ${TABLE_ONLY}
          and (a.starts_at >= ${from.toISOString()}::timestamptz or (a.status = 'started' and exists (
            select 1 from appointment_holds h
            where h.workspace_id = a.workspace_id and h.appointment_id = a.id and h.live
              and h.resource_id is not null and h.ends_at > ${stale.toISOString()}::timestamptz
          )))
        order by a.starts_at, a.id
        limit ${SERVICE_DAY_CAP + 1}
      `)
    ).rows;
    const truncated = rows.length > SERVICE_DAY_CAP;
    const visits = rows.slice(0, SERVICE_DAY_CAP).map((row): DayVisit => ({
      id: row.id,
      start: new Date(row.starts_at).toISOString(),
      end: new Date(row.ends_at).toISOString(),
      name: row.client_name,
      party: row.party_size,
      status: row.status,
      resourceIds: row.resource_ids ?? [],
      ...(row.note === null ? {} : { note: row.note }),
      ...(row.occasion === null ? {} : { occasion: row.occasion }),
      ...(row.client_phone === null ? {} : { phone: row.client_phone }),
      ...(row.client_email === null ? {} : { email: row.client_email }),
      lookupCode: row.lookup_code,
      ...(row.seated_at === null ? {} : { seatedAt: new Date(row.seated_at).toISOString() }),
      source: row.source,
    }));
    const sum = (statuses: readonly AppointmentStatus[]) =>
      visits.filter((visit) => statuses.includes(visit.status)).reduce((total, visit) => total + visit.party, 0);
    return {
      date: input.date,
      zone,
      visits,
      covers: {
        booked: sum(['booked', 'confirmed', 'arrived', 'started', 'completed']),
        seated: sum(['started']),
        toCome: sum(['booked', 'confirmed', 'arrived']),
      },
      truncated,
    };
  });
}

/** The words when a reservation is seated at a table someone still sits at. */
export const STILL_SEATED = 'Someone is still seated at that table. Finish them first.';

/** The moves a host may make from each status (AC-6561); a move back undoes the last one (Undo, AC-6565). */
const MOVES: Readonly<Record<AppointmentStatus, readonly AppointmentStatus[]>> = {
  booked: ['confirmed', 'arrived', 'started', 'no_show', 'cancelled'],
  confirmed: ['booked', 'arrived', 'started', 'no_show', 'cancelled'],
  arrived: ['booked', 'confirmed', 'started', 'no_show', 'cancelled'],
  started: ['arrived', 'completed'],
  completed: ['started'],
  no_show: ['booked', 'confirmed', 'arrived'],
  cancelled: ['booked', 'confirmed'],
};

/** Whether `status` is one of the visit statuses. */
const isStatus = (value: string): value is AppointmentStatus =>
  (APPOINTMENT_STATUSES as readonly string[]).includes(value);

/** The statuses whose holds are live: a move into one from a freed status holds the table (and staff) again. */
const HOLDING: readonly AppointmentStatus[] = ['booked', 'confirmed', 'arrived', 'started'];

/**
 * Before a freed visit holds again (an Undo of No show or Cancel), under the place lock and every involved person's
 * lock: its staff must still be free (their meetings, time off and blocks, `loadVisitInputs`' busy) and the place's
 * pacing must still take the party. The exclusion constraints guard the tables and staff holds themselves.
 */
async function stillFree(
  tx: WorkspaceTx,
  workspaceId: string,
  appointmentId: string,
  placeId: string,
): Promise<boolean> {
  const [visit] = (
    await tx.execute<{ starts_at: string; ends_at: string; party_size: number }>(sql`
      select starts_at, ends_at, party_size from appointments where id = ${appointmentId}::uuid
    `)
  ).rows;
  if (visit === undefined) return false;
  const items = (
    await tx.execute<{ service_id: string; variant_id: string; staff_id: string | null }>(sql`
      select service_id::text, variant_id::text, staff_id::text from appointment_items
      where appointment_id = ${appointmentId}::uuid order by position
    `)
  ).rows;
  const holds = (
    await tx.execute<{ staff_id: string | null; starts_at: string; ends_at: string }>(sql`
      select staff_id::text, starts_at, ends_at from appointment_holds
      where appointment_id = ${appointmentId}::uuid and staff_id is not null
    `)
  ).rows;
  const start = new Date(visit.starts_at);
  const end = new Date(visit.ends_at);
  const inputs = await loadVisitInputs(tx, {
    workspaceId,
    placeId,
    items: items.map((item) => ({
      serviceId: item.service_id,
      variantId: item.variant_id,
      ...(item.staff_id === null ? {} : { staffId: item.staff_id }),
    })),
    party: visit.party_size,
    from: start,
    to: end,
    except: appointmentId,
  });
  for (const hold of holds) {
    const from = new Date(hold.starts_at).getTime();
    const to = new Date(hold.ends_at).getTime();
    const staff = inputs.staff.find((each) => each.id === hold.staff_id);
    if (staff === undefined) return false;
    if (staff.busy.some((busy) => busy.start < to && from < busy.end)) return false;
  }
  if (inputs.pacing !== undefined) {
    const covers = inputs.pacing.booked.reduce(
      (sum, booked) => (booked.start < end.getTime() && start.getTime() < booked.end ? sum + booked.party : sum),
      0,
    );
    if (covers + visit.party_size > inputs.pacing.coversCap) return false;
  }
  return true;
}

/**
 * Moves a reservation to `status` (AC-6561), under the place lock: Seated starts the table's clock; Finished frees
 * what is left of its hold at once; No show and Cancelled free it; a move back (Undo) holds it again under every
 * involved person's lock too, refused SLOT_TAKEN when the table, a staff member's time or the pacing went meanwhile.
 * Run service reaches table reservations only; any other visit needs `services.calendar` and is NOT_FOUND without it.
 * Refuses CONFLICT for a move the status can't make. Every move (Undo too) writes one audit row.
 */
export async function setVisitStatus(
  scope: EngineScope,
  input: { readonly appointmentId: string; readonly status: string },
  deps: { readonly now?: () => Date; readonly slotCache?: SlotCache } = {},
  hooks: readonly AfterWrite[] = [],
): Promise<{ readonly id: string; readonly status: AppointmentStatus }> {
  const calendar = can(scope.access, 'services.calendar');
  if (!calendar) requirePermission(scope, 'hospitality.service');
  const id = checkId(input.appointmentId, 'That reservation doesn’t exist.');
  if (!isStatus(input.status)) throw inputInvalid('status', 'Pick a status.');
  const status = input.status;
  const now = (deps.now?.() ?? new Date()).toISOString();
  const { result } = await runWrite(
    scope,
    async (context) => {
      const { tx } = context;
      const [found] = (
        await tx.execute<{ place_id: string; table_only: boolean }>(sql`
        select a.place_id::text, ${TABLE_ONLY} as table_only from appointments a where a.id = ${id}::uuid
      `)
      ).rows;
      if (found === undefined || (!found.table_only && !calendar)) {
        throw refuse('NOT_FOUND', 'That reservation doesn’t exist.');
      }
      if (found.table_only) await requireApp(tx, scope.workspaceId, 'table_seating');
      else await requireVisitApp(tx, scope.workspaceId);
      const people = (
        await tx.execute<{ id: string; member_id: string | null }>(sql`
        select distinct s.id::text, s.member_id::text from appointment_holds h
        join staff s on s.workspace_id = h.workspace_id and s.id = h.staff_id
        where h.appointment_id = ${id}::uuid
      `)
      ).rows.map((row) => ({ id: row.id, memberId: row.member_id ?? undefined }));
      await lockVisit(tx, scope.workspaceId, found.place_id, people);
      const [row] = (
        await tx.execute<{ status: AppointmentStatus; place_id: string }>(sql`
        select status, place_id::text from appointments where id = ${id}::uuid for update
      `)
      ).rows;
      if (row === undefined) throw refuse('NOT_FOUND', 'That reservation doesn’t exist.');
      if (row.status === status) return { id, status, placeId: row.place_id };
      if (!MOVES[row.status].includes(status)) throw refuse('CONFLICT', 'That reservation can’t move to that status.');
      const live = status !== 'no_show' && status !== 'cancelled';
      const rehold = live && !HOLDING.includes(row.status) && row.status !== 'completed';
      if (rehold && !(await stillFree(tx, scope.workspaceId, id, row.place_id))) {
        throw refuse('SLOT_TAKEN', 'That time was given to someone else meanwhile.');
      }
      if (status === 'started') {
        // Seating, or the Undo of a Finish: under the place lock, its tables must have nobody seated at them now.
        const seated = await seatedTables(tx, scope.workspaceId, row.place_id, new Date(now), id);
        if (seated.size > 0) {
          const own = (
            await tx.execute<{ resource_id: string }>(sql`
              select resource_id::text as resource_id from appointment_holds
              where appointment_id = ${id}::uuid and resource_id is not null
            `)
          ).rows;
          if (own.some((hold) => seated.has(hold.resource_id))) throw refuse('SLOT_TAKEN', STILL_SEATED);
        }
      }
      try {
        if (status === 'completed') {
          // Finishing frees what is left of the hold at once (a table back online).
          await tx.execute(sql`
          update appointment_holds set during = tstzrange(lower(during), greatest(lower(during) + interval '1 minute', ${now}::timestamptz), '[)')
          where appointment_id = ${id}::uuid and upper(during) > ${now}::timestamptz
        `);
        } else {
          await tx.execute(sql`update appointment_holds set live = ${live} where appointment_id = ${id}::uuid`);
        }
      } catch (error) {
        if (postgresError(error)?.code === '23P01')
          throw refuse('SLOT_TAKEN', 'That table was given to someone else meanwhile.');
        throw error;
      }
      await tx.execute(sql`
      update appointments set status = ${status}, updated_at = now(),
        arrived_at = case when ${status} = 'arrived' then ${now}::timestamptz else arrived_at end,
        seated_at = case when ${status} = 'started' then coalesce(seated_at, ${now}::timestamptz)
          when ${status} in ('booked', 'confirmed', 'arrived') then null else seated_at end,
        finished_at = case when ${status} = 'completed' then ${now}::timestamptz when ${status} = 'started' then null else finished_at end,
        cancelled_at = case when ${status} = 'cancelled' then ${now}::timestamptz when ${live} then null else cancelled_at end
      where id = ${id}::uuid
    `);
      await auditSetup(tx, scope, 'visit.status', { appointmentId: id, from: row.status, to: status });
      context.record({ visits: [row.place_id] });
      return { id, status, placeId: row.place_id };
    },
    hooks,
  );
  deps.slotCache?.purge(result.placeId);
  return { id: result.id, status: result.status };
}

/** The most a VISIT_LIMITS party may be, re-exported for the setup screen's party field. */
export const PARTY_LIMIT = VISIT_LIMITS.partyMax;
