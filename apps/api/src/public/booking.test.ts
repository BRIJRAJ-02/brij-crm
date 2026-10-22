// Booking pages through the real app (spec 0025, milestone 1): the member
// procedures, and the public routes a visitor's browser calls, with a fake
// calendar, a fixed clock and the real Postgres: facts without member emails,
// slots, a booking and its records, a slot taken, the bot checks, the Origin
// check, the rate limits and an unknown key.
import { newId, type BookingCalendar, type BookingEvent } from '@crm/core';
import type { Database, IdentityStore } from '@crm/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.ts';
import { EDGE_HEADER, ORIGIN_HEADER } from '../edge.ts';
import { APP_URL, TEST_EDGE_SECRET, testEnv, testServices } from '../testing.ts';
import { createMailpitMailer } from '../mail/mailpit.ts';
import { MAILPIT_URL, newIp, testConnections } from '../../test/sign-in.ts';
import { failure, memberWithWorkspace } from '../../test/workspace.ts';
import { createMemoryLimiter } from './limits.ts';

/** Sunday 1 November 2026, midnight UTC. */
const NOW = new Date('2026-11-01T00:00:00.000Z');
const MONDAY_9 = '2026-11-02T09:00:00.000Z';

let db: Database;
let identity: IdentityStore;
const events: BookingEvent[] = [];
const calendar: BookingCalendar = {
  busy: () =>
    Promise.resolve({ status: 'read', busy: [{ start: '2026-11-02T12:00:00.000Z', end: '2026-11-02T13:00:00.000Z' }] }),
  events: (event) => {
    events.push(event);
    return Promise.resolve({ meetingId: newId() });
  },
};
let app: ReturnType<typeof createApp>;

beforeAll(() => {
  ({ db, identity } = testConnections());
  const env = testEnv();
  app = createApp({
    services: {
      ...testServices(env, { db, identity, mailer: createMailpitMailer({ url: MAILPIT_URL, from: env.MAIL_FROM }) }),
      bookingCalendar: calendar,
      bookingLimiter: createMemoryLimiter(),
      now: () => NOW,
    },
    env,
  });
});
afterAll(async () => {
  await identity.close();
  await db.close();
});

/** A request as the public page sends it through the edge, from one client address. */
function visit(path: string, init: { method?: string; body?: unknown; ip?: string; origin?: string | null } = {}) {
  const headers: Record<string, string> = {
    [EDGE_HEADER]: TEST_EDGE_SECRET,
    'x-forwarded-for': init.ip ?? newIp(),
    'content-type': 'application/json',
  };
  if (init.origin !== null) {
    // The edge forwards it as its own header; locally (no edge) the browser's Origin is read.
    headers[ORIGIN_HEADER] = init.origin ?? APP_URL;
    headers.origin = init.origin ?? APP_URL;
  }
  return app.request(`/api/public/booking/${path}`, {
    method: init.method ?? 'GET',
    headers,
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
}

const booking = (over: Record<string, unknown> = {}) => ({
  idempotencyKey: newId(),
  start: MONDAY_9,
  duration: 30,
  name: 'Grace Hopper',
  email: 'grace@navy.example',
  timeZone: 'America/New_York',
  company_url: '',
  startedAt: NOW.getTime() - 60_000,
  ...over,
});

async function pageOf(m: Awaited<ReturnType<typeof memberWithWorkspace>>) {
  return m.client.bookingPages.create({
    workspace: m.slug,
    id: newId(),
    title: 'Intro call',
    timeZone: 'UTC',
    mutationId: newId(),
  });
}

describe('the member procedures (AC-623, AC-645)', () => {
  it('makes, changes, lists and deletes a page; another member’s page is absent', async () => {
    const m = await memberWithWorkspace(app);
    const page = await pageOf(m);
    expect(page).toMatchObject({ slug: 'intro-call', status: 'live', canChange: true, bookingsThisMonth: 0 });
    const changed = await m.client.bookingPages.update({
      workspace: m.slug,
      pageId: page.id,
      settings: { minNoticeMinutes: 120, description: 'Thirty minutes to meet.' },
      mutationId: newId(),
    });
    expect(changed).toMatchObject({ minNoticeMinutes: 120, description: 'Thirty minutes to meet.' });
    const refused = await failure(() =>
      m.client.bookingPages.update({
        workspace: m.slug,
        pageId: page.id,
        settings: { durations: [7] },
        mutationId: newId(),
      }),
    );
    expect(refused.code).toBe('INPUT_INVALID');
    expect((await m.client.bookingPages.list({ workspace: m.slug })).map((each) => each.id)).toEqual([page.id]);
    await m.client.bookingPages.delete({ workspace: m.slug, pageId: page.id, mutationId: newId() });
    expect(await m.client.bookingPages.list({ workspace: m.slug })).toEqual([]);
    const other = await memberWithWorkspace(app);
    expect((await failure(() => other.client.bookingPages.get({ workspace: m.slug, pageId: page.id }))).code).toBe(
      'NOT_FOUND',
    );
  });
});

describe('handle addresses (22 Oct 2026)', () => {
  /** A request to the handle routes, through the edge. */
  const handles = (path: string) =>
    app.request(`/api/public/handles/${path}`, {
      headers: { [EDGE_HEADER]: TEST_EDGE_SECRET, 'x-forwarded-for': newIp() },
    });

  it('claims a handle in Settings, then answers the profile and each page by /<handle>/<slug>', async () => {
    const m = await memberWithWorkspace(app);
    const page = await pageOf(m);
    const handle = `ada-${newId().slice(-8)}`;
    const profile = await m.client.profile.update({ workspace: m.slug, handle, bio: 'Hello.', mutationId: newId() });
    expect(profile).toMatchObject({ handle, bio: 'Hello.' });
    const reserved = await failure(() =>
      m.client.profile.update({ workspace: m.slug, handle: 'settings', mutationId: newId() }),
    );
    expect(reserved.code).toBe('INPUT_INVALID');
    expect((await m.client.bookingPages.get({ workspace: m.slug, pageId: page.id })).handle).toBe(handle);

    const read = await handles(handle);
    expect(read.status).toBe(200);
    const body = await read.text();
    expect(body).not.toContain(m.email);
    expect(JSON.parse(body)).toMatchObject({
      handle,
      bio: 'Hello.',
      links: [{ slug: 'intro-call', title: 'Intro call' }],
    });
    const address = await handles(`${handle}/intro-call`);
    expect(await address.json()).toEqual({ publicKey: page.publicKey, handle, slug: 'intro-call' });
    const facts = (await (await visit(page.publicKey)).json()) as { readonly path?: string };
    expect(facts.path).toBe(`/${handle}/intro-call`);
    expect((await handles(`${handle}/nothing-here`)).status).toBe(404);
    expect((await handles(`nobody-${newId().slice(-8)}`)).status).toBe(404);
    expect((await handles(`${handle}?after=nonsense`)).status).toBe(400);
  });
});

describe('the public page (AC-629, AC-632 to AC-634, AC-643, AC-644)', () => {
  it('answers the facts and the slots, books, and lists the booking with its person', async () => {
    const m = await memberWithWorkspace(app);
    const page = await pageOf(m);
    const facts = await visit(page.publicKey);
    expect(facts.status).toBe(200);
    expect(facts.headers.get('cache-control')).toBe('private, no-store');
    const body = await facts.text();
    expect(body).not.toContain(m.email);
    expect(JSON.parse(body)).toMatchObject({ title: 'Intro call', durations: [30], location: { type: 'video' } });

    const slots = await visit(
      `${page.publicKey}/slots?from=2026-11-02T00:00:00.000Z&to=2026-11-03T00:00:00.000Z&duration=30&tz=America/New_York`,
    );
    const { slots: offered } = (await slots.json()) as { slots: { start: string }[] };
    // 09:00 to 17:00 UTC is sixteen half hours; the busy hour at 12:00 takes two.
    expect(offered).toHaveLength(14);
    expect(offered.map((slot) => slot.start)).not.toContain('2026-11-02T12:00:00.000Z');

    const booked = await visit(`${page.publicKey}/book`, { method: 'POST', body: booking() });
    expect(booked.status).toBe(200);
    const answer = (await booked.json()) as { manageToken: string };
    expect(answer).toMatchObject({
      booking: {
        start: MONDAY_9,
        end: '2026-11-02T09:30:00.000Z',
        title: 'Intro call',
        hostName: 'Ada',
        location: { type: 'video' },
        timeZone: 'America/New_York',
      },
    });
    // The guest page reads the booking by its token, and its calendar file.
    const managed = await visit(`manage/${answer.manageToken}`);
    expect(await managed.json()).toMatchObject({ state: 'confirmed', start: MONDAY_9, visitorName: 'Grace Hopper' });
    const ics = await visit(`manage/${answer.manageToken}/ics`);
    expect(ics.headers.get('content-type')).toBe('text/calendar; charset=utf-8');
    expect(await ics.text()).toContain('METHOD:REQUEST');
    expect((await visit('manage/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')).status).toBe(404);
    expect(events.some((event) => event.start === MONDAY_9 && event.attendees[0]?.email === 'grace@navy.example')).toBe(
      true,
    );
    const [listed] = await m.client.bookings.list({ workspace: m.slug, pageId: page.id, when: 'upcoming' });
    expect(listed).toMatchObject({ visitorName: 'Grace Hopper', status: 'confirmed', eventFailed: false });
    expect(listed?.personRecordId).toBeDefined();
    expect(listed?.companyRecordId).toBeDefined();

    const taken = await visit(`${page.publicKey}/book`, {
      method: 'POST',
      body: booking({ email: 'ann@other.example' }),
    });
    expect(taken.status).toBe(409);
    expect(await taken.json()).toMatchObject({
      code: 'SLOT_TAKEN',
      message: 'That time was just taken. Pick another.',
    });
  });

  it('refuses a filled honeypot, a booking sent too fast, bad input, a foreign origin and an unknown key', async () => {
    const m = await memberWithWorkspace(app);
    const page = await pageOf(m);
    const path = `${page.publicKey}/book`;
    expect((await visit(path, { method: 'POST', body: booking({ company_url: 'spam.example' }) })).status).toBe(400);
    expect((await visit(path, { method: 'POST', body: booking({ startedAt: NOW.getTime() - 500 }) })).status).toBe(400);
    const bad = await visit(path, { method: 'POST', body: booking({ email: 'not an email' }) });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({
      code: 'INPUT_INVALID',
      message: 'Give an email address such as name@example.com.',
    });
    expect((await visit(path, { method: 'POST', body: booking(), origin: 'https://evil.example' })).status).toBe(403);
    const unknown = await visit('AAAAAAAAAAAAAAAA');
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toMatchObject({ code: 'NOT_FOUND', message: 'This page is no longer available.' });
    const slotsQuery = await visit(
      `${page.publicKey}/slots?from=2026-11-02T00:00:00.000Z&to=2027-02-02T00:00:00.000Z&duration=30&tz=UTC`,
    );
    expect(slotsQuery.status).toBe(400);
  });

  it('limits one address to 5 bookings and 60 reads a minute (429 with Retry-After)', async () => {
    const m = await memberWithWorkspace(app);
    const page = await pageOf(m);
    const ip = newIp();
    const hours = ['09', '10', '11', '13', '14'];
    for (const hour of hours) {
      const answer = await visit(`${page.publicKey}/book`, {
        method: 'POST',
        ip,
        body: booking({ start: `2026-11-02T${hour}:00:00.000Z`, email: `v${hour}@visitor.example` }),
      });
      expect(answer.status).toBe(200);
    }
    const sixth = await visit(`${page.publicKey}/book`, {
      method: 'POST',
      ip,
      body: booking({ start: '2026-11-02T15:00:00.000Z' }),
    });
    expect(sixth.status).toBe(429);
    expect(Number(sixth.headers.get('retry-after'))).toBeGreaterThan(0);
    for (let read = 0; read < 60; read += 1) expect((await visit(page.publicKey, { ip })).status).toBe(200);
    expect((await visit(page.publicKey, { ip })).status).toBe(429);
  });
});

describe('the guest page’s changes and the host’s (milestone 2: AC-638 to AC-640, AC-675 to AC-677)', () => {
  async function booked() {
    const m = await memberWithWorkspace(app);
    const page = await pageOf(m);
    const answer = await visit(`${page.publicKey}/book`, { method: 'POST', body: booking() });
    const { manageToken } = (await answer.json()) as { manageToken: string };
    return { m, page, token: manageToken };
  }

  it('moves to a time the page offers, adds guests, then cancels with a reason', async () => {
    const { m, token } = await booked();
    const slots = await visit(`manage/${token}/slots?from=2026-11-02T00:00:00.000Z&to=2026-11-03T00:00:00.000Z&tz=UTC`);
    expect(slots.status).toBe(200);
    const { slots: offered } = (await slots.json()) as { slots: { start: string }[] };
    expect(offered.map((slot) => slot.start)).toContain('2026-11-02T10:00:00.000Z');

    const moved = await visit(`manage/${token}/move`, { method: 'POST', body: { start: '2026-11-02T10:00:00.000Z' } });
    expect(moved.status).toBe(200);
    expect(await moved.json()).toMatchObject({
      booking: { start: '2026-11-02T10:00:00.000Z', state: 'confirmed', canMove: true },
    });

    const guests = await visit(`manage/${token}/guests`, {
      method: 'POST',
      body: { emails: ['ann@navy.example', 'grace@navy.example'] },
    });
    expect(await guests.json()).toEqual({ added: 1, guests: ['ann@navy.example'] });
    const removed = await visit(`manage/${token}/guests/remove`, {
      method: 'POST',
      body: { email: 'ann@navy.example' },
    });
    expect(await removed.json()).toEqual({ guests: [] });

    // A taken time names it, and a bad body says what is wrong.
    const taken = await visit(`manage/${token}/move`, { method: 'POST', body: { start: '2026-11-02T12:00:00.000Z' } });
    expect(taken.status).toBe(409);
    expect(await taken.json()).toMatchObject({ code: 'SLOT_TAKEN' });
    const bad = await visit(`manage/${token}/guests`, { method: 'POST', body: { emails: ['not an email'] } });
    expect(bad.status).toBe(400);

    const cancelled = await visit(`manage/${token}/cancel`, { method: 'POST', body: { reason: 'Something came up.' } });
    expect(await cancelled.json()).toMatchObject({
      booking: { state: 'cancelled', canChange: false, cancelReason: 'Something came up.' },
    });
    const listed = await m.client.bookings.listAll({ workspace: m.slug, when: 'cancelled' });
    expect(listed[0]).toMatchObject({ cancelledBy: 'guest', cancelReason: 'Something came up.', reschedules: 1 });
  });

  it('refuses a change from a foreign origin, and an unknown token', async () => {
    const { token } = await booked();
    const foreign = await visit(`manage/${token}/cancel`, { method: 'POST', body: {}, origin: 'https://evil.example' });
    expect(foreign.status).toBe(403);
    const unknown = await visit(`manage/${'x'.repeat(32)}/cancel`, { method: 'POST', body: {} });
    expect(unknown.status).toBe(404);
  });

  it('limits one booking to 8 changes a minute, whatever the address', async () => {
    const { token } = await booked();
    const statuses: number[] = [];
    for (let index = 0; index < 9; index += 1) {
      const answer = await visit(`manage/${token}/guests`, { method: 'POST', body: { emails: ['ann@navy.example'] } });
      statuses.push(answer.status);
    }
    expect(statuses.slice(0, 8).every((status) => status === 200)).toBe(true);
    expect(statuses[8]).toBe(429);
  });

  it('lets the host move, copy the guest link and cancel; a stranger gets nothing', async () => {
    const { m, page, token } = await booked();
    const [listed] = await m.client.bookings.listAll({ workspace: m.slug, when: 'upcoming' });
    if (listed === undefined) throw new Error('No booking listed.');
    const link = await m.client.bookings.guestLink({ workspace: m.slug, bookingId: listed.id });
    expect(link.path).toBe(`/b/${page.publicKey}/manage?t=${token}`);
    const slots = await m.client.bookings.moveSlots({
      workspace: m.slug,
      bookingId: listed.id,
      from: '2026-11-02T00:00:00.000Z',
      to: '2026-11-03T00:00:00.000Z',
    });
    expect(slots.slots.length).toBeGreaterThan(0);
    expect(
      await m.client.bookings.move({
        workspace: m.slug,
        bookingId: listed.id,
        start: '2026-11-02T11:00:00.000Z',
        mutationId: newId(),
      }),
    ).toEqual({ moved: true });
    const stranger = await memberWithWorkspace(app);
    const refused = await failure(() =>
      stranger.client.bookings.cancel({ workspace: m.slug, bookingId: listed.id, mutationId: newId() }),
    );
    expect(refused.code).toBe('NOT_FOUND');
    expect(
      await m.client.bookings.cancel({ workspace: m.slug, bookingId: listed.id, reason: 'Ill.', mutationId: newId() }),
    ).toEqual({ cancelled: true });
    const seen = await visit(`manage/${token}`);
    expect(await seen.json()).toMatchObject({ state: 'cancelled', cancelReason: 'Ill.' });
  });
});
