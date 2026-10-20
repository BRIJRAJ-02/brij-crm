// A booking the member makes themselves (spec 0027, AC-709 to AC-712): Book
// someone in, from a span drawn on Bookings › Calendar. It is a real booking
// on one of their pages, but the member's own time is theirs to give: it skips
// the page's offered slots, hours, holds, notice and buffers, and is refused
// only when it would overlap another confirmed booking of theirs (the host
// lock, then the exclusion constraint), is in the past, or runs under 5
// minutes or past 8 hours. The guest is filed as a person like a visitor is;
// the calendar event, with every guest invited, is written after the commit.
import { and, eq, isNull, sql } from 'drizzle-orm';
import { PERMISSIONS } from '@crm/contracts';
import { schema } from '@crm/db';
import { requirePermission } from '../access/check.ts';
import type { EngineScope } from '../access/mint.ts';
import { inWorkspace } from '../access/run.ts';
import { postgresError, refuse, refuseOn } from '../engine/refusals.ts';
import { runWrite, type AfterWrite } from '../engine/write.ts';
import type { BookingCalendar } from './calendar.ts';
import { hostLockKey, lockKey } from './locks.ts';
import { newManageToken } from './public.ts';
import { loadPage } from './slots.ts';
import { matchVisitor } from './visitor.ts';

const { bookingPageMembers, bookings, objects } = schema;

/** The shortest and longest meeting a member books in themselves, in minutes. */
export const HOST_BOOKING_MINUTES = { min: 5, max: 480 } as const;

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
}

/** What the member's booking needs from outside: the calendar to write its event to, and the clock. */
export interface HostBookingDeps {
  readonly calendar: Pick<BookingCalendar, 'events'>;
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
  // The guest page's token: only its hash is kept, and the guest reaches the booking from the invitation (emails, M2).
  const { hash } = newManageToken();
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
      await lockKey(tx, hostLockKey(scope.workspaceId, host));
      const [again] = await tx
        .select({ id: bookings.id })
        .from(bookings)
        .where(and(eq(bookings.pageId, page.id), eq(bookings.idempotencyKey, input.idempotencyKey)));
      if (again !== undefined) return { bookingId: again.id, replayed: true, title: page.title, video: false };
      const by = { type: 'member' as const, id: host, memberId: host };
      let bookingId: string;
      try {
        const [row] = await tx
          .insert(bookings)
          .values({
            workspaceId: scope.workspaceId,
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
      } catch (error) {
        if (postgresError(error)?.code === '23P01') throw refuse('SLOT_TAKEN', TAKEN);
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
      return { bookingId, replayed: false, title: page.title, video: page.location.type === 'video' };
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
        video: result.video,
      });
    } catch (error) {
      deps.log?.warn('booking.event_failed', {
        bookingId: result.bookingId,
        attempt,
        error: error instanceof Error ? error.name : 'unknown',
      });
    }
  }
  await inWorkspace(scope, (tx) =>
    tx
      .update(bookings)
      .set(
        written === undefined
          ? { eventFailedAt: sql`now()` }
          : { meetingId: written.meetingId ?? null, videoUrl: written.videoUrl ?? null, updatedAt: sql`now()` },
      )
      .where(eq(bookings.id, result.bookingId)),
  );
  return { bookingId: result.bookingId, replayed: false };
}
