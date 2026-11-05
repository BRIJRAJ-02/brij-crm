// Changing and cancelling a booked visit (spec 0066, AC-6622; 0065 AC-6555): a new time or party size re-plans the
// visit under the place lock and every involved person's lock, its own holds left out (`except`), and swaps its items
// and holds in one transaction; the exclusion constraints stay the last guard (a `23P01` is SLOT_TAKEN with the next
// free times). Cancelling frees its holds. The guest's door (`public.ts`) and the desk both come through here; the
// permission and the cutoffs are their callers'.
import { VISIT_LIMITS, type AppointmentStatus } from '@crm/contracts';
import { sql } from 'drizzle-orm';
import type { EngineScope } from '../access/mint.ts';
import { inWorkspace } from '../access/run.ts';
import { inputInvalid, isRefusal, postgresError, refuse } from '../engine/refusals.ts';
import { runWrite, type AfterWrite } from '../engine/write.ts';
import { auditSetup } from '../hospitality/gate.ts';
import { addDays, placeDateOf, wallToInstant } from '../hospitality/hours.ts';
import { VISIT_TAKEN_MESSAGE, type SlotCache, type VisitDeps, type VisitTakenError } from './book.ts';
import { calendarBusy, loadVisitInputs, withCalendarBusy, type AskedItem, type VisitInputs } from './load.ts';
import { lockVisit, type LockedStaff } from './locks.ts';
import { queueVisitMail } from './mail.ts';
import { planVisit, type PlanInput } from './planner.ts';

const DAY = 86_400_000;

/** The statuses a guest or the desk may still change or cancel. */
const OPEN: readonly AppointmentStatus[] = ['booked', 'confirmed'];

/** A visit as a change reads it. */
interface VisitRow extends Record<string, unknown> {
  readonly id: string;
  readonly place_id: string;
  readonly status: AppointmentStatus;
  readonly starts_at: string;
  readonly party_size: number;
}

async function visitOf(scope: EngineScope, appointmentId: string) {
  return inWorkspace(scope, async (tx) => {
    const [row] = (
      await tx.execute<VisitRow>(sql`
        select id::text, place_id::text, status, starts_at, party_size from appointments where id = ${appointmentId}::uuid
      `)
    ).rows;
    if (row === undefined) throw refuse('NOT_FOUND', 'That reservation doesn’t exist.');
    const items = (
      await tx.execute<{ service_id: string; variant_id: string }>(sql`
        select service_id::text, variant_id::text from appointment_items
        where appointment_id = ${appointmentId}::uuid order by position
      `)
    ).rows.map((item): AskedItem => ({ serviceId: item.service_id, variantId: item.variant_id }));
    return { row, items };
  });
}

function planInput(
  inputs: VisitInputs,
  options: {
    readonly party: number;
    readonly now: Date;
    readonly from: Date;
    readonly to: Date;
    readonly online: boolean;
  },
): PlanInput {
  return {
    zone: inputs.place.zone,
    hours: inputs.place.hours,
    staff: inputs.staff,
    resources: inputs.resources,
    items: inputs.items,
    party: options.party,
    now: options.now,
    from: options.from,
    to: options.to,
    noticeMinutes: options.online ? inputs.rules.noticeMinutes : 0,
    ...(options.online ? { windowDays: inputs.rules.windowDays } : {}),
    stepMinutes: inputs.rules.stepMinutes,
    pacing: inputs.pacing,
    onlineOnly: options.online,
  };
}

/** SLOT_TAKEN with the next free starts on the asked day (up to 3), read fresh. */
async function takenWithNext(
  scope: EngineScope,
  deps: VisitDeps,
  input: {
    readonly placeId: string;
    readonly items: readonly AskedItem[];
    readonly party: number;
    readonly except: string;
  },
  start: Date,
  zone: string,
  online: boolean,
): Promise<VisitTakenError> {
  deps.slotCache?.purge(input.placeId);
  const date = placeDateOf(start.getTime(), zone);
  const from = wallToInstant(date, 0, zone);
  const to = wallToInstant(addDays(date, 1), 0, zone);
  const now = deps.now?.() ?? new Date();
  const next = await inWorkspace(scope, (tx) =>
    loadVisitInputs(tx, { workspaceId: scope.workspaceId, ...input, from, to }),
  )
    .then((inputs) =>
      planVisit(planInput(inputs, { party: input.party, now, from, to, online }))
        .starts.filter((each) => each.start.getTime() > start.getTime())
        .slice(0, 3)
        .map((each) => each.start.toISOString()),
    )
    .catch(() => []);
  return Object.assign(refuse('SLOT_TAKEN', VISIT_TAKEN_MESSAGE), { next });
}

/** A guest's cutoff: how long before the visit changes close, and the refusal's words. */
export interface Cutoff {
  readonly minutes: number;
  readonly message: string;
}

/** Refuses BOOKING_CLOSED when the locked visit's start is within the cutoff of now. */
function checkLockedCutoff(cutoff: Cutoff | undefined, startsAt: string, now: Date): void {
  if (cutoff === undefined) return;
  if (new Date(startsAt).getTime() - cutoff.minutes * 60_000 <= now.getTime()) {
    throw refuse('BOOKING_CLOSED', cutoff.message);
  }
}

/** A changed visit: its new start and end, and its party. */
export interface MovedVisit {
  readonly appointmentId: string;
  readonly start: string;
  readonly end: string;
  readonly party: number;
}

/**
 * Moves a booked or confirmed visit to `start` with `party` (unchanged when absent). `online` applies the guest's
 * notice, window and online party range. Refuses CONFLICT for a visit past changing (seated, finished, cancelled),
 * SLOT_TAKEN with `next` when the new time doesn't hold. No permission check: the callers check theirs.
 */
export async function moveVisit(
  scope: EngineScope,
  deps: VisitDeps & { readonly slotCache?: SlotCache },
  input: {
    readonly appointmentId: string;
    readonly start: string;
    readonly party?: number;
    readonly online: boolean;
    /** A guest's change cutoff: refused BOOKING_CLOSED with `message` once the locked visit starts within `minutes`. */
    readonly cutoff?: Cutoff | undefined;
  },
  hooks: readonly AfterWrite[] = [],
): Promise<MovedVisit> {
  const start = new Date(input.start);
  if (Number.isNaN(start.getTime())) throw inputInvalid('start', 'Pick a time.');
  const { row, items } = await visitOf(scope, input.appointmentId);
  if (!OPEN.includes(row.status)) throw refuse('CONFLICT', 'This reservation can’t be changed any more.');
  const party = input.party ?? row.party_size;
  if (!Number.isInteger(party) || party < VISIT_LIMITS.partyMin || party > VISIT_LIMITS.partyMax) {
    throw inputInvalid('party', 'Choose a party of 1 to 100.');
  }
  const now = deps.now?.() ?? new Date();
  const from = new Date(start.getTime() - DAY);
  const to = new Date(start.getTime() + DAY);
  const asked = { placeId: row.place_id, items, party, except: row.id };
  const first = await inWorkspace(scope, (tx) =>
    loadVisitInputs(tx, { workspaceId: scope.workspaceId, ...asked, from, to }),
  );
  if (input.online && (party < first.rules.partyMin || party > first.rules.partyMax)) {
    throw inputInvalid(
      'party',
      `Online, we take parties of ${String(first.rules.partyMin)} to ${String(first.rules.partyMax)}. Call us for a larger one.`,
    );
  }
  const calendars = await calendarBusy(
    deps.busy.fresh ?? deps.busy,
    scope.workspaceId,
    first.links,
    new Date(from.getTime() - DAY),
    new Date(to.getTime() + DAY),
  );
  const options = { party, now, from, to, online: input.online };
  const before = planVisit({ ...planInput(withCalendarBusy(first, calendars), options), at: start }).starts[0];
  if (before === undefined) throw await takenWithNext(scope, deps, asked, start, first.place.zone, input.online);
  try {
    const { result } = await runWrite(
      scope,
      async (context) => {
        const { tx } = context;
        const old = (
          await tx.execute<{ id: string; member_id: string | null }>(sql`
          select distinct s.id::text, s.member_id::text from appointment_holds h
          join staff s on s.workspace_id = h.workspace_id and s.id = h.staff_id
          where h.appointment_id = ${row.id}::uuid
        `)
        ).rows.map((each): LockedStaff => ({ id: each.id, memberId: each.member_id ?? undefined }));
        const fresh = before.items.flatMap((item) =>
          item.staffId === undefined ? [] : [{ id: item.staffId, memberId: first.links.get(item.staffId) }],
        );
        await lockVisit(tx, scope.workspaceId, row.place_id, [...old, ...fresh]);
        const [locked] = (
          await tx.execute<{ status: AppointmentStatus; starts_at: string }>(
            sql`select status, starts_at from appointments where id = ${row.id}::uuid for update`,
          )
        ).rows;
        if (locked === undefined || !OPEN.includes(locked.status)) {
          throw refuse('CONFLICT', 'This reservation can’t be changed any more.');
        }
        checkLockedCutoff(input.cutoff, locked.starts_at, now);
        const again = await loadVisitInputs(tx, { workspaceId: scope.workspaceId, ...asked, from, to });
        const plan = planVisit({
          ...planInput(withCalendarBusy(again, calendars), options),
          at: start,
          narrow: before.items.map((item) => ({ staffId: item.staffId, resourceIds: item.resourceIds })),
        }).starts[0];
        if (plan === undefined) throw refuse('SLOT_TAKEN', VISIT_TAKEN_MESSAGE);
        const itemRows = (
          await tx.execute<{ id: string; position: number }>(sql`
          select id::text, position from appointment_items where appointment_id = ${row.id}::uuid order by position
        `)
        ).rows;
        await tx.execute(sql`delete from appointment_holds where appointment_id = ${row.id}::uuid`);
        for (const [index, item] of plan.items.entries()) {
          const itemRow = itemRows[index];
          if (itemRow === undefined) continue;
          await tx.execute(sql`
          update appointment_items set starts_at = ${item.start.toISOString()}::timestamptz,
            ends_at = ${item.end.toISOString()}::timestamptz, staff_id = ${item.staffId ?? null}
          where id = ${itemRow.id}::uuid
        `);
        }
        for (const hold of plan.holds) {
          const itemId = itemRows[hold.item]?.id;
          if (itemId === undefined) continue;
          await tx.execute(sql`
          insert into appointment_holds (workspace_id, appointment_id, item_id, place_id, staff_id, resource_id, during)
          values (${scope.workspaceId}::uuid, ${row.id}::uuid, ${itemId}::uuid, ${row.place_id}::uuid,
            ${hold.staffId ?? null}, ${hold.resourceId ?? null},
            tstzrange(${hold.start.toISOString()}::timestamptz, ${hold.end.toISOString()}::timestamptz, '[)'))
        `);
        }
        await tx.execute(sql`
        update appointments set starts_at = ${plan.start.toISOString()}::timestamptz,
          ends_at = ${plan.end.toISOString()}::timestamptz, party_size = ${party}, updated_at = now()
        where id = ${row.id}::uuid
      `);
        await auditSetup(tx, scope, 'visit.moved', { appointmentId: row.id, placeId: row.place_id });
        context.record({ visits: [row.place_id] });
        // The guest hears of it, and the reminders move with it (replaced, so the old ones never fire).
        await queueVisitMail(tx, row.id, ['changed', 'reminder_24h', 'reminder_2h']);
        return {
          appointmentId: row.id,
          start: plan.start.toISOString(),
          end: plan.end.toISOString(),
          party,
        } satisfies MovedVisit;
      },
      hooks,
    );
    deps.slotCache?.purge(row.place_id);
    return result;
  } catch (error) {
    const taken = (isRefusal(error) && error.refusal.code === 'SLOT_TAKEN') || postgresError(error)?.code === '23P01';
    if (taken) throw await takenWithNext(scope, deps, asked, start, first.place.zone, input.online);
    throw error;
  }
}

/**
 * Cancels a booked or confirmed visit, freeing its holds at once. A repeat answers the cancelled visit. Refuses
 * CONFLICT for one already seated or finished. No permission check: the callers check theirs.
 */
export async function cancelVisit(
  scope: EngineScope,
  deps: { readonly now?: () => Date; readonly slotCache?: SlotCache },
  input: {
    readonly appointmentId: string;
    readonly reason?: string | undefined;
    /** A guest's cancel cutoff, checked against the locked visit (see `moveVisit`). */
    readonly cutoff?: Cutoff | undefined;
  },
  hooks: readonly AfterWrite[] = [],
): Promise<{ readonly appointmentId: string; readonly cancelled: boolean }> {
  const reason = input.reason?.trim();
  if (reason !== undefined && reason.length > VISIT_LIMITS.cancelReasonMax) {
    throw inputInvalid('reason', 'Use 200 characters or fewer.');
  }
  const at = deps.now?.() ?? new Date();
  const now = at.toISOString();
  const { result } = await runWrite(
    scope,
    async (context) => {
      const { tx } = context;
      const [found] = (
        await tx.execute<{ place_id: string }>(
          sql`select place_id::text from appointments where id = ${input.appointmentId}::uuid`,
        )
      ).rows;
      if (found === undefined) throw refuse('NOT_FOUND', 'That reservation doesn’t exist.');
      await lockVisit(tx, scope.workspaceId, found.place_id, []);
      const [row] = (
        await tx.execute<{ status: AppointmentStatus; starts_at: string }>(
          sql`select status, starts_at from appointments where id = ${input.appointmentId}::uuid for update`,
        )
      ).rows;
      if (row === undefined) throw refuse('NOT_FOUND', 'That reservation doesn’t exist.');
      if (row.status === 'cancelled')
        return { appointmentId: input.appointmentId, cancelled: false, placeId: found.place_id };
      checkLockedCutoff(input.cutoff, row.starts_at, at);
      if (!OPEN.includes(row.status) && row.status !== 'arrived') {
        throw refuse('CONFLICT', 'This reservation can’t be cancelled any more.');
      }
      await tx.execute(
        sql`update appointment_holds set live = false where appointment_id = ${input.appointmentId}::uuid`,
      );
      await tx.execute(sql`
      update appointments set status = 'cancelled', cancelled_at = ${now}::timestamptz, cancel_reason = ${reason ?? null},
        updated_at = now()
      where id = ${input.appointmentId}::uuid
    `);
      await auditSetup(tx, scope, 'visit.status', {
        appointmentId: input.appointmentId,
        from: row.status,
        to: 'cancelled',
      });
      context.record({ visits: [found.place_id] });
      await queueVisitMail(tx, input.appointmentId, ['cancelled']);
      return { appointmentId: input.appointmentId, cancelled: true, placeId: found.place_id };
    },
    hooks,
  );
  deps.slotCache?.purge(result.placeId);
  return { appointmentId: result.appointmentId, cancelled: result.cancelled };
}
