// Changing a booking (spec 0025, milestone 2; AC-638 to AC-640, AC-675 to
// AC-677): its guest moves it, adds guests or cancels it from the guest page
// (the manage token is the only key), and its host moves or cancels it from
// Bookings. Every change follows the booking's write path:
// - the calendars are read outside any lock (a network call never holds a
//   pooled connection's lock);
// - one transaction holds the hosts' advisory locks (the same ones booking
//   takes), reads the booking again under a row lock, checks it may still
//   change, rechecks a new time against the page's slots without the
//   booking's own time, writes it (the exclusion constraint is the last
//   guard), and records who changed it;
// - the same transaction queues the change's emails (and a move's reminders),
//   so they go exactly when the change commits;
// - after the commit, the calendar event is moved or cancelled through spec
//   0024's services (guests added later are not put on the event: their
//   emails carry the calendar file) (three tries, a short wait between them; a failure is logged and
//   marked for the host).
// A booking keeps its id through every move (AC-639), and moves at most 5
// times. Nothing changes once the meeting has started.
import { and, eq, sql } from 'drizzle-orm';
import type { PublicSlots } from '@crm/contracts';
import type { RecordRefDisplay } from '@crm/contracts/values';
import { schema, type WorkspaceTx } from '@crm/db';
import type { BookingEntry } from '../access/door.ts';
import { requirePermission } from '../access/check.ts';
import { checkScope, type EngineScope } from '../access/mint.ts';
import { writeAudit } from '../members/audit.ts';
import { can, isOpen, objectLevel } from '../access/policy.ts';
import { visibleRecords } from '../access/visibility.ts';
import { checkId } from '../engine/ids.ts';
import { inWorkspace } from '../access/run.ts';
import { postgresError, refuse, refuseOn } from '../engine/refusals.ts';
import type { BookingCalendar, BusyReader, EventRef } from './calendar.ts';
import { chooseHosts, lockRotations } from '../rotation/assign.ts';
import { changedSeats, liveSeats, recordSeats, syncHosts } from '../rotation/reseat.ts';
import { loadTeam, memberBusy, readTeam, teamMemberIds, teamSlots, type Team } from '../rotation/team.ts';
import { handLinkOf, linkedRecords } from './links.ts';
import { hostLockKey, lockKey } from './locks.ts';
import { enqueueBookingMail } from './mail-queue.ts';
import {
  BUSY_MARGIN_MS,
  bookedSpans,
  loadPage,
  membersBusy,
  membersClosed,
  membersOf,
  pageSlots,
  type MembersBusy,
  type PageRecord,
} from './slots.ts';
import { ensureManageToken, managePath, type ManageLinkKey } from './tokens.ts';

const { bookings } = schema;

/** The most times a booking may be moved (AC-639). */
export const MAX_RESCHEDULES = 5;

/** The most guests a booking may have (0025-experience.md). */
export const MAX_GUESTS = 10;

/** What a change needs: the calendar calls, the clock, and where failures are logged. */
export interface ChangeDeps {
  readonly calendar: Pick<BookingCalendar, 'existing'> &
    Partial<Pick<BookingCalendar, 'events'>> & {
      readonly busy: BusyReader & { readonly fresh?: BusyReader };
    };
  readonly now?: () => Date;
  readonly log?: { warn(message: string, fields: Readonly<Record<string, unknown>>): void };
}

/**
 * Who is changing which booking: its guest (through the door's token entry,
 * as the page's `booking` actor), or a member through the access door.
 */
export type ChangeTarget =
  | { readonly by: 'guest'; readonly scope: EngineScope; readonly bookingId: string; readonly pageId: string }
  | { readonly by: 'host'; readonly scope: EngineScope; readonly bookingId: string };

/** The guest's target, from the entry the door made from their token. */
export function guestTarget(entry: BookingEntry & { readonly bookingId: string }): ChangeTarget {
  checkScope(entry.scope);
  const { principal } = entry.scope.access;
  if (principal.kind !== 'booking' || principal.pageId !== entry.pageId) {
    throw new Error('Refused a booking entry the door did not make.');
  }
  return { by: 'guest', scope: entry.scope, bookingId: entry.bookingId, pageId: entry.pageId };
}

/** A member's target: they need `booking.manage`; which bookings they may change is checked on the row. */
export function hostTarget(scope: EngineScope, bookingId: string): ChangeTarget {
  requirePermission(scope, 'booking.manage');
  return { by: 'host', scope, bookingId };
}

type BookingRow = typeof bookings.$inferSelect;

const MISSING = 'That booking doesn’t exist, or isn’t yours.';

/**
 * The booking and its page as the target may see them: the guest's own
 * booking; for a member, one on a page they own or that they host, or any
 * with `booking.admin` (hidden means absent: NOT_FOUND).
 */
async function readTarget(
  tx: WorkspaceTx,
  target: ChangeTarget,
  lock: boolean,
): Promise<{ readonly row: BookingRow; readonly page: PageRecord }> {
  const query = tx.select().from(bookings).where(eq(bookings.id, target.bookingId));
  const [row] = lock ? await query.for('update') : await query;
  const page = row === undefined ? undefined : await loadPage(tx, row.pageId);
  if (row === undefined || page === undefined) throw refuse('NOT_FOUND', MISSING);
  if (target.by === 'guest') {
    if (row.pageId !== target.pageId) throw refuse('NOT_FOUND', MISSING);
    return { row, page };
  }
  const { principal } = target.scope.access;
  const me = principal.kind === 'member' ? principal.memberId : undefined;
  const allowed =
    can(target.scope.access, 'booking.admin') ||
    (me !== undefined && (row.hostMemberId === me || page.ownerMemberId === me));
  if (!allowed) throw refuse('NOT_FOUND', MISSING);
  return { row, page };
}

/** Who a change is recorded as. */
function actorOf(target: ChangeTarget, page: PageRecord) {
  if (target.by === 'guest') return { type: 'booking' as const, id: page.id, memberId: null };
  const { principal } = target.scope.access;
  if (principal.kind !== 'member') throw refuse('FORBIDDEN', 'Only a member changes a booking from Bookings.');
  return { type: 'member' as const, id: principal.memberId, memberId: principal.memberId };
}

/** The updated by columns for an actor. */
function updatedBy(actor: ReturnType<typeof actorOf>) {
  return { updatedByType: actor.type, updatedById: actor.id, updatedByMemberId: actor.memberId, updatedAt: sql`now()` };
}

/** Refuses a booking that can no longer change: cancelled, or its meeting has started. */
function checkChangeable(row: BookingRow, now: Date, doing: 'cancelled' | 'moved' | 'changed'): void {
  if (row.status === 'cancelled') throw refuse('BOOKING_CLOSED', 'This booking was already cancelled.');
  if (row.startsAt.getTime() <= now.getTime()) {
    throw refuse('BOOKING_CLOSED', `That meeting has already happened, so it can no longer be ${doing}.`);
  }
}

/** Refuses a move the booking or its page no longer allows. */
function checkMovable(row: BookingRow, page: PageRecord, now: Date): void {
  checkChangeable(row, now, 'moved');
  if (row.reschedules >= MAX_RESCHEDULES) {
    throw refuse(
      'LIMIT_REACHED',
      `This booking has moved ${String(MAX_RESCHEDULES)} times, the most it can. Cancel it and book again instead.`,
    );
  }
  if (page.isDeleted || page.status !== 'live') {
    throw refuse(
      'BOOKING_CLOSED',
      'This page isn’t taking bookings any more, so this booking can’t move. It can still be cancelled.',
    );
  }
}

/** The booking's length in minutes. */
const minutesOf = (row: BookingRow) => Math.round((row.endsAt.getTime() - row.startsAt.getTime()) / 60_000);

/**
 * The calendars' busy times without the booking's own time: its event is on
 * the host's calendar, and a move may overlap where it is now.
 */
function withoutOwn(busy: MembersBusy, row: BookingRow): MembersBusy {
  const start = row.startsAt.getTime();
  const end = row.endsAt.getTime();
  return {
    ...busy,
    busy: busy.busy.flatMap((span) => {
      const a = span.start.getTime();
      const b = span.end.getTime();
      if (b <= start || a >= end) return [span];
      return [
        ...(a < start ? [{ start: span.start, end: new Date(start) }] : []),
        ...(b > end ? [{ start: new Date(end), end: span.end }] : []),
      ];
    }),
  };
}

/** The page's slots of the booking's own length in a range, its own time free (a personal or collective page). */
async function slotsFor(
  tx: WorkspaceTx,
  page: PageRecord,
  row: BookingRow,
  memberIds: readonly string[],
  busy: MembersBusy,
  range: { readonly from: Date; readonly to: Date; readonly now: Date },
) {
  const held = await bookedSpans(tx, memberIds, page.id, range.from, range.to, row.id);
  const closed = await membersClosed(
    tx,
    memberIds,
    page,
    new Date(range.from.getTime() - BUSY_MARGIN_MS),
    new Date(range.to.getTime() + BUSY_MARGIN_MS),
  );
  return pageSlots(page, {
    duration: minutesOf(row),
    from: range.from,
    to: range.to,
    now: range.now,
    busy: withoutOwn(busy, row),
    bookings: held,
    closed,
  });
}

/** Each team member's calendar, the booking's own time left free. */
async function teamBusy(
  read: BusyReader,
  workspaceId: string,
  row: BookingRow,
  memberIds: readonly string[],
  from: Date,
  to: Date,
): Promise<ReadonlyMap<string, MembersBusy>> {
  const each = await memberBusy(read, workspaceId, memberIds, from, to);
  return new Map([...each].map(([memberId, busy]) => [memberId, withoutOwn(busy, row)]));
}

/**
 * A round robin booking's move times (spec 0029, AC-746; spec 0037, AC-1324): every time its fixed hosts are free
 * and each rotation can seat someone, the booking itself left out of every count. Whether the current hosts stay is
 * decided when it moves (`moveTeamBooking`).
 */
async function teamMoveSlots(
  scope: EngineScope,
  read: BusyReader,
  found: { readonly row: BookingRow; readonly page: PageRecord; readonly team: Extract<Team, { kind: 'round_robin' }> },
  range: { readonly from: Date; readonly to: Date; readonly now: Date },
) {
  const { row, page, team } = found;
  const busy = await teamBusy(
    read,
    scope.workspaceId,
    row,
    teamMemberIds(team),
    new Date(range.from.getTime() - BUSY_MARGIN_MS),
    new Date(range.to.getTime() + BUSY_MARGIN_MS),
  );
  return inWorkspace(scope, async (tx) =>
    teamSlots(page, team, await readTeam(tx, page, team, busy, { ...range, margin: BUSY_MARGIN_MS, except: row.id }), {
      duration: minutesOf(row),
      ...range,
    }),
  );
}

/** A round robin page's team, for a booking on one; undefined for any other page. */
async function roundRobinTeam(
  tx: WorkspaceTx,
  page: PageRecord,
): Promise<Extract<Team, { kind: 'round_robin' }> | undefined> {
  if (page.kind !== 'round_robin') return undefined;
  const team = await loadTeam(tx, page);
  return team?.kind === 'round_robin' ? team : undefined;
}

/**
 * The times the booking may move to in a range (AC-675): the page's slots of
 * the booking's own length, its own time free. `unreachable` when a host's
 * calendar refuses us until they reconnect (nothing is offered then).
 */
export async function readMoveSlots(
  target: ChangeTarget,
  deps: ChangeDeps,
  range: { readonly from: Date; readonly to: Date },
): Promise<PublicSlots> {
  const now = deps.now?.() ?? new Date();
  const found = await inWorkspace(target.scope, async (tx) => {
    const read = await readTarget(tx, target, false);
    checkMovable(read.row, read.page, now);
    const team = await roundRobinTeam(tx, read.page);
    return { ...read, team, memberIds: team === undefined ? await membersOf(tx, read.page) : [] };
  });
  const { row, page, team, memberIds } = found;
  if (team !== undefined) {
    const offered = await teamMoveSlots(target.scope, deps.calendar.busy, { row, page, team }, { ...range, now });
    return {
      slots: offered.slots.map((slot) => ({ start: slot.start.toISOString(), end: slot.end.toISOString() })),
      calendar: offered.blocked ? 'unreachable' : 'ok',
    };
  }
  const busy = await membersBusy(
    deps.calendar.busy,
    target.scope.workspaceId,
    memberIds,
    new Date(range.from.getTime() - BUSY_MARGIN_MS),
    new Date(range.to.getTime() + BUSY_MARGIN_MS),
  );
  const slots = await inWorkspace(target.scope, (tx) => slotsFor(tx, page, row, memberIds, busy, { ...range, now }));
  return {
    slots: slots.map((slot) => ({ start: slot.start.toISOString(), end: slot.end.toISOString() })),
    calendar: busy.blocked ? 'unreachable' : 'ok',
  };
}

/** The booking's event, when one was made and where it lives. */
function eventOf(workspaceId: string, row: BookingRow): EventRef | undefined {
  return row.meetingId === null ? undefined : { workspaceId, meetingId: row.meetingId };
}

/** The wait before each further try of a calendar call: a passing outage gets a moment to pass. */
const RETRY_WAITS_MS = [250, 1_000] as const;

/**
 * Calls the calendar after a commit: three tries with a short wait between
 * them, then a warning in the log and, unless the booking is cancelled, the
 * host's warning on the booking. The emails were queued with the change.
 */
async function afterCommit(
  target: ChangeTarget,
  deps: ChangeDeps,
  row: BookingRow,
  call: ((ref: EventRef) => Promise<void>) | undefined,
): Promise<void> {
  const ref = eventOf(target.scope.workspaceId, row);
  if (ref === undefined || call === undefined) return;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await call(ref);
      return;
    } catch (error) {
      deps.log?.warn('booking.event_change_failed', {
        bookingId: row.id,
        attempt,
        error: error instanceof Error ? error.name : 'unknown',
      });
    }
    const wait = RETRY_WAITS_MS[attempt - 1];
    if (wait !== undefined) await new Promise((resolve) => setTimeout(resolve, wait));
  }
  if (row.status === 'confirmed') {
    await inWorkspace(target.scope, (tx) =>
      tx
        .update(bookings)
        .set({ eventFailedAt: sql`now()` })
        .where(eq(bookings.id, row.id)),
    );
  }
}

/**
 * Moves the booking to `start` (AC-639, AC-640, AC-675): the same booking,
 * the same length, a time the page offers now. Answers whether it moved (the
 * same time again changes nothing). Refuses SLOT_TAKEN when the time is gone,
 * LIMIT_REACHED after 5 moves, BOOKING_CLOSED once it is cancelled, has
 * started, or its page stopped taking bookings.
 */
export async function moveBooking(
  target: ChangeTarget,
  deps: ChangeDeps,
  input: { readonly start: Date },
): Promise<{ readonly moved: boolean }> {
  const now = deps.now?.() ?? new Date();
  const start = input.start;
  const first = await inWorkspace(target.scope, async (tx) => {
    const found = await readTarget(tx, target, false);
    if (found.row.startsAt.getTime() === start.getTime() && found.row.status === 'confirmed') return undefined;
    checkMovable(found.row, found.page, now);
    const team = await roundRobinTeam(tx, found.page);
    return { ...found, team, memberIds: team === undefined ? await membersOf(tx, found.page) : [] };
  });
  if (first === undefined) return { moved: false };
  if (first.team !== undefined) return moveTeamBooking(target, deps, { ...first, team: first.team }, start, now);
  const { memberIds } = first;

  // The calendars, outside any lock: the day around the new time, read fresh.
  const dayFrom = new Date(start.getTime() - 86_400_000);
  const dayTo = new Date(start.getTime() + 86_400_000);
  const busy = await membersBusy(
    deps.calendar.busy.fresh ?? deps.calendar.busy,
    target.scope.workspaceId,
    memberIds,
    new Date(dayFrom.getTime() - BUSY_MARGIN_MS),
    new Date(dayTo.getTime() + BUSY_MARGIN_MS),
  );
  if (busy.blocked) throw refuse('BOOKING_CLOSED', 'This booking can’t move right now. Try again later.');

  const moved = await inWorkspace(target.scope, async (tx) => {
    for (const memberId of [...memberIds].sort()) await lockKey(tx, hostLockKey(target.scope.workspaceId, memberId));
    const { row, page } = await readTarget(tx, target, true);
    if (row.startsAt.getTime() === start.getTime() && row.status === 'confirmed') return undefined;
    checkMovable(row, page, now);
    const offered = await slotsFor(tx, page, row, memberIds, busy, { from: dayFrom, to: dayTo, now });
    if (!offered.some((slot) => slot.start.getTime() === start.getTime())) {
      throw refuseOn('SLOT_TAKEN', 'That time has just gone. Pick another.', 'start');
    }
    const end = new Date(start.getTime() + minutesOf(row) * 60_000);
    const blockStart = new Date(start.getTime() - page.bufferBefore * 60_000);
    const blockEnd = new Date(end.getTime() + page.bufferAfter * 60_000);
    try {
      const [updated] = await tx
        .update(bookings)
        .set({
          startsAt: start,
          endsAt: end,
          during: sql`tstzrange(${blockStart.toISOString()}::timestamptz, ${blockEnd.toISOString()}::timestamptz, '[)')`,
          reschedules: row.reschedules + 1,
          previousStartsAt: row.startsAt,
          ...updatedBy(actorOf(target, page)),
        })
        .where(and(eq(bookings.id, row.id), eq(bookings.status, 'confirmed')))
        .returning();
      if (updated === undefined) throw new Error('The booking was not moved.');
      // The emails with the change; the reminders again for the new time, replacing the old ones.
      await enqueueBookingMail(tx, updated.id, ['moved', 'reminder_24h', 'reminder_1h']);
      return updated;
    } catch (error) {
      // The lock should make this unreachable: a write that skipped it, refused by the database.
      if (postgresError(error)?.code === '23P01') {
        throw refuseOn('SLOT_TAKEN', 'That time has just gone. Pick another.', 'start');
      }
      throw error;
    }
  });
  if (moved === undefined) return { moved: false };
  const existing = deps.calendar.existing;
  await afterCommit(
    target,
    deps,
    moved,
    existing === undefined
      ? undefined
      : (ref) => existing.move(ref, { start: moved.startsAt.toISOString(), end: moved.endsAt.toISOString() }),
  );
  return { moved: true };
}

/**
 * Moves a round robin booking (spec 0029, AC-746; spec 0037, AC-1324): under the rotations' locks, then every
 * candidate's host lock, the booking keeps each host who is free at the new time when the page says "same host
 * when free"; every other seat, and every seat when it says "through the rotation", picks again. A seat that changed
 * voids its ledger row and writes a new one; a new organiser gets the event on their calendar and the old one's is
 * cancelled; the guest and both hosts are told (`reassigned`) beside the usual `moved`.
 */
async function moveTeamBooking(
  target: ChangeTarget,
  deps: ChangeDeps,
  first: {
    readonly row: BookingRow;
    readonly page: PageRecord;
    readonly team: Extract<Team, { kind: 'round_robin' }>;
  },
  start: Date,
  now: Date,
): Promise<{ readonly moved: boolean }> {
  const { scope } = target;
  const dayFrom = new Date(start.getTime() - 86_400_000);
  const dayTo = new Date(start.getTime() + 86_400_000);
  const read = deps.calendar.busy.fresh ?? deps.calendar.busy;
  const busy = await teamBusy(
    read,
    scope.workspaceId,
    first.row,
    teamMemberIds(first.team),
    new Date(dayFrom.getTime() - BUSY_MARGIN_MS),
    new Date(dayTo.getTime() + BUSY_MARGIN_MS),
  );
  const range = { from: dayFrom, to: dayTo, now };
  const offered = await inWorkspace(scope, async (tx) =>
    teamSlots(
      first.page,
      first.team,
      await readTeam(tx, first.page, first.team, busy, { ...range, margin: BUSY_MARGIN_MS, except: first.row.id }),
      { duration: minutesOf(first.row), ...range },
    ),
  );
  if (offered.blocked) throw refuse('BOOKING_CLOSED', 'This booking can’t move right now. Try again later.');
  const slot = offered.slots.find((each) => each.start.getTime() === start.getTime());
  if (slot === undefined) throw refuseOn('SLOT_TAKEN', 'That time has just gone. Pick another.', 'start');

  const result = await inWorkspace(scope, async (tx) => {
    await lockRotations(
      tx,
      scope.workspaceId,
      first.team.rotations.map((rotation) => rotation.rules.id),
    );
    // The team as it stands under the locks (a member removed or switched off meanwhile is gone from it).
    const team = (await roundRobinTeam(tx, first.page)) ?? first.team;
    const seats = await liveSeats(tx, first.row.id);
    const keep =
      first.page.rescheduleHost === 'same'
        ? new Map([...seats].map(([rotationId, seat]) => [rotationId, seat.memberId]))
        : undefined;
    const chosen = await chooseHosts(tx, first.page, team, {
      workspaceId: scope.workspaceId,
      start,
      duration: minutesOf(first.row),
      candidates: slot.candidates,
      busy,
      ...range,
      ...(keep === undefined ? {} : { keep }),
      except: first.row.id,
    });
    const { row, page } = await readTarget(tx, target, true);
    if (row.startsAt.getTime() === start.getTime() && row.status === 'confirmed') return undefined;
    checkMovable(row, page, now);
    const end = new Date(start.getTime() + minutesOf(row) * 60_000);
    const blockStart = new Date(start.getTime() - page.bufferBefore * 60_000);
    const blockEnd = new Date(end.getTime() + page.bufferAfter * 60_000);
    const changes = changedSeats(team, seats, chosen.picks);
    try {
      const [updated] = await tx
        .update(bookings)
        .set({
          startsAt: start,
          endsAt: end,
          during: sql`tstzrange(${blockStart.toISOString()}::timestamptz, ${blockEnd.toISOString()}::timestamptz, '[)')`,
          reschedules: row.reschedules + 1,
          previousStartsAt: row.startsAt,
          hostMemberId: chosen.organiser,
          ...updatedBy(actorOf(target, page)),
        })
        .where(and(eq(bookings.id, row.id), eq(bookings.status, 'confirmed')))
        .returning();
      if (updated === undefined) throw new Error('The booking was not moved.');
      await syncHosts(tx, updated.id, chosen.hosts);
      await recordSeats(tx, scope, updated.id, changes);
      const organiserChanged = chosen.organiser !== row.hostMemberId;
      await enqueueBookingMail(tx, updated.id, [
        'moved',
        ...(changes.length === 0 ? [] : (['reassigned'] as const)),
        // A new organiser's calendar gets the event in the worker, never inside this request.
        ...(organiserChanged ? (['host_changed'] as const) : []),
        'reminder_24h',
        'reminder_1h',
      ]);
      return { updated, organiserChanged };
    } catch (error) {
      if (postgresError(error)?.code === '23P01') {
        throw refuseOn('SLOT_TAKEN', 'That time has just gone. Pick another.', 'start');
      }
      throw error;
    }
  });
  if (result === undefined) return { moved: false };
  const { updated, organiserChanged } = result;
  if (organiserChanged) return { moved: true };
  const existing = deps.calendar.existing;
  await afterCommit(
    target,
    deps,
    updated,
    existing === undefined
      ? undefined
      : (ref) => existing.move(ref, { start: updated.startsAt.toISOString(), end: updated.endsAt.toISOString() }),
  );
  return { moved: true };
}

/**
 * Cancels the booking (AC-638, AC-640, AC-677), with an optional reason the
 * guest's email carries. Answers whether it cancelled now (cancelling again
 * changes nothing). Refuses BOOKING_CLOSED once the meeting has started.
 */
export async function cancelBooking(
  target: ChangeTarget,
  deps: ChangeDeps,
  input: { readonly reason?: string | undefined },
): Promise<{ readonly cancelled: boolean }> {
  const now = deps.now?.() ?? new Date();
  const reason = input.reason?.trim();
  const cancelled = await inWorkspace(target.scope, async (tx) => {
    const { row, page } = await readTarget(tx, target, true);
    if (row.status === 'cancelled') return undefined;
    checkChangeable(row, now, 'cancelled');
    const [updated] = await tx
      .update(bookings)
      .set({
        status: 'cancelled',
        cancelReason: reason === undefined || reason === '' ? null : reason,
        cancelledAt: sql`now()`,
        cancelledBy: target.by,
        ...updatedBy(actorOf(target, page)),
      })
      .where(eq(bookings.id, row.id))
      .returning();
    if (updated === undefined) throw new Error('The booking was not cancelled.');
    await enqueueBookingMail(tx, updated.id, ['cancelled']);
    return updated;
  });
  if (cancelled === undefined) return { cancelled: false };
  await afterCommit(target, deps, cancelled, deps.calendar.existing?.cancel);
  return { cancelled: true };
}

/** A list of strings a booking's answers hold under `key`. */
function listOf(answers: unknown, key: string): readonly string[] {
  if (typeof answers !== 'object' || answers === null || !(key in answers)) return [];
  const list = (answers as Readonly<Record<string, unknown>>)[key];
  return Array.isArray(list) ? list.filter((each): each is string => typeof each === 'string') : [];
}

/** Everyone a booking has ever invited (removed guests stay counted). */
const everInvitedOf = (answers: unknown) => listOf(answers, 'everInvited');

/** The guests added after booking, who aren't on the calendar event's own invitation. */
export const addedLaterOf = (answers: unknown) => listOf(answers, 'addedLater');

/** The guests a booking's answers hold. */
export function guestsOf(answers: unknown): readonly string[] {
  if (typeof answers !== 'object' || answers === null || !('guests' in answers) || !Array.isArray(answers.guests)) {
    return [];
  }
  return answers.guests.filter((guest): guest is string => typeof guest === 'string');
}

/**
 * Invites more people to the booking (AC-676): only addresses not already on
 * it (the visitor and the guests), at most 10 guests in all. Answers how many
 * were new and everyone now invited. Refuses LIMIT_REACHED past 10.
 */
export async function addGuests(
  target: ChangeTarget,
  deps: ChangeDeps,
  input: { readonly emails: readonly string[] },
): Promise<{ readonly added: number; readonly guests: readonly string[] }> {
  const now = deps.now?.() ?? new Date();
  const changed = await inWorkspace(target.scope, async (tx) => {
    const { row, page } = await readTarget(tx, target, true);
    checkChangeable(row, now, 'changed');
    const before = guestsOf(row.answers);
    const on = new Set([row.visitorEmail, ...before]);
    const fresh = [...new Set(input.emails.map((email) => email.trim().toLowerCase()))].filter(
      (email) => email !== '' && !on.has(email),
    );
    if (fresh.length === 0) return { row, added: 0, guests: before };
    const guests = [...before, ...fresh];
    // Everyone ever invited counts towards the 10, so removing a guest never frees a place to invite someone new:
    // a guest page can't be turned into a way to send invitations to anyone.
    const ever = new Set([...everInvitedOf(row.answers), ...guests]);
    if (ever.size > MAX_GUESTS) {
      const left = Math.max(0, MAX_GUESTS - new Set([...everInvitedOf(row.answers), ...before]).size);
      throw refuseOn(
        'LIMIT_REACHED',
        left === 0
          ? `This booking has invited ${String(MAX_GUESTS)} people, the most it can.`
          : `A booking can invite at most ${String(MAX_GUESTS)} people. ${String(left)} more can join.`,
        'emails',
      );
    }
    const answers = typeof row.answers === 'object' && row.answers !== null ? row.answers : {};
    const [updated] = await tx
      .update(bookings)
      .set({
        answers: {
          ...answers,
          guests,
          everInvited: [...ever],
          // Not on the calendar event's own invitation: their emails carry the calendar file from now on.
          addedLater: [...new Set([...addedLaterOf(row.answers), ...fresh])],
        },
        ...updatedBy(actorOf(target, page)),
      })
      .where(eq(bookings.id, row.id))
      .returning();
    if (updated === undefined) throw new Error('The guests were not added.');
    await enqueueBookingMail(tx, updated.id, ['guests']);
    return { row: updated, added: fresh.length, guests };
  });
  return { added: changed.added, guests: changed.guests };
}

/**
 * Takes a guest off the booking (timefix's Remove on the guest page), and
 * queues the email telling them, with a cancelled calendar file (the guests
 * kind tells everyone invited but no longer on it). Answers everyone still
 * invited. Removing someone who isn't on it changes nothing.
 */
export async function removeGuest(
  target: ChangeTarget,
  deps: ChangeDeps,
  input: { readonly email: string },
): Promise<{ readonly guests: readonly string[] }> {
  const now = deps.now?.() ?? new Date();
  const email = input.email.trim().toLowerCase();
  const changed = await inWorkspace(target.scope, async (tx) => {
    const { row, page } = await readTarget(tx, target, true);
    checkChangeable(row, now, 'changed');
    const before = guestsOf(row.answers);
    if (!before.includes(email)) return { row, removed: false, guests: before };
    const guests = before.filter((guest) => guest !== email);
    const answers = typeof row.answers === 'object' && row.answers !== null ? row.answers : {};
    const [updated] = await tx
      .update(bookings)
      .set({ answers: { ...answers, guests }, ...updatedBy(actorOf(target, page)) })
      .where(eq(bookings.id, row.id))
      .returning();
    if (updated === undefined) throw new Error('The guest was not removed.');
    // They hear that they are off it, with a cancelled calendar file, once their invitation had gone (QA Q81).
    await enqueueBookingMail(tx, updated.id, ['guests']);
    return { row: updated, removed: true, guests };
  });
  return { guests: changed.guests };
}

/**
 * The guest page's path for a booking (Copy guest link): for a member who may
 * change it. The path carries the guest's token, so it is read only on demand.
 */
export async function bookingGuestPath(
  scope: EngineScope,
  deps: { readonly linkKey: ManageLinkKey },
  input: { readonly bookingId: string },
): Promise<{ readonly path: string }> {
  const target = hostTarget(scope, input.bookingId);
  return inWorkspace(scope, async (tx) => {
    const { row, page } = await readTarget(tx, target, false);
    return { path: managePath(page.publicKey, await ensureManageToken(tx, deps.linkKey, row)) };
  });
}

/**
 * Marks a past booking as a no show, or takes the mark back (spec 0043,
 * AC-1613): its host, the page's owner or `booking.admin`, as any change; a
 * cancelled booking or one not yet started is BOOKING_CLOSED. Audited; the
 * same mark again changes nothing. It feeds each routing rule's report.
 */
export async function markNoShow(
  scope: EngineScope,
  input: { readonly bookingId: string; readonly noShow: boolean },
  now: Date = new Date(),
): Promise<{ readonly noShow: boolean }> {
  const target = hostTarget(scope, input.bookingId);
  const { principal } = scope.access;
  if (principal.kind !== 'member') throw refuse('FORBIDDEN', 'Only a member can mark a no show.');
  return inWorkspace(scope, async (tx) => {
    const { row } = await readTarget(tx, target, true);
    if (row.status === 'cancelled')
      throw refuse('BOOKING_CLOSED', 'This booking was cancelled, so nobody was expected.');
    if (row.startsAt.getTime() > now.getTime()) {
      throw refuse('BOOKING_CLOSED', 'That meeting hasn’t started yet. Mark a no show once it has.');
    }
    if ((row.noShowAt !== null) === input.noShow) return { noShow: input.noShow };
    await tx
      .update(bookings)
      .set({
        ...(input.noShow
          ? { noShowAt: sql`now()`, noShowByMemberId: principal.memberId }
          : { noShowAt: null, noShowByMemberId: null }),
        updatedAt: sql`now()`,
        updatedByType: 'member',
        updatedById: principal.memberId,
        updatedByMemberId: principal.memberId,
      })
      .where(eq(bookings.id, row.id));
    await writeAudit(tx, scope.workspaceId, scope.actor, {
      action: input.noShow ? 'booking.no_show' : 'booking.no_show_undone',
      targetType: 'booking',
      targetId: row.id,
    });
    return { noShow: input.noShow };
  });
}

/** What a link to a record nobody may see, or that doesn't exist, answers: the same either way. */
const NO_SUCH_RECORD = 'That record doesn’t exist, or you can’t see it.';

/** What replacing a booking's link to a record the member can't see answers: never which record it is. */
const HIDDEN_LINK = 'This booking is linked to a record you can’t see.';

/**
 * Links a booking to a record by hand from its card, or takes the link off with `recordId: null` (polish F2): its
 * host, the page's owner or `booking.admin`, as any change (a booking they can't change answers NOT_FOUND). The
 * record must be live on a live object the member can see (else NOT_FOUND on `recordId`, the same for one that
 * doesn't exist) and may change (else FORBIDDEN, as linking a task, AC-447); a person or a company is refused
 * (CONFIG_INVALID): those are the guest's, filed when it was made. A past or cancelled booking may be filed too.
 * Kept in `deal_record_id`, audited; the same link again changes nothing. Answers the record as a chip shows it.
 *
 * A write never removes what the writer can't see (spec 0009), as a relationship's side of one and a task's links
 * keep a link hidden from them (spec 0014, spec 0019). So when the record linked now is live on a live object and
 * hidden from the member (an object hidden from them, a record rule), taking the link off changes nothing and answers
 * nothing linked, as taking off a link that isn't there does, and naming another record refuses FORBIDDEN on
 * `recordId` without naming the one linked. A linked record in the trash gives way; one on an archived object
 * stays, as a relationship's does, since restoring the object shows it again.
 */
export async function linkBookingRecord(
  scope: EngineScope,
  input: { readonly bookingId: string; readonly recordId: string | null },
): Promise<{ readonly linkedRecord?: RecordRefDisplay }> {
  const target = hostTarget(scope, input.bookingId);
  const { principal } = scope.access;
  if (principal.kind !== 'member') throw refuse('FORBIDDEN', 'Only a member links a booking from Bookings.');
  return inWorkspace(scope, async (tx) => {
    const { row } = await readTarget(tx, target, true);
    const recordId = input.recordId === null ? null : checkId(input.recordId, NO_SUCH_RECORD);
    if (recordId !== null) await checkLinkableRecord(tx, scope, recordId);
    if (
      row.dealRecordId !== null &&
      row.dealRecordId !== recordId &&
      (await isHiddenLink(tx, scope, row.dealRecordId))
    ) {
      if (recordId === null) return {};
      throw refuseOn('FORBIDDEN', HIDDEN_LINK, 'recordId');
    }
    if (row.dealRecordId !== recordId) {
      await tx
        .update(bookings)
        .set({
          dealRecordId: recordId,
          updatedAt: sql`now()`,
          updatedByType: 'member',
          updatedById: principal.memberId,
          updatedByMemberId: principal.memberId,
        })
        .where(eq(bookings.id, row.id));
      await writeAudit(tx, scope.workspaceId, scope.actor, {
        action: recordId === null ? 'booking.record_unlinked' : 'booking.record_linked',
        targetType: 'booking',
        targetId: row.id,
        before: { recordId: row.dealRecordId },
        after: { recordId },
      });
    }
    return handLinkOf({ dealRecordId: recordId }, await linkedRecords(tx, scope.access, [{ dealRecordId: recordId }]));
  });
}

/**
 * Whether the record a booking is linked to now is live on a live object and hidden from the member, so a link write
 * must keep it (spec 0009). One in the trash, or gone, reads as absent and gives way; one on an archived object
 * stays hidden and kept, as relationships keep theirs.
 */
async function isHiddenLink(tx: WorkspaceTx, scope: EngineScope, recordId: string): Promise<boolean> {
  if (isOpen(scope.access)) return false;
  const found = await tx.execute<{ id: string; object_id: string }>(sql`
    select r.id::text as id, r.object_id::text as object_id
    from records r join objects o on o.workspace_id = r.workspace_id and o.id = r.object_id
    where r.id = ${recordId}::uuid and r.deleted_at is null
  `);
  const [record] = found.rows;
  if (record === undefined) return false;
  const seen = await visibleRecords(tx, scope.access, [{ objectId: record.object_id, recordId: record.id }]);
  return !seen.has(record.id);
}

/**
 * Refuses a record a booking can't be linked to: missing, in the trash, on an archived object or one the member
 * can't see (NOT_FOUND, alike); a person or a company (CONFIG_INVALID); one on an object they may only read
 * (FORBIDDEN). Locks it `for key share`, which blocks only its purge, never an edit.
 */
async function checkLinkableRecord(tx: WorkspaceTx, scope: EngineScope, recordId: string): Promise<void> {
  const found = await tx.execute<{ id: string; object_id: string; standard_key: string | null }>(sql`
    select r.id::text as id, r.object_id::text as object_id, o.standard_key
    from records r join objects o on o.workspace_id = r.workspace_id and o.id = r.object_id
    where r.id = ${recordId}::uuid and r.deleted_at is null and o.archived_at is null
    for key share of r
  `);
  const [record] = found.rows;
  if (record === undefined) throw refuseOn('NOT_FOUND', NO_SUCH_RECORD, 'recordId');
  const seen = await visibleRecords(tx, scope.access, [{ objectId: record.object_id, recordId: record.id }]);
  if (!seen.has(record.id)) throw refuseOn('NOT_FOUND', NO_SUCH_RECORD, 'recordId');
  if (record.standard_key === 'people' || record.standard_key === 'companies') {
    throw refuseOn(
      'CONFIG_INVALID',
      'A booking is filed to its guest’s person and company already. Link a deal or another record.',
      'recordId',
    );
  }
  if (!isOpen(scope.access) && objectLevel(scope.access, record.object_id) !== 'write') {
    throw refuseOn('FORBIDDEN', 'You can’t link a booking to a record you can’t change.', 'recordId');
  }
}
