// A booking the member makes themselves (spec 0027, AC-709 to AC-712): Book
// someone in, from a span drawn on Bookings › Calendar. It is a real booking
// on one of their pages, but the member's own time is theirs to give: it skips
// the page's offered slots, hours, holds, notice and buffers, and is refused
// only when it would overlap another confirmed booking of theirs (the host
// lock, then the exclusion constraint), is in the past, or runs under 5
// minutes or past 8 hours. The guest is filed as a person like a visitor is;
// the calendar event, with every guest invited, is written after the commit,
// on the calendar the member picked (one of their own they can write), else
// the page's own "Add events to", else their default.
import { randomUUID } from 'node:crypto';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { HOST_BOOKING_LIMITS, PERMISSIONS } from '@crm/contracts';
import { schema, type WorkspaceTx } from '@crm/db';
import { requirePermission } from '../access/check.ts';
import type { EngineScope } from '../access/mint.ts';
import { inWorkspace } from '../access/run.ts';
import { isUuid } from '../engine/ids.ts';
import { postgresError, refuse, refuseOn } from '../engine/refusals.ts';
import { runWrite, type AfterWrite } from '../engine/write.ts';
import type { BookingCalendar } from './calendar.ts';
import { hostLockKey, lockKey } from './locks.ts';
import { enqueueBookingMail, recordEvent } from './mail-queue.ts';
import { loadPage } from './slots.ts';
import { manageTokenFor, type ManageLinkKey } from './tokens.ts';
import { matchVisitor } from './visitor.ts';

const { bookingPageMembers, bookings, objects } = schema;

/** The shortest and longest meeting a member books in themselves, in minutes: the contract's bounds, so they can't drift. */
export const HOST_BOOKING_MINUTES = HOST_BOOKING_LIMITS;

/** Book someone in: who, when, on which page, and what to tell them. */
export interface HostBookingInput {
  /** Minted once per dialog, so a retry gives back the booking the first made. */
  readonly idempotencyKey: string;
  readonly pageId: string;
  readonly start: Date;
  readonly minutes: number;
  readonly name: string;
  readonly email: string;
  readonly timeZone: string;
  readonly guests: readonly string[];
  readonly message?: string | undefined;
  /**
   * The member's own calendar the event goes on (`calendar_calendars.id`), when they picked one: refused unless it
   * is theirs to write on an account that works. Absent, the page's own "Add events to", else their default.
   */
  readonly calendarId?: string | undefined;
}

/** What the member's booking needs from outside: the calendar to write its event to, and the clock. */
export interface HostBookingDeps {
  readonly calendar: Pick<BookingCalendar, 'events'>;
  /** Derives the guest page's token (`tokens.ts`), which their email carries. */
  readonly linkKey: ManageLinkKey;
  readonly now?: () => Date;
  readonly log?: { warn(message: string, fields: Readonly<Record<string, unknown>>): void };
}

/** The member the scope acts for, who hosts what they book in. */
function bookingHost(scope: EngineScope): string {
  requirePermission(scope, 'booking.manage');
  const { principal } = scope.access;
  if (principal.kind !== 'member') throw refuse('FORBIDDEN', PERMISSIONS['booking.manage'].message);
  return principal.memberId;
}

const TAKEN = 'Something else is already in that time.';
const REUSED = 'That request was already used. Open New meeting again to book.';
const NO_SUCH_CALENDAR = 'That calendar isn’t one of yours, or can’t take events now. Pick another.';

/**
 * Refuses a picked calendar the host can't put the event on (NOT_FOUND on `calendarId`): it must be one of their
 * own, which they own or can write, on an account that still works, as the event writer's destination rule has it.
 * Anyone else's calendar answers the same as one that doesn't exist.
 */
async function checkCalendar(tx: WorkspaceTx, host: string, calendarId: string): Promise<void> {
  if (!isUuid(calendarId)) throw refuseOn('NOT_FOUND', NO_SUCH_CALENDAR, 'calendarId');
  const found = await tx.execute<{ id: string }>(sql`
    select k.id::text as id
    from calendar_calendars k
    join calendar_connections c on c.workspace_id = k.workspace_id and c.id = k.connection_id
    where k.id = ${calendarId}::uuid and k.member_id = ${host}::uuid and k.access_role in ('owner', 'writer')
      and c.status in ('syncing', 'connected', 'failed')
  `);
  if (found.rows.length === 0) throw refuseOn('NOT_FOUND', NO_SUCH_CALENDAR, 'calendarId');
}

/**
 * Books a guest into the member's own time (AC-709, AC-710): answers the
 * booking's id, the same one again for a retry. Refuses NOT_FOUND for a page
 * the member isn't on, CONFIG_INVALID for a length out of bounds or a time
 * gone by, SLOT_TAKEN when it overlaps another of their bookings.
 */
export async function bookAsHost(
  scope: EngineScope,
  deps: HostBookingDeps,
  input: HostBookingInput,
  hooks: readonly AfterWrite[] = [],
): Promise<{ readonly bookingId: string; readonly replayed: boolean }> {
  const host = bookingHost(scope);
  const now = deps.now?.() ?? new Date();
  if (
    !Number.isInteger(input.minutes) ||
    input.minutes < HOST_BOOKING_MINUTES.min ||
    input.minutes > HOST_BOOKING_MINUTES.max
  ) {
    throw refuseOn('CONFIG_INVALID', 'A meeting is 5 minutes to 8 hours long.', 'minutes');
  }
  if (input.start.getTime() < now.getTime()) {
    throw refuseOn('CONFIG_INVALID', 'That time has gone by. Pick a time from now on.', 'start');
  }
  const end = new Date(input.start.getTime() + input.minutes * 60_000);
  // The guest page's token: only its hash is kept, and the guest reaches the booking from their email.
  const newId = randomUUID();
  const { hash } = manageTokenFor(deps.linkKey, newId);
  const guests = [...new Set(input.guests.map((guest) => guest.trim().toLowerCase()))].filter(
    (guest) => guest !== '' && guest !== input.email,
  );

  const { result } = await runWrite(
    scope,
    async (context) => {
      const { tx } = context;
      const page = await loadPage(tx, input.pageId);
      const [onPage] =
        page === undefined || page.isDeleted
          ? []
          : await tx
              .select({ memberId: bookingPageMembers.memberId })
              .from(bookingPageMembers)
              .where(and(eq(bookingPageMembers.pageId, page.id), eq(bookingPageMembers.memberId, host)));
      if (page === undefined || onPage === undefined) {
        throw refuseOn('NOT_FOUND', 'That booking page doesn’t exist, or isn’t yours.', 'pageId');
      }
      if (input.calendarId !== undefined) await checkCalendar(tx, host, input.calendarId);
      await lockKey(tx, hostLockKey(scope.workspaceId, host));
      const [again] = await tx
        .select({ id: bookings.id })
        .from(bookings)
        .where(
          and(
            eq(bookings.pageId, page.id),
            eq(bookings.idempotencyKey, input.idempotencyKey),
            eq(bookings.hostMemberId, host),
          ),
        );
      if (again !== undefined) return { bookingId: again.id, replayed: true, title: page.title, place: undefined };
      const by = { type: 'member' as const, id: host, memberId: host };
      let bookingId: string;
      try {
        const [row] = await tx
          .insert(bookings)
          .values({
            workspaceId: scope.workspaceId,
            id: newId,
            pageId: page.id,
            hostMemberId: host,
            startsAt: input.start,
            endsAt: end,
            during: sql`tstzrange(${input.start.toISOString()}::timestamptz, ${end.toISOString()}::timestamptz, '[)')`,
            visitorName: input.name,
            visitorEmail: input.email,
            visitorTimeZone: input.timeZone,
            answers: {
              ...(guests.length === 0 ? {} : { guests }),
              ...(input.message === undefined || input.message.trim() === '' ? {} : { note: input.message.trim() }),
              bookedBy: 'host',
            },
            manageTokenHash: hash,
            manageTokenDerived: true,
            idempotencyKey: input.idempotencyKey,
            createdByType: by.type,
            createdById: by.id,
            createdByMemberId: by.memberId,
            updatedByType: by.type,
            updatedById: by.id,
            updatedByMemberId: by.memberId,
          })
          .returning({ id: bookings.id });
        if (row === undefined) throw new Error('The booking was not stored.');
        bookingId = row.id;
        // The reminders with the booking; the confirmation after its event, so it knows whether the calendar invited them.
        await enqueueBookingMail(tx, bookingId, ['reminder_24h', 'reminder_1h']);
      } catch (error) {
        if (postgresError(error)?.code === '23P01') throw refuse('SLOT_TAKEN', TAKEN);
        // The same key on this page from someone else's booking: a client reused it, so nothing is booked.
        if (postgresError(error)?.code === '23505') throw refuse('ID_TAKEN', REUSED);
        throw error;
      }
      // The guest's records, as for a visitor, in a savepoint: a refusal (no right to add people) keeps the booking.
      const standard = await tx
        .select({ id: objects.id, key: objects.standardKey })
        .from(objects)
        .where(and(sql`${objects.standardKey} in ('people', 'companies')`, isNull(objects.archivedAt)));
      const people = standard.find((each) => each.key === 'people')?.id;
      const companies = standard.find((each) => each.key === 'companies')?.id;
      if (people !== undefined && companies !== undefined) {
        await lockKey(tx, `booking:email:${scope.workspaceId}:${input.email}`);
        const matched = await context.perRecord((step) =>
          matchVisitor(step, { people, companies }, { name: input.name, email: input.email, timeZone: input.timeZone }),
        );
        if (matched.ok && (matched.value.personId !== undefined || matched.value.companyId !== undefined)) {
          await tx
            .update(bookings)
            .set({ personRecordId: matched.value.personId ?? null, companyRecordId: matched.value.companyId ?? null })
            .where(eq(bookings.id, bookingId));
        }
      }
      return { bookingId, replayed: false, title: page.title, place: page.location };
    },
    hooks,
  );
  if (result.replayed) return { bookingId: result.bookingId, replayed: true };

  // The calendar event, after the commit: three tries, then the booking stands without one (it says so).
  let written: Awaited<ReturnType<BookingCalendar['events']>> | undefined;
  for (let attempt = 1; attempt <= 3 && written === undefined; attempt += 1) {
    try {
      written = await deps.calendar.events({
        workspaceId: scope.workspaceId,
        hostMemberId: host,
        bookingId: result.bookingId,
        pageId: input.pageId,
        ...(input.calendarId === undefined ? {} : { calendarId: input.calendarId }),
        title: `${result.title} with ${input.name}`,
        description: [
          `Booked in by you through “${result.title}”.`,
          ...(input.message === undefined || input.message.trim() === '' ? [] : ['', input.message.trim()]),
        ].join('\n'),
        start: input.start.toISOString(),
        end: end.toISOString(),
        attendees: [
          { email: input.email, name: input.name },
          ...guests.map((guest) => ({ email: guest, name: guest })),
        ],
        video: result.place?.type === 'video',
        // In person or a custom place goes on the event; a phone page's number is the guest's, which isn't asked here.
        ...(result.place === undefined || result.place.type === 'video' || result.place.type === 'phone'
          ? {}
          : { location: result.place.value }),
      });
    } catch (error) {
      deps.log?.warn('booking.event_failed', {
        bookingId: result.bookingId,
        attempt,
        error: error instanceof Error ? error.name : 'unknown',
      });
    }
  }
  await inWorkspace(scope, async (tx) => {
    await recordEvent(tx, result.bookingId, written);
    await enqueueBookingMail(tx, result.bookingId, ['confirmed']);
  });
  return { bookingId: result.bookingId, replayed: false };
}
