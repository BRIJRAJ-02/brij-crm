// Reassigning a round robin booking (spec 0029, AC-748, AC-749; spec 0037,
// AC-1337): one seat picked again at the booking's own time, through its
// rotation ("Next in rotation") or to a named member who is free then, the
// other seats kept. Needs Manage over the seat's current host and the new one
// (`canActFor`, today `booking.admin` over everyone and each member over
// themself). The same core reseats a leaving member's bookings (`reseatFor`).
import { and, eq, sql } from 'drizzle-orm';
import { schema, type WorkspaceTx } from '@crm/db';
import { requirePermission } from '../access/check.ts';
import type { EngineScope } from '../access/mint.ts';
import { can } from '../access/policy.ts';
import { inWorkspace } from '../access/run.ts';
import { canActFor, schedulingReach } from '../access/scheduling.ts';
import type { BookingCalendar, BusyReader, EventRef } from '../booking/calendar.ts';
import { enqueueBookingMail } from '../booking/mail-queue.ts';
import { BUSY_MARGIN_MS, loadPage, type MembersBusy, type PageRecord } from '../booking/slots.ts';
import { actorRow } from '../engine/scope.ts';
import { isRefusal, postgresError, refuse } from '../engine/refusals.ts';
import { chooseHosts, lockRotations } from './assign.ts';
import { changedSeats, liveSeats, recordSeats, remakeEvent, syncHosts } from './reseat.ts';
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
    const { row, page, seats } = await readSeated(tx, input.bookingId, now);
    input.check?.({ seats });
    const keep = new Map(
      [...seats].flatMap(([rotationId, seat]) =>
        input.rotationIds.includes(rotationId) ? [] : [[rotationId, seat.memberId] as const],
      ),
    );
    const duration = Math.round((row.endsAt.getTime() - row.startsAt.getTime()) / 60_000);
    let chosen;
    try {
      chosen = await chooseHosts(tx, asStanding(page, row, now), team, {
        workspaceId: scope.workspaceId,
        start: row.startsAt,
        duration,
        candidates: team.rotations.map((rotation) => rotation.members.map((member) => member.memberId)),
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
    const changes = changedSeats(team, seats, chosen.picks, input.reason).map((change) => ({
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
          needsHostAt: null,
        })
        .where(and(eq(bookings.id, row.id), eq(bookings.status, 'confirmed')));
      await syncHosts(tx, row.id, chosen.hosts);
    } catch (error) {
      if (postgresError(error)?.code === '23P01') throw refuse('SLOT_TAKEN', input.nobody);
      throw error;
    }
    await recordSeats(tx, scope, row.id, changes);
    await enqueueBookingMail(tx, row.id, ['reassigned']);
    const old: EventRef | undefined =
      chosen.organiser !== row.hostMemberId && row.meetingId !== null
        ? { workspaceId: scope.workspaceId, meetingId: row.meetingId }
        : undefined;
    return {
      hostMemberId: chosen.organiser,
      changed: true,
      organiserChanged: chosen.organiser !== row.hostMemberId,
      old,
    };
  });
  if (result.changed && 'organiserChanged' in result && result.organiserChanged && deps.calendar.events !== undefined) {
    await remakeEvent(
      scope,
      {
        events: deps.calendar.events,
        ...(deps.calendar.existing === undefined ? {} : { existing: deps.calendar.existing }),
      },
      input.bookingId,
      result.old,
      deps.log,
    );
  }
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
    const me = scope.access.principal.kind === 'member' ? scope.access.principal.memberId : undefined;
    if (!can(scope.access, 'booking.admin') && found.row.hostMemberId !== me) throw refuse('NOT_FOUND', MISSING);
    const seat = input.rotationId ?? found.team.rotations[0]?.rules.id;
    const rotation = found.team.rotations.find((each) => each.rules.id === seat);
    if (seat === undefined || rotation === undefined || !found.seats.has(seat)) {
      throw refuse('NOT_FOUND', 'That rotation doesn’t seat anyone on this booking.');
    }
    return { reach: await schedulingReach(tx, scope), rotationId: seat, rotationName: rotation.rules.name };
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
 * Reseats every seat `memberId` holds on the booking, through its rotation, never back to them (a member who left,
 * AC-749). System work: no reach check. Refuses SLOT_TAKEN when a seat finds nobody free.
 */
export async function reseatFor(
  scope: EngineScope,
  deps: ReseatDeps,
  input: { readonly bookingId: string; readonly memberId: string },
): Promise<Reseated> {
  const now = deps.now?.() ?? new Date();
  const rotationIds = await inWorkspace(scope, async (tx) => {
    const { seats } = await readSeated(tx, input.bookingId, now);
    return [...seats].flatMap(([rotationId, seat]) => (seat.memberId === input.memberId ? [rotationId] : []));
  });
  if (rotationIds.length === 0) return { hostMemberId: input.memberId, changed: false };
  return reseat(scope, deps, {
    bookingId: input.bookingId,
    rotationIds,
    reason: 'reassigned',
    nobody: 'Nobody else in its rotation is free then.',
    allow: (_rotationId, memberId) => memberId !== input.memberId,
  });
}

/**
 * Hands every upcoming booking a rotation seats `memberId` on to the next free member in it (spec 0029, AC-750:
 * "Reassign their N upcoming bookings", offered after they were removed or switched off), each one as a reassign of
 * its own. `booking.admin`. Answers how many moved and how many nobody could take (they stay where they were).
 */
export async function reassignUpcoming(
  scope: EngineScope,
  deps: ReseatDeps,
  input: { readonly rotationId: string; readonly memberId: string },
): Promise<{ readonly reassigned: number; readonly stuck: number }> {
  requirePermission(scope, 'booking.admin');
  const now = deps.now?.() ?? new Date();
  const { ids, name } = await inWorkspace(scope, async (tx) => {
    const [rotation] = await tx
      .select({ name: schema.rotations.name })
      .from(schema.rotations)
      .where(eq(schema.rotations.id, input.rotationId));
    if (rotation === undefined) throw refuse('NOT_FOUND', 'That rotation doesn’t exist.');
    const found = await tx.execute<{ id: string }>(sql`
      select b.id::text as id
      from rotation_assignments a
      join bookings b on b.workspace_id = a.workspace_id and b.id = a.booking_id
      where a.rotation_id = ${input.rotationId}::uuid and a.member_id = ${input.memberId}::uuid
        and a.voided_at is null and a.source = 'booking'
        and b.status = 'confirmed' and b.starts_at > ${now.toISOString()}::timestamptz
      order by b.starts_at
      limit 200
    `);
    return { ids: found.rows.map((row) => row.id), name: rotation.name };
  });
  let reassigned = 0;
  let stuck = 0;
  for (const bookingId of ids) {
    try {
      const done = await reseat(scope, deps, {
        bookingId,
        rotationIds: [input.rotationId],
        reason: 'reassigned',
        nobody: `Nobody else in ${name} is free then.`,
        allow: (_rotationId, memberId) => memberId !== input.memberId,
      });
      if (done.changed) reassigned += 1;
      else stuck += 1;
    } catch (error) {
      if (!isRefusal(error)) throw error;
      stuck += 1;
    }
  }
  return { reassigned, stuck };
}
