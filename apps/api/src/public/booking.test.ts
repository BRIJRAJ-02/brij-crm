// Booking pages through the real app (spec 0025, milestone 1): the member
// procedures, and the public routes a visitor's browser calls, with a fake
// calendar, a fixed clock and the real Postgres: facts without member emails,
// slots, a booking and its records, a slot taken, the bot checks, the Origin
// check, the rate limits and an unknown key.
import { PublicProfile } from '@crm/contracts';
import { newId, type BookingCalendar, type BookingEvent } from '@crm/core';
import type { Database, IdentityStore } from '@crm/db';
import { testQuery } from '@crm/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createApp } from '../app.ts';
import { EDGE_HEADER, ORIGIN_HEADER } from '../edge.ts';
import { APP_URL, TEST_EDGE_SECRET, testEnv, testServices } from '../testing.ts';
import { createMailpitMailer } from '../mail/mailpit.ts';
import { MAILPIT_URL, newIp, testConnections } from '../../test/sign-in.ts';
import { failure, memberWithWorkspace, tag } from '../../test/workspace.ts';
import { BOT_REFUSED } from './booking.ts';
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
function visit(
  path: string,
  init: {
    method?: string;
    body?: unknown;
    ip?: string;
    origin?: string | null;
    headers?: Record<string, string>;
  } = {},
) {
  const headers: Record<string, string> = {
    [EDGE_HEADER]: TEST_EDGE_SECRET,
    'x-forwarded-for': init.ip ?? newIp(),
    'content-type': 'application/json',
    ...init.headers,
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

/** What a public block is called in a list: its title, a testimonial's author, or nothing. */
function nameOf(item: object): string {
  if ('title' in item && typeof item.title === 'string') return item.title;
  return 'author' in item && typeof item.author === 'string' ? item.author : '';
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
      // A new Public page joins the person's link page by itself (spec 0051).
      items: [{ kind: 'page', slug: 'intro-call', title: 'Intro call' }],
    });
    const address = await handles(`${handle}/intro-call`);
    expect(await address.json()).toEqual({ publicKey: page.publicKey, handle, slug: 'intro-call' });
    const facts = (await (await visit(page.publicKey)).json()) as { readonly path?: string };
    expect(facts.path).toBe(`/${handle}/intro-call`);
    expect((await handles(`${handle}/nothing-here`)).status).toBe(404);
    expect((await handles(`nobody-${newId().slice(-8)}`)).status).toBe(404);
    expect((await handles(`${handle}?after=nonsense`)).status).toBe(400);
  });

  it('answers the link page’s blocks in the order Settings saved, never naming a workspace (spec 0051)', async () => {
    const m = await memberWithWorkspace(app);
    const handle = `blocks-${newId().slice(-8)}`;
    await m.client.profile.update({ workspace: m.slug, handle, mutationId: newId() });
    const { workspace: second } = await m.client.workspaces.create({
      id: newId(),
      name: 'Second shop',
      slug: `second-${tag()}`,
      memberName: 'Ada',
    });
    const make = (workspace: string, title: string) =>
      m.client.bookingPages.create({ workspace, id: newId(), title, timeZone: 'UTC', mutationId: newId() });
    await make(m.slug, 'Quick chat');
    await make(second.slug, 'Brijraj');
    const save = (block: Parameters<typeof m.client.profile.saveItem>[0]['block'], id = newId()) =>
      m.client.profile.saveItem({ workspace: m.slug, id, block, mutationId: newId() });
    const site = await save({ kind: 'link', title: 'LinkedIn', url: 'linkedin.com/in/ada' });
    // A retry of the same add makes nothing new.
    await save({ kind: 'link', title: 'LinkedIn', url: 'linkedin.com/in/ada' }, site.id);
    const heading = await save({ kind: 'heading', title: 'Meet me' });
    const refused = await failure(() => save({ kind: 'link', title: 'Bad', url: 'javascript:alert(1)' }));
    expect(refused.code).toBe('INPUT_INVALID');
    const { items } = await m.client.profile.items({ workspace: m.slug });
    // One page block, not two: a link page belongs to one workspace now (spec 0056), so the page made in the
    // second workspace is placed on that workspace's own link page and never on this one.
    expect(items.map((item) => item.kind)).toEqual(['page', 'link', 'heading']);
    const [first] = items;
    await m.client.profile.orderItems({
      workspace: m.slug,
      ids: [site.id, heading.id, first?.id ?? ''],
      mutationId: newId(),
    });
    // An order that misses a block is refused, and changes nothing.
    const stale = await failure(() =>
      m.client.profile.orderItems({ workspace: m.slug, ids: [site.id, heading.id], mutationId: newId() }),
    );
    expect(stale.code).toBe('CONFIG_INVALID');
    const read = await handles(handle);
    expect(read.headers.get('cache-control')).toContain('no-store');
    const text = await read.text();
    for (const secret of [m.workspace.id, second.id, m.slug, second.slug, 'Second shop', m.email]) {
      expect(text).not.toContain(secret);
    }
    const body = PublicProfile.parse(JSON.parse(text));
    expect(body.items.map((item) => [item.kind, 'fullName' in item ? item.fullName : nameOf(item)])).toEqual([
      ['link', 'LinkedIn'],
      ['heading', 'Meet me'],
      ['page', 'Quick chat'],
    ]);
    expect(body.items[0]).toMatchObject({ url: 'https://linkedin.com/in/ada', mark: 'linkedin' });
    // A search answers the matches flat.
    const found = PublicProfile.parse(await (await handles(`${handle}?q=chat`)).json());
    expect(found.items.map((item) => ('fullName' in item ? item.fullName : nameOf(item)))).toEqual(['Quick chat']);
  });

  it('answers the contact card as a vCard to download, and 404 with none, archived, or no such person (AC-5114)', async () => {
    const m = await memberWithWorkspace(app);
    const handle = `card-${newId().slice(-8)}`;
    await m.client.profile.update({ workspace: m.slug, handle, mutationId: newId() });
    expect((await handles(`${handle}/contact.vcf`)).status).toBe(404);
    expect((await handles(`nobody-${newId().slice(-8)}/contact.vcf`)).status).toBe(404);
    const card = await m.client.profile.saveItem({
      workspace: m.slug,
      id: newId(),
      block: {
        kind: 'contact',
        fullName: 'Ada Lovelace',
        company: 'Acme, Inc.',
        email: 'ada@acme.dev',
        phone: '+44 20 7946 0958',
      },
      mutationId: newId(),
    });
    // Up to three cards (spec 0061, AC-6114), each its own Save contact; with no `card`, the first answers.
    const home = await m.client.profile.saveItem({
      workspace: m.slug,
      id: newId(),
      block: { kind: 'contact', fullName: 'Ada at home' },
      mutationId: newId(),
    });
    const club = await m.client.profile.saveItem({
      workspace: m.slug,
      id: newId(),
      block: { kind: 'contact', fullName: 'Ada at the club' },
      mutationId: newId(),
    });
    const fourth = await failure(() =>
      m.client.profile.saveItem({
        workspace: m.slug,
        id: newId(),
        block: { kind: 'contact', fullName: 'Ada elsewhere' },
        mutationId: newId(),
      }),
    );
    expect(fourth).toMatchObject({ code: 'LIMIT_REACHED', message: 'A link page holds up to 3 contact cards.' });
    expect(await (await handles(`${handle}/contact.vcf?card=${home.id}`)).text()).toContain('FN:Ada at home');
    expect((await handles(`${handle}/contact.vcf?card=${newId()}`)).status).toBe(404);
    for (const extra of [home, club]) {
      await m.client.profile.deleteItem({ workspace: m.slug, id: extra.id, mutationId: newId() });
    }
    const answer = await handles(`${handle}/contact.vcf`);
    expect(answer.status).toBe(200);
    expect(answer.headers.get('content-type')).toBe('text/vcard; charset=utf-8');
    expect(answer.headers.get('content-disposition')).toBe(`attachment; filename="${handle}.vcf"`);
    expect(answer.headers.get('cache-control')).toContain('no-store');
    const vcard = await answer.text();
    expect(vcard.split('\r\n')).toEqual(
      expect.arrayContaining(['FN:Ada Lovelace', 'ORG:Acme\\, Inc.', 'EMAIL;TYPE=INTERNET:ada@acme.dev']),
    );
    expect(vcard).not.toContain('PHOTO');
    expect(vcard).not.toContain(m.email);
    // The page shows its name only; the rest is in the file.
    const page = PublicProfile.parse(await (await handles(handle)).json());
    expect(page.items).toEqual([{ kind: 'contact', id: card.id, fullName: 'Ada Lovelace', company: 'Acme, Inc.' }]);
    await m.client.profile.archiveItem({ workspace: m.slug, id: card.id, archived: true, mutationId: newId() });
    expect((await handles(`${handle}/contact.vcf`)).status).toBe(404);
  });

  it('keeps each person’s link page their own: another member’s id changes nothing', async () => {
    const ada = await memberWithWorkspace(app);
    const bob = await memberWithWorkspace(app);
    const mine = await ada.client.profile.saveItem({
      workspace: ada.slug,
      id: newId(),
      block: { kind: 'heading', title: 'Ada’s' },
      mutationId: newId(),
    });
    const taken = await failure(() =>
      bob.client.profile.saveItem({
        workspace: bob.slug,
        id: mine.id,
        block: { kind: 'heading', title: 'Bob’s now' },
        mutationId: newId(),
      }),
    );
    expect(taken.code).toBe('NOT_FOUND');
    const gone = await failure(() =>
      bob.client.profile.deleteItem({ workspace: bob.slug, id: mine.id, mutationId: newId() }),
    );
    expect(gone.code).toBe('NOT_FOUND');
    expect((await ada.client.profile.items({ workspace: ada.slug })).items).toEqual([
      expect.objectContaining({ id: mine.id, title: 'Ada’s' }),
    ]);
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
    // The host they booked is on the event, first, then the visitor: a guest's own copy never shows the organiser,
    // so without the host on it nothing on the visitor's copy names who they are meeting (owner, 25 Oct 2026).
    const made = events.find((event) => event.start === MONDAY_9);
    expect(made?.attendees.map((attendee) => attendee.email)).toEqual([m.email, 'grace@navy.example']);
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
    const trapped = await visit(path, { method: 'POST', body: booking({ company_url: 'spam.example' }) });
    expect(trapped.status).toBe(400);
    expect(await trapped.json()).toMatchObject({ code: 'INPUT_INVALID', message: BOT_REFUSED });
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

describe('page views for the operator console (spec 0047, AC-1625)', () => {
  const CHROME =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
  const { ownerUrl } = inject('testDatabase');
  const viewsOf = (pageId: string) =>
    testQuery<{ views: number }>(ownerUrl, 'select views from booking_page_views where page_id = $1 order by views', [
      pageId,
    ]);
  const settle = () => new Promise((resolve) => setTimeout(resolve, 200));

  it('counts each load of a visitor once a day, by visitor, and never a host, a bot or no browser at all', async () => {
    const m = await memberWithWorkspace(app);
    const page = await pageOf(m);
    const ip = newIp();
    for (let load = 0; load < 2; load += 1) {
      expect((await visit(`${page.publicKey}/viewer`, { ip, headers: { 'user-agent': CHROME } })).status).toBe(200);
    }
    await visit(`${page.publicKey}/viewer`, { headers: { 'user-agent': CHROME } });
    // The host on their own page, a crawler, and a request with no user agent: none counted.
    await visit(`${page.publicKey}/viewer`, { headers: { 'user-agent': CHROME, cookie: m.cookie } });
    await visit(`${page.publicKey}/viewer`, { headers: { 'user-agent': 'Googlebot/2.1' } });
    await visit(`${page.publicKey}/viewer`);
    await settle();
    expect((await viewsOf(page.id)).map((row) => row.views)).toEqual([1, 2]);
  });

  it('counts a link page’s views and its blocks’ presses, never the owner’s own, a bot’s, or a block not theirs', async () => {
    const m = await memberWithWorkspace(app);
    const handle = `counts-${newId().slice(-8)}`;
    await m.client.profile.update({ workspace: m.slug, handle, mutationId: newId() });
    const site = await m.client.profile.saveItem({
      workspace: m.slug,
      id: newId(),
      block: { kind: 'link', title: 'Site', url: 'ada.dev' },
      mutationId: newId(),
    });
    const heading = await m.client.profile.saveItem({
      workspace: m.slug,
      id: newId(),
      block: { kind: 'heading', title: 'More' },
      mutationId: newId(),
    });
    const other = await memberWithWorkspace(app);
    const theirs = await other.client.profile.saveItem({
      workspace: other.slug,
      id: newId(),
      block: { kind: 'link', title: 'Theirs', url: 'bea.dev' },
      mutationId: newId(),
    });
    const read = (headers: Record<string, string>, query = '') =>
      app.request(`/api/public/handles/${handle}${query}`, {
        headers: { [EDGE_HEADER]: TEST_EDGE_SECRET, 'x-forwarded-for': ip, ...headers },
      });
    const press = (body: string, headers: Record<string, string> = { 'user-agent': CHROME }) =>
      app.request(`/api/public/handles/${handle}/press`, {
        method: 'POST',
        headers: {
          [EDGE_HEADER]: TEST_EDGE_SECRET,
          'x-forwarded-for': ip,
          'content-type': 'text/plain;charset=UTF-8',
          [ORIGIN_HEADER]: APP_URL,
          origin: APP_URL,
          ...headers,
        },
        body,
      });
    const ip = newIp();
    await read({ 'user-agent': CHROME });
    await read({ 'user-agent': CHROME });
    // A later page and a search are the same view's reads; the owner, a crawler and no browser count nothing.
    await read({ 'user-agent': CHROME }, '?q=site');
    await read({ 'user-agent': CHROME }, '?q=');
    await read({ 'user-agent': CHROME, cookie: m.cookie });
    await read({ 'user-agent': 'Googlebot/2.1' });
    await read({});
    for (const body of [site.id, site.id, heading.id, theirs.id, 'nonsense', '']) {
      expect((await press(body)).status).toBe(204);
    }
    expect((await press(site.id, { 'user-agent': CHROME, cookie: m.cookie })).status).toBe(204);
    expect((await press(site.id, { 'user-agent': 'facebookexternalhit/1.1' })).status).toBe(204);
    const nobody = await app.request('/api/public/handles/nobody-here-1/press', {
      method: 'POST',
      headers: {
        [EDGE_HEADER]: TEST_EDGE_SECRET,
        'x-forwarded-for': ip,
        'user-agent': CHROME,
        origin: APP_URL,
        [ORIGIN_HEADER]: APP_URL,
      },
      body: site.id,
    });
    expect(nobody.status).toBe(204);
    await settle();
    const counts = await m.client.profile.counts({ workspace: m.slug });
    expect(counts).toEqual({
      days: 30,
      views: 2,
      visitors: 1,
      before: { views: 0, visitors: 0 },
      presses: [{ id: site.id, presses: 2 }],
    });
    // Another person's figures name nothing of these.
    expect(JSON.stringify(await other.client.profile.counts({ workspace: other.slug }))).not.toContain(site.id);
  });

  it('takes a press from the public origin the page is served on, but no other, and no view another site makes', async () => {
    const PUBLIC = 'https://book.example';
    const env = { ...testEnv(), BOOKING_PUBLIC_ORIGIN: PUBLIC };
    const onPublic = createApp({
      services: {
        ...testServices(env, { db, identity, mailer: createMailpitMailer({ url: MAILPIT_URL, from: env.MAIL_FROM }) }),
        bookingCalendar: calendar,
        bookingLimiter: createMemoryLimiter(),
      },
      env,
    });
    const m = await memberWithWorkspace(app);
    const handle = `beacon-${newId().slice(-8)}`;
    await m.client.profile.update({ workspace: m.slug, handle, mutationId: newId() });
    const site = await m.client.profile.saveItem({
      workspace: m.slug,
      id: newId(),
      block: { kind: 'link', title: 'Site', url: 'ada.dev' },
      mutationId: newId(),
    });
    const ip = newIp();
    const press = (origin: string) =>
      onPublic.request(`/api/public/handles/${handle}/press`, {
        method: 'POST',
        headers: {
          [EDGE_HEADER]: TEST_EDGE_SECRET,
          'x-forwarded-for': ip,
          'user-agent': CHROME,
          [ORIGIN_HEADER]: origin,
          origin,
        },
        body: site.id,
      });
    expect((await press(PUBLIC)).status).toBe(204);
    expect((await press('https://elsewhere.example')).status).toBe(403);
    // A read another site makes (an image there) is answered but never a view.
    await onPublic.request(`/api/public/handles/${handle}`, {
      headers: {
        [EDGE_HEADER]: TEST_EDGE_SECRET,
        'x-forwarded-for': ip,
        'user-agent': CHROME,
        'sec-fetch-site': 'cross-site',
      },
    });
    await settle();
    expect(await m.client.profile.counts({ workspace: m.slug })).toMatchObject({
      views: 0,
      presses: [{ id: site.id, presses: 1 }],
    });
  });
});
