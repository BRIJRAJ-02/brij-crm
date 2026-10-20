// Changing a booking (spec 0025, milestone 2): the guest's move, guests and
// cancel by their token, the host's move and cancel through the access door,
// the calendar event following each change, and the emails queued with it.
// Against a real Postgres.
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import type { PublicBookInput } from '@crm/contracts';
import { createDatabase, type Database } from '@crm/db';
import { testQuery } from '@crm/db/testing';
import { enterBookingByToken, enterBookingPage } from '../access/door.ts';
import { newId } from '../engine/ids.ts';
import { isRefusal } from '../engine/refusals.ts';
import { createWorkspace } from '../engine/workspaces.ts';
import { rescope, testScope } from '../testing.ts';
import type { BookingCalendar, EventChange, EventRef } from './calendar.ts';
import {
  addGuests,
  removeGuest,
  bookingGuestPath,
  cancelBooking,
  guestTarget,
  hostTarget,
  MAX_RESCHEDULES,
  moveBooking,
  readMoveSlots,
} from './change.ts';
import { createBookingPage, updateBookingPage } from './pages.ts';
import { bookPublicSlot, readManagedBooking } from './public.ts';
import { manageTokenFor } from './tokens.ts';

const { appUrl, ownerUrl } = inject('testDatabase');
let db: Database;

beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-booking-change-tests' });
});
afterAll(async () => {
  await db.close();
});

/** A write as the owner: rows set up past the services. */
const asOwner = (text: string, params: readonly unknown[] = []) => testQuery(ownerUrl, text, params);

const LINK_KEY = Buffer.alloc(32, 9);
/** Sunday 1 November 2026, midnight UTC. */
const NOW = new Date('2026-11-01T00:00:00.000Z');
const MONDAY_9 = '2026-11-02T09:00:00.000Z';
const MONDAY_10 = new Date('2026-11-02T10:00:00.000Z');

/** A calendar that records every call, its event at a known place. */
function recordingCalendar(options: { readonly failChanges?: boolean } = {}) {
  const changes: { ref: EventRef; change: EventChange }[] = [];
  const cancels: EventRef[] = [];
  const calendar: BookingCalendar = {
    busy: () => Promise.resolve({ status: 'none' }),
    events: () => Promise.resolve({ meetingId: newId(), videoUrl: 'https://meet.example/x' }),
    existing: {
      move: (ref, change) => {
        if (options.failChanges === true) return Promise.reject(new Error('down'));
        changes.push({ ref, change });
        return Promise.resolve();
      },
      cancel: (ref) => {
        cancels.push(ref);
        return Promise.resolve();
      },
    },
  };
  return { calendar, changes, cancels };
}

let count = 0;
async function setup(calendar: BookingCalendar = recordingCalendar().calendar) {
  count += 1;
  const created = await createWorkspace(db, {
    name: 'Change',
    slug: `change-${String(count)}-${String(Date.now())}`,
    firstMember: { name: 'Ada Host', email: 'ada@example.com' },
  });
  const host = testScope({ db, workspaceId: created.workspaceId, actor: { type: 'member', id: created.memberId } });
  const page = await createBookingPage(host, { id: newId(), title: 'Intro call', timeZone: 'UTC' }, NOW);
  const entry = await enterBookingPage({ db }, page.publicKey);
  const deps = { calendar, now: () => NOW, linkKey: LINK_KEY };
  const book = async (over: Partial<PublicBookInput> = {}) =>
    bookPublicSlot(entry, deps, {
      idempotencyKey: newId(),
      start: MONDAY_9,
      duration: 30,
      name: 'Grace Hopper',
      email: 'grace@navy.example',
      timeZone: 'Europe/London',
      ...over,
    });
  const addMember = async (name: string, role: 'admin' | 'member') => {
    const id = newId();
    await db.withWorkspace(created.workspaceId, (tx) =>
      tx.execute(
        sql`insert into members (workspace_id, id, name, email, role, created_by_type, updated_by_type) values (${created.workspaceId}, ${id}, ${name}, ${`${name}-${id}@example.com`}, ${role}, 'system', 'system')`,
      ),
    );
    return rescope(host, { actor: { type: 'member', id }, role });
  };
  return { workspaceId: created.workspaceId, host, page, deps, book, addMember };
}

async function refusalOf(call: Promise<unknown>) {
  try {
    await call;
  } catch (error) {
    if (isRefusal(error)) return error.refusal;
    throw error;
  }
  throw new Error('It was let through.');
}

/** The booking's mail rows on Graphile's queue: kind, when each runs, and its key. */
function queued(bookingId: string) {
  return testQuery<{ kind: string; run_at: Date; key: string | null }>(
    ownerUrl,
    `select payload->>'kind' as kind, run_at, key from graphile_worker._private_jobs j
     join graphile_worker._private_tasks t on t.id = j.task_id
     where t.identifier = 'crm_booking_mail' and payload->>'bookingId' = $1 order by j.id`,
    [bookingId],
  );
}

async function row(workspaceId: string, bookingId: string) {
  const found = await db.withWorkspace(workspaceId, (tx) =>
    tx.execute<{
      status: string;
      starts_at: string;
      reschedules: number;
      previous_starts_at: string | null;
      cancelled_by: string | null;
      cancel_reason: string | null;
      event_failed_at: string | null;
    }>(sql`select * from bookings where id = ${bookingId}::uuid`),
  );
  const [first] = found.rows;
  if (first === undefined) throw new Error('No booking.');
  return first;
}

describe('a booking queues its emails, and its token derives from its id', () => {
  it('queues the confirmation and both reminders, each reminder keyed for a move to replace', async () => {
    const s = await setup();
    const booked = await s.book();
    expect(booked.manageToken).toBe(manageTokenFor(LINK_KEY, booked.bookingId).token);
    const rows = await queued(booked.bookingId);
    expect(rows.map((each) => each.kind)).toEqual(['confirmed', 'reminder_24h', 'reminder_1h']);
    expect(rows[1]?.run_at.toISOString()).toBe('2026-11-01T09:00:00.000Z');
    expect(rows[2]?.run_at.toISOString()).toBe('2026-11-02T08:00:00.000Z');
    expect(rows[1]?.key).toBe(`crm-booking:${s.workspaceId}:${booked.bookingId}:reminder_24h`);
    expect(rows[0]?.key).toBeNull();
  });
});

describe('the guest moves their booking (AC-639, AC-675)', () => {
  it('offers the page’s times with its own time free, then moves the same booking and its event', async () => {
    const recorder = recordingCalendar();
    const s = await setup(recorder.calendar);
    const booked = await s.book();
    const target = guestTarget(await enterBookingByToken({ db }, booked.manageToken));
    const slots = await readMoveSlots(target, s.deps, {
      from: new Date('2026-11-02T00:00:00Z'),
      to: new Date('2026-11-03T00:00:00Z'),
    });
    // Its own 9:00 is offered (moving onto itself changes nothing).
    expect(slots.slots.map((slot) => slot.start)).toContain(MONDAY_9);
    expect(await moveBooking(target, s.deps, { start: new Date(MONDAY_9) })).toEqual({ moved: false });
    expect(await moveBooking(target, s.deps, { start: MONDAY_10 })).toEqual({ moved: true });
    const moved = await row(s.workspaceId, booked.bookingId);
    expect(new Date(moved.starts_at).toISOString()).toBe(MONDAY_10.toISOString());
    expect(moved.reschedules).toBe(1);
    expect(new Date(moved.previous_starts_at ?? '').toISOString()).toBe(MONDAY_9);
    expect(recorder.changes).toHaveLength(1);
    expect(recorder.changes[0]?.change).toEqual({ start: MONDAY_10.toISOString(), end: '2026-11-02T10:30:00.000Z' });
    // The moved email, and the reminders again for the new time (the same keys, replaced).
    const rows = await queued(booked.bookingId);
    expect(rows.map((each) => each.kind)).toEqual(['confirmed', 'reminder_24h', 'reminder_1h', 'moved']);
    expect(rows.find((each) => each.kind === 'reminder_1h')?.run_at.toISOString()).toBe('2026-11-02T09:00:00.000Z');
  });

  it('refuses a time another booking holds, and a sixth move', async () => {
    const s = await setup();
    const first = await s.book();
    await s.book({ start: MONDAY_10.toISOString(), email: 'ann@navy.example' });
    const target = guestTarget(await enterBookingByToken({ db }, first.manageToken));
    expect(await refusalOf(moveBooking(target, s.deps, { start: MONDAY_10 }))).toMatchObject({ code: 'SLOT_TAKEN' });
    await asOwner('update bookings set reschedules = $1 where id = $2', [MAX_RESCHEDULES, first.bookingId]);
    expect(await refusalOf(moveBooking(target, s.deps, { start: new Date('2026-11-02T11:00:00Z') }))).toMatchObject({
      code: 'LIMIT_REACHED',
    });
    expect((await readManagedBooking(await enterBookingByToken({ db }, first.manageToken), NOW)).canMove).toBe(false);
  });

  it('refuses a move once the page is paused, but still lets them cancel', async () => {
    const s = await setup();
    const booked = await s.book();
    await updateBookingPage(s.host, { pageId: s.page.id, settings: { status: 'paused' } });
    const target = guestTarget(await enterBookingByToken({ db }, booked.manageToken));
    expect(await refusalOf(moveBooking(target, s.deps, { start: MONDAY_10 }))).toMatchObject({
      code: 'BOOKING_CLOSED',
    });
    expect(await cancelBooking(target, s.deps, {})).toEqual({ cancelled: true });
  });

  it('marks the booking for the host when the calendar won’t move its event', async () => {
    const s = await setup(recordingCalendar({ failChanges: true }).calendar);
    const booked = await s.book();
    const target = guestTarget(await enterBookingByToken({ db }, booked.manageToken));
    expect(await moveBooking(target, s.deps, { start: MONDAY_10 })).toEqual({ moved: true });
    expect((await row(s.workspaceId, booked.bookingId)).event_failed_at).not.toBeNull();
  });
});

describe('the guest cancels (AC-638, AC-677)', () => {
  it('cancels once with the reason, removes the event, queues the email; again changes nothing', async () => {
    const recorder = recordingCalendar();
    const s = await setup(recorder.calendar);
    const booked = await s.book();
    const target = guestTarget(await enterBookingByToken({ db }, booked.manageToken));
    expect(await cancelBooking(target, s.deps, { reason: '  Something came up.  ' })).toEqual({ cancelled: true });
    expect(await cancelBooking(target, s.deps, {})).toEqual({ cancelled: false });
    expect(await row(s.workspaceId, booked.bookingId)).toMatchObject({
      status: 'cancelled',
      cancelled_by: 'guest',
      cancel_reason: 'Something came up.',
    });
    expect(recorder.cancels).toHaveLength(1);
    expect((await queued(booked.bookingId)).map((each) => each.kind)).toContain('cancelled');
    const seen = await readManagedBooking(await enterBookingByToken({ db }, booked.manageToken), NOW);
    expect(seen).toMatchObject({
      state: 'cancelled',
      canChange: false,
      canMove: false,
      cancelReason: 'Something came up.',
    });
    expect(await refusalOf(moveBooking(target, s.deps, { start: MONDAY_10 }))).toMatchObject({
      code: 'BOOKING_CLOSED',
    });
  });

  it('refuses once the meeting has started', async () => {
    const s = await setup();
    const booked = await s.book();
    const target = guestTarget(await enterBookingByToken({ db }, booked.manageToken));
    const later = { ...s.deps, now: () => new Date('2026-11-02T09:05:00Z') };
    expect(await refusalOf(cancelBooking(target, later, {}))).toMatchObject({
      code: 'BOOKING_CLOSED',
      message: 'That meeting has already happened, so it can no longer be cancelled.',
    });
  });
});

describe('the guest adds guests (AC-676)', () => {
  it('invites only new addresses, and stops at 10 ever invited', async () => {
    const recorder = recordingCalendar();
    const s = await setup(recorder.calendar);
    const booked = await s.book({ guests: ['ann@navy.example'] });
    const target = guestTarget(await enterBookingByToken({ db }, booked.manageToken));
    expect(
      await addGuests(target, s.deps, { emails: ['Ann@navy.example', 'grace@navy.example', 'bob@navy.example'] }),
    ).toEqual({ added: 1, guests: ['ann@navy.example', 'bob@navy.example'] });
    expect(await addGuests(target, s.deps, { emails: ['bob@navy.example'] })).toEqual({
      added: 0,
      guests: ['ann@navy.example', 'bob@navy.example'],
    });
    expect((await queued(booked.bookingId)).filter((each) => each.kind === 'guests')).toHaveLength(1);
    // Taking one off; someone not on it changes nothing.
    expect(await removeGuest(target, s.deps, { email: 'ANN@navy.example' })).toEqual({ guests: ['bob@navy.example'] });
    expect(await removeGuest(target, s.deps, { email: 'nobody@navy.example' })).toEqual({
      guests: ['bob@navy.example'],
    });
    // Removing never frees a place: everyone ever invited counts towards the 10.
    const eight = Array.from({ length: 8 }, (_, index) => `g${String(index)}@navy.example`);
    expect((await addGuests(target, s.deps, { emails: eight })).added).toBe(8);
    for (const guest of eight) await removeGuest(target, s.deps, { email: guest });
    expect(await refusalOf(addGuests(target, s.deps, { emails: ['new@navy.example'] }))).toMatchObject({
      code: 'LIMIT_REACHED',
    });
    // Someone already counted may come back.
    expect((await addGuests(target, s.deps, { emails: ['g0@navy.example'] })).added).toBe(1);
  });
});

describe('the host moves and cancels (AC-640)', () => {
  it('lets the page’s owner and an admin change it, and hides it from a member who is neither', async () => {
    const recorder = recordingCalendar();
    const s = await setup(recorder.calendar);
    const booked = await s.book();
    const stranger = await s.addMember('Bo', 'member');
    expect(await refusalOf(cancelBooking(hostTarget(stranger, booked.bookingId), s.deps, {}))).toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(await refusalOf(bookingGuestPath(stranger, s.deps, { bookingId: booked.bookingId }))).toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(await moveBooking(hostTarget(s.host, booked.bookingId), s.deps, { start: MONDAY_10 })).toEqual({
      moved: true,
    });
    const admin = await s.addMember('Cy', 'admin');
    expect(await cancelBooking(hostTarget(admin, booked.bookingId), s.deps, { reason: 'Double booked.' })).toEqual({
      cancelled: true,
    });
    expect(await row(s.workspaceId, booked.bookingId)).toMatchObject({ cancelled_by: 'host', reschedules: 1 });
    expect(recorder.cancels).toHaveLength(1);
  });

  it('copies the guest link with the guest’s token', async () => {
    const s = await setup();
    const booked = await s.book();
    const { path } = await bookingGuestPath(s.host, s.deps, { bookingId: booked.bookingId });
    expect(path).toBe(`/b/${s.page.publicKey}/manage?t=${booked.manageToken}`);
  });

  it('moves an older booking’s random token to the derived one when its link is written again', async () => {
    const s = await setup();
    const booked = await s.book();
    await asOwner('update bookings set manage_token_hash = $1, manage_token_derived = false where id = $2', [
      '0'.repeat(64),
      booked.bookingId,
    ]);
    const { path } = await bookingGuestPath(s.host, s.deps, { bookingId: booked.bookingId });
    expect(path).toContain(booked.manageToken);
    await expect(enterBookingByToken({ db }, booked.manageToken)).resolves.toMatchObject({
      bookingId: booked.bookingId,
    });
  });
});
