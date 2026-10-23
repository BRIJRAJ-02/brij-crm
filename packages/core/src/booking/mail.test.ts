// What a booking's emails say (spec 0025, AC-636, AC-637): who hears what for
// each kind, the guest page link derived from the booking, the calendar file
// only when no calendar event invited them, reminders that go stale, and
// guests invited once. Against a real Postgres.
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, type Database } from '@crm/db';
import { enterBookingByToken, enterBookingPage, systemScope } from '../access/door.ts';
import { newId } from '../engine/ids.ts';
import { createWorkspace } from '../engine/workspaces.ts';
import { testScope } from '../testing.ts';
import { NO_CALENDAR, type BookingCalendar } from './calendar.ts';
import { addGuests, cancelBooking, guestTarget, hostTarget, moveBooking, removeGuest } from './change.ts';
import type { BookingMailKind } from './mail-queue.ts';
import { markGuestsTold, prepareBookingMail, whenLine } from './mail.ts';
import { createBookingPage } from './pages.ts';
import { bookPublicSlot } from './public.ts';

const { appUrl } = inject('testDatabase');
let db: Database;
beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-booking-mail-tests' });
});
afterAll(async () => {
  await db.close();
});

const LINK_KEY = Buffer.alloc(32, 3);
const NOW = new Date('2026-11-01T00:00:00.000Z');
const ORIGIN = 'https://app.example';
const mailDeps = (now = NOW) => ({
  appOrigin: ORIGIN,
  linkKey: LINK_KEY,
  organizerEmail: 'bookings@app.example',
  now: () => now,
});
const withEvent: BookingCalendar = {
  busy: () => Promise.resolve({ status: 'none' }),
  events: () => Promise.resolve({ meetingId: newId(), videoUrl: 'https://meet.example/abc' }),
  existing: { move: () => Promise.resolve(), cancel: () => Promise.resolve() },
};

/**
 * A calendar file's text with its folded lines joined again (RFC 5545 folds a content line at 75 octets), so an
 * attendee whose line folds inside its address still reads whole.
 */
const unfolded = (content: string | undefined) => content?.replace(/\r\n /g, '');

let count = 0;
async function booked(calendar: BookingCalendar = NO_CALENDAR, guests: string[] = []) {
  count += 1;
  const created = await createWorkspace(db, {
    name: 'Mail',
    slug: `mail-${String(count)}-${String(Date.now())}`,
    firstMember: { name: 'Ada Host', email: 'ada@example.com' },
  });
  const host = testScope({ db, workspaceId: created.workspaceId, actor: { type: 'member', id: created.memberId } });
  const page = await createBookingPage(host, { id: newId(), title: 'Intro call', timeZone: 'UTC' }, NOW);
  const deps = { calendar, now: () => NOW, linkKey: LINK_KEY };
  const result = await bookPublicSlot(await enterBookingPage({ db }, page.publicKey), deps, {
    idempotencyKey: newId(),
    start: '2026-11-02T09:00:00.000Z',
    duration: 30,
    name: 'Grace Hopper',
    email: 'grace@navy.example',
    timeZone: 'Europe/London',
    note: 'About the compiler.',
    guests,
  });
  const system = systemScope(db, created.workspaceId);
  const prepare = (kind: BookingMailKind, now = NOW) =>
    prepareBookingMail(system, mailDeps(now), { bookingId: result.bookingId, kind });
  return { ...result, page, host, deps, system, prepare };
}

describe('the confirmation (AC-636)', () => {
  it('tells the visitor with their link and a calendar file, the host with the details, and invites each guest once', async () => {
    const b = await booked(NO_CALENDAR, ['ann@navy.example']);
    const prepared = await b.prepare('confirmed');
    expect(prepared.messages.map((mail) => mail.to)).toEqual([
      'grace@navy.example',
      'ada@example.com',
      'ann@navy.example',
    ]);
    const [visitor, host, guest] = prepared.messages;
    expect(visitor).toMatchObject({
      subject: 'Booked: Intro call with Ada Host',
      heading: 'You’re booked',
      button: { label: 'View your booking', url: `${ORIGIN}/b/${b.page.publicKey}/manage?t=${b.manageToken}` },
    });
    expect(visitor?.rows).toContainEqual({
      label: 'When',
      value: 'Monday 2 November 2026, 9:00 AM to 9:30 AM (Europe/London)',
    });
    expect(visitor?.ics?.method).toBe('REQUEST');
    expect(visitor?.ics?.content).toContain(`UID:${b.bookingId}@app.example`);
    expect(host).toMatchObject({ subject: 'New booking: Intro call with Grace Hopper' });
    // The host is in the meeting by default (owner, 22 Oct 2026): both files list them, and the host gets one too.
    expect(unfolded(visitor?.ics?.content)).toContain('MAILTO:ada@example.com');
    expect(host?.ics?.method).toBe('REQUEST');
    expect(host?.ics?.content).toContain(`UID:${b.bookingId}@app.example`);
    expect(unfolded(host?.ics?.content)).toContain('MAILTO:grace@navy.example');
    expect(unfolded(host?.ics?.content)).toContain('MAILTO:ada@example.com');
    expect(host?.rows).toContainEqual({ label: 'Note', value: 'About the compiler.' });
    // Each reader's footer says why they got it.
    expect(visitor?.why).toBe('You got this email because this address was used to book Intro call with Ada Host.');
    expect(host?.why).toBe('You got this email because you host Intro call.');
    expect(guest?.why).toBe('You got this email because Grace Hopper added this address to Intro call.');
    // A guest never gets the visitor's link.
    expect(JSON.stringify(guest)).not.toContain(b.manageToken);
    expect(prepared.invited).toEqual(['ann@navy.example']);
    await markGuestsTold(b.system, b.bookingId, prepared);
    expect((await b.prepare('guests')).messages).toEqual([]);
  });

  it('leaves the calendar file out when the calendar event already invited them, and says where to join', async () => {
    const b = await booked(withEvent);
    const [visitor, host] = (await b.prepare('confirmed')).messages;
    expect(visitor?.ics).toBeUndefined();
    // The event is already in the host's calendar, so their email carries no file either.
    expect(host?.ics).toBeUndefined();
    expect(visitor?.rows).toContainEqual({ label: 'Where', value: 'https://meet.example/abc' });
  });
});

describe('changes (AC-638 to AC-640)', () => {
  it('a guest’s move tells the visitor and the host with the old time; a host’s cancel tells the visitor why', async () => {
    const b = await booked();
    const target = guestTarget(await enterBookingByToken({ db }, b.manageToken));
    await moveBooking(target, b.deps, { start: new Date('2026-11-02T10:00:00.000Z') });
    const moved = await b.prepare('moved');
    expect(moved.messages.map((mail) => mail.to)).toEqual(['grace@navy.example', 'ada@example.com']);
    expect(moved.messages[0]?.rows).toContainEqual({
      label: 'Was',
      value: 'Monday 2 November 2026, 9:00 AM to 9:30 AM (Europe/London)',
    });
    expect(moved.messages[0]?.ics?.content).not.toContain('SEQUENCE:0');
    expect(moved.messages[1]?.ics?.method).toBe('REQUEST');

    await cancelBooking(hostTarget(b.host, b.bookingId), b.deps, { reason: 'I’m ill.' });
    const cancelled = await b.prepare('cancelled');
    // The host did it: the visitor hears, with the reason and a way to book again, and the host gets only the
    // calendar file that takes it off their calendar (no calendar event held it).
    expect(cancelled.messages.map((mail) => [mail.to, mail.subject])).toEqual([
      ['grace@navy.example', 'Cancelled: Intro call with Ada Host'],
      ['ada@example.com', 'Cancelled: Intro call with Grace Hopper'],
    ]);
    expect(cancelled.messages[1]?.ics?.method).toBe('CANCEL');
    expect(cancelled.messages[0]).toMatchObject({
      heading: 'Ada Host cancelled your booking',
      button: { label: 'Book another time', url: `${ORIGIN}/b/${b.page.publicKey}` },
    });
    expect(cancelled.messages[0]?.rows).toContainEqual({ label: 'Reason', value: 'I’m ill.' });
    expect(cancelled.messages[0]?.ics?.method).toBe('CANCEL');
    // Nothing else goes for a cancelled booking.
    expect((await b.prepare('reminder_1h', new Date('2026-11-02T08:30:00Z'))).skipped).toBe('cancelled');
  });

  it('a guest’s cancel tells the host; a guest added later gets an invitation with the calendar file', async () => {
    const b = await booked(withEvent);
    const target = guestTarget(await enterBookingByToken({ db }, b.manageToken));
    await addGuests(target, b.deps, { emails: ['bob@navy.example'] });
    const invited = await b.prepare('guests');
    expect(invited.messages.map((mail) => [mail.to, mail.subject])).toEqual([
      ['bob@navy.example', 'Invitation: Intro call with Ada Host'],
    ]);
    expect(invited.messages[0]?.ics?.method).toBe('REQUEST');
    // Not on the calendar event, so a move reaches their calendar through our file.
    await moveBooking(target, b.deps, { start: new Date('2026-11-02T10:00:00.000Z') });
    const moved = await b.prepare('moved');
    expect(moved.messages.find((mail) => mail.to === 'bob@navy.example')?.ics?.method).toBe('REQUEST');
    expect(JSON.stringify(moved.messages.find((mail) => mail.to === 'bob@navy.example'))).not.toContain(b.manageToken);
    await cancelBooking(target, b.deps, {});
    const cancelled = await b.prepare('cancelled');
    expect(cancelled.messages.map((mail) => mail.to)).toEqual([
      'grace@navy.example',
      'bob@navy.example',
      'ada@example.com',
    ]);
    expect(cancelled.messages[2]?.subject).toBe('Cancelled by guest: Intro call with Grace Hopper');
  });
});

describe('a guest taken off (QA Q81)', () => {
  it('is told once, with a cancelled calendar file, and is invited again when added back', async () => {
    const b = await booked(NO_CALENDAR, ['ann@navy.example']);
    const confirmed = await b.prepare('confirmed');
    await markGuestsTold(b.system, b.bookingId, confirmed);
    const target = guestTarget(await enterBookingByToken({ db }, b.manageToken));
    await removeGuest(target, b.deps, { email: 'ann@navy.example' });
    const told = await b.prepare('guests');
    expect(told.messages.map((mail) => [mail.to, mail.subject])).toEqual([
      ['ann@navy.example', 'No longer invited: Intro call with Ada Host'],
    ]);
    expect(told.messages[0]?.ics?.method).toBe('CANCEL');
    expect(unfolded(told.messages[0]?.ics?.content)).toContain('ann@navy.example');
    expect(told.messages[0]?.intro).toBe(
      'Grace Hopper took you off Intro call, hosted by Ada Host. Nothing else to do.',
    );
    // The cancelled file only takes it off their calendar: never the visitor's note.
    expect(unfolded(told.messages[0]?.ics?.content)).not.toContain('About the compiler.');
    // Never the visitor's link: it is their key.
    expect(JSON.stringify(told.messages)).not.toContain(b.manageToken);
    expect(told.uninvited).toEqual(['ann@navy.example']);
    await markGuestsTold(b.system, b.bookingId, told);
    // Told once: a later run says nothing more, and a move or cancel no longer reaches them.
    expect((await b.prepare('guests')).messages).toEqual([]);
    await moveBooking(target, b.deps, { start: new Date('2026-11-02T10:00:00.000Z') });
    expect((await b.prepare('moved')).messages.map((mail) => mail.to)).not.toContain('ann@navy.example');
    // Added back, they are invited again.
    await addGuests(target, b.deps, { emails: ['ann@navy.example'] });
    const again = await b.prepare('guests');
    expect(again.messages.map((mail) => [mail.to, mail.subject])).toEqual([
      ['ann@navy.example', 'Invitation: Intro call with Ada Host'],
    ]);
    await markGuestsTold(b.system, b.bookingId, again);
    // Taken off a second time, nothing more goes: removing and adding back can't be used to mail them again and again.
    await removeGuest(target, b.deps, { email: 'ann@navy.example' });
    expect((await b.prepare('guests')).messages).toEqual([]);
    await addGuests(target, b.deps, { emails: ['ann@navy.example'] });
    expect((await b.prepare('guests')).messages).toEqual([]);
  });

  it('names the host when a host took them off', async () => {
    const b = await booked(NO_CALENDAR, ['ann@navy.example']);
    await markGuestsTold(b.system, b.bookingId, await b.prepare('confirmed'));
    await removeGuest(hostTarget(b.host, b.bookingId), b.deps, { email: 'ann@navy.example' });
    const [told] = (await b.prepare('guests')).messages;
    expect(told).toMatchObject({
      preview: 'Ada Host took you off Intro call.',
      intro: 'Ada Host took you off Intro call. Nothing else to do.',
    });
  });

  it('says nothing to someone taken off before their invitation went', async () => {
    const b = await booked(NO_CALENDAR, ['ann@navy.example']);
    const target = guestTarget(await enterBookingByToken({ db }, b.manageToken));
    await removeGuest(target, b.deps, { email: 'ann@navy.example' });
    expect((await b.prepare('guests')).messages).toEqual([]);
  });
});

describe('reminders (AC-637)', () => {
  it('go only when the meeting is that close, with the call’s link when there is one', async () => {
    const b = await booked(withEvent);
    expect((await b.prepare('reminder_24h', new Date('2026-11-01T09:00:00Z'))).messages[0]).toMatchObject({
      subject: 'Tomorrow: Intro call with Ada Host',
      button: { label: 'Join the call', url: 'https://meet.example/abc' },
    });
    expect((await b.prepare('reminder_1h', new Date('2026-11-02T08:00:00Z'))).messages[0]?.subject).toBe(
      'In an hour: Intro call with Ada Host',
    );
    // Too early (a reminder left from before a move) or after it started: nothing.
    expect((await b.prepare('reminder_1h', new Date('2026-11-01T09:00:00Z'))).skipped).toBe('stale');
    expect((await b.prepare('reminder_24h', new Date('2026-11-02T09:10:00Z'))).skipped).toBe('stale');
  });
});

describe('whenLine', () => {
  it('writes the range in the zone, the zone named', () => {
    expect(whenLine(new Date('2026-11-02T09:00:00Z'), new Date('2026-11-02T09:30:00Z'), 'America/New_York')).toBe(
      'Monday 2 November 2026, 4:00 AM to 4:30 AM (America/New York)',
    );
  });
});
