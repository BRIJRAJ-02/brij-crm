// A booking the member makes themselves (spec 0027, AC-709 to AC-712): Book
// someone in, from a span drawn on Bookings › Calendar. It is a real booking
// on one of their pages, but the member's own time is theirs to give: it skips
// the page's offered slots, hours, holds, notice and buffers, and is refused
// only when it would overlap another confirmed booking of theirs (the host
// lock, then the exclusion constraint), is in the past, or runs under 5
// minutes or past 8 hours. The guest is filed as a person like a visitor is;
// the calendar event, with every guest invited, is written after the commit,
// on the calendar the member picked (one of their own they can write), else
// the page's own "Add events to", else their default. A member may book in a
// colleague whose scheduling they Manage (spec 0037, AC-1272), on that
// colleague's page and calendars, never one the actor picks (decision 14);
// it is audited as `booking.changed_for` (AC-1263).
import { randomUUID } from 'node:crypto';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { HOST_BOOKING_LIMITS, PERMISSIONS } from '@crm/contracts';
import { schema, type WorkspaceTx } from '@crm/db';
import { requirePermission } from '../access/check.ts';
import { objectLevel } from '../access/policy.ts';
import type { EngineScope } from '../access/mint.ts';
import { inWorkspace } from '../access/run.ts';
import { actingFor } from '../access/scheduling.ts';
import { isUuid } from '../engine/ids.ts';
import { postgresError, refuse, refuseOn } from '../engine/refusals.ts';
import { runWrite, type AfterWrite } from '../engine/write.ts';
import { writeAudit } from '../members/audit.ts';
import type { BookingCalendar } from './calendar.ts';
import { hostLockKey, lockKey } from './locks.ts';
import { enqueueBookingMail, recordEvent } from './mail-queue.ts';
import { loadPage } from './slots.ts';
import { manageTokenFor, type ManageLinkKey } from './tokens.ts';
import { matchVisitor } from './visitor.ts';

const { attributes, bookingPageMembers, bookings, members, objects } = schema;

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
  /** Who hosts it, when not the caller: a colleague they Manage (spec 0037, AC-1272). */
  readonly forMemberId?: string | undefined;
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
const NOT_YOUR_CALENDAR = 'Only they choose which of their calendars a meeting goes on.';

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
/** Why a guest booked in isn't in the CRM, when the refusal says nothing itself. */
const NOT_IN_CRM = 'Something stopped their record being made. Ask a workspace admin.';

/**
 * Why the guest's record couldn't be made, for the member who booked them in: a required field named with its
 * object and what fixes it ("Desk phone on People is required and nothing fills it."), since the record form's
 * "Give it a value." has nowhere to go after a booking. A field the member can't see stays unnamed (its refusal
 * carries no attribute), and any other refusal says what it says.
 */
async function notInCrmReason(
  tx: WorkspaceTx,
  refusal: { readonly code: string; readonly message: string; readonly attributeId?: string } | undefined,
): Promise<string> {
  if (refusal === undefined) return NOT_IN_CRM;
  if (refusal.code !== 'VALUE_REQUIRED' || refusal.attributeId === undefined) return refusal.message;
  const [field] = await tx
    .select({ title: attributes.title, object: objects.pluralName })
    .from(attributes)
    .innerJoin(objects, eq(objects.id, attributes.objectId))
    .where(eq(attributes.id, refusal.attributeId));
  if (field === undefined) return refusal.message;
  return `${field.title} on ${field.object} is required and nothing fills it. Give it a default, or make it optional.`;
}

export async function bookAsHost(
  scope: EngineScope,
  deps: HostBookingDeps,
  input: HostBookingInput,
  hooks: readonly AfterWrite[] = [],
): Promise<{ readonly bookingId: string; readonly replayed: boolean; readonly notInCrm?: string }> {
  const actor = bookingHost(scope);
  const host = input.forMemberId ?? actor;
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
      if (host !== actor) {
        // Someone else's time (spec 0037): Manage over them, and nobody picks another person's calendar (decision 14).
        await actingFor(tx, scope, host, 'manage');
        if (input.calendarId !== undefined) throw refuseOn('FORBIDDEN', NOT_YOUR_CALENDAR, 'calendarId');
      }
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
        .where(
          and(
            eq(bookings.pageId, page.id),
            eq(bookings.idempotencyKey, input.idempotencyKey),
            eq(bookings.hostMemberId, host),
          ),
        );
      if (again !== undefined) return { bookingId: again.id, replayed: true, title: page.title, place: undefined };
      // After the retry check: a retry answers the booking it made, even once that calendar is disconnected.
      if (input.calendarId !== undefined) await checkCalendar(tx, host, input.calendarId);
      const by = { type: 'member' as const, id: actor, memberId: actor };
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
        if (host !== actor) {
          await writeAudit(tx, scope.workspaceId, scope.actor, {
            action: 'booking.changed_for',
            targetType: 'booking',
            targetId: bookingId,
            after: { memberId: host, change: 'made' },
          });
        }
        // The reminders with the booking; the confirmation after its event, so it knows whether the calendar invited them.
        await enqueueBookingMail(tx, bookingId, ['reminder_24h', 'reminder_1h']);
      } catch (error) {
        if (postgresError(error)?.code === '23P01') throw refuse('SLOT_TAKEN', TAKEN);
        // The same key on this page from someone else's booking: a client reused it, so nothing is booked.
        if (postgresError(error)?.code === '23505') throw refuse('ID_TAKEN', REUSED);
        throw error;
      }
      // The guest's records, as for a visitor, in a savepoint: a refusal (no right to add people) keeps the booking.
      let notInCrm: string | undefined;
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
        // Refused (a required field nothing fills, no right to add people): the booking stands, and the member who
        // booked it is told why the guest isn't in the CRM, rather than finding out later (late trap #71).
        // Only to a member who may see both objects: for one who can't, a refusal would tell a new guest from one
        // already in the CRM, since a match reads past their access (security review, 29 Oct 2026).
        const seesBoth =
          objectLevel(scope.access, people) !== 'none' && objectLevel(scope.access, companies) !== 'none';
        if (!matched.ok && seesBoth) notInCrm = await notInCrmReason(tx, matched.refusals[0]);
        if (matched.ok && (matched.value.personId !== undefined || matched.value.companyId !== undefined)) {
          await tx
            .update(bookings)
            .set({ personRecordId: matched.value.personId ?? null, companyRecordId: matched.value.companyId ?? null })
            .where(eq(bookings.id, bookingId));
        }
      }
      return { bookingId, replayed: false, title: page.title, place: page.location, notInCrm };
    },
    hooks,
  );
  if (result.replayed) return { bookingId: result.bookingId, replayed: true };

  // The member who booked them in goes on the event too, first. The event sits on that member's calendar, so the
  // provider makes them its organiser and marks them accepted rather than inviting them to their own meeting, but a
  // guest's own copy never shows the organiser: without this the person booked in reads "<title> with <themselves>",
  // one guest, themselves, and nothing naming who booked them (owner, 25 Oct 2026, the same fault as a public
  // booking). Their name, not just an address, so the copy reads as a person.
  const [booker] = await inWorkspace(scope, (tx) =>
    tx.select({ email: members.email, name: members.name }).from(members).where(eq(members.id, host)),
  );

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
          host === actor
            ? `Booked in by you through “${result.title}”.`
            : `Booked in for you through “${result.title}”.`,
          ...(input.message === undefined || input.message.trim() === '' ? [] : ['', input.message.trim()]),
        ].join('\n'),
        start: input.start.toISOString(),
        end: end.toISOString(),
        attendees: [
          ...(booker === undefined ? [] : [booker]),
          { email: input.email, name: input.name },
          // A member who typed their own address into the guests is already on it, by name, as the first attendee.
          ...guests
            .filter((guest) => guest !== booker?.email.trim().toLowerCase())
            .map((guest) => ({ email: guest, name: guest })),
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
  return {
    bookingId: result.bookingId,
    replayed: false,
    ...(result.notInCrm === undefined ? {} : { notInCrm: result.notInCrm }),
  };
}
