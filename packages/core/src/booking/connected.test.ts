// Booking's calendar calls over spec 0024's connections (spec 0025, AC-630,
// AC-633), against the real Postgres and the fake provider: busy times are the
// host's calendar's, no connection is `none`, a refused grant is `blocked`, a
// passing outage `unavailable`, and an event lands on the host's calendar.
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, type Database } from '@crm/db';
import { connectCalendar, updateCalendarConnection } from '../calendar/connections.ts';
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
  /** Connects another account for the same host. */
  const connectAs = async (account: string) => {
    const exchanged = await fake.provider.exchangeCode(`code:${account}`, 'https://crm.test/callback');
    return connectCalendar(owner, { provider: 'google', exchanged, tokenKey });
  };
  return { created, owner, fake, calendar, connect, connectAs, ask };
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

  it('puts the booking on the host’s default calendar, not their oldest (AC-711)', async () => {
    const { created, owner, fake, calendar, connect, connectAs } = await world();
    await connect();
    const work = await connectAs('ada@work.dev');
    await updateCalendarConnection(owner, { connectionId: work.id, isDefault: true });
    await calendar.events({
      workspaceId: created.workspaceId,
      hostMemberId: created.memberId,
      bookingId: '019a0000-0000-7000-8000-000000000002',
      title: 'Intro with Cy',
      description: '',
      start: '2026-11-02T10:00:00.000Z',
      end: '2026-11-02T10:30:00.000Z',
      attendees: [{ email: 'cy@example.com', name: 'Cy' }],
      video: false,
    });
    // The fake keeps each account's calendar: the event is in the default one's.
    const window = { from: FROM, to: TO };
    const inWork = await fake.provider.freeBusy(fake.tokensFor('ada@work.dev'), window.from, window.to);
    const inFirst = await fake.provider.freeBusy(fake.tokensFor('ada@acme.dev'), window.from, window.to);
    expect(inWork).toHaveLength(1);
    expect(inFirst).toEqual([]);
  });

  it('reads past one failing calendar and names it, and closes only when the default is refused or all fail', async () => {
    const { fake, calendar, connect, connectAs, ask } = await world();
    await connect();
    const work = await connectAs('ada@work.dev');
    fake.put('ada@acme.dev', {
      id: 'e1',
      status: 'confirmed',
      start: { at: '2026-11-02T10:00:00.000Z', allDay: false },
      end: { at: '2026-11-02T11:00:00.000Z', allDay: false },
      attendees: [],
      isPrivate: false,
    });
    // The second calendar (not the default) is refused: the default's times still answer, the other named.
    fake.failFreeBusy('ada@work.dev', 'CALENDAR_AUTH_REVOKED');
    expect(await calendar.busy(ask)).toEqual({
      status: 'read',
      busy: [{ start: '2026-11-02T10:00:00.000Z', end: '2026-11-02T11:00:00.000Z' }],
      skipped: [{ connectionId: work.id, reason: 'blocked' }],
    });
    // A passing outage on both: unavailable (offered as if no calendar).
    fake.failFreeBusy('ada@work.dev', 'CALENDAR_UNAVAILABLE');
    fake.failFreeBusy('ada@acme.dev', 'CALENDAR_UNAVAILABLE');
    expect(await calendar.busy(ask)).toEqual({ status: 'unavailable' });
    // The default (where events go) refused: closed, whatever the other says.
    fake.failFreeBusy('ada@work.dev', undefined);
    fake.failFreeBusy('ada@acme.dev', 'CALENDAR_AUTH_REVOKED');
    expect(await calendar.busy(ask)).toEqual({ status: 'blocked' });
  });
});
