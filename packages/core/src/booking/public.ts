// The public booking page's services (spec 0025): the page's facts, its slots,
// and a visitor's booking. Each takes the entry `enterBookingPage` made from
// the public key, so a visitor reaches one page of one workspace and nothing
// else, and each answers only what AC-644 allows (no member email, no other
// booking, no busy event's title, no id but the page's public key).
//
// Booking, adapted from an earlier scheduling build's write path:
// 1. A retry of the same attempt (its idempotency key) answers the first booking.
// 2. The host's calendars are read OUTSIDE any lock (a network call never
//    holds a pooled connection's lock); a calendar refused until reconnect
//    fails closed.
// 3. One transaction holds an advisory lock per host (every required member,
//    in id order), recomputes that day's slots against the bookings it now
//    sees, and refuses SLOT_TAKEN unless the slot is still offered; then
//    inserts the booking (the exclusion constraint refuses an overlap anything
//    let through) and matches or makes the visitor's records under a lock on
//    their email, in a savepoint, so a record refusal never loses the booking.
// 4. After the commit, the calendar event (three tries); a booking whose event
//    failed stays confirmed and is marked for the host.
import { handoffSubmission, handoffVisitor } from '../forms/public.ts';
import { randomUUID } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type {
  PublicBookInput,
  PublicBooking,
  PublicManagedBooking,
  PublicBookingPage,
  PublicLocation,
  PublicSlots,
  PublicSlotsQuery,
} from '@crm/contracts';
import { schema, type WorkspaceTx } from '@crm/db';
import type { BookingEntry } from '../access/door.ts';
import { checkScope } from '../access/mint.ts';
import { inWorkspace } from '../access/run.ts';
import { postgresError, refuse, refuseOn } from '../engine/refusals.ts';
import { runWrite, type AfterWrite } from '../engine/write.ts';
import type { BookingCalendar, BusyReader } from './calendar.ts';
import {
  BUSY_MARGIN_MS,
  bookedSpans,
  loadPage,
  membersBusy,
  membersClosed,
  membersOf,
  pageSlots,
  pickHost,
  type PageRecord,
} from './slots.ts';
import { hostLockKey, lockKey } from './locks.ts';
import { buildBookingIcs } from './ics.ts';
import { matchVisitor } from './visitor.ts';
import { MAX_RESCHEDULES } from './change.ts';
import { enqueueBookingMail, recordEvent } from './mail-queue.ts';
import { ensureManageToken, manageTokenFor, type ManageLinkKey } from './tokens.ts';

const { bookings, members, workspaces } = schema;

/** What the public services need: the calendar calls, the manage link key, and the clock. */
export interface PublicBookingDeps {
  readonly calendar: BookingCalendar & { readonly busy: BusyReader & { readonly fresh?: BusyReader } };
  /** Derives each booking's guest page token (`tokens.ts`). */
  readonly linkKey: ManageLinkKey;
  readonly now?: () => Date;
  /** Where a failed calendar event is reported (the booking itself stands). */
  readonly log?: { warn(message: string, fields: Readonly<Record<string, unknown>>): void };
}

/** Refuses an entry the door didn't make for this page. */
function checkEntry(entry: BookingEntry): void {
  checkScope(entry.scope);
  const { principal } = entry.scope.access;
  if (principal.kind !== 'booking' || principal.pageId !== entry.pageId) {
    throw new Error('Refused a booking entry the door did not make.');
  }
}

/** The page, live and taking bookings: deleted is "no longer available", paused is closed. */
async function livePage(tx: WorkspaceTx, entry: BookingEntry): Promise<PageRecord> {
  return liveOf(await loadPage(tx, entry.pageId));
}

/** `livePage` for a page already read, so a caller never reads it twice. */
function liveOf(page: PageRecord | undefined): PageRecord {
  if (page === undefined || page.isDeleted) throw refuse('NOT_FOUND', 'This page is no longer available.');
  if (page.status !== 'live') throw refuse('BOOKING_CLOSED', 'This page isn’t taking bookings right now.');
  return page;
}

/** The host's name as the workspace shows it, never their email. */
export async function hostName(tx: WorkspaceTx, memberId: string): Promise<string> {
  const [row] = await tx.select({ name: members.name }).from(members).where(eq(members.id, memberId));
  return row?.name ?? '';
}

/** The location a visitor may see. */
function publicLocation(page: PageRecord): PublicLocation {
  return page.location;
}

/** The page's facts for its public page (AC-644: no member email, no internal id). */
export async function getPublicBookingPage(entry: BookingEntry): Promise<PublicBookingPage> {
  checkEntry(entry);
  return inWorkspace(entry.scope, async (tx) => {
    const page = await livePage(tx, entry);
    return {
      publicKey: page.publicKey,
      title: page.title,
      description: page.description,
      hostName: await hostName(tx, page.ownerMemberId),
      durations: page.durations,
      location: publicLocation(page),
      hostTimeZone: page.availability.timeZone,
      windowDays: page.windowDays,
    };
  });
}

/**
 * Whether the signed in person with this user id hosts the page (spec 0028,
 * AC-720): on their own page they get neither the overlay nor the prefill.
 */
export async function isPageHost(entry: BookingEntry, userId: string): Promise<boolean> {
  checkEntry(entry);
  return inWorkspace(entry.scope, async (tx) => {
    const page = await loadPage(tx, entry.pageId);
    if (page === undefined) return false;
    const hosts = [...new Set([page.ownerMemberId, ...(await membersOf(tx, page))])];
    const found = await tx
      .select({ id: members.id })
      .from(members)
      .where(and(inArray(members.id, hosts), eq(members.userId, userId)))
      .limit(1);
    return found.length > 0;
  });
}

/** Refuses a length the page doesn't offer. */
function checkDuration(page: PageRecord, duration: number): void {
  if (!page.durations.some((offered) => offered === duration)) {
    throw refuseOn('CONFIG_INVALID', 'This page doesn’t offer a meeting of that length.', 'duration');
  }
}

/** The page's slots of one length in the range (AC-629, AC-631), start and end only. */
export async function readPublicSlots(
  entry: BookingEntry,
  deps: PublicBookingDeps,
  query: PublicSlotsQuery,
): Promise<PublicSlots> {
  checkEntry(entry);
  const now = deps.now?.() ?? new Date();
  const from = new Date(query.from);
  const to = new Date(query.to);
  const { page, memberIds } = await inWorkspace(entry.scope, async (tx) => {
    const live = await livePage(tx, entry);
    checkDuration(live, query.duration);
    return { page: live, memberIds: await membersOf(tx, live) };
  });
  // Calendars first, outside the database transaction.
  const busy = await membersBusy(
    deps.calendar.busy,
    entry.scope.workspaceId,
    memberIds,
    new Date(from.getTime() - BUSY_MARGIN_MS),
    new Date(to.getTime() + BUSY_MARGIN_MS),
  );
  const margin = { from: new Date(from.getTime() - BUSY_MARGIN_MS), to: new Date(to.getTime() + BUSY_MARGIN_MS) };
  const { booked, closed } = await inWorkspace(entry.scope, async (tx) => ({
    booked: await bookedSpans(tx, memberIds, page.id, from, to),
    closed: await membersClosed(tx, memberIds, page, margin.from, margin.to),
  }));
  const slots = pageSlots(page, { duration: query.duration, from, to, now, busy, bookings: booked, closed });
  return {
    slots: slots.map((slot) => ({ start: slot.start.toISOString(), end: slot.end.toISOString() })),
    calendar: busy.blocked ? 'unreachable' : 'ok',
  };
}

/** What a booking keeps of the visitor's answers: their number, note and guests (milestone 2 adds the questions). */
function answersOf(input: PublicBookInput): Readonly<Record<string, unknown>> {
  const guests = [...new Set((input.guests ?? []).filter((guest) => guest !== input.email))];
  return {
    ...(input.phone === undefined || input.phone === '' ? {} : { phone: input.phone }),
    ...(input.note === undefined || input.note === '' ? {} : { note: input.note }),
    ...(guests.length === 0 ? {} : { guests }),
  };
}

/** The text the calendar event carries: who booked and how to reach them. */
function eventDescription(page: PageRecord, input: PublicBookInput): string {
  return [
    `Booked through “${page.title}”.`,
    `Name: ${input.name}`,
    `Email: ${input.email}`,
    ...(input.phone === undefined || input.phone === '' ? [] : [`Phone: ${input.phone}`]),
    `Time zone: ${input.timeZone}`,
    ...(input.note === undefined || input.note === '' ? [] : ['', input.note]),
  ].join('\n');
}

/** The location line of the event, for anything but video. */
function eventLocation(page: PageRecord, input: PublicBookInput): string | undefined {
  switch (page.location.type) {
    case 'video':
      return undefined;
    case 'phone':
      return input.phone === undefined || input.phone === '' ? undefined : `Phone: ${input.phone}`;
    default:
      return page.location.value;
  }
}

/** A booking, as its visitor sees it. */
interface Booked {
  readonly bookingId: string;
  readonly replayed: boolean;
  readonly booking: PublicBooking;
  /** The guest page's token, derived from the booking's id: a replay answers the same one. */
  readonly manageToken: string;
}

/**
 * A visitor's booking (AC-632 to AC-634): see the header for the steps.
 * `hooks` are the write's (the outbox hook, so the records it makes reach
 * screens live). Refuses SLOT_TAKEN when the slot is gone, BOOKING_CLOSED for
 * a paused page or a host whose calendar can't be read.
 */
export async function bookPublicSlot(
  entry: BookingEntry,
  deps: PublicBookingDeps,
  input: PublicBookInput,
  hooks: readonly AfterWrite[] = [],
  /** The form submission a verified hand off named (AC-1058): stored on the booking when it is this workspace's. */
  link?: { readonly submissionId: string },
): Promise<Booked> {
  checkEntry(entry);
  const now = deps.now?.() ?? new Date();
  const start = new Date(input.start);
  const end = new Date(start.getTime() + input.duration * 60_000);
  const workspaceId = entry.scope.workspaceId;

  const replay = async (tx: WorkspaceTx, page: PageRecord): Promise<Booked | undefined> => {
    const [row] = await tx
      .select()
      .from(bookings)
      .where(and(eq(bookings.pageId, page.id), eq(bookings.idempotencyKey, input.idempotencyKey)));
    if (row === undefined) return undefined;
    return {
      bookingId: row.id,
      replayed: true,
      manageToken: await ensureManageToken(tx, deps.linkKey, row),
      booking: {
        start: row.startsAt.toISOString(),
        end: row.endsAt.toISOString(),
        title: page.title,
        hostName: await hostName(tx, row.hostMemberId),
        location: publicLocation(page),
        timeZone: row.visitorTimeZone,
      },
    };
  };

  // 1. The page, the length, a retry.
  type First =
    | { readonly again: Booked }
    | { readonly page: PageRecord; readonly memberIds: readonly string[]; readonly host: string };
  const first = await inWorkspace(entry.scope, async (tx): Promise<First> => {
    const page = await loadPage(tx, entry.pageId);
    const again = page === undefined ? undefined : await replay(tx, page);
    if (again !== undefined) return { again };
    const live = liveOf(page);
    checkDuration(live, input.duration);
    if (live.location.type === 'phone' && (input.phone ?? '').trim() === '') {
      throw refuseOn('VALUE_REQUIRED', 'Give a number to call you on.', 'phone');
    }
    const memberIds = await membersOf(tx, live);
    return { page: live, memberIds, host: pickHost(live, memberIds) };
  });
  if ('again' in first) return first.again;
  const { page, memberIds, host } = first;

  // 2. The calendars, outside any lock: the day around the slot, read fresh.
  const dayFrom = new Date(start.getTime() - 86_400_000);
  const dayTo = new Date(start.getTime() + 86_400_000);
  const busy = await membersBusy(
    deps.calendar.busy.fresh ?? deps.calendar.busy,
    workspaceId,
    memberIds,
    new Date(dayFrom.getTime() - BUSY_MARGIN_MS),
    new Date(dayTo.getTime() + BUSY_MARGIN_MS),
  );
  if (busy.blocked) throw refuse('BOOKING_CLOSED', 'This page can’t take bookings right now. Try again later.');

  // 3. Check and reserve, atomically, under the hosts' locks. The id is made here, so the token derives from it.
  const newId = randomUUID();
  const { token, hash: tokenHash } = manageTokenFor(deps.linkKey, newId);
  const name = await inWorkspace(entry.scope, (tx) => hostName(tx, host));
  const { result } = await runWrite(
    entry.scope,
    async (context) => {
      const { tx } = context;
      for (const memberId of [...memberIds].sort()) await lockKey(tx, hostLockKey(workspaceId, memberId));
      const again = await replay(tx, page);
      if (again !== undefined) return again;
      const held = await bookedSpans(tx, memberIds, page.id, dayFrom, dayTo);
      const closed = await membersClosed(
        tx,
        memberIds,
        page,
        new Date(dayFrom.getTime() - BUSY_MARGIN_MS),
        new Date(dayTo.getTime() + BUSY_MARGIN_MS),
      );
      const offered = pageSlots(page, {
        duration: input.duration,
        from: dayFrom,
        to: dayTo,
        now,
        busy,
        bookings: held,
        closed,
      });
      if (!offered.some((slot) => slot.start.getTime() === start.getTime())) {
        throw refuse('SLOT_TAKEN', 'That time was just taken. Pick another.');
      }
      const blockStart = new Date(start.getTime() - page.bufferBefore * 60_000);
      const blockEnd = new Date(end.getTime() + page.bufferAfter * 60_000);
      const actor = { type: 'booking' as const, id: page.id, memberId: null };
      let bookingId: string;
      try {
        // A hand off names a submission; it is linked only when it is this workspace's and its form sends its
        // visitors on to this very page.
        const submissionId = link === undefined ? undefined : await handoffSubmission(tx, link.submissionId, page.id);
        const [row] = await tx
          .insert(bookings)
          .values({
            workspaceId,
            id: newId,
            pageId: page.id,
            hostMemberId: host,
            startsAt: start,
            endsAt: end,
            during: sql`tstzrange(${blockStart.toISOString()}::timestamptz, ${blockEnd.toISOString()}::timestamptz, '[)')`,
            visitorName: input.name,
            visitorEmail: input.email,
            visitorTimeZone: input.timeZone,
            answers: answersOf(input),
            ...(submissionId === undefined ? {} : { submissionId }),
            manageTokenHash: tokenHash,
            manageTokenDerived: true,
            idempotencyKey: input.idempotencyKey,
            createdByType: actor.type,
            createdById: actor.id,
            createdByMemberId: actor.memberId,
            updatedByType: actor.type,
            updatedById: actor.id,
            updatedByMemberId: actor.memberId,
          })
          .returning({ id: bookings.id });
        if (row === undefined) throw new Error('The booking was not stored.');
        bookingId = row.id;
        // The reminders with the booking; the confirmation after its event, so it knows whether the calendar invited them.
        await enqueueBookingMail(tx, bookingId, ['reminder_24h', 'reminder_1h']);
      } catch (error) {
        // The lock should make this unreachable: a write that skipped it, refused by the database.
        if (postgresError(error)?.code === '23P01')
          throw refuse('SLOT_TAKEN', 'That time was just taken. Pick another.');
        throw error;
      }
      // The visitor's records, under a lock on their email, in a savepoint: a refusal keeps the booking.
      await lockKey(tx, `booking:email:${workspaceId}:${input.email}`);
      const matched = await context.perRecord((step) =>
        matchVisitor(
          step,
          { people: entry.people, companies: entry.companies },
          { name: input.name, email: input.email, timeZone: input.timeZone },
        ),
      );
      if (matched.ok && (matched.value.personId !== undefined || matched.value.companyId !== undefined)) {
        await tx
          .update(bookings)
          .set({ personRecordId: matched.value.personId ?? null, companyRecordId: matched.value.companyId ?? null })
          .where(eq(bookings.id, bookingId));
      }
      return {
        bookingId,
        replayed: false,
        manageToken: token,
        booking: {
          start: start.toISOString(),
          end: end.toISOString(),
          title: page.title,
          hostName: name,
          location: publicLocation(page),
          timeZone: input.timeZone,
        },
      } satisfies Booked;
    },
    hooks,
  );
  if (result.replayed) return result;

  // 4. The calendar event, after the commit: three tries, then the booking stands without one.
  let written: Awaited<ReturnType<BookingCalendar['events']>> | undefined;
  for (let attempt = 1; attempt <= 3 && written === undefined; attempt += 1) {
    try {
      written = await deps.calendar.events({
        workspaceId,
        hostMemberId: host,
        bookingId: result.bookingId,
        pageId: entry.pageId,
        title: `${page.title} with ${input.name}`,
        description: eventDescription(page, input),
        start: start.toISOString(),
        end: end.toISOString(),
        attendees: [
          { email: input.email, name: input.name },
          ...(input.guests ?? [])
            .filter((guest) => guest !== input.email)
            .map((guest) => ({ email: guest, name: guest })),
        ],
        video: page.location.type === 'video',
        ...(eventLocation(page, input) === undefined ? {} : { location: eventLocation(page, input) }),
      });
    } catch (error) {
      deps.log?.warn('booking.event_failed', {
        bookingId: result.bookingId,
        attempt,
        error: error instanceof Error ? error.name : 'unknown',
      });
    }
  }
  // The outcome, and the emails (after the event, so the confirmation knows whether the calendar already invited them).
  await inWorkspace(entry.scope, async (tx) => {
    await recordEvent(tx, result.bookingId, written);
    await enqueueBookingMail(tx, result.bookingId, ['confirmed']);
  });
  return result;
}

/** The answers a booking keeps, read back as the guest page shows them. */
function storedAnswers(answers: unknown): { readonly note?: string; readonly guests: readonly string[] } {
  if (typeof answers !== 'object' || answers === null) return { guests: [] };
  const note = 'note' in answers && typeof answers.note === 'string' ? answers.note : undefined;
  const guests =
    'guests' in answers && Array.isArray(answers.guests)
      ? answers.guests.filter((guest): guest is string => typeof guest === 'string')
      : [];
  return { ...(note === undefined ? {} : { note }), guests };
}

/**
 * The name and email a form's hand off names (spec 0023 AC-1058), for the
 * booking page's prefill: read from the stored submission in this page's
 * workspace, never from the link. Empty for a submission that isn't there.
 */
export async function readHandoffPrefill(
  entry: BookingEntry,
  submissionId: string,
): Promise<{ readonly name?: string; readonly email?: string }> {
  checkEntry(entry);
  return inWorkspace(entry.scope, (tx) => handoffVisitor(tx, submissionId, entry.pageId));
}

/**
 * The booking a manage token opens, as its guest sees it (AC-674): its state
 * (confirmed, cancelled, or past once it ended), the time, the page's facts,
 * the visitor, guests and note. A deleted page still shows its bookings.
 */
export async function readManagedBooking(
  entry: BookingEntry & { readonly bookingId: string },
  now: Date = new Date(),
): Promise<PublicManagedBooking> {
  checkEntry(entry);
  return inWorkspace(entry.scope, async (tx) => {
    const [row] = await tx.select().from(bookings).where(eq(bookings.id, entry.bookingId));
    const page = await loadPage(tx, entry.pageId);
    if (row === undefined || page === undefined) throw refuse('NOT_FOUND', 'This link doesn’t open a booking.');
    const answers = storedAnswers(row.answers);
    const canChange = row.status === 'confirmed' && row.startsAt.getTime() > now.getTime();
    const [workspace] = await tx.select({ slug: workspaces.slug }).from(workspaces).limit(1);
    return {
      workspaceSlug: workspace?.slug ?? '',
      canChange,
      canMove: canChange && !page.isDeleted && page.status === 'live' && row.reschedules < MAX_RESCHEDULES,
      ...(row.cancelReason === null ? {} : { cancelReason: row.cancelReason }),
      state: row.status === 'cancelled' ? 'cancelled' : row.endsAt.getTime() <= now.getTime() ? 'past' : 'confirmed',
      publicKey: page.publicKey,
      title: page.title,
      hostName: await hostName(tx, row.hostMemberId),
      start: row.startsAt.toISOString(),
      end: row.endsAt.toISOString(),
      timeZone: row.visitorTimeZone,
      location: publicLocation(page),
      ...(row.videoUrl === null ? {} : { videoUrl: row.videoUrl }),
      visitorName: row.visitorName,
      visitorEmail: row.visitorEmail,
      guests: [...answers.guests],
      ...(answers.note === undefined ? {} : { note: answers.note }),
    };
  });
}

/** Where the calendar entry is sent from, and the app it points back to. */
export interface IcsOrigin {
  /** The app's origin (`https://app.example`): the UID's domain and the guest page's address. */
  readonly appOrigin: string;
  readonly organizerEmail: string;
  readonly organizerName: string;
}

/** The booking a manage token opens, as an `.ics` file for Add to calendar (AC-674). */
export async function managedBookingIcs(
  entry: BookingEntry & { readonly bookingId: string },
  token: string,
  origin: IcsOrigin,
  now: Date = new Date(),
): Promise<string> {
  const booking = await readManagedBooking(entry, now);
  const where =
    booking.videoUrl ??
    (booking.location.type === 'address' || booking.location.type === 'custom' ? booking.location.value : undefined);
  return buildBookingIcs({
    bookingId: entry.bookingId,
    uidDomain: new URL(origin.appOrigin).host,
    method: booking.state === 'cancelled' ? 'CANCEL' : 'REQUEST',
    start: new Date(booking.start),
    end: new Date(booking.end),
    summary: `${booking.title} with ${booking.hostName}`,
    description: booking.note ?? '',
    ...(where === undefined ? {} : { location: where }),
    url: `${origin.appOrigin}/b/${booking.publicKey}/manage?t=${token}`,
    organizerEmail: origin.organizerEmail,
    organizerName: origin.organizerName,
    attendees: [{ name: booking.visitorName, email: booking.visitorEmail }],
    // Grows with each download, so a calendar holding an earlier copy takes this one (a move's new time).
    sequence: Math.floor(now.getTime() / 1000),
    now,
  });
}
