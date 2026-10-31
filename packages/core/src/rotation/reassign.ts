// Reassigning a round robin booking (spec 0029, AC-748, AC-749; spec 0037,
// AC-1337): one seat picked again at the booking's own time, through its
// rotation ("Next in rotation") or to a named member who is free then, the
// other seats kept. Needs Manage over the seat's current host and the new one
// (`canActFor`: owners and admins over everyone, delegates over whom they
// manage, each member over themself). The same core reseats a booking whose host left or was handed on (`reseatGone`).
import { and, eq, sql } from 'drizzle-orm';
import { schema, type WorkspaceTx } from '@crm/db';
import { requirePermission } from '../access/check.ts';
import type { EngineScope } from '../access/mint.ts';
import { inWorkspace } from '../access/run.ts';
import { canActFor, schedulingReach } from '../access/scheduling.ts';
import type { BookingCalendar, BusyReader } from '../booking/calendar.ts';
import { enqueueBookingMail } from '../booking/mail-queue.ts';
import { BUSY_MARGIN_MS, loadPage, type MembersBusy, type PageRecord } from '../booking/slots.ts';
import { actorRow } from '../engine/scope.ts';
import { writeAudit } from '../members/audit.ts';
import { isRefusal, postgresError, refuse } from '../engine/refusals.ts';
import { chooseHosts, lockRotations } from './assign.ts';
import { changedSeats, liveSeats, recordSeats, syncHosts } from './reseat.ts';
import { loadTeam, memberBusy, teamMemberIds } from './team.ts';
import type { AssignmentRow } from './ledger.ts';

const { bookings } = schema;

/** What reseating reads and calls. */
export interface ReseatDeps {
  readonly calendar: Partial<Pick<BookingCalendar, 'events' | 'existing'>> & {
    readonly busy: BusyReader & { readonly fresh?: BusyReader };
  };
  readonly now?: () => Date;
  readonly log?: { warn(message: string, fields: Readonly<Record<string, unknown>>): void };
}

const MISSING = 'That booking doesn’t exist, or isn’t yours.';
const FORBIDDEN_MESSAGE = 'You can only reassign meetings of people whose scheduling you manage.';

type BookingRow = typeof bookings.$inferSelect;

/** The booking, its page and team, and its seats; NOT_FOUND unless it is a confirmed, upcoming round robin booking. */
async function readSeated(tx: WorkspaceTx, bookingId: string, now: Date) {
  const [row] = await tx.select().from(bookings).where(eq(bookings.id, bookingId));
  const page = row === undefined ? undefined : await loadPage(tx, row.pageId);
  if (row === undefined || page === undefined) throw refuse('NOT_FOUND', MISSING);
  if (row.status !== 'confirmed' || row.startsAt.getTime() <= now.getTime()) {
    throw refuse('BOOKING_CLOSED', 'Only an upcoming booking can get a new host.');
  }
  const team = page.kind === 'round_robin' ? await loadTeam(tx, page) : undefined;
  if (team?.kind !== 'round_robin') throw refuse('CONFIG_INVALID', 'Only a round robin booking can be reassigned.');
  return { row, page, team, seats: await liveSeats(tx, row.id) };
}

/** Each member's calendars over the day around the booking, its own time left free. */
async function busyAround(
  deps: ReseatDeps,
  workspaceId: string,
  row: BookingRow,
  memberIds: readonly string[],
): Promise<ReadonlyMap<string, MembersBusy>> {
  const read = deps.calendar.busy.fresh ?? deps.calendar.busy;
  const each = await memberBusy(
    read,
    workspaceId,
    memberIds,
    new Date(row.startsAt.getTime() - 86_400_000 - BUSY_MARGIN_MS),
    new Date(row.startsAt.getTime() + 86_400_000 + BUSY_MARGIN_MS),
  );
  const start = row.startsAt.getTime();
  const end = row.endsAt.getTime();
  return new Map(
    [...each].map(([memberId, busy]) => [
      memberId,
      { ...busy, busy: busy.busy.filter((span) => span.end.getTime() <= start || span.start.getTime() >= end) },
    ]),
  );
}

/**
 * The page as a reseat reads it: a booking that already stands is never too soon or too far ahead, so its notice
 * and window don't apply; its hours, buffers and daily limit still do.
 */
function asStanding(page: PageRecord, row: BookingRow, now: Date): PageRecord {
  const days = Math.ceil((row.startsAt.getTime() - now.getTime()) / 86_400_000) + 1;
  return { ...page, minNoticeMinutes: 0, windowDays: Math.max(page.windowDays, days) };
}

/** What one reseat did: the booking's organiser now, and whether any seat changed. */
export interface Reseated {
  readonly hostMemberId: string;
  readonly changed: boolean;
}

/**
 * Picks the named seats again at the booking's own time, keeping every other seat, under the rotations' locks then
 * every candidate's host lock. Refuses SLOT_TAKEN when nobody allowed is free. Writes the organiser, the hosts, the
 * ledger (each changed seat's old row voided, a new one with `reason` and who did it) and the `reassigned` email;
 * after the commit a new organiser's calendar gets the event.
 */
async function reseat(
  scope: EngineScope,
  deps: ReseatDeps,
  input: {
    readonly bookingId: string;
    readonly rotationIds: readonly string[];
    readonly allow: (rotationId: string, memberId: string) => boolean;
    readonly reason: AssignmentRow['reason'];
    readonly nobody: string;
    readonly check?: (found: { readonly seats: ReadonlyMap<string, { readonly memberId: string }> }) => void;
  },
): Promise<Reseated> {
  const now = deps.now?.() ?? new Date();
  const first = await inWorkspace(scope, (tx) => readSeated(tx, input.bookingId, now));
  input.check?.(first);
  const { team } = first;
  const busy = await busyAround(deps, scope.workspaceId, first.row, teamMemberIds(team));
  const by = actorRow(scope.actor);
  const result = await inWorkspace(scope, async (tx) => {
    await lockRotations(
      tx,
      scope.workspaceId,
      team.rotations.map((rotation) => rotation.rules.id),
    );
    // Read again under the locks: the seats may have changed since.
    // The team too: who is in each rotation and switched on is read under the locks, never before them.
    const { row, page, seats, team: locked } = await readSeated(tx, input.bookingId, now);
    input.check?.({ seats });
    const keep = new Map(
      [...seats].flatMap(([rotationId, seat]) =>
        input.rotationIds.includes(rotationId) ? [] : [[rotationId, seat.memberId] as const],
      ),
    );
    const duration = Math.round((row.endsAt.getTime() - row.startsAt.getTime()) / 60_000);
    let chosen;
    try {
      chosen = await chooseHosts(tx, asStanding(page, row, now), locked, {
        workspaceId: scope.workspaceId,
        start: row.startsAt,
        duration,
        candidates: locked.rotations.map((rotation) => rotation.members.map((member) => member.memberId)),
        busy,
        from: new Date(row.startsAt.getTime() - 86_400_000),
        to: new Date(row.startsAt.getTime() + 86_400_000),
        now,
        keep,
        except: row.id,
        allow: (rotationId, memberId) => !keep.has(rotationId) && input.allow(rotationId, memberId),
      });
    } catch (error) {
      if (isRefusal(error) && error.refusal.code === 'SLOT_TAKEN') throw refuse('SLOT_TAKEN', input.nobody);
      throw error;
    }
    const changes = changedSeats(locked, seats, chosen.picks, input.reason).map((change) => ({
      ...change,
      detail: { ...change.detail, ...(by.memberId === null ? {} : { by: by.memberId }) },
    }));
    if (changes.length === 0) return { hostMemberId: row.hostMemberId, changed: false, old: undefined };
    try {
      await tx
        .update(bookings)
        .set({
          hostMemberId: chosen.organiser,
          updatedByType: by.type,
          updatedById: by.id,
          updatedByMemberId: by.memberId,
        })
        .where(and(eq(bookings.id, row.id), eq(bookings.status, 'confirmed')));
      await syncHosts(tx, row.id, chosen.hosts);
      // "Needs a host" clears only once no host of it has left the workspace (another seat's may still have).
      await tx.execute(sql`
        update bookings b set needs_host_at = null
        where b.id = ${row.id}::uuid and b.needs_host_at is not null
          and not exists (
            select 1 from booking_hosts h
            join members m on m.workspace_id = h.workspace_id and m.id = h.member_id
            -- A guest can't host either (spec 0031 slice 9): they count as gone.
            where h.workspace_id = b.workspace_id and h.booking_id = b.id
              and (m.status <> 'active' or m.role::text = 'guest')
          )
      `);
    } catch (error) {
      if (postgresError(error)?.code === '23P01') throw refuse('SLOT_TAKEN', input.nobody);
      throw error;
    }
    await recordSeats(tx, scope, row.id, changes);
    await writeAudit(tx, scope.workspaceId, scope.actor, {
      action: 'booking.reassigned',
      targetType: 'booking',
      targetId: row.id,
      before: {
        seats: changes.map((change) => ({
          rotationId: change.rotationId,
          memberId: seats.get(change.rotationId)?.memberId,
        })),
      },
      after: {
        seats: changes.map((change) => ({ rotationId: change.rotationId, memberId: change.memberId })),
        reason: input.reason,
      },
    });
    // A new organiser's calendar gets the event in the worker (`host_changed`), never inside this request.
    await enqueueBookingMail(tx, row.id, [
      'reassigned',
      ...(chosen.organiser === row.hostMemberId ? [] : (['host_changed'] as const)),
    ]);
    return { hostMemberId: chosen.organiser, changed: true };
  });
  return { hostMemberId: result.hostMemberId, changed: result.changed };
}

/**
 * Reassigns one seat of an upcoming round robin booking (AC-748, AC-1337): to `memberId` when named (free then,
 * in the rotation, and someone the actor may Manage), else to the next in its rotation among the free members the
 * actor may Manage. `rotationId` names the seat; the first rotation's when left out. The actor needs Manage over
 * the seat's current host; a booking they can't see is NOT_FOUND.
 */
export async function reassignBooking(
  scope: EngineScope,
  deps: ReseatDeps,
  input: { readonly bookingId: string; readonly rotationId?: string; readonly memberId?: string },
): Promise<Reseated> {
  requirePermission(scope, 'booking.manage');
  const now = deps.now?.() ?? new Date();
  const { reach, rotationId, rotationName } = await inWorkspace(scope, async (tx) => {
    const found = await readSeated(tx, input.bookingId, now);
    const reach = await schedulingReach(tx, scope);
    // Seen only by someone who may see one of its hosts' scheduling (their own, a delegation, owners and admins).
    const hosts = [found.row.hostMemberId, ...[...found.seats.values()].map((seat) => seat.memberId)];
    if (!hosts.some((memberId) => canActFor(reach, memberId, 'view'))) throw refuse('NOT_FOUND', MISSING);
    const seat = input.rotationId ?? found.team.rotations[0]?.rules.id;
    const rotation = found.team.rotations.find((each) => each.rules.id === seat);
    if (seat === undefined || rotation === undefined || !found.seats.has(seat)) {
      throw refuse('NOT_FOUND', 'That rotation doesn’t seat anyone on this booking.');
    }
    return { reach, rotationId: seat, rotationName: rotation.rules.name };
  });
  if (input.memberId !== undefined && !canActFor(reach, input.memberId, 'manage')) {
    throw refuse('FORBIDDEN', FORBIDDEN_MESSAGE);
  }
  let current: string | undefined;
  return reseat(scope, deps, {
    bookingId: input.bookingId,
    rotationIds: [rotationId],
    reason: input.memberId === undefined ? 'reassigned' : 'manual',
    nobody:
      input.memberId === undefined
        ? `Nobody else in ${rotationName} is free then.`
        : 'They aren’t free then, or aren’t in this rotation.',
    check: ({ seats }) => {
      current = seats.get(rotationId)?.memberId;
      if (current === undefined) throw refuse('NOT_FOUND', 'That rotation doesn’t seat anyone on this booking.');
      if (!canActFor(reach, current, 'manage')) throw refuse('FORBIDDEN', FORBIDDEN_MESSAGE);
    },
    allow: (_rotationId, memberId) =>
      memberId !== current &&
      canActFor(reach, memberId, 'manage') &&
      (input.memberId === undefined || memberId === input.memberId),
  });
}

/**
 * Reseats every seat of the booking whose holder is no longer an active, switched on member of its rotation (they
 * left the workspace or the rotation, or were switched off and an admin asked to hand their bookings on), through
 * the rotation and never back to them (AC-749, AC-750). System work: no reach check. Answers whether any seat
 * changed and whether a host is still missing (a seat nobody can take, or a fixed host who left).
 */
export async function reseatGone(
  scope: EngineScope,
  deps: ReseatDeps,
  bookingId: string,
): Promise<{ readonly changed: boolean; readonly missing: boolean }> {
  const now = deps.now?.() ?? new Date();
  const plan = await inWorkspace(scope, async (tx) => {
    const { seats, team } = await readSeated(tx, bookingId, now);
    const gone = [...seats].flatMap(([rotationId, seat]) => {
      const rotation = team.rotations.find((each) => each.rules.id === rotationId);
      const stays = rotation?.members.some((member) => member.memberId === seat.memberId) ?? false;
      return stays ? [] : [rotationId];
    });
    const fixedGone = await tx.execute<{ n: number }>(sql`
      select count(*)::int as n from booking_hosts h
      join members m on m.workspace_id = h.workspace_id and m.id = h.member_id
      where h.booking_id = ${bookingId}::uuid and (m.status <> 'active' or m.role::text = 'guest')
        and not exists (
          select 1 from rotation_assignments a
          where a.workspace_id = h.workspace_id and a.booking_id = h.booking_id and a.member_id = h.member_id
            and a.voided_at is null
        )
    `);
    return { gone, seats, fixedGone: (fixedGone.rows[0]?.n ?? 0) > 0 };
  });
  if (plan.gone.length === 0) return { changed: false, missing: plan.fixedGone };
  try {
    const done = await reseat(scope, deps, {
      bookingId,
      rotationIds: plan.gone,
      reason: 'reassigned',
      nobody: 'Nobody else in its rotation is free then.',
      allow: (rotationId, memberId) => memberId !== plan.seats.get(rotationId)?.memberId,
    });
    return { changed: done.changed, missing: plan.fixedGone || !done.changed };
  } catch (error) {
    if (!isRefusal(error)) throw error;
    return { changed: false, missing: true };
  }
}

/**
 * Hands every upcoming booking a rotation seats `memberId` on to the next free member in it (spec 0029, AC-750:
 * "Reassign their N upcoming bookings", offered once they were removed from it or switched off). Reassigning needs
 * Manage over both hosts (spec 0037, AC-1337): over the member, and over every member the rotation could hand to.
 * Each booking is flagged "Needs a host" and queued (`needs_host`) for the worker, which reseats it through the
 * rotation (`reseatGone`) or tells the admins nobody was free; a slow calendar never holds the request. Answers how
 * many it queued. The member must be out of the rotation or switched off, or the worker would seat them again.
 */
export async function reassignUpcoming(
  scope: EngineScope,
  input: { readonly rotationId: string; readonly memberId: string },
  now: Date = new Date(),
): Promise<{ readonly queued: number }> {
  requirePermission(scope, 'booking.manage');
  return inWorkspace(scope, async (tx) => {
    const reach = await schedulingReach(tx, scope);
    if (!canActFor(reach, input.memberId, 'view')) throw refuse('NOT_FOUND', 'That person isn’t in this workspace.');
    const candidates = await tx
      .select({ memberId: schema.rotationRoster.memberId })
      .from(schema.rotationRoster)
      .where(and(eq(schema.rotationRoster.rotationId, input.rotationId), eq(schema.rotationRoster.isOn, true)));
    if (![input.memberId, ...candidates.map((each) => each.memberId)].every((id) => canActFor(reach, id, 'manage'))) {
      throw refuse('FORBIDDEN', FORBIDDEN_MESSAGE);
    }
    const [still] = await tx
      .select({ isOn: schema.rotationRoster.isOn })
      .from(schema.rotationRoster)
      .where(
        and(eq(schema.rotationRoster.rotationId, input.rotationId), eq(schema.rotationRoster.memberId, input.memberId)),
      );
    if (still?.isOn === true) {
      throw refuse('CONFIG_INVALID', 'Switch them off or remove them from the rotation first.');
    }
    const flagged = await tx.execute<{ id: string }>(sql`
      update bookings b set needs_host_at = coalesce(b.needs_host_at, now())
      where b.status = 'confirmed' and b.starts_at > ${now.toISOString()}::timestamptz
        and exists (
          select 1 from rotation_assignments a
          where a.workspace_id = b.workspace_id and a.booking_id = b.id and a.rotation_id = ${input.rotationId}::uuid
            and a.member_id = ${input.memberId}::uuid and a.voided_at is null and a.source = 'booking'
        )
      returning b.id::text as id
    `);
    for (const row of flagged.rows) await enqueueBookingMail(tx, row.id, ['needs_host']);
    return { queued: flagged.rows.length };
  });
}
