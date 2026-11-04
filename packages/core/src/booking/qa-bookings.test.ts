// The bookings QA lane's core checks (4 November 2026, "bulletproof before release"): the calendar file a guest and
// a host import, the slot engine on the days clocks change, two changes to one booking racing, a guest's token used
// where it shouldn't be, an invitation only page, a request the host hasn't answered, and what an old guest link still
// shows. Against a real Postgres. A comment marked Fixed names a defect the QA lane found and the fix lane closed (see
// apps/web/e2e/BOOKINGS-QA.md).
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import type { PublicBookInput } from '@crm/contracts';
import { createDatabase, type Database } from '@crm/db';
import { testQuery } from '@crm/db/testing';
import { rollingWeek } from '../../test/dates-kit.ts';
import { enterBookingByToken, enterBookingPage } from '../access/door.ts';
import { newId } from '../engine/ids.ts';
import { isRefusal } from '../engine/refusals.ts';
import { createWorkspace } from '../engine/workspaces.ts';
import { testScope } from '../testing.ts';
import type { BookingCalendar } from './calendar.ts';
import { addGuests, cancelBooking, guestTarget, moveBooking } from './change.ts';
import { computeSlots } from './engine.ts';
import { buildBookingIcs, type IcsInput } from './ics.ts';
import { createBookingPage, updateBookingPage } from './pages.ts';
import { bookPublicSlot, readManagedBooking, readPublicSlots } from './public.ts';

const { appUrl, ownerUrl } = inject('testDatabase');
let db: Database;

beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-bookings-qa-tests' });
});
afterAll(async () => {
  await db.close();
});

const LINK_KEY = Buffer.alloc(32, 7);
const { monday: MONDAY_DAY, sunday: SUNDAY_DAY, tuesday: TUESDAY_DAY } = rollingWeek();
const NOW = new Date(`${SUNDAY_DAY}T00:00:00.000Z`);
const MONDAY_9 = `${MONDAY_DAY}T09:00:00.000Z`;
const MONDAY_10 = new Date(`${MONDAY_DAY}T10:00:00.000Z`);
const MONDAY_11 = new Date(`${MONDAY_DAY}T11:00:00.000Z`);

const quietCalendar: BookingCalendar = {
  busy: () => Promise.resolve({ status: 'none' }),
  events: () => Promise.resolve({ meetingId: newId(), videoUrl: 'https://meet.example/x' }),
  existing: { move: () => Promise.resolve(), cancel: () => Promise.resolve() },
};

let count = 0;
async function setup() {
  count += 1;
  const created = await createWorkspace(db, {
    name: 'Bookings QA',
    slug: `bookings-qa-${String(count)}-${String(Date.now())}`,
    firstMember: { name: 'Ada Host', email: 'ada@example.com' },
  });
  const host = testScope({ db, workspaceId: created.workspaceId, actor: { type: 'member', id: created.memberId } });
  const page = await createBookingPage(host, { id: newId(), title: 'Intro call', timeZone: 'UTC' }, NOW);
  const deps = { calendar: quietCalendar, now: () => NOW, linkKey: LINK_KEY };
  const book = async (over: Partial<PublicBookInput> = {}) =>
    bookPublicSlot(await enterBookingPage({ db }, page.publicKey), deps, {
      idempotencyKey: newId(),
      start: MONDAY_9,
      duration: 30,
      name: 'Grace Hopper',
      email: 'grace@navy.example',
      timeZone: 'Europe/London',
      ...over,
    });
  return { workspaceId: created.workspaceId, host, page, deps, book };
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

/** The booking's queued mail kinds, in order. */
async function mailKinds(bookingId: string): Promise<readonly string[]> {
  const rows = await testQuery<{ kind: string }>(
    ownerUrl,
    `select payload->>'kind' as kind from graphile_worker._private_jobs j
     join graphile_worker._private_tasks t on t.id = j.task_id
     where t.identifier = 'crm_booking_mail' and payload->>'bookingId' = $1 order by j.id`,
    [bookingId],
  );
  return rows.map((each) => each.kind);
}

// ---------------------------------------------------------------------------------------------------------------
// The calendar file (ICS)
// ---------------------------------------------------------------------------------------------------------------

const ICS_BASE: IcsInput = {
  bookingId: '0199f0a0-0000-7000-8000-000000000001',
  uidDomain: 'app.example',
  method: 'REQUEST',
  start: new Date('2027-03-28T00:30:00.000Z'),
  end: new Date('2027-03-28T01:30:00.000Z'),
  summary: 'Intro call',
  description: 'Booked on Timefix',
  location: 'https://meet.example/x',
  url: 'https://book.example/m#t=abc',
  organizerEmail: 'bookings@timefix.example',
  organizerName: 'Ada Host',
  attendees: [{ name: 'Grace Hopper', email: 'grace@navy.example' }],
  sequence: 0,
  now: new Date('2027-03-01T00:00:00.000Z'),
};

/** The unfolded content lines. */
const unfold = (ics: string) => ics.replace(/\r\n /g, '').split('\r\n');

describe('the calendar file', () => {
  it('is CRLF throughout, ends with one, folds at 75 octets and never splits a character', () => {
    const ics = buildBookingIcs({ ...ICS_BASE, description: '🌻'.repeat(60) + ' محمد علي '.repeat(10) });
    expect(ics.endsWith('\r\n')).toBe(true);
    expect(ics.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
    for (const line of ics.split('\r\n')) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    expect(ics).not.toContain('�');
  });

  it('writes times in UTC, so a booking across a clock change lands right in any calendar', () => {
    const lines = unfold(buildBookingIcs(ICS_BASE));
    expect(lines).toContain('DTSTART:20270328T003000Z');
    expect(lines).toContain('DTEND:20270328T013000Z');
  });

  it('a cancel keeps the UID, says CANCEL and CANCELLED, and the sequence only grows', () => {
    const lines = unfold(buildBookingIcs({ ...ICS_BASE, method: 'CANCEL', sequence: 1_800_000_000 }));
    expect(lines).toContain('METHOD:CANCEL');
    expect(lines).toContain('STATUS:CANCELLED');
    expect(lines).toContain(`UID:${ICS_BASE.bookingId}@app.example`);
    expect(lines).toContain('SEQUENCE:1800000000');
  });

  it('a line break in a name or note can’t start a property of its own', () => {
    const lines = unfold(
      buildBookingIcs({
        ...ICS_BASE,
        description: 'hi\r\nATTENDEE:MAILTO:evil@example.com',
        attendees: [{ name: 'Eve\r\nORGANIZER:MAILTO:evil@example.com', email: 'eve@example.com' }],
      }),
    );
    expect(lines.filter((line) => line.startsWith('ATTENDEE'))).toHaveLength(1);
    expect(lines.filter((line) => line.startsWith('ORGANIZER'))).toHaveLength(1);
  });

  // Fixed (B-09): a CN parameter is escaped as TEXT (`\;`, `\,`), which RFC 5545 doesn't allow in a parameter, and a
  // colon is left bare, so "Eve:MAILTO:attacker@evil.example" ends the parameters early: a calendar reads the
  // attendee's address as the attacker's, in the host's and the guest's file alike. Fix (core, ics.ts): a
  // `paramValue()` that wraps the name in DQUOTE and drops `"` and control characters (RFC 5545 §3.2).
  it('an attendee’s name is a quoted parameter, so a colon in it can’t change the address', () => {
    const lines = unfold(
      buildBookingIcs({ ...ICS_BASE, attendees: [{ name: 'Eve:MAILTO:attacker@evil.example;X=', email: 'eve@x.io' }] }),
    );
    const attendee = lines.find((line) => line.startsWith('ATTENDEE')) ?? '';
    // The value is everything after the first colon outside a quoted parameter.
    const params = attendee.match(/^ATTENDEE((?:;[^:;"]+=(?:"[^"]*"|[^:;"]*))*):(.*)$/);
    expect(params?.[2]).toBe('MAILTO:eve@x.io');
  });

  it('a name with a comma or semicolon is quoted, not backslash escaped', () => {
    const lines = unfold(
      buildBookingIcs({ ...ICS_BASE, attendees: [{ name: 'Hopper, Grace; PhD', email: 'g@x.io' }] }),
    );
    expect(lines.find((line) => line.startsWith('ATTENDEE'))).toContain('CN="Hopper, Grace; PhD"');
  });
});

// ---------------------------------------------------------------------------------------------------------------
// The slot engine on awkward days
// ---------------------------------------------------------------------------------------------------------------

describe('the engine on the days clocks change, for a guest in another zone', () => {
  const week = (startMinute: number, endMinute: number) =>
    [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({ dayOfWeek, startMinute, endMinute }));
  const base = {
    overrides: [],
    busy: [],
    bookings: [],
    durationMinutes: 60,
    bufferBefore: 0,
    bufferAfter: 0,
    now: new Date('2027-01-01T00:00:00Z'),
  };

  it('New York’s spring forward: 9 to 5 is still eight hourly slots, each 60 real minutes, in EDT', () => {
    const slots = computeSlots({
      ...base,
      rules: week(9 * 60, 17 * 60),
      hostZone: 'America/New_York',
      from: new Date('2027-03-14T00:00:00-05:00'),
      to: new Date('2027-03-15T00:00:00-04:00'),
    });
    expect(slots).toHaveLength(8);
    expect(slots[0]?.start.toISOString()).toBe('2027-03-14T13:00:00.000Z');
    for (const slot of slots) expect(slot.end.getTime() - slot.start.getTime()).toBe(3_600_000);
  });

  it('a host in Kolkata (+5:30) seen by a guest in Los Angeles: the host’s Monday 9:00 is the guest’s Sunday evening', () => {
    const slots = computeSlots({
      ...base,
      rules: [{ dayOfWeek: 1, startMinute: 9 * 60, endMinute: 10 * 60 }],
      hostZone: 'Asia/Kolkata',
      from: new Date('2027-01-03T00:00:00Z'),
      to: new Date('2027-01-05T00:00:00Z'),
    });
    expect(slots.map((slot) => slot.start.toISOString())).toEqual(['2027-01-04T03:30:00.000Z']);
  });

  it('a window crossing midnight in the host’s zone is offered on both days (22:00 to 02:00 as two ranges)', () => {
    const slots = computeSlots({
      ...base,
      rules: [
        { dayOfWeek: 1, startMinute: 22 * 60, endMinute: 1440 },
        { dayOfWeek: 2, startMinute: 0, endMinute: 2 * 60 },
      ],
      hostZone: 'Europe/Berlin',
      from: new Date('2027-01-04T00:00:00+01:00'),
      to: new Date('2027-01-06T00:00:00+01:00'),
    });
    expect(slots.map((slot) => slot.start.toISOString())).toEqual([
      '2027-01-04T21:00:00.000Z',
      '2027-01-04T22:00:00.000Z',
      '2027-01-04T23:00:00.000Z',
      '2027-01-05T00:00:00.000Z',
    ]);
  });

  it('minimum notice and the booking window: nothing sooner than the notice, nothing past the window', () => {
    const now = new Date('2027-01-04T08:10:00Z');
    const slots = computeSlots({
      ...base,
      now,
      rules: week(8 * 60, 18 * 60),
      hostZone: 'UTC',
      minNoticeMinutes: 120,
      windowDays: 1,
      from: new Date('2027-01-04T00:00:00Z'),
      to: new Date('2027-01-07T00:00:00Z'),
    });
    const starts = slots.map((slot) => slot.start.getTime());
    expect(Math.min(...starts)).toBeGreaterThanOrEqual(now.getTime() + 120 * 60_000);
    expect(Math.max(...starts)).toBeLessThan(now.getTime() + 86_400_000);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Changes to a booking: races and token misuse
// ---------------------------------------------------------------------------------------------------------------

describe('two changes to one booking at once', () => {
  it('two cancels at once: one cancels, one cancel email', async () => {
    const s = await setup();
    const booked = await s.book();
    const target = guestTarget(await enterBookingByToken({ db }, booked.manageToken));
    const results = await Promise.all([cancelBooking(target, s.deps, {}), cancelBooking(target, s.deps, {})]);
    expect(results.filter((each) => each.cancelled)).toHaveLength(1);
    expect((await mailKinds(booked.bookingId)).filter((kind) => kind === 'cancelled')).toHaveLength(1);
  });

  it('two moves at once to different times: the booking ends at one of them, with one move counted', async () => {
    const s = await setup();
    const booked = await s.book();
    const target = guestTarget(await enterBookingByToken({ db }, booked.manageToken));
    const settled = await Promise.allSettled([
      moveBooking(target, s.deps, { start: MONDAY_10 }),
      moveBooking(target, s.deps, { start: MONDAY_11 }),
    ]);
    const [found] = await testQuery<{ starts_at: Date; reschedules: number }>(
      ownerUrl,
      'select starts_at, reschedules from bookings where id = $1',
      [booked.bookingId],
    );
    const moved = settled.filter((each) => each.status === 'fulfilled' && each.value.moved).length;
    expect(found?.reschedules).toBe(moved);
    expect([MONDAY_10.getTime(), MONDAY_11.getTime()]).toContain(found?.starts_at.getTime());
  });

  it('a move and a cancel at once leave it cancelled or moved, never a live booking with its event gone', async () => {
    const s = await setup();
    const booked = await s.book();
    const target = guestTarget(await enterBookingByToken({ db }, booked.manageToken));
    await Promise.allSettled([moveBooking(target, s.deps, { start: MONDAY_10 }), cancelBooking(target, s.deps, {})]);
    const [found] = await testQuery<{ status: string }>(ownerUrl, 'select status from bookings where id = $1', [
      booked.bookingId,
    ]);
    expect(found?.status).toBe('cancelled');
  });

  it('moving onto another guest’s time is refused SLOT_TAKEN', async () => {
    const s = await setup();
    const first = await s.book();
    await s.book({ start: MONDAY_10.toISOString(), email: 'ann@navy.example' });
    const target = guestTarget(await enterBookingByToken({ db }, first.manageToken));
    expect(await refusalOf(moveBooking(target, s.deps, { start: MONDAY_10 }))).toMatchObject({ code: 'SLOT_TAKEN' });
  });

  it('a made up or truncated token opens nothing, and one workspace’s token never opens another’s booking', async () => {
    const a = await setup();
    const b = await setup();
    const booked = await a.book();
    await b.book();
    await expect(enterBookingByToken({ db }, booked.manageToken.slice(0, -1))).rejects.toMatchObject({
      refusal: { code: 'NOT_FOUND' },
    });
    await expect(enterBookingByToken({ db }, 'A'.repeat(booked.manageToken.length))).rejects.toMatchObject({
      refusal: { code: 'NOT_FOUND' },
    });
    const entry = await enterBookingByToken({ db }, booked.manageToken);
    expect(entry.scope.workspaceId).toBe(a.workspaceId);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Privacy and invitation only pages
// ---------------------------------------------------------------------------------------------------------------

describe('an invitation only page (one off links only)', () => {
  // Fixed (B-10): `readPublicSlots` never reads `linksOnly`, so anyone holding the plain /b/<key> address reads the
  // host's free times for two months, though booking is refused. Fix (core, public.ts): answer no slots when
  // `linksOnly` is on and no open one off link was given (the slots read then needs the link's hash, as /book has).
  it('offers no times without a link', async () => {
    const s = await setup();
    await updateBookingPage(s.host, { pageId: s.page.id, settings: { linksOnly: true } });
    const entry = await enterBookingPage({ db }, s.page.publicKey);
    const read = await readPublicSlots(entry, s.deps, {
      from: `${MONDAY_DAY}T00:00:00.000Z`,
      to: `${TUESDAY_DAY}T00:00:00.000Z`,
      tz: 'UTC',
      duration: 30,
    });
    expect(read.slots).toEqual([]);
  });

  it('refuses a booking without a link', async () => {
    const s = await setup();
    await updateBookingPage(s.host, { pageId: s.page.id, settings: { linksOnly: true } });
    expect(await refusalOf(s.book())).toMatchObject({ code: 'LINK_USED' });
  });
});

describe('a request the host hasn’t answered', () => {
  // Fixed (B-11): `addGuests` checks only cancelled and past, not `approval === 'pending'`, so a visitor's unanswered
  // request on a "confirm each booking" page sends invitation emails to up to 10 people for a meeting that may never
  // happen (and feeds B-06's spam route). `checkMovable` already refuses a pending one. Fix (core, change.ts).
  it('refuses more guests until the host confirms it', async () => {
    const s = await setup();
    await updateBookingPage(s.host, { pageId: s.page.id, settings: { requiresConfirmation: true } });
    const booked = await s.book();
    const target = guestTarget(await enterBookingByToken({ db }, booked.manageToken));
    expect(await refusalOf(addGuests(target, s.deps, { emails: ['stranger@example.com'] }))).toMatchObject({
      code: 'BOOKING_CLOSED',
    });
  });
});

describe('what an old guest link still shows', () => {
  // Fixed (B-13): a manage token never expires and can't be revoked, so a forwarded confirmation shows the
  // visitor's name, email, guests and note forever, a cancelled meeting a year on included. Fix (core,
  // readManagedBooking): past or cancelled for more than 30 days, answer the state, time and title only.
  it('a booking cancelled long ago no longer shows the visitor’s email or guests', async () => {
    const s = await setup();
    const booked = await s.book({ guests: ['ann@navy.example'], note: 'My private reason' });
    const target = guestTarget(await enterBookingByToken({ db }, booked.manageToken));
    await cancelBooking(target, s.deps, {});
    const yearOn = new Date(NOW.getTime() + 365 * 86_400_000);
    const seen = await readManagedBooking(await enterBookingByToken({ db }, booked.manageToken), yearOn);
    expect(seen.state).toBe('cancelled');
    expect(JSON.stringify(seen)).not.toContain('grace@navy.example');
    expect(JSON.stringify(seen)).not.toContain('ann@navy.example');
    expect(JSON.stringify(seen)).not.toContain('My private reason');
  });

  it('the guest page never shows the host’s email or another booking’s visitor', async () => {
    const s = await setup();
    const mine = await s.book();
    await s.book({ start: MONDAY_10.toISOString(), name: 'Other Person', email: 'other@example.com' });
    const seen = JSON.stringify(await readManagedBooking(await enterBookingByToken({ db }, mine.manageToken), NOW));
    expect(seen).not.toContain('ada@example.com');
    expect(seen).not.toContain('other@example.com');
    expect(seen).not.toContain('Other Person');
  });
});
