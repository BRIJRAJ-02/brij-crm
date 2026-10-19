// Booking's calendar calls over spec 0024's connections (spec 0025, AC-630,
// AC-633), against the real Postgres and the fake provider: busy times are the
// host's calendar's, no connection is `none`, a refused grant is `blocked`, a
// passing outage `unavailable`, and an event lands on the host's calendar.
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, type Database } from '@crm/db';
import { connectCalendar } from '../calendar/connections.ts';
import { createFakeCalendarProvider } from '../calendar/fake.ts';
import { decodeTokenKey } from '../calendar/tokens.ts';
import { createWorkspace } from '../engine/workspaces.ts';
import { testScope } from '../testing.ts';
import { connectedCalendar } from './connected.ts';

const { appUrl } = inject('testDatabase');
let db: Database;

beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-booking-calendar-tests' });
});
afterAll(async () => {
  await db.close();
});

const tokenKey = decodeTokenKey(Buffer.alloc(32, 5).toString('base64'));
const FROM = '2026-11-02T00:00:00.000Z';
const TO = '2026-11-03T00:00:00.000Z';

async function world() {
  const created = await createWorkspace(db, {
    name: 'Booking calendar',
    slug: `booking-calendar-${String(Date.now())}-${String(Math.random()).slice(2, 8)}`,
    firstMember: { name: 'Ada', email: 'ada@acme.dev' },
  });
  const owner = testScope({ db, workspaceId: created.workspaceId, actor: { type: 'member', id: created.memberId } });
  const fake = createFakeCalendarProvider();
  const calendar = connectedCalendar({ db, providers: { google: fake.provider }, tokenKey });
  const connect = async () => {
    const exchanged = await fake.provider.exchangeCode('code:ada@acme.dev', 'https://crm.test/callback');
    await connectCalendar(owner, { provider: 'google', exchanged, tokenKey });
  };
  const ask = { workspaceId: created.workspaceId, memberId: created.memberId, from: FROM, to: TO };
  return { created, fake, calendar, connect, ask };
}

describe('connectedCalendar', () => {
  it('answers none with no connection, and the calendar’s busy times with one', async () => {
    const { fake, calendar, connect, ask } = await world();
    expect(await calendar.busy(ask)).toEqual({ status: 'none' });
    await connect();
    fake.put('ada@acme.dev', {
      id: 'e1',
      status: 'confirmed',
      start: { at: '2026-11-02T10:00:00.000Z', allDay: false },
      end: { at: '2026-11-02T11:00:00.000Z', allDay: false },
      attendees: [],
      isPrivate: false,
    });
    expect(await calendar.busy(ask)).toEqual({
      status: 'read',
      busy: [{ start: '2026-11-02T10:00:00.000Z', end: '2026-11-02T11:00:00.000Z' }],
    });
  });

  it('fails open on an outage and closed on a refused grant', async () => {
    const { fake, calendar, connect, ask } = await world();
    await connect();
    fake.failNext('freeBusy', 'CALENDAR_UNAVAILABLE');
    expect(await calendar.busy(ask)).toEqual({ status: 'unavailable' });
    fake.failNext('freeBusy', 'CALENDAR_AUTH_REVOKED');
    expect(await calendar.busy(ask)).toEqual({ status: 'blocked' });
  });

  it('puts the booking on the host’s calendar, and makes nothing without a connection', async () => {
    const { created, fake, calendar, connect } = await world();
    const event = {
      workspaceId: created.workspaceId,
      hostMemberId: created.memberId,
      bookingId: '019a0000-0000-7000-8000-000000000001',
      title: 'Intro with Bea',
      description: '',
      start: '2026-11-02T10:00:00.000Z',
      end: '2026-11-02T10:30:00.000Z',
      attendees: [{ email: 'bea@example.com', name: 'Bea' }],
      video: false,
    };
    expect(await calendar.events(event)).toEqual({});
    expect(fake.calls('createEvent')).toBe(0);
    await connect();
    await calendar.events(event);
    expect(fake.calls('createEvent')).toBe(1);
  });
});
