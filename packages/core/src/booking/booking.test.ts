// Booking pages end to end in core (spec 0025, milestone 1), against the real
// Postgres: members' pages and who may touch them, the public page and its
// slots through a fake calendar, a booking's records and event, retries, and
// the race: several visitors booking one slot at once get exactly one booking.
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import type { PublicBookInput } from '@crm/contracts';
import { createDatabase, type Database } from '@crm/db';
import { enterBookingByToken, enterBookingPage, type BookingEntry } from '../access/door.ts';
import { newId } from '../engine/ids.ts';
import { isRefusal } from '../engine/refusals.ts';
import { createRecord } from '../engine/records.ts';
import { createWorkspace } from '../engine/workspaces.ts';
import { rescope, testScope } from '../testing.ts';
import { NO_CALENDAR, type BookingCalendar, type BookingEvent, type BusyAnswer } from './calendar.ts';
import {
  createBookingPage,
  deleteBookingPage,
  getBookingPage,
  getMemberHours,
  listBookingPages,
  listBookings,
  setMemberHours,
  updateBookingPage,
} from './pages.ts';
import {
  bookPublicSlot,
  getPublicBookingPage,
  managedBookingIcs,
  readManagedBooking,
  readPublicSlots,
} from './public.ts';

const { appUrl } = inject('testDatabase');
let db: Database;

beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-booking-tests' });
});
afterAll(async () => {
  await db.close();
});

/** Sunday 1 November 2026, midnight UTC: the clock every booking here reads. */
const NOW = new Date('2026-11-01T00:00:00.000Z');
const MONDAY_9 = '2026-11-02T09:00:00.000Z';

let count = 0;
async function workspace() {
  count += 1;
  const created = await createWorkspace(db, {
    name: 'Booking',
    slug: `booking-${String(count)}-${String(Date.now())}`,
    firstMember: { name: 'Ada Host', email: 'ada@example.com' },
  });
  const owner = testScope({ db, workspaceId: created.workspaceId, actor: { type: 'member', id: created.memberId } });
  const addMember = async (name: string, role: 'admin' | 'member') => {
    const id = newId();
    await db.withWorkspace(created.workspaceId, (tx) =>
      tx.execute(
        sql`insert into members (workspace_id, id, name, email, role, created_by_type, updated_by_type) values (${created.workspaceId}, ${id}, ${name}, ${`${name}-${id}@example.com`}, ${role}, 'system', 'system')`,
      ),
    );
    return rescope(owner, { actor: { type: 'member', id }, role });
  };
  const attributes = await db.withWorkspace(created.workspaceId, (tx) =>
    tx.execute<{ id: string; slug: string }>(
      sql`select a.id::text, o.api_slug || '.' || a.api_slug as slug from attributes a join objects o on o.id = a.object_id`,
    ),
  );
  const ids = Object.fromEntries(attributes.rows.map((row) => [row.slug, row.id]));
  const attribute = (slug: string): string => ids[slug] ?? '';
  return { ...created, owner, addMember, attribute };
}

/** A live page of the owner's: weekdays 09:00 to 17:00 UTC, 30 minutes, video. */
async function livePage(w: Awaited<ReturnType<typeof workspace>>, settings = {}) {
  const page = await createBookingPage(w.owner, { id: newId(), title: 'Intro call', timeZone: 'UTC', settings }, NOW);
  const entry = await enterBookingPage({ db }, page.publicKey);
  return { page, entry };
}

/** A calendar whose busy answer and event writer the test sets. */
function fakeCalendar(
  busy: BusyAnswer = { status: 'none' },
  writer?: (event: BookingEvent) => Promise<{ meetingId?: string }>,
) {
  const events: BookingEvent[] = [];
  const calendar: BookingCalendar = {
    busy: () => Promise.resolve(busy),
    events: (event) => {
      events.push(event);
      return writer === undefined ? Promise.resolve({ meetingId: newId() }) : writer(event);
    },
  };
  return { calendar, events };
}

const deps = (calendar: BookingCalendar = NO_CALENDAR) => ({ calendar, now: () => NOW });

const bookInput = (over: Partial<PublicBookInput> = {}): PublicBookInput => ({
  idempotencyKey: newId(),
  start: MONDAY_9,
  duration: 30,
  name: 'Grace Hopper',
  email: 'grace@navy.example',
  timeZone: 'Europe/London',
  ...over,
});

async function refusalOf(call: Promise<unknown>) {
  try {
    await call;
  } catch (error) {
    if (isRefusal(error)) return error.refusal;
    throw error;
  }
  throw new Error('It was let through.');
}

const mondaySlots = (entry: BookingEntry, calendar: BookingCalendar = NO_CALENDAR) =>
  readPublicSlots(entry, deps(calendar), {
    from: '2026-11-02T00:00:00.000Z',
    to: '2026-11-03T00:00:00.000Z',
    duration: 30,
    tz: 'UTC',
  });

describe('pages (AC-623, AC-624, AC-645, AC-648)', () => {
  it('makes a page with defaults, a slug from its title, the next one free when taken', async () => {
    const w = await workspace();
    const { page } = await livePage(w);
    expect(page).toMatchObject({
      slug: 'intro-call',
      durations: [30],
      location: { type: 'video' },
      status: 'live',
      kind: 'personal',
      ownerMemberId: w.memberId,
      canChange: true,
    });
    expect(page.publicKey).toMatch(/^[A-Za-z0-9_-]{16}$/);
    expect(page.availability.weekly.mon).toEqual([['09:00', '17:00']]);
    const second = await createBookingPage(w.owner, { id: newId(), title: 'Intro call', timeZone: 'UTC' }, NOW);
    expect(second.slug).toBe('intro-call-2');
    // The same id again is the same page.
    const again = await createBookingPage(w.owner, { id: page.id, title: 'Other', timeZone: 'UTC' }, NOW);
    expect(again.id).toBe(page.id);
    expect(
      await refusalOf(updateBookingPage(w.owner, { pageId: second.id, settings: { slug: 'intro-call' } })),
    ).toEqual({
      code: 'SLUG_TAKEN',
      message: 'Another booking page in this workspace has that web address.',
      field: 'slug',
    });
  });

  it('changes only the settings given, and deleting hides it and frees its slug while its bookings stay', async () => {
    const w = await workspace();
    const { page, entry } = await livePage(w);
    const changed = await updateBookingPage(w.owner, {
      pageId: page.id,
      settings: { durations: [15, 60], bufferAfter: 10, dailyLimit: 3 },
    });
    expect(changed).toMatchObject({ durations: [15, 60], bufferAfter: 10, dailyLimit: 3, title: 'Intro call' });
    await updateBookingPage(w.owner, { pageId: page.id, settings: { durations: [30] } });
    await bookPublicSlot(entry, deps(), bookInput());
    await deleteBookingPage(w.owner, { pageId: page.id });
    expect(await listBookingPages(w.owner, NOW)).toEqual([]);
    expect(await refusalOf(getBookingPage(w.owner, { pageId: page.id }))).toMatchObject({ code: 'NOT_FOUND' });
    expect(await listBookings(w.owner, { pageId: page.id, when: 'upcoming' }, NOW)).toHaveLength(1);
    expect(await refusalOf(getPublicBookingPage(entry))).toEqual({
      code: 'NOT_FOUND',
      message: 'This page is no longer available.',
    });
    const reused = await createBookingPage(w.owner, { id: newId(), title: 'Intro call', timeZone: 'UTC' }, NOW);
    expect(reused.slug).toBe('intro-call');
  });

  it('shows a member their own pages only, an admin everyone’s, and counts this month’s bookings', async () => {
    const w = await workspace();
    const bea = await w.addMember('bea', 'member');
    const cal = await w.addMember('cal', 'admin');
    const { page, entry } = await livePage(w);
    const beas = await createBookingPage(bea, { id: newId(), title: 'Bea’s', timeZone: 'UTC' }, NOW);
    await bookPublicSlot(entry, deps(), bookInput());
    expect((await listBookingPages(bea, NOW)).map((each) => each.id)).toEqual([beas.id]);
    const all = await listBookingPages(cal, NOW);
    expect(all.map((each) => each.id).sort()).toEqual([page.id, beas.id].sort());
    expect(all.find((each) => each.id === page.id)).toMatchObject({ bookingsThisMonth: 1, canChange: true });
    expect(await refusalOf(updateBookingPage(bea, { pageId: page.id, settings: { title: 'Mine' } }))).toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(await updateBookingPage(cal, { pageId: beas.id, settings: { title: 'Fixed' } })).toMatchObject({
      title: 'Fixed',
    });
  });
});

describe('the public page and its slots (AC-629, AC-631, AC-644)', () => {
  it('answers the page’s facts and no member email; a paused page is closed, an unknown key absent', async () => {
    const w = await workspace();
    const { page, entry } = await livePage(w);
    const facts = await getPublicBookingPage(entry);
    expect(facts).toEqual({
      publicKey: page.publicKey,
      title: 'Intro call',
      description: '',
      hostName: 'Ada Host',
      workspaceName: 'Booking',
      durations: [30],
      location: { type: 'video' },
      hostTimeZone: 'UTC',
      windowDays: 60,
    });
    expect(JSON.stringify(facts)).not.toContain('@');
    await updateBookingPage(w.owner, { pageId: page.id, settings: { status: 'paused' } });
    expect(await refusalOf(getPublicBookingPage(entry))).toMatchObject({ code: 'BOOKING_CLOSED' });
    expect(await refusalOf(enterBookingPage({ db }, 'AAAAAAAAAAAAAAAA'))).toMatchObject({ code: 'NOT_FOUND' });
    expect(await refusalOf(enterBookingPage({ db }, 'not a key'))).toMatchObject({ code: 'NOT_FOUND' });
  });

  it('offers the hours minus busy times and bookings; a refused calendar offers nothing, a passing outage everything', async () => {
    const w = await workspace();
    const { entry } = await livePage(w);
    expect((await mondaySlots(entry)).slots).toHaveLength(16);
    const busy = fakeCalendar({
      status: 'read',
      busy: [{ start: '2026-11-02T10:00:00.000Z', end: '2026-11-02T11:00:00.000Z' }],
    });
    const starts = (await mondaySlots(entry, busy.calendar)).slots.map((slot) => slot.start);
    expect(starts).toHaveLength(14);
    expect(starts).not.toContain('2026-11-02T10:00:00.000Z');
    expect(starts).not.toContain('2026-11-02T10:30:00.000Z');
    expect((await mondaySlots(entry, fakeCalendar({ status: 'blocked' }).calendar)).slots).toEqual([]);
    expect((await mondaySlots(entry, fakeCalendar({ status: 'unavailable' }).calendar)).slots).toHaveLength(16);
    await bookPublicSlot(entry, deps(), bookInput());
    expect((await mondaySlots(entry)).slots.map((slot) => slot.start)).not.toContain(MONDAY_9);
    expect(
      await refusalOf(
        readPublicSlots(entry, deps(), { from: MONDAY_9, to: '2026-11-03T00:00:00.000Z', duration: 45, tz: 'UTC' }),
      ),
    ).toMatchObject({ code: 'CONFIG_INVALID', field: 'duration' });
  });

  it('stops offering a day at its daily limit', async () => {
    const w = await workspace();
    const { entry } = await livePage(w, { dailyLimit: 1 });
    await bookPublicSlot(entry, deps(), bookInput());
    expect((await mondaySlots(entry)).slots).toEqual([]);
  });
});

describe('booking (AC-632, AC-633, AC-634)', () => {
  it('books, makes the person and their company as the page, and puts the event on the host’s calendar', async () => {
    const w = await workspace();
    const { page, entry } = await livePage(w);
    const fake = fakeCalendar();
    const booked = await bookPublicSlot(entry, deps(fake.calendar), bookInput());
    expect(booked).toMatchObject({
      replayed: false,
      booking: {
        start: MONDAY_9,
        end: '2026-11-02T09:30:00.000Z',
        title: 'Intro call',
        hostName: 'Ada Host',
        location: { type: 'video' },
        timeZone: 'Europe/London',
      },
    });
    expect(booked.manageToken).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(fake.events).toEqual([
      expect.objectContaining({
        hostMemberId: w.memberId,
        bookingId: booked.bookingId,
        title: 'Intro call with Grace Hopper',
        start: MONDAY_9,
        attendees: [{ email: 'grace@navy.example', name: 'Grace Hopper' }],
        video: true,
      }),
    ]);
    const [row] = await listBookings(w.owner, { pageId: page.id, when: 'upcoming' }, NOW);
    expect(row).toMatchObject({ visitorEmail: 'grace@navy.example', status: 'confirmed', eventFailed: false });
    const records = await db.withWorkspace(w.workspaceId, (tx) =>
      tx.execute<{ id: string; object: string; created_by_type: string; created_by_id: string }>(
        sql`select r.id::text, o.api_slug as object, r.created_by_type::text, r.created_by_id::text from records r join objects o on o.id = r.object_id order by o.api_slug`,
      ),
    );
    expect(records.rows).toEqual([
      { id: row?.companyRecordId, object: 'companies', created_by_type: 'booking', created_by_id: page.id },
      { id: row?.personRecordId, object: 'people', created_by_type: 'booking', created_by_id: page.id },
    ]);
    const stored = await db.withWorkspace(w.workspaceId, (tx) =>
      tx.execute<{ meeting_id: string | null; during: string; manage_token_hash: string }>(
        sql`select meeting_id::text, during::text, manage_token_hash from bookings`,
      ),
    );
    expect(stored.rows[0]?.meeting_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(stored.rows[0]?.manage_token_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('matches the same person again, makes no company for a free email domain, and never overwrites a person', async () => {
    const w = await workspace();
    const { page, entry } = await livePage(w);
    await bookPublicSlot(entry, deps(), bookInput());
    await bookPublicSlot(entry, deps(), bookInput({ start: '2026-11-02T10:00:00.000Z', name: 'Someone Else' }));
    await bookPublicSlot(
      entry,
      deps(),
      bookInput({ start: '2026-11-02T11:00:00.000Z', name: 'Free Mail', email: 'free@gmail.com' }),
    );
    const [ada] = [
      (
        await createRecord(w.owner, {
          objectId: w.objects.people ?? '',
          values: {
            [w.attribute('people.name')]: { firstName: 'Lin' },
            [w.attribute('people.email_addresses')]: ['lin@acme.example'],
          },
        })
      ).recordId,
    ];
    await bookPublicSlot(
      entry,
      deps(),
      bookInput({ start: '2026-11-02T12:00:00.000Z', name: 'Not Lin', email: 'lin@acme.example' }),
    );
    const bookings = await listBookings(w.owner, { pageId: page.id, when: 'upcoming' }, NOW);
    expect(bookings[0]?.personRecordId).toBe(bookings[1]?.personRecordId);
    expect(bookings[2]?.companyRecordId).toBeUndefined();
    expect(bookings[3]?.personRecordId).toBe(ada);
    const names = await db.withWorkspace(w.workspaceId, (tx) =>
      tx.execute<{ text_value: string }>(
        sql`select text_value from "values" where attribute_id = ${w.attribute('people.name')}::uuid and active_until is null order by text_value`,
      ),
    );
    expect(names.rows.map((each) => each.text_value)).toEqual(['Free Mail', 'Grace Hopper', 'Lin']);
    // Lin had no company: linked to acme.example, made for her.
    const links = await db.withWorkspace(w.workspaceId, (tx) =>
      tx.execute(
        sql`select 1 from record_links where active_until is null and (from_record_id = ${ada}::uuid or to_record_id = ${ada}::uuid)`,
      ),
    );
    expect(links.rows).toHaveLength(1);
  });

  it('answers a retry of the same attempt with the first booking, and refuses a slot that is gone', async () => {
    const w = await workspace();
    const { entry } = await livePage(w);
    const input = bookInput();
    const first = await bookPublicSlot(entry, deps(), input);
    const again = await bookPublicSlot(entry, deps(), input);
    expect(again).toMatchObject({ bookingId: first.bookingId, replayed: true, booking: first.booking });
    expect(await refusalOf(bookPublicSlot(entry, deps(), bookInput({ email: 'other@example.org' })))).toEqual({
      code: 'SLOT_TAKEN',
      message: 'That time was just taken. Pick another.',
    });
    expect(
      await refusalOf(bookPublicSlot(entry, deps(), bookInput({ start: '2026-11-01T09:00:00.000Z' }))),
    ).toMatchObject({ code: 'SLOT_TAKEN' });
  });

  it('keeps the booking when the calendar event fails three times, marked for the host', async () => {
    const w = await workspace();
    const { page, entry } = await livePage(w);
    const fake = fakeCalendar({ status: 'none' }, () => Promise.reject(new Error('provider down')));
    const warnings: unknown[] = [];
    const booked = await bookPublicSlot(
      entry,
      { ...deps(fake.calendar), log: { warn: (message, fields) => warnings.push({ message, fields }) } },
      bookInput(),
    );
    expect(booked.replayed).toBe(false);
    expect(fake.events).toHaveLength(3);
    expect(warnings).toHaveLength(3);
    const [row] = await listBookings(w.owner, { pageId: page.id, when: 'upcoming' }, NOW);
    expect(row).toMatchObject({ status: 'confirmed', eventFailed: true });
  });

  it('refuses a booking when the host’s calendar refuses us, and a phone page without a number', async () => {
    const w = await workspace();
    const { entry } = await livePage(w, { location: { type: 'phone' } });
    expect(
      await refusalOf(
        bookPublicSlot(
          entry,
          deps(fakeCalendar({ status: 'blocked' }).calendar),
          bookInput({ phone: '+44 20 7946 0000' }),
        ),
      ),
    ).toMatchObject({ code: 'BOOKING_CLOSED' });
    expect(await refusalOf(bookPublicSlot(entry, deps(), bookInput()))).toMatchObject({
      code: 'VALUE_REQUIRED',
      field: 'phone',
    });
  });
});

describe('no double booking (AC-632)', () => {
  it('gives eight visitors racing for one slot exactly one booking, and the other seven SLOT_TAKEN', async () => {
    const w = await workspace();
    const { page, entry } = await livePage(w);
    const racers = Array.from({ length: 8 }, (_, index) =>
      bookPublicSlot(entry, deps(), bookInput({ email: `racer-${String(index)}@race${String(index)}.example` })),
    );
    const settled = await Promise.allSettled(racers);
    const won = settled.filter((each) => each.status === 'fulfilled');
    const lost = settled.flatMap((each) => (each.status === 'rejected' ? [each.reason as unknown] : []));
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(7);
    expect(lost.every((reason) => isRefusal(reason) && reason.refusal.code === 'SLOT_TAKEN')).toBe(true);
    const rows = await db.withWorkspace(w.workspaceId, (tx) =>
      tx.execute<{ status: string }>(sql`select status from bookings where page_id = ${page.id}::uuid`),
    );
    expect(rows.rows).toEqual([{ status: 'confirmed' }]);
  });

  it('serialises one host across two of their pages: overlapping slots on each, one winner', async () => {
    const w = await workspace();
    const { entry: one } = await livePage(w);
    const other = await createBookingPage(
      w.owner,
      { id: newId(), title: 'Deep dive', timeZone: 'UTC', settings: { durations: [60] } },
      NOW,
    );
    const two = await enterBookingPage({ db }, other.publicKey);
    const settled = await Promise.allSettled([
      bookPublicSlot(one, deps(), bookInput({ start: '2026-11-02T09:30:00.000Z' })),
      bookPublicSlot(two, deps(), bookInput({ duration: 60, email: 'b@b.example' })),
      bookPublicSlot(one, deps(), bookInput({ start: '2026-11-02T09:00:00.000Z', email: 'c@c.example' })),
    ]);
    const won = settled.filter((each) => each.status === 'fulfilled').length;
    // The hour on page two overlaps both half hours; the two half hours don't overlap each other.
    expect(won === 1 || won === 2).toBe(true);
    const rows = await db.withWorkspace(w.workspaceId, (tx) =>
      tx.execute<{ starts_at: string; ends_at: string }>(
        sql`select starts_at::text, ends_at::text from bookings where status = 'confirmed' order by starts_at`,
      ),
    );
    for (let index = 1; index < rows.rows.length; index += 1) {
      expect(Date.parse(rows.rows[index]?.starts_at ?? '')).toBeGreaterThanOrEqual(
        Date.parse(rows.rows[index - 1]?.ends_at ?? ''),
      );
    }
  });
});

describe('the guest page (AC-674)', () => {
  it('opens the booking by its token: state, time, facts, guests and note; a replay rotates the token', async () => {
    const w = await workspace();
    const { page, entry } = await livePage(w);
    const input = bookInput({ guests: ['ann@navy.example', 'grace@navy.example'], note: 'About the compiler.' });
    const booked = await bookPublicSlot(entry, deps(), input);
    const guest = await enterBookingByToken({ db }, booked.manageToken);
    expect(await readManagedBooking(guest, NOW)).toEqual({
      state: 'confirmed',
      publicKey: page.publicKey,
      title: 'Intro call',
      hostName: 'Ada Host',
      start: MONDAY_9,
      end: '2026-11-02T09:30:00.000Z',
      timeZone: 'Europe/London',
      location: { type: 'video' },
      visitorName: 'Grace Hopper',
      visitorEmail: 'grace@navy.example',
      guests: ['ann@navy.example'],
      note: 'About the compiler.',
    });
    expect((await readManagedBooking(guest, new Date('2026-11-03T00:00:00Z'))).state).toBe('past');
    const origin = {
      appOrigin: 'https://app.example',
      organizerEmail: 'bookings@app.example',
      organizerName: 'Bookings',
    };
    expect(await managedBookingIcs(guest, booked.manageToken, origin, NOW)).toContain(
      `UID:${booked.bookingId}@app.example`,
    );
    // A retry of the same attempt answers the same booking with a new token; the old one stops opening it.
    const again = await bookPublicSlot(entry, deps(), input);
    expect(again.bookingId).toBe(booked.bookingId);
    expect(again.manageToken).not.toBe(booked.manageToken);
    expect(await refusalOf(enterBookingByToken({ db }, booked.manageToken))).toMatchObject({ code: 'NOT_FOUND' });
    expect(await refusalOf(enterBookingByToken({ db }, 'short'))).toMatchObject({ code: 'NOT_FOUND' });
  });

  it('says the calendar is unreachable when it refuses us, and offers nothing', async () => {
    const w = await workspace();
    const { entry } = await livePage(w);
    expect(await mondaySlots(entry, fakeCalendar({ status: 'blocked' }).calendar)).toEqual({
      slots: [],
      calendar: 'unreachable',
    });
    expect((await mondaySlots(entry)).calendar).toBe('ok');
  });
});

describe('a member’s own hours (Bookings › Availability)', () => {
  it('defaults to weekdays 9 to 5, is the member’s own, and a page that follows them books by them', async () => {
    const w = await workspace();
    const bea = await w.addMember('bea', 'member');
    expect((await getMemberHours(w.owner, { timeZone: 'UTC' })).availability.weekly.mon).toEqual([['09:00', '17:00']]);
    const { page, entry } = await livePage(w, { hoursMode: 'mine' });
    expect(page.hoursMode).toBe('mine');
    expect((await mondaySlots(entry)).slots).toHaveLength(16);
    const mine = (await getMemberHours(w.owner, { timeZone: 'UTC' })).availability;
    await setMemberHours(w.owner, {
      availability: { ...mine, weekly: { ...mine.weekly, mon: [['10:00', '11:00']] }, overrides: [] },
    });
    expect((await mondaySlots(entry)).slots.map((slot) => slot.start)).toEqual([
      '2026-11-02T10:00:00.000Z',
      '2026-11-02T10:30:00.000Z',
    ]);
    // Bea's hours are hers alone; the owner's page still follows the owner's.
    await setMemberHours(bea, {
      availability: { ...mine, overrides: [{ date: '2026-11-02', ranges: [], note: 'Away' }] },
    });
    expect((await mondaySlots(entry)).slots).toHaveLength(2);
    expect((await getMemberHours(bea, { timeZone: 'UTC' })).availability.overrides).toEqual([
      { date: '2026-11-02', ranges: [], note: 'Away' },
    ]);
  });
});
