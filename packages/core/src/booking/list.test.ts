// Bookings, the workspace's list (spec 0025, AC-646), against the real
// Postgres: upcoming soonest first and past latest first, with the page's
// title and location; a member sees their own pages' bookings and the ones
// they host, an admin everyone's, a member without either nothing. The week
// read: a range's bookings, cancelled ones too, and the reader's own calendar
// events synced from the fake provider (never another member's).
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, type Database } from '@crm/db';
import { enterBookingPage, systemScope } from '../access/door.ts';
import { connectCalendar } from '../calendar/connections.ts';
import { createFakeCalendarProvider } from '../calendar/fake.ts';
import { syncConnection } from '../calendar/sync.ts';
import { decodeTokenKey } from '../calendar/tokens.ts';
import { outboxHook } from '../engine/outbox.ts';
import { newId } from '../engine/ids.ts';
import { createWorkspace } from '../engine/workspaces.ts';
import { rescope, testScope } from '../testing.ts';
import { NO_CALENDAR } from './calendar.ts';
import { listWorkspaceBookings, readBookingsCalendar } from './list.ts';
import { createBookingPage } from './pages.ts';
import { bookPublicSlot } from './public.ts';

const { appUrl } = inject('testDatabase');
let db: Database;

beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-booking-list-tests' });
});
afterAll(async () => {
  await db.close();
});

const NOW = new Date('2026-11-01T00:00:00.000Z');

async function workspace() {
  const created = await createWorkspace(db, {
    name: 'Booking list',
    slug: `booking-list-${newId().slice(-12)}`,
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
  return { ...created, owner, addMember };
}

const book = async (publicKey: string, start: string, name: string) => {
  const entry = await enterBookingPage({ db }, publicKey);
  return bookPublicSlot(
    entry,
    { calendar: NO_CALENDAR, now: () => NOW, linkKey: Buffer.alloc(32, 7) },
    {
      idempotencyKey: newId(),
      start,
      duration: 30,
      name,
      email: `${name.toLowerCase()}@example.org`,
      timeZone: 'Europe/London',
      note: 'About the pilot',
      guests: ['ops@example.org'],
    },
  );
};

describe('the bookings list (AC-646)', () => {
  it('lists upcoming soonest first and past latest first, with the page title, location, guests and note', async () => {
    const w = await workspace();
    const page = await createBookingPage(
      w.owner,
      {
        id: newId(),
        title: 'Quick chat',
        timeZone: 'UTC',
        settings: { location: { type: 'address', value: '1 High St' } },
      },
      NOW,
    );
    await book(page.publicKey, '2026-11-03T10:00:00.000Z', 'Later');
    await book(page.publicKey, '2026-11-02T09:00:00.000Z', 'Sooner');

    const upcoming = await listWorkspaceBookings(w.owner, { when: 'upcoming' }, NOW);
    expect(upcoming.map((booking) => booking.visitorName)).toEqual(['Sooner', 'Later']);
    expect(upcoming[0]).toMatchObject({
      pageTitle: 'Quick chat',
      location: { type: 'address', value: '1 High St' },
      visitorEmail: 'sooner@example.org',
      guests: ['ops@example.org'],
      note: 'About the pilot',
      status: 'confirmed',
    });
    expect(await listWorkspaceBookings(w.owner, { when: 'past' }, NOW)).toEqual([]);

    const later = new Date('2026-11-10T00:00:00.000Z');
    expect((await listWorkspaceBookings(w.owner, { when: 'past' }, later)).map((each) => each.visitorName)).toEqual([
      'Later',
      'Sooner',
    ]);
    expect(await listWorkspaceBookings(w.owner, { when: 'upcoming' }, later)).toEqual([]);
    expect(await listWorkspaceBookings(w.owner, { when: 'cancelled' }, NOW)).toEqual([]);
  });

  it('keeps a cancelled booking out of Upcoming and Past, on Canceled with its reason', async () => {
    const w = await workspace();
    const page = await createBookingPage(w.owner, { id: newId(), title: 'Quick chat', timeZone: 'UTC' }, NOW);
    const kept = await book(page.publicKey, '2026-11-02T09:00:00.000Z', 'Kept');
    const gone = await book(page.publicKey, '2026-11-02T10:00:00.000Z', 'Gone');
    await db.withWorkspace(w.workspaceId, (tx) =>
      tx.execute(sql`update bookings set status = 'cancelled', cancel_reason = 'Clash' where id = ${gone.bookingId}`),
    );
    expect((await listWorkspaceBookings(w.owner, { when: 'upcoming' }, NOW)).map((each) => each.id)).toEqual([
      kept.bookingId,
    ]);
    expect(await listWorkspaceBookings(w.owner, { when: 'cancelled' }, NOW)).toMatchObject([
      { id: gone.bookingId, status: 'cancelled', cancelReason: 'Clash' },
    ]);
    const later = new Date('2026-11-10T00:00:00.000Z');
    expect((await listWorkspaceBookings(w.owner, { when: 'past' }, later)).map((each) => each.id)).toEqual([
      kept.bookingId,
    ]);
  });

  it('shows a member only their own pages’ bookings; an admin sees everyone’s', async () => {
    const w = await workspace();
    const bea = await w.addMember('Bea', 'member');
    const cy = await w.addMember('Cy', 'admin');
    const adas = await createBookingPage(w.owner, { id: newId(), title: 'Ada’s', timeZone: 'UTC' }, NOW);
    const beas = await createBookingPage(bea, { id: newId(), title: 'Bea’s', timeZone: 'UTC' }, NOW);
    await book(adas.publicKey, '2026-11-02T09:00:00.000Z', 'Visitor');
    await book(beas.publicKey, '2026-11-02T11:00:00.000Z', 'Other');

    expect((await listWorkspaceBookings(bea, { when: 'upcoming' }, NOW)).map((each) => each.pageTitle)).toEqual([
      'Bea’s',
    ]);
    expect((await listWorkspaceBookings(cy, { when: 'upcoming' }, NOW)).map((each) => each.pageTitle)).toEqual([
      'Ada’s',
      'Bea’s',
    ]);
  });

  it('reads a week: its bookings, cancelled too, and the reader’s own calendar events, never another member’s', async () => {
    const w = await workspace();
    const bea = await w.addMember('Bea', 'member');
    const page = await createBookingPage(w.owner, { id: newId(), title: 'Quick chat', timeZone: 'UTC' }, NOW);
    const kept = await book(page.publicKey, '2026-11-02T09:00:00.000Z', 'Kept');
    const gone = await book(page.publicKey, '2026-11-03T09:00:00.000Z', 'Gone');
    await book(page.publicKey, '2026-11-12T09:00:00.000Z', 'Later');
    await db.withWorkspace(w.workspaceId, (tx) =>
      tx.execute(sql`update bookings set status = 'cancelled' where id = ${gone.bookingId}`),
    );
    const week = await readBookingsCalendar(w.owner, {
      from: '2026-11-02T00:00:00.000Z',
      to: '2026-11-09T00:00:00.000Z',
    });
    expect(week.bookings.map((each) => [each.id, each.status])).toEqual([
      [kept.bookingId, 'confirmed'],
      [gone.bookingId, 'cancelled'],
    ]);
    expect(week.events).toEqual([]);

    // The owner's calendar, through the fake provider and a real sync (a meeting with someone else is stored).
    const tokenKey = decodeTokenKey(Buffer.alloc(32, 7).toString('base64'));
    const fake = createFakeCalendarProvider();
    const exchanged = await fake.provider.exchangeCode('code:ada@example.com', 'https://crm.test/callback');
    const connection = await connectCalendar(w.owner, { provider: 'google', exchanged, tokenKey });
    const start = new Date();
    start.setUTCHours(10, 0, 0, 0);
    start.setTime(start.getTime() + 2 * 86_400_000);
    fake.put('ada@example.com', {
      id: 'review',
      status: 'confirmed',
      icalUid: 'review@google.com',
      title: 'Design review',
      start: { at: start.toISOString(), allDay: false },
      end: { at: new Date(start.getTime() + 3_600_000).toISOString(), allDay: false },
      organizerEmail: 'ada@example.com',
      attendees: [
        { email: 'ada@example.com', response: 'accepted', isOrganizer: true, isSelf: true },
        { email: 'zed@globex.com', response: 'accepted', isOrganizer: false, isSelf: false },
      ],
      isPrivate: false,
    });
    await syncConnection(
      {
        providers: { google: fake.provider },
        tokenKey,
        systemScope: (workspaceId) => systemScope(db, workspaceId),
        hooks: [outboxHook()],
        isFreeDomain: () => false,
      },
      { workspaceId: w.workspaceId, connectionId: connection.id },
    );
    const range = {
      from: new Date(start.getTime() - 86_400_000).toISOString(),
      to: new Date(start.getTime() + 86_400_000).toISOString(),
    };
    expect((await readBookingsCalendar(w.owner, range)).events).toMatchObject([
      { connectionId: connection.id, title: 'Design review', startsAt: start.toISOString(), allDay: false },
    ]);
    expect((await readBookingsCalendar(bea, range)).events).toEqual([]);

    // The booking's own event, synced back from the host's calendar: one block, the booking's.
    fake.put('ada@example.com', {
      id: 'mirror',
      status: 'confirmed',
      icalUid: 'mirror@google.com',
      title: 'Quick chat with Kept',
      start: { at: '2026-11-02T09:00:00.000Z', allDay: false },
      end: { at: '2026-11-02T09:30:00.000Z', allDay: false },
      organizerEmail: 'ada@example.com',
      attendees: [
        { email: 'ada@example.com', response: 'accepted', isOrganizer: true, isSelf: true },
        { email: 'kept@example.org', response: 'accepted', isOrganizer: false, isSelf: false },
      ],
      isPrivate: false,
    });
    await syncConnection(
      {
        providers: { google: fake.provider },
        tokenKey,
        systemScope: (workspaceId) => systemScope(db, workspaceId),
        hooks: [outboxHook()],
        isFreeDomain: () => false,
      },
      { workspaceId: w.workspaceId, connectionId: connection.id },
    );
    const stored = await db.withWorkspace(w.workspaceId, (tx) =>
      tx.execute<{ id: string }>(sql`select id::text from meetings where ical_uid = 'mirror@google.com'`),
    );
    expect(stored.rows).toHaveLength(1);
    const mirrored = await readBookingsCalendar(w.owner, {
      from: '2026-11-02T00:00:00.000Z',
      to: '2026-11-09T00:00:00.000Z',
    });
    expect(mirrored.bookings.map((each) => each.id)).toEqual([kept.bookingId, gone.bookingId]);
    expect(mirrored.events).toEqual([]);
  });
});
