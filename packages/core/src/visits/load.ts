// What the planner reads, from the database (spec 0066, B0: `loadVisitInputs`): the place's zone and hours, the
// services asked for and their variants, who can do each and what each needs, the staff at the place with their
// shifts and busy time, the resources with theirs, and the parties booked for pacing. Impure, and read in the
// caller's transaction. A staff member linked to a member is that member (AC-6606): their meetings, time off and
// blocks are read from the meeting engine's own tables (one source), and their calendars through the busy reader,
// outside any transaction and only for linked staff (`calendarBusy`). Unlinked staff use `staff_time_off` and
// `staff_blocks`.
import {
  LIVE_APPOINTMENT_STATUSES,
  type CapacityMode,
  type HoldBySize,
  type PlaceHoursShape,
  type PriceType,
  type ResourceKind,
  type StaffRule,
} from '@crm/contracts';
import { sql } from 'drizzle-orm';
import type { WorkspaceTx } from '@crm/db';
import { blockedTimes } from '../booking/blocks.ts';
import type { BusyReader } from '../booking/calendar.ts';
import { memberBookings, membersBusy } from '../booking/slots.ts';
import { uuidList } from '../engine/ids.ts';
import { refuse } from '../engine/refusals.ts';
import { placeDateOf } from '../hospitality/hours.ts';
import type { BookedParty, Interval, PlannerItem, PlannerResource, PlannerStaff, ResourceNeed } from './planner.ts';

const DAY = 86_400_000;

/** The refusal for a service the place doesn't offer (or that isn't there). */
export const SERVICE_NOT_FOUND = 'That service isn’t offered here.';
/** The refusal for a place that isn't there. */
export const VISIT_PLACE_NOT_FOUND = 'That place doesn’t exist.';
/** The refusal for a professional who doesn't do the service. */
export const STAFF_NOT_FOUND = 'That professional doesn’t do this service here.';

/** One service asked for: the variant, and the professional when the client chose one. */
export interface AskedItem {
  readonly serviceId: string;
  readonly variantId: string;
  readonly staffId?: string | undefined;
}

/** What a visit's items are, as booked: names and prices copied, per staff prices kept. */
export interface ItemFacts {
  readonly serviceId: string;
  readonly variantId: string;
  readonly serviceName: string;
  readonly variantName: string;
  readonly priceMinor: number;
  readonly priceType: PriceType;
  readonly staffPrices: ReadonlyMap<string, number>;
  readonly capacityMode: CapacityMode;
}

/** Everything the planner needs at one place, and the facts a booking copies. */
export interface VisitInputs {
  readonly place: { readonly id: string; readonly zone: string; readonly hours: PlaceHoursShape };
  readonly currency: string;
  readonly items: readonly PlannerItem[];
  readonly facts: readonly ItemFacts[];
  readonly staff: readonly PlannerStaff[];
  /** Each staff member's linked member, when linked. */
  readonly links: ReadonlyMap<string, string>;
  readonly resources: readonly PlannerResource[];
  readonly pacing?: { readonly coversCap: number; readonly booked: readonly BookedParty[] } | undefined;
  /** The services' booking rules: the finest step, the most notice, the shortest window. */
  readonly rules: { readonly stepMinutes: number; readonly noticeMinutes: number; readonly windowDays: number };
  /** Whether any service is bookable online (a guest's plan refuses one that isn't). */
  readonly online: boolean;
}

const LIVE = sql.raw(`(${LIVE_APPOINTMENT_STATUSES.map((status) => `'${status}'`).join(', ')})`);

const span = (start: string | Date, end: string | Date): Interval => ({
  start: new Date(start).getTime(),
  end: new Date(end).getTime(),
});

/**
 * The planner's inputs for `asked` at `placeId` over [from, to) (busy read a day either side), in the caller's
 * transaction. Refuses NOT_FOUND for a place, service, variant or professional that isn't there or isn't offered.
 * `except` leaves one visit's own holds out (a move).
 */
export async function loadVisitInputs(
  tx: WorkspaceTx,
  input: {
    readonly workspaceId: string;
    readonly placeId: string;
    readonly items: readonly AskedItem[];
    readonly party: number;
    readonly from: Date;
    readonly to: Date;
    readonly except?: string | undefined;
  },
): Promise<VisitInputs> {
  const { workspaceId, placeId } = input;
  const busyFrom = new Date(input.from.getTime() - DAY);
  const busyTo = new Date(input.to.getTime() + DAY);
  const [place] = (
    await tx.execute<{ id: string; time_zone: string; hours: PlaceHoursShape; currency: string | null }>(sql`
      select p.id::text as id, p.time_zone, p.hours, w.currency
      from places p join workspaces w on w.id = p.workspace_id
      where p.workspace_id = ${workspaceId}::uuid and p.id = ${placeId}::uuid
    `)
  ).rows;
  if (place === undefined) throw refuse('NOT_FOUND', VISIT_PLACE_NOT_FOUND);

  const serviceIds = [...new Set(input.items.map((item) => item.serviceId))];
  const variantIds = [...new Set(input.items.map((item) => item.variantId))];
  const variants = (
    await tx.execute<{
      service_id: string;
      variant_id: string;
      service_name: string;
      variant_name: string;
      minutes: number;
      price_minor: string | number;
      price_type: PriceType;
      buffer_before_min: number;
      processing_after_min: number | null;
      processing_min: number | null;
      buffer_after_min: number;
      capacity_mode: CapacityMode;
      staff_rule: StaffRule;
      hold_by_size: HoldBySize[];
      online: boolean;
      step_min: number;
      notice_min: number;
      window_days: number;
      covers_cap: number | null;
    }>(sql`
      select s.id::text as service_id, v.id::text as variant_id, s.name as service_name, v.name as variant_name,
        v.minutes, v.price_minor, v.price_type, v.buffer_before_min, v.processing_after_min, v.processing_min,
        s.buffer_after_min, s.capacity_mode, s.staff_rule, s.hold_by_size, s.online, s.step_min, s.notice_min,
        s.window_days, s.covers_cap
      from services s
      join service_variants v on v.workspace_id = s.workspace_id and v.service_id = s.id and v.archived_at is null
      join service_places sp on sp.workspace_id = s.workspace_id and sp.service_id = s.id and sp.place_id = ${placeId}::uuid
      where s.workspace_id = ${workspaceId}::uuid and s.archived_at is null
        and s.id = any(${uuidList(serviceIds)}) and v.id = any(${uuidList(variantIds)})
    `)
  ).rows;
  const variantOf = (item: AskedItem) =>
    variants.find((row) => row.service_id === item.serviceId && row.variant_id === item.variantId);
  if (!input.items.every((item) => variantOf(item) !== undefined)) throw refuse('NOT_FOUND', SERVICE_NOT_FOUND);

  // The staff at the place, in the business's order, and who does which service.
  const staffRows = (
    await tx.execute<{
      id: string;
      member_id: string | null;
      position: number;
      shifts: PlaceHoursShape;
      outside_hours: boolean;
    }>(sql`
      select st.id::text as id, st.member_id::text as member_id, st.position, sp.shifts, sp.outside_hours
      from staff st
      join staff_places sp on sp.workspace_id = st.workspace_id and sp.staff_id = st.id and sp.place_id = ${placeId}::uuid
      where st.workspace_id = ${workspaceId}::uuid and st.archived_at is null
      order by st.position, st.id
    `)
  ).rows;
  const chosenFor = (
    await tx.execute<{ service_id: string; staff_id: string }>(sql`
      select service_id::text as service_id, staff_id::text as staff_id from service_staff
      where workspace_id = ${workspaceId}::uuid and service_id = any(${uuidList(serviceIds)})
    `)
  ).rows;
  const overrides = (
    await tx.execute<{
      variant_id: string;
      staff_id: string;
      minutes: number | null;
      price_minor: string | number | null;
    }>(sql`
      select variant_id::text as variant_id, staff_id::text as staff_id, minutes, price_minor from service_variant_staff
      where workspace_id = ${workspaceId}::uuid and variant_id = any(${uuidList(variantIds)})
    `)
  ).rows;
  const needs = (
    await tx.execute<{ service_id: string; kind: ResourceKind | null; count: number; resource_id: string | null }>(sql`
      select service_id::text as service_id, kind, count, resource_id::text as resource_id from service_resources
      where workspace_id = ${workspaceId}::uuid and service_id = any(${uuidList(serviceIds)})
      order by id
    `)
  ).rows;
  const atPlace = new Set(staffRows.map((row) => row.id));

  const items: PlannerItem[] = [];
  const facts: ItemFacts[] = [];
  for (const asked of input.items) {
    const row = variantOf(asked);
    if (row === undefined) throw refuse('NOT_FOUND', SERVICE_NOT_FOUND);
    const qualified =
      row.staff_rule === 'none'
        ? []
        : row.staff_rule === 'all'
          ? staffRows.map((each) => each.id)
          : chosenFor
              .filter((each) => each.service_id === row.service_id && atPlace.has(each.staff_id))
              .map((each) => each.staff_id);
    if (asked.staffId !== undefined && (row.staff_rule === 'none' || !qualified.includes(asked.staffId))) {
      throw refuse('NOT_FOUND', STAFF_NOT_FOUND);
    }
    const own = overrides.filter((each) => each.variant_id === row.variant_id);
    const staffMinutes = new Map(
      own.flatMap((each) => (each.minutes === null ? [] : [[each.staff_id, each.minutes] as const])),
    );
    items.push({
      minutes: row.minutes,
      bufferBefore: row.buffer_before_min,
      bufferAfter: row.buffer_after_min,
      ...(row.processing_min === null || row.processing_after_min === null
        ? {}
        : { processing: { after: row.processing_after_min, minutes: row.processing_min } }),
      staff:
        row.staff_rule === 'none'
          ? 'none'
          : { qualified, ...(asked.staffId === undefined ? {} : { chosen: asked.staffId }) },
      ...(staffMinutes.size === 0 ? {} : { staffMinutes }),
      needs: needs
        .filter((need) => need.service_id === row.service_id)
        .map((need): ResourceNeed =>
          need.resource_id !== null
            ? { resourceId: need.resource_id }
            : { kind: need.kind ?? 'other', count: need.count },
        ),
      capacityMode: row.capacity_mode,
      holdBySize: row.hold_by_size,
    });
    facts.push({
      serviceId: row.service_id,
      variantId: row.variant_id,
      serviceName: row.service_name,
      variantName: row.variant_name,
      priceMinor: Number(row.price_minor),
      priceType: row.price_type,
      staffPrices: new Map(
        own.flatMap((each) => (each.price_minor === null ? [] : [[each.staff_id, Number(each.price_minor)] as const])),
      ),
      capacityMode: row.capacity_mode,
    });
  }

  // Only the staff some item may use, and the resources some need may.
  const wantedStaff = staffRows.filter((row) =>
    items.some((item) => item.staff !== 'none' && item.staff.qualified.includes(row.id)),
  );
  const kinds = [...new Set(needs.flatMap((need) => (need.kind === null ? [] : [need.kind])))];
  const named = needs.flatMap((need) => (need.resource_id === null ? [] : [need.resource_id]));
  const resourceRows =
    kinds.length === 0 && named.length === 0
      ? []
      : (
          await tx.execute<{
            id: string;
            kind: ResourceKind;
            min_capacity: number;
            max_capacity: number;
            joins: string[];
            position: number;
            online: boolean;
          }>(sql`
            select id::text as id, kind, min_capacity, max_capacity, joins::text[] as joins, position, online
            from resources
            where workspace_id = ${workspaceId}::uuid and place_id = ${placeId}::uuid and archived_at is null
              and (kind = any(${`{${kinds.join(',')}}`}::text[]) or id = any(${uuidList(named)}))
            order by position, id
          `)
        ).rows;

  // Live holds touching the range, of the staff and resources read.
  const staffIds = wantedStaff.map((row) => row.id);
  const resourceIds = resourceRows.map((row) => row.id);
  const except = input.except === undefined ? sql`true` : sql`h.appointment_id <> ${input.except}::uuid`;
  const holds =
    staffIds.length === 0 && resourceIds.length === 0
      ? []
      : (
          await tx.execute<{
            staff_id: string | null;
            resource_id: string | null;
            starts_at: string;
            ends_at: string;
          }>(sql`
            select h.staff_id::text as staff_id, h.resource_id::text as resource_id, h.starts_at, h.ends_at
            from appointment_holds h
            where h.workspace_id = ${workspaceId}::uuid and h.live and ${except}
              and (h.staff_id = any(${uuidList(staffIds)}) or h.resource_id = any(${uuidList(resourceIds)}))
              and h.starts_at < ${busyTo.toISOString()}::timestamptz and h.ends_at > ${busyFrom.toISOString()}::timestamptz
          `)
        ).rows;
  // Each staff member's booked minutes per place date (any staff fairness): their live items.
  const booked =
    staffIds.length === 0
      ? []
      : (
          await tx.execute<{ staff_id: string; starts_at: string; ends_at: string }>(sql`
            select i.staff_id::text as staff_id, i.starts_at, i.ends_at
            from appointment_items i
            join appointments a on a.workspace_id = i.workspace_id and a.id = i.appointment_id
            where i.workspace_id = ${workspaceId}::uuid and i.staff_id = any(${uuidList(staffIds)})
              and a.status in ${LIVE}
              and i.starts_at < ${busyTo.toISOString()}::timestamptz and i.ends_at > ${busyFrom.toISOString()}::timestamptz
          `)
        ).rows;

  // The person's other engine: a linked member's meetings, time off and blocks; an unlinked staff member's own.
  const links = new Map(
    wantedStaff.flatMap((row) => (row.member_id === null ? [] : [[row.id, row.member_id] as const])),
  );
  const memberIds = [...links.values()];
  const meetings = await memberBookings(tx, memberIds, '', busyFrom, busyTo);
  const closed = await blockedTimes(tx, memberIds, busyFrom, busyTo, { id: '', isPrivate: false });
  const unlinked = staffIds.filter((id) => !links.has(id));
  const away =
    unlinked.length === 0
      ? []
      : (
          await tx.execute<{ staff_id: string; starts_at: string; ends_at: string }>(sql`
            select staff_id::text as staff_id, starts_at, ends_at from staff_time_off
            where workspace_id = ${workspaceId}::uuid and staff_id = any(${uuidList(unlinked)})
              and (place_id is null or place_id = ${placeId}::uuid)
              and starts_at < ${busyTo.toISOString()}::timestamptz and ends_at > ${busyFrom.toISOString()}::timestamptz
            union all
            select staff_id::text, starts_at, ends_at from staff_blocks
            where workspace_id = ${workspaceId}::uuid and staff_id = any(${uuidList(unlinked)}) and place_id = ${placeId}::uuid
              and starts_at < ${busyTo.toISOString()}::timestamptz and ends_at > ${busyFrom.toISOString()}::timestamptz
          `)
        ).rows;

  const staff: PlannerStaff[] = wantedStaff.map((row) => {
    const memberId = links.get(row.id);
    const busy: Interval[] = [
      ...holds.filter((hold) => hold.staff_id === row.id).map((hold) => span(hold.starts_at, hold.ends_at)),
      ...away.filter((each) => each.staff_id === row.id).map((each) => span(each.starts_at, each.ends_at)),
    ];
    if (memberId !== undefined) {
      for (const meeting of meetings.get(memberId) ?? []) {
        busy.push(span(meeting.blockStart ?? meeting.start, meeting.blockEnd ?? meeting.end));
      }
      for (const each of closed.get(memberId)?.busy ?? []) busy.push(span(each.start, each.end));
    }
    const minutes = new Map<string, number>();
    for (const item of booked.filter((each) => each.staff_id === row.id)) {
      const date = placeDateOf(new Date(item.starts_at).getTime(), place.time_zone);
      const length = (new Date(item.ends_at).getTime() - new Date(item.starts_at).getTime()) / 60_000;
      minutes.set(date, (minutes.get(date) ?? 0) + length);
    }
    return {
      id: row.id,
      order: row.position,
      shifts: row.shifts,
      outsideHours: row.outside_hours,
      busy,
      bookedMinutes: minutes,
    };
  });
  const resources: PlannerResource[] = resourceRows.map((row) => ({
    id: row.id,
    kind: row.kind,
    minCapacity: row.min_capacity,
    maxCapacity: row.max_capacity,
    joins: row.joins,
    order: row.position,
    online: row.online,
    busy: holds.filter((hold) => hold.resource_id === row.id).map((hold) => span(hold.starts_at, hold.ends_at)),
  }));

  // Pacing: the smallest covers cap among the services, and the live parties of those services at the place.
  const caps = variants.flatMap((row) => (row.covers_cap === null ? [] : [row.covers_cap]));
  const paced = [...new Set(variants.filter((row) => row.covers_cap !== null).map((row) => row.service_id))];
  const pacing =
    caps.length === 0
      ? undefined
      : {
          coversCap: Math.min(...caps),
          booked: (
            await tx.execute<{ starts_at: string; ends_at: string; party_size: number }>(sql`
              select a.starts_at, a.ends_at, a.party_size from appointments a
              where a.workspace_id = ${workspaceId}::uuid and a.place_id = ${placeId}::uuid and a.status in ${LIVE}
                and ${input.except === undefined ? sql`true` : sql`a.id <> ${input.except}::uuid`}
                and a.starts_at < ${busyTo.toISOString()}::timestamptz and a.ends_at > ${busyFrom.toISOString()}::timestamptz
                and exists (
                  select 1 from appointment_items i
                  where i.workspace_id = a.workspace_id and i.appointment_id = a.id and i.service_id = any(${uuidList(paced)})
                )
            `)
          ).rows.map((row) => ({ ...span(row.starts_at, row.ends_at), party: row.party_size })),
        };

  return {
    place: { id: place.id, zone: place.time_zone, hours: place.hours },
    currency: place.currency ?? 'USD',
    items,
    facts,
    staff,
    links,
    resources,
    pacing,
    rules: {
      stepMinutes: Math.min(...variants.map((row) => row.step_min)),
      noticeMinutes: Math.max(...variants.map((row) => row.notice_min)),
      windowDays: Math.min(...variants.map((row) => row.window_days)),
    },
    online: input.items.every((item) => variantOf(item)?.online === true),
  };
}

/**
 * The linked staff's calendar busy over [from, to), through `reader` (a `createBusyCache` for a slot read, the fresh
 * reader at booking), outside any transaction. A calendar that refuses us until reconnected closes that person's
 * whole range (fail closed), as booking pages do.
 */
export async function calendarBusy(
  reader: BusyReader,
  workspaceId: string,
  links: ReadonlyMap<string, string>,
  from: Date,
  to: Date,
): Promise<ReadonlyMap<string, readonly Interval[]>> {
  const out = new Map<string, readonly Interval[]>();
  await Promise.all(
    [...links].map(async ([staffId, memberId]) => {
      const answer = await membersBusy(reader, workspaceId, [memberId], from, to);
      out.set(
        staffId,
        answer.blocked
          ? [{ start: from.getTime() - DAY, end: to.getTime() + DAY }]
          : answer.busy.map((each) => span(each.start, each.end)),
      );
    }),
  );
  return out;
}

/** The inputs with each linked staff member's calendar busy added. */
export function withCalendarBusy(inputs: VisitInputs, busy: ReadonlyMap<string, readonly Interval[]>): VisitInputs {
  if (busy.size === 0) return inputs;
  return {
    ...inputs,
    staff: inputs.staff.map((member) => {
      const more = busy.get(member.id);
      return more === undefined ? member : { ...member, busy: [...member.busy, ...more] };
    }),
  };
}
