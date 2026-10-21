// Giving a round robin booking new hosts (spec 0029, AC-746, AC-748, AC-749;
// spec 0037, AC-1324, AC-1337): a move through the rotation, a reassign, and a
// member who leaves all end here. Inside the caller's transaction, under the
// locks `chooseHosts` took: the organiser on the booking (its trigger moves
// that `booking_hosts` row), every other host's row, and for each seat that
// changed its old ledger row voided and a new one written with its reason.
// After the commit, a new organiser's calendar gets the event and the old one's
// is cancelled; the emails go with the change (`reassigned`).
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { schema, type WorkspaceTx } from '@crm/db';
import type { EngineScope } from '../access/mint.ts';
import { inWorkspace } from '../access/run.ts';
import type { BookingCalendar, EventRef } from '../booking/calendar.ts';
import { recordEvent } from '../booking/mail-queue.ts';
import { loadPage, type PageRecord } from '../booking/slots.ts';
import { writeAssignment, type AssignmentRow } from './ledger.ts';
import type { SeatPick } from './pick.ts';
import type { Team } from './team.ts';

const { bookingHosts, bookings, members, rotationAssignments } = schema;

/** A booking's seat: the live ledger row of one rotation, and its member. */
export interface LiveSeat {
  readonly id: string;
  readonly memberId: string;
}

/** A booking's live seats by rotation id (one live row per rotation, `rotation_assignments_booking_live`). */
export async function liveSeats(tx: WorkspaceTx, bookingId: string): Promise<ReadonlyMap<string, LiveSeat>> {
  const rows = await tx
    .select({
      id: rotationAssignments.id,
      rotationId: rotationAssignments.rotationId,
      memberId: rotationAssignments.memberId,
    })
    .from(rotationAssignments)
    .where(and(eq(rotationAssignments.bookingId, bookingId), isNull(rotationAssignments.voidedAt)));
  return new Map(rows.map((row) => [row.rotationId, { id: row.id, memberId: row.memberId }]));
}

/**
 * Makes the booking's `booking_hosts` rows exactly `hosts`, after its organiser and times were written: rows of
 * hosts who left go, new hosts get a row with the booking's range and status. The exclusion constraint refuses a
 * host already booked then (23P01, which the caller turns into SLOT_TAKEN).
 */
export async function syncHosts(tx: WorkspaceTx, bookingId: string, hosts: readonly string[]): Promise<void> {
  const list = `{${[...new Set(hosts)].join(',')}}`;
  await tx.execute(sql`
    delete from ${bookingHosts}
    where ${bookingHosts.bookingId} = ${bookingId}::uuid and ${bookingHosts.memberId} <> all(${list}::uuid[])
  `);
  await tx.execute(sql`
    insert into booking_hosts (workspace_id, booking_id, member_id, during, status)
    select b.workspace_id, b.id, m.id, b.during, b.status
    from bookings b, unnest(${list}::uuid[]) as m(id)
    where b.id = ${bookingId}::uuid
    on conflict do nothing
  `);
}

/** A seat given to someone new, with why. */
export interface SeatChange {
  readonly rotationId: string;
  readonly memberId: string;
  readonly reason: AssignmentRow['reason'];
  readonly detail: AssignmentRow['detail'];
}

/** The changes a set of picks makes to the live seats: only the seats whose member differs. */
export function changedSeats(
  team: Extract<Team, { kind: 'round_robin' }>,
  seats: ReadonlyMap<string, LiveSeat>,
  picks: readonly SeatPick[],
  reason?: AssignmentRow['reason'],
): readonly SeatChange[] {
  return picks.flatMap((pick) => {
    if (seats.get(pick.rotationId)?.memberId === pick.memberId) return [];
    const windowDays = team.rotations.find((rotation) => rotation.rules.id === pick.rotationId)?.rules.windowDays ?? 30;
    return [
      {
        rotationId: pick.rotationId,
        memberId: pick.memberId,
        reason: reason ?? pick.reason,
        detail: { ...pick.detail, windowDays },
      },
    ];
  });
}

/** Voids each changed seat's old row and writes its new one, in the caller's transaction. */
export async function recordSeats(
  tx: WorkspaceTx,
  scope: EngineScope,
  bookingId: string,
  changes: readonly SeatChange[],
): Promise<void> {
  if (changes.length === 0) return;
  await tx
    .update(rotationAssignments)
    .set({ voidedAt: sql`now()`, updatedAt: sql`now()` })
    .where(
      and(
        eq(rotationAssignments.bookingId, bookingId),
        isNull(rotationAssignments.voidedAt),
        inArray(
          rotationAssignments.rotationId,
          changes.map((change) => change.rotationId),
        ),
      ),
    );
  for (const change of changes) {
    await writeAssignment(tx, scope, {
      rotationId: change.rotationId,
      memberId: change.memberId,
      source: 'booking',
      bookingId,
      reason: change.reason,
      detail: change.detail,
    });
  }
}

/** The answers a booking keeps that its event shows. */
function answerOf(answers: unknown, key: 'phone' | 'note'): string | undefined {
  if (typeof answers !== 'object' || answers === null || !(key in answers)) return undefined;
  const value: unknown = (answers as Readonly<Record<string, unknown>>)[key];
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/** The guests a booking keeps. */
function guestsOf(answers: unknown): readonly string[] {
  if (typeof answers !== 'object' || answers === null || !('guests' in answers)) return [];
  const value: unknown = (answers as { readonly guests: unknown }).guests;
  return Array.isArray(value) ? value.filter((each): each is string => typeof each === 'string') : [];
}

/** The location line of the event, for anything but video. */
function eventLocation(page: PageRecord, phone: string | undefined): string | undefined {
  switch (page.location.type) {
    case 'video':
      return undefined;
    case 'phone':
      return phone === undefined ? undefined : `Phone: ${phone}`;
    default:
      return page.location.value;
  }
}

/**
 * After a commit that gave the booking a new organiser: the old organiser's event is cancelled (its attendees are
 * told by the provider) and the new organiser's calendar gets the booking's event, inviting the guest, its guests
 * and the other hosts. Three tries each; a failure marks the booking for the host, as booking does.
 */
export async function remakeEvent(
  scope: EngineScope,
  calendar: Pick<BookingCalendar, 'events' | 'existing'>,
  bookingId: string,
  old: EventRef | undefined,
  log?: { readonly warn: (message: string, fields: Readonly<Record<string, unknown>>) => void },
): Promise<void> {
  if (old !== undefined && calendar.existing !== undefined) {
    const { cancel } = calendar.existing;
    await retry(() => cancel(old), 'booking.event_cancel_failed', bookingId, log);
  }
  const facts = await inWorkspace(scope, async (tx) => {
    const [row] = await tx.select().from(bookings).where(eq(bookings.id, bookingId));
    if (row === undefined || row.status !== 'confirmed') return undefined;
    const page = await loadPage(tx, row.pageId);
    if (page === undefined) return undefined;
    const others = await tx
      .select({ email: members.email, name: members.name })
      .from(bookingHosts)
      .innerJoin(members, and(eq(members.workspaceId, bookingHosts.workspaceId), eq(members.id, bookingHosts.memberId)))
      .where(and(eq(bookingHosts.bookingId, bookingId), sql`${bookingHosts.memberId} <> ${row.hostMemberId}::uuid`));
    return { row, page, others };
  });
  if (facts === undefined) return;
  const { row, page, others } = facts;
  const phone = answerOf(row.answers, 'phone');
  const note = answerOf(row.answers, 'note');
  const location = eventLocation(page, phone);
  const written = await retry(
    () =>
      calendar.events({
        workspaceId: scope.workspaceId,
        hostMemberId: row.hostMemberId,
        bookingId,
        title: `${page.title} with ${row.visitorName}`,
        description: [
          `Booked through “${page.title}”.`,
          `Name: ${row.visitorName}`,
          `Email: ${row.visitorEmail}`,
          ...(phone === undefined ? [] : [`Phone: ${phone}`]),
          `Time zone: ${row.visitorTimeZone}`,
          ...(note === undefined ? [] : ['', note]),
        ].join('\n'),
        start: row.startsAt.toISOString(),
        end: row.endsAt.toISOString(),
        attendees: [
          { email: row.visitorEmail, name: row.visitorName },
          ...guestsOf(row.answers)
            .filter((guest) => guest !== row.visitorEmail)
            .map((guest) => ({ email: guest, name: guest })),
          ...others,
        ],
        video: page.location.type === 'video',
        ...(location === undefined ? {} : { location }),
      }),
    'booking.event_failed',
    bookingId,
    log,
  );
  await inWorkspace(scope, (tx) => recordEvent(tx, bookingId, written));
}

/** Three tries of a calendar call; undefined when all failed (logged). */
async function retry<T>(
  call: () => Promise<T>,
  message: string,
  bookingId: string,
  log?: { readonly warn: (message: string, fields: Readonly<Record<string, unknown>>) => void },
): Promise<T | undefined> {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await call();
    } catch (error) {
      log?.warn(message, { bookingId, attempt, error: error instanceof Error ? error.name : 'unknown' });
    }
  }
  return undefined;
}
