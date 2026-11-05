// Table seating's public routes through the real app (spec 0066 B7 lite): from an empty workspace through the member
// procedures (install, tables, setup, Publish) to a guest's facts, times, reservation, manage by token and by code
// with email, change and cancel; the Origin check, the bot check, the code lookup's tighter limit, and the Service
// list hearing every guest change.
import { newId } from '@crm/core';
import type { Database, IdentityStore } from '@crm/db';
import { testQuery } from '@crm/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createApp } from '../app.ts';
import { EDGE_HEADER, ORIGIN_HEADER } from '../edge.ts';
import { APP_URL, TEST_EDGE_SECRET, testEnv, testServices } from '../testing.ts';
import { createMailpitMailer } from '../mail/mailpit.ts';
import { MAILPIT_URL, newIp, testConnections } from '../../test/sign-in.ts';
import { memberWithWorkspace } from '../../test/workspace.ts';
import { createMemoryLimiter } from './limits.ts';

const { ownerUrl } = inject('testDatabase');
const DAY_MS = 86_400_000;
const MONDAY = ((): string => {
  const soon = Date.now() + 2 * DAY_MS;
  const hop = (8 - new Date(soon).getUTCDay()) % 7;
  return new Date(soon + hop * DAY_MS).toISOString().slice(0, 10);
})();
const SUNDAY = new Date(Date.parse(`${MONDAY}T00:00:00.000Z`) - DAY_MS).toISOString().slice(0, 10);
const NOW = new Date(`${SUNDAY}T09:00:00.000Z`);

let db: Database;
let identity: IdentityStore;
let app: ReturnType<typeof createApp>;

beforeAll(() => {
  ({ db, identity } = testConnections());
  const env = testEnv();
  app = createApp({
    services: {
      ...testServices(env, { db, identity, mailer: createMailpitMailer({ url: MAILPIT_URL, from: env.MAIL_FROM }) }),
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

function guest(path: string, init: { method?: string; body?: unknown; ip?: string; origin?: string | null } = {}) {
  const headers: Record<string, string> = {
    [EDGE_HEADER]: TEST_EDGE_SECRET,
    'x-forwarded-for': init.ip ?? newIp(),
    'content-type': 'application/json',
  };
  if (init.origin !== null) {
    headers[ORIGIN_HEADER] = init.origin ?? APP_URL;
    headers.origin = init.origin ?? APP_URL;
  }
  return app.request(`/api/public/tables/${path}`, {
    method: init.method ?? 'GET',
    headers,
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
}

/** An empty workspace "Somewhere", set up the way a newcomer would: install, hours, a table, Publish. */
async function somewhere() {
  const m = await memberWithWorkspace(app);
  await testQuery(ownerUrl, `update workspaces set early_access = '{business_apps}' where id = $1`, [m.workspace.id]);
  await m.client.hospitality.install({
    workspace: m.slug,
    app: 'table_seating',
    business: {
      name: 'Somewhere',
      kind: 'restaurant',
      place: { country: 'GB', timeZone: 'Europe/London' },
      currency: 'GBP',
    },
    mutationId: newId(),
  });
  const place = (await m.client.hospitality.business({ workspace: m.slug })).places[0];
  if (place === undefined) throw new Error('No place.');
  const range = [{ from: '18:00', to: '23:00' }];
  await m.client.hospitality.updatePlace({
    workspace: m.slug,
    placeId: place.id,
    hours: {
      weekly: { mon: range, tue: range, wed: range, thu: range, fri: range, sat: range, sun: range },
      exceptions: [],
    },
    mutationId: newId(),
  });
  await m.client.hospitality.addResources({
    workspace: m.slug,
    placeId: place.id,
    kind: 'table',
    labels: ['T1'],
    minCapacity: 1,
    maxCapacity: 8,
    mutationId: newId(),
  });
  const setup = await m.client.tables.setup({ workspace: m.slug, placeId: place.id });
  return { m, placeId: place.id, key: setup.publicKey, rules: setup.rules };
}

const reservation = (over: Record<string, unknown> = {}) => ({
  idempotencyKey: newId(),
  party: 2,
  start: `${MONDAY}T18:00:00.000Z`,
  name: 'Grace Hopper',
  email: 'grace@navy.example',
  phone: '+44 20 7946 0000',
  company_url: '',
  startedAt: NOW.getTime() - 60_000,
  ...over,
});

describe('a reservation page from an empty workspace (spec 0066 B7 lite)', () => {
  it('refuses Publish until set up, then a guest reserves, finds, changes and cancels it', async () => {
    const { m, placeId, key, rules } = await somewhere();
    // Not published yet: the page says so.
    const closed = await (await guest(key)).json();
    expect(closed).toMatchObject({ taking: false, business: { name: 'Somewhere' } });
    await m.client.tables.saveSetup({
      workspace: m.slug,
      placeId,
      rules: { ...rules, online: true },
      mutationId: newId(),
    });
    const page = await (await guest(key)).json();
    expect(page).toMatchObject({ taking: true, partyMin: 1, partyMax: 8, today: SUNDAY });

    const times = (await (await guest(`${key}/times?party=2&date=${MONDAY}`)).json()) as { times: string[] };
    expect(times.times[0]).toBe(`${MONDAY}T18:00:00.000Z`);

    // The Origin check: a write from elsewhere is refused before anything happens.
    expect(
      (await guest(`${key}/reserve`, { method: 'POST', body: reservation(), origin: 'https://evil.example' })).status,
    ).toBe(403);
    // The bot check: sent faster than a person could.
    expect(
      (await guest(`${key}/reserve`, { method: 'POST', body: reservation({ startedAt: NOW.getTime() }) })).status,
    ).toBe(400);

    const made = await guest(`${key}/reserve`, { method: 'POST', body: reservation() });
    expect(made.status).toBe(200);
    const { visit, manageToken } = (await made.json()) as { visit: { lookupCode: string }; manageToken: string };
    expect(visit.lookupCode).toMatch(/^[A-Z2-9]{8}$/);

    const taken = await guest(`${key}/reserve`, { method: 'POST', body: reservation({ email: 'ada@example.com' }) });
    expect(taken.status).toBe(409);
    expect(await taken.json()).toMatchObject({
      code: 'SLOT_TAKEN',
      // Every 30 minutes, checklabs' default slot interval.
      next: [`${MONDAY}T19:30:00.000Z`, `${MONDAY}T20:00:00.000Z`, `${MONDAY}T20:30:00.000Z`],
    });

    const byCode = await guest(`${key}/visit`, {
      method: 'POST',
      body: { guest: { code: visit.lookupCode.toLowerCase(), email: 'GRACE@navy.example' } },
    });
    expect(await byCode.json()).toMatchObject({ visit: { lookupCode: visit.lookupCode, party: 2 } });
    const wrongEmail = await guest(`${key}/visit`, {
      method: 'POST',
      body: { guest: { code: visit.lookupCode, email: 'someone@else.example' } },
    });
    expect(wrongEmail.status).toBe(404);

    const changed = await guest(`${key}/change`, {
      method: 'POST',
      body: { guest: { token: manageToken }, start: `${MONDAY}T20:00:00.000Z`, party: 4 },
    });
    expect(await changed.json()).toMatchObject({ visit: { start: `${MONDAY}T20:00:00.000Z`, party: 4 } });

    // The Service list sees the guest's change, and its row stored one `visits` event naming the place.
    const day = await m.client.tables.day({ workspace: m.slug, placeId, date: MONDAY });
    expect(day.visits.map((each) => [each.start, each.party])).toEqual([[`${MONDAY}T20:00:00.000Z`, 4]]);
    const rows = await testQuery<{ item_ids: string[] }>(
      ownerUrl,
      `select item_ids::text[] as item_ids from outbox where workspace_id = $1 and kind = 'visits' order by seq`,
      [m.workspace.id],
    );
    expect(rows.map((row) => row.item_ids)).toEqual([[placeId], [placeId]]);

    // The calendar file is POSTed with the token in the body, never in an address a log or history keeps.
    expect((await guest(`${key}/manage/${manageToken}/ics`)).status).not.toBe(200);
    const ics = await guest(`${key}/ics`, { method: 'POST', body: { guest: { token: manageToken } } });
    expect(ics.headers.get('content-type')).toContain('text/calendar');
    expect(await ics.text()).toContain('Table for 4 at Somewhere');

    const cancelled = await guest(`${key}/cancel`, { method: 'POST', body: { guest: { token: manageToken } } });
    expect(await cancelled.json()).toMatchObject({ visit: { status: 'cancelled' } });
  });

  it('wears the guest look at the version its facts name, and nothing at another (5 November 2026)', async () => {
    const { m, placeId, key, rules } = await somewhere();
    await m.client.tables.saveSetup({
      workspace: m.slug,
      placeId,
      rules: { ...rules, online: true },
      mutationId: newId(),
    });
    const page = (await (await guest(key)).json()) as { look?: string; areas?: unknown; menuPath?: unknown };
    expect(page.look).toMatch(/^[0-9a-f]{12}$/);
    // No Menu app: no menu link. Its one table sits in no area: no seating choice.
    expect(page.menuPath).toBeUndefined();
    expect(page.areas).toBeUndefined();
    const look = await guest(`${key}/look.css?v=${page.look ?? ''}`);
    expect(look.status).toBe(200);
    expect(look.headers.get('content-type')).toMatch(/^text\/css/);
    expect(await look.text()).toMatch(/--menu-accent:#[0-9a-f]{6}/);
    // Any other version is the plain not found, never cached, so an old or made up one never sticks at the edge.
    const stale = await guest(`${key}/look.css?v=000000000000`);
    expect(stale.status).toBe(404);
    expect(stale.headers.get('cache-control')).toBe('no-store');
    expect((await guest(`${key}/look.css`)).status).toBe(404);
  });

  it('offers only areas holding a table taken online, only while taking, and the menu only while guests can open it', async () => {
    const { m, placeId, key, rules } = await somewhere();
    const facts = async () => (await (await guest(key)).json()) as { areas?: readonly string[]; menuPath?: string };
    const area = async (name: string, labels: readonly string[], online: boolean) => {
      const floor = await m.client.hospitality.saveArea({ workspace: m.slug, placeId, name, mutationId: newId() });
      const areaId = floor.areas.find((each) => each.name === name)?.id;
      await m.client.hospitality.addResources({
        workspace: m.slug,
        placeId,
        kind: 'table',
        labels: [...labels],
        ...(areaId === undefined ? {} : { areaId }),
        minCapacity: 1,
        maxCapacity: 4,
        online,
        mutationId: newId(),
      });
    };
    await area('Terrace', ['T2'], true);
    await area('Back room', ['T3'], false);
    // Saved after the tables: Publish reads the floor.
    await m.client.tables.saveSetup({
      workspace: m.slug,
      placeId,
      rules: { ...rules, online: true },
      mutationId: newId(),
    });
    expect((await facts()).areas).toEqual(['Terrace']);

    await m.client.hospitality.install({ workspace: m.slug, app: 'menu', mutationId: newId() });
    const menuId = newId();
    const sectionId = newId();
    await m.client.menu.saveMenu({
      workspace: m.slug,
      id: menuId,
      name: 'Dinner',
      placeIds: [placeId],
      mutationId: newId(),
    });
    await m.client.menu.saveSection({ workspace: m.slug, id: sectionId, menuId, name: 'Mains', mutationId: newId() });
    await m.client.menu.saveItem({
      workspace: m.slug,
      id: newId(),
      sectionId,
      item: {
        name: 'Soup',
        priceMinor: 650,
        diet: [],
        allergens: [],
        kcal: null,
        featured: false,
        sizes: [],
        groupIds: [],
      },
      mutationId: newId(),
    });
    // A draft is no menu yet; published, the page links it; hidden, it doesn't.
    expect((await facts()).menuPath).toBeUndefined();
    await m.client.menu.publish({ workspace: m.slug, mutationId: newId() });
    expect((await facts()).menuPath).toMatch(/^\/m\/[A-Za-z0-9_-]{16}$/);
    await m.client.menu.setHidden({ workspace: m.slug, hidden: true, mutationId: newId() });
    expect((await facts()).menuPath).toBeUndefined();

    await m.client.tables.saveSetup({
      workspace: m.slug,
      placeId,
      rules: { ...rules, online: false },
      mutationId: newId(),
    });
    expect((await facts()).areas).toBeUndefined();
  });

  it('limits code lookups per address tighter than reads, so codes can’t be swept', async () => {
    const { key } = await somewhere();
    const ip = newIp();
    const statuses: number[] = [];
    for (let index = 0; index < 11; index += 1) {
      const answer = await guest(`${key}/visit`, {
        method: 'POST',
        ip,
        body: { guest: { code: 'ABCDEFGH', email: 'grace@navy.example' } },
      });
      statuses.push(answer.status);
    }
    expect(statuses.slice(0, 10).every((status) => status === 404)).toBe(true);
    expect(statuses[10]).toBe(429);
    expect((await guest('AAAAAAAAAAAAAAAA')).status).toBe(404);
  });

  it('keeps a reservation made before the app went: view, cancel and the calendar file work; times, reserve and change refuse', async () => {
    const { m, placeId, key, rules } = await somewhere();
    await m.client.tables.saveSetup({
      workspace: m.slug,
      placeId,
      rules: { ...rules, online: true },
      mutationId: newId(),
    });
    const made = (await (await guest(`${key}/reserve`, { method: 'POST', body: reservation() })).json()) as {
      manageToken: string;
    };
    await m.client.hospitality.remove({ workspace: m.slug, app: 'table_seating', mutationId: newId() });
    const token = { guest: { token: made.manageToken } };
    expect((await guest(`${key}/visit`, { method: 'POST', body: token })).status).toBe(200);
    expect((await guest(`${key}/ics`, { method: 'POST', body: token })).status).toBe(200);
    expect(await (await guest(key)).json()).toMatchObject({ taking: false });
    const times = await guest(`${key}/times?party=2&date=${MONDAY}`);
    expect(await times.json()).toMatchObject({ code: 'BOOKING_CLOSED' });
    const again = await guest(`${key}/reserve`, {
      method: 'POST',
      body: reservation({ start: `${MONDAY}T21:00:00.000Z`, email: 'ada@example.com' }),
    });
    expect(await again.json()).toMatchObject({ code: 'BOOKING_CLOSED' });
    const change = await guest(`${key}/change`, {
      method: 'POST',
      body: { ...token, start: `${MONDAY}T20:00:00.000Z` },
    });
    expect(await change.json()).toMatchObject({ code: 'BOOKING_CLOSED' });
    const cancelled = await guest(`${key}/cancel`, { method: 'POST', body: token });
    expect(await cancelled.json()).toMatchObject({ visit: { status: 'cancelled' } });
  });

  it('refuses a fourth upcoming reservation for one email generically, without saying what exists', async () => {
    const { m, placeId, key, rules } = await somewhere();
    await m.client.tables.saveSetup({
      workspace: m.slug,
      placeId,
      rules: { ...rules, online: true },
      mutationId: newId(),
    });
    for (const at of ['18:00', '19:30', '21:00']) {
      const made = await guest(`${key}/reserve`, {
        method: 'POST',
        body: reservation({ start: `${MONDAY}T${at}:00.000Z`, party: 1 }),
      });
      expect(made.status).toBe(200);
    }
    const fourth = await guest(`${key}/reserve`, {
      method: 'POST',
      body: reservation({ start: `${MONDAY}T21:30:00.000Z`, party: 1 }),
    });
    expect(fourth.status).toBe(409);
    expect(await fourth.json()).toMatchObject({
      code: 'CONFLICT',
      message: 'We couldn’t take this reservation online. Please call the restaurant.',
    });
  });

  it('gives a change or cancel by code its own bucket, apart from the lookups', async () => {
    const { key } = await somewhere();
    const ip = newIp();
    const lookup = { guest: { code: 'ABCDEFGH', email: 'grace@navy.example' } };
    for (let index = 0; index < 10; index += 1) await guest(`${key}/visit`, { method: 'POST', ip, body: lookup });
    expect((await guest(`${key}/visit`, { method: 'POST', ip, body: lookup })).status).toBe(429);
    // The lookups are spent; a cancel by code still reaches the reservation check (none here: 404, not 429).
    expect((await guest(`${key}/cancel`, { method: 'POST', ip, body: lookup })).status).toBe(404);
  });
});

describe('walk ins and new reservation emails on the staff side (spec 0066 B7 lite)', () => {
  it('answers the Reservations page’s places and tables with only the fields it draws', async () => {
    const { m, placeId } = await somewhere();
    const { places } = await m.client.tables.places({ workspace: m.slug });
    expect(places.map((place) => place.id)).toEqual([placeId]);
    expect(Object.keys(places[0] ?? {}).sort()).toEqual(['hours', 'id', 'name', 'timeZone']);
    const floor = await m.client.tables.floor({ workspace: m.slug, placeId });
    expect(floor.resources.map((table) => table.label)).toEqual(['T1']);
    expect(Object.keys(floor.resources[0] ?? {}).sort()).toEqual(['id', 'label', 'maxCapacity', 'minCapacity']);
  });

  it('lists the free tables for a party, seats a walk in now, and refuses the same table twice', async () => {
    const { m, placeId, rules } = await somewhere();
    await m.client.tables.saveSetup({ workspace: m.slug, placeId, rules, mutationId: newId() });
    const free = await m.client.tables.freeTables({ workspace: m.slug, placeId, party: 3 });
    expect(free.tables.map((table) => table.label)).toEqual(['T1']);
    expect(free.holdMinutes).toBe(105);
    const tableIds = free.tables[0]?.resourceIds ?? [];
    const seated = await m.client.tables.walkIn({
      workspace: m.slug,
      placeId,
      party: 3,
      resourceIds: [...tableIds],
      mutationId: newId(),
    });
    expect(seated.status).toBe('started');
    expect((await m.client.tables.freeTables({ workspace: m.slug, placeId, party: 3 })).tables).toEqual([]);
    await expect(
      m.client.tables.walkIn({ workspace: m.slug, placeId, party: 2, resourceIds: [...tableIds], mutationId: newId() }),
    ).rejects.toMatchObject({ code: 'SLOT_TAKEN' });
  });

  it('turns the reader’s new reservation emails off and on, on for the owner by default', async () => {
    const { m, placeId, rules } = await somewhere();
    await m.client.tables.saveSetup({ workspace: m.slug, placeId, rules, mutationId: newId() });
    expect((await m.client.tables.setup({ workspace: m.slug, placeId })).notifyMe).toBe(true);
    expect(await m.client.tables.setNotify({ workspace: m.slug, placeId, on: false, mutationId: newId() })).toEqual({
      placeId,
      notifyMe: false,
    });
    expect((await m.client.tables.setup({ workspace: m.slug, placeId })).notifyMe).toBe(false);
  });
});
