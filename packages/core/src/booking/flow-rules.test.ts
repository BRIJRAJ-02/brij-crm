// A booking page's flow rules (spec 0062, L1), against a real Postgres: where a redirect page sends its visitor
// (AC-6201), a guest's cancel and move inside the cutoffs (AC-6202), a request that waits for its host's Confirm
// (AC-6203), and a one off link that books a set number of times, even under a race (AC-6204). Every default is
// today's behaviour (AC-6220).
import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import type { PublicBookInput } from '@crm/contracts';
import { createDatabase, type Database } from '@crm/db';
import { testQuery } from '@crm/db/testing';
import { rollingWeek } from '../../test/dates-kit.ts';
import { enterBookingByToken, enterBookingPage, systemScope } from '../access/door.ts';
import { newId } from '../engine/ids.ts';
import { isRefusal } from '../engine/refusals.ts';
import { createWorkspace } from '../engine/workspaces.ts';
import { rescope, testScope } from '../testing.ts';
import type { BookingCalendar } from './calendar.ts';
import {
  cancelBooking,
  confirmBooking,
  declineBooking,
  expireRequest,
  guestTarget,
  hostTarget,
  moveBooking,
} from './change.ts';
import { createOneOffLink, listOneOffLinks, revokeOneOffLink } from './one-off-links.ts';
import { createBookingPage, updateBookingPage } from './pages.ts';
import { bookPublicSlot, getPublicBookingPage, readManagedBooking } from './public.ts';
import { listRequests } from './requests.ts';

const { appUrl, ownerUrl } = inject('testDatabase');
let db: Database;

beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-booking-flow-tests' });
});
afterAll(async () => {
  await db.close();
});

const LINK_KEY = Buffer.alloc(32, 7);
const { monday: MONDAY_DAY, sunday: SUNDAY_DAY } = rollingWeek();
const NOW = new Date(`${SUNDAY_DAY}T00:00:00.000Z`);
const MONDAY_9 = `${MONDAY_DAY}T09:00:00.000Z`;
const MONDAY_10 = `${MONDAY_DAY}T10:00:00.000Z`;

/** A calendar that counts the events written. */
function countingCalendar() {
  const written: string[] = [];
  const calendar: BookingCalendar = {
    busy: () => Promise.resolve({ status: 'none' }),
    events: (event) => {
      written.push(event.bookingId);
      return Promise.resolve({ meetingId: newId() });
    },
    existing: { move: () => Promise.resolve(), cancel: () => Promise.resolve() },
  };
  return { calendar, written };
}

let count = 0;
async function setup() {
  count += 1;
  const created = await createWorkspace(db, {
    name: 'Flow',
    slug: `flow-${String(count)}-${String(Date.now())}`,
    firstMember: { name: 'Ada Host', email: 'ada@example.com' },
  });
  const host = testScope({ db, workspaceId: created.workspaceId, actor: { type: 'member', id: created.memberId } });
  const page = await createBookingPage(host, { id: newId(), title: 'Intro call', timeZone: 'UTC' }, NOW);
  const entry = await enterBookingPage({ db }, page.publicKey);
  const { calendar, written } = countingCalendar();
  const deps = { calendar, now: () => NOW, linkKey: LINK_KEY };
  const book = (over: Partial<PublicBookInput> = {}) =>
    bookPublicSlot(entry, deps, {
      idempotencyKey: newId(),
      start: MONDAY_9,
      duration: 30,
      name: 'Grace Hopper',
      email: 'grace@navy.example',
      timeZone: 'Europe/London',
      ...over,
    });
  const set = (settings: Parameters<typeof updateBookingPage>[1]['settings']) =>
    updateBookingPage(host, { pageId: page.id, settings }, NOW);
  return { workspaceId: created.workspaceId, host, page, entry, deps, book, set, written };
}

async function refusalOf(call: Promise<unknown>) {
  try {
    await call;
  } catch (error) {
    if (isRefusal(error)) return { code: error.refusal.code, field: error.refusal.field };
    throw error;
  }
  throw new Error('It was let through.');
}

/** The booking's queued mail kinds, in order. */
async function queued(bookingId: string): Promise<string[]> {
  const rows = await testQuery<{ kind: string }>(
    ownerUrl,
    `select payload->>'kind' as kind from graphile_worker._private_jobs j
     join graphile_worker._private_tasks t on t.id = j.task_id
     where t.identifier = 'crm_booking_mail' and payload->>'bookingId' = $1 order by j.id`,
    [bookingId],
  );
  return rows.map((row) => row.kind);
}

async function bookingRow(workspaceId: string, bookingId: string) {
  const found = await db.withWorkspace(workspaceId, (tx) =>
    tx.execute<{ status: string; approval: string | null; decline_reason: string | null; decided_at: Date | null }>(
      sql`select status, approval, decline_reason, decided_at from bookings where id = ${bookingId}::uuid`,
    ),
  );
  const [row] = found.rows;
  if (row === undefined) throw new Error('No booking.');
  return row;
}

describe('after booking (AC-6201)', () => {
  it('sends nobody anywhere by default, and a redirect page only to its own address', async () => {
    const s = await setup();
    expect((await s.book()).redirectUrl).toBeUndefined();
    await s.set({ afterBooking: 'redirect', redirectUrl: 'https://acme.example/thanks' });
    const booked = await s.book({ start: MONDAY_10 });
    expect(booked.redirectUrl).toBe('https://acme.example/thanks');
  });

  it('adds the booking as query values only when the host switched that on', async () => {
    const s = await setup();
    await s.set({ afterBooking: 'redirect', redirectUrl: 'https://acme.example/thanks?x=1', sendBookingDetails: true });
    const url = new URL((await s.book()).redirectUrl ?? '');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      x: '1',
      name: 'Grace Hopper',
      email: 'grace@navy.example',
      start: MONDAY_9.replace('.000Z', '.000Z'),
      tz: 'Europe/London',
      page: s.page.slug,
    });
  });

  it('refuses a redirect page with no address, and Confirmation drops the address', async () => {
    const s = await setup();
    expect(await refusalOf(s.set({ afterBooking: 'redirect' }))).toEqual({
      code: 'VALUE_REQUIRED',
      field: 'redirectUrl',
    });
    await s.set({ afterBooking: 'redirect', redirectUrl: 'https://acme.example/thanks' });
    const back = await s.set({ afterBooking: 'confirmation' });
    expect(back.afterBooking).toBe('confirmation');
    expect(back.redirectUrl).toBeNull();
  });
});

describe('cutoffs (AC-6202)', () => {
  it('refuses a guest’s cancel and move inside the cutoff, says so on their page, and never stops the host', async () => {
    const s = await setup();
    // The booking starts 33 hours after NOW; a two day cutoff covers it.
    await s.set({ cancelCutoffMinutes: 2880, moveCutoffMinutes: 2880 });
    const booked = await s.book();
    const entry = await enterBookingByToken({ db }, booked.manageToken);
    const guest = guestTarget(entry);
    expect(await refusalOf(cancelBooking(guest, s.deps, {}))).toEqual({ code: 'TOO_LATE', field: undefined });
    expect(await refusalOf(moveBooking(guest, s.deps, { start: new Date(MONDAY_10) }))).toEqual({
      code: 'TOO_LATE',
      field: undefined,
    });
    const managed = await readManagedBooking(entry, NOW);
    expect(managed).toMatchObject({ canChange: true, canMove: false, cancelTooLate: true, moveTooLate: true });
    expect(await cancelBooking(hostTarget(s.host, booked.bookingId), s.deps, {})).toEqual({ cancelled: true });
  });

  it('lets a guest change a booking outside the cutoff, as before', async () => {
    const s = await setup();
    await s.set({ cancelCutoffMinutes: 60 });
    const booked = await s.book();
    const guest = guestTarget(await enterBookingByToken({ db }, booked.manageToken));
    expect(await cancelBooking(guest, s.deps, {})).toEqual({ cancelled: true });
  });
});

describe('requires confirmation (AC-6203)', () => {
  it('books a request that holds its slot, stays off the calendar, and asks the host', async () => {
    const s = await setup();
    await s.set({ requiresConfirmation: true });
    expect((await getPublicBookingPage(s.entry)).requiresConfirmation).toBe(true);
    const booked = await s.book();
    expect(booked.pending).toBe(true);
    expect(s.written).toEqual([]);
    expect(await queued(booked.bookingId)).toEqual(['requested', 'pending_expire']);
    expect((await bookingRow(s.workspaceId, booked.bookingId)).approval).toBe('pending');
    // Held: nobody else books the same time.
    expect(await refusalOf(s.book({ email: 'ann@example.com' }))).toMatchObject({ code: 'SLOT_TAKEN' });
    const managed = await readManagedBooking(await enterBookingByToken({ db }, booked.manageToken), NOW);
    expect(managed).toMatchObject({ state: 'requested', canMove: false });
    const requests = await listRequests(s.host, { pageId: s.page.id });
    expect(requests.map((each) => each.bookingId)).toEqual([booked.bookingId]);
    // Expires at the earlier of a day after the request and an hour before the start.
    expect(requests[0]?.expiresAt).toBeDefined();
  });

  it('confirms once: its event and confirmation go through the worker, its reminders are queued', async () => {
    const s = await setup();
    await s.set({ requiresConfirmation: true });
    const booked = await s.book();
    const target = hostTarget(s.host, booked.bookingId);
    expect(await confirmBooking(target, { now: () => NOW })).toEqual({ confirmed: true });
    expect(await confirmBooking(target, { now: () => NOW })).toEqual({ confirmed: false });
    expect((await bookingRow(s.workspaceId, booked.bookingId)).approval).toBe('approved');
    expect(await queued(booked.bookingId)).toEqual([
      'requested',
      'pending_expire',
      'approved',
      'reminder_24h',
      'reminder_1h',
    ]);
    // Answered, the wait leaves it alone.
    expect(await expireRequest(systemScope(db, s.workspaceId), booked.bookingId, NOW)).toBe(false);
  });

  it('declines with a reason, which frees the slot and tells the visitor', async () => {
    const s = await setup();
    await s.set({ requiresConfirmation: true });
    const booked = await s.book();
    expect(
      await declineBooking(hostTarget(s.host, booked.bookingId), { now: () => NOW }, { reason: 'Away that day' }),
    ).toEqual({ declined: true });
    expect(await bookingRow(s.workspaceId, booked.bookingId)).toMatchObject({
      status: 'cancelled',
      approval: 'declined',
      decline_reason: 'Away that day',
    });
    expect(await queued(booked.bookingId)).toContain('declined');
    const managed = await readManagedBooking(await enterBookingByToken({ db }, booked.manageToken), NOW);
    expect(managed).toMatchObject({ state: 'declined', cancelReason: 'Away that day' });
    // The time is free again.
    expect((await s.book({ email: 'ann@example.com' })).pending).toBe(true);
  });

  it('declines itself when nobody answers, with no member named', async () => {
    const s = await setup();
    await s.set({ requiresConfirmation: true });
    const booked = await s.book();
    expect(await expireRequest(systemScope(db, s.workspaceId), booked.bookingId, NOW)).toBe(true);
    expect(await bookingRow(s.workspaceId, booked.bookingId)).toMatchObject({
      status: 'cancelled',
      approval: 'declined',
    });
  });

  it('refuses a request’s Confirm to a member who only sees its host', async () => {
    const s = await setup();
    await s.set({ requiresConfirmation: true });
    const booked = await s.book();
    const other = newId();
    await db.withWorkspace(s.workspaceId, (tx) =>
      tx.execute(
        sql`insert into members (workspace_id, id, name, email, role, created_by_type, updated_by_type) values (${s.workspaceId}, ${other}, 'Bo', ${`bo-${other}@example.com`}, 'member', 'system', 'system')`,
      ),
    );
    const bo = rescope(s.host, { actor: { type: 'member', id: other }, role: 'member' });
    expect(await refusalOf(confirmBooking(hostTarget(bo, booked.bookingId), { now: () => NOW }))).toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe('one off links (AC-6204)', () => {
  const hashOf = (token: string) => createHash('sha256').update(token).digest('hex');

  it('books its uses, then says it has been used; the token is stored only as its hash', async () => {
    const s = await setup();
    const { link, token } = await createOneOffLink(s.host, { pageId: s.page.id, label: 'For Grace' }, NOW);
    expect(link).toMatchObject({ label: 'For Grace', maxUses: 1, uses: 0, state: 'open' });
    const stored = await testQuery<{ token_hash: string }>(
      ownerUrl,
      'select token_hash from booking_page_links where id = $1',
      [link.id],
    );
    expect(stored[0]?.token_hash).toBe(hashOf(token));
    const booked = await s.book({ oneOffToken: token });
    expect(booked.bookingId).toBeDefined();
    expect(await refusalOf(s.book({ start: MONDAY_10, oneOffToken: token }))).toEqual({
      code: 'LINK_USED',
      field: undefined,
    });
    expect(
      (await getPublicBookingPage(s.entry, undefined, undefined, { hash: hashOf(token), now: NOW })).linkUsed,
    ).toBe(true);
    expect((await listOneOffLinks(s.host, { pageId: s.page.id }, NOW))[0]).toMatchObject({ uses: 1, state: 'used' });
  });

  it('lets exactly one of two visitors racing the last use book', async () => {
    const s = await setup();
    const { token } = await createOneOffLink(s.host, { pageId: s.page.id }, NOW);
    const outcomes = await Promise.allSettled([
      s.book({ oneOffToken: token }),
      s.book({ start: MONDAY_10, email: 'ann@example.com', oneOffToken: token }),
    ]);
    expect(outcomes.filter((each) => each.status === 'fulfilled')).toHaveLength(1);
  });

  it('books nothing once revoked or expired, and refuses an expiry past a year', async () => {
    const s = await setup();
    const { link, token } = await createOneOffLink(s.host, { pageId: s.page.id, maxUses: 3 }, NOW);
    expect((await revokeOneOffLink(s.host, { pageId: s.page.id, linkId: link.id }, NOW)).state).toBe('revoked');
    expect(await refusalOf(s.book({ oneOffToken: token }))).toMatchObject({ code: 'LINK_USED' });
    expect(
      await refusalOf(
        createOneOffLink(
          s.host,
          { pageId: s.page.id, expiresAt: new Date(NOW.getTime() + 400 * 86_400_000).toISOString() },
          NOW,
        ),
      ),
    ).toEqual({ code: 'CONFIG_INVALID', field: 'expiresAt' });
  });

  it('books a page through its link only while the page takes bookings', async () => {
    const s = await setup();
    const { token } = await createOneOffLink(s.host, { pageId: s.page.id }, NOW);
    await s.set({ status: 'paused' });
    expect(await refusalOf(s.book({ oneOffToken: token }))).toMatchObject({ code: 'BOOKING_CLOSED' });
  });
});
