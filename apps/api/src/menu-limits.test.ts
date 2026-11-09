// The guest menu read's rate limits under the `/m/<key>` server render (security review, should-fix 4): the render
// reads from one function address, so it vouches for each guest with the edge secret and the guest's address. Without
// the secret a forwarded guest address is ignored; with it, two guests get separate windows; and a spray of made up
// keys never spends a real menu's renders. Real sessions, real Postgres, the real limits (60 a minute per address).
import { newId } from '@crm/core';
import type { Database, IdentityStore } from '@crm/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newIp, signInApp, testConnections } from '../test/sign-in.ts';
import { memberWithWorkspace } from '../test/workspace.ts';
import { GUEST_IP_HEADER, RENDER_HEADER } from '@crm/contracts';
import { EDGE_HEADER, ORIGIN_HEADER } from './edge.ts';
import { MENU_LIMITS } from './public/limits.ts';
import { APP_URL, TEST_EDGE_SECRET } from './testing.ts';

let db: Database;
let identity: IdentityStore;
let app: ReturnType<typeof signInApp>['app'];

beforeAll(() => {
  ({ db, identity } = testConnections());
  ({ app } = signInApp({ db, identity }));
});
afterAll(async () => {
  await identity.close();
  await db.close();
});

const PER_ADDRESS = MENU_LIMITS.readsPerAddress.max;

/** A read of `key` from `from` (the address the edge saw), with the render's headers when given. */
function read(key: string, from: string, render: { secret?: string; guestIp?: string } = {}) {
  return app.request(`/api/public/menu/${key}`, {
    headers: {
      [EDGE_HEADER]: TEST_EDGE_SECRET,
      'x-forwarded-for': from,
      [ORIGIN_HEADER]: APP_URL,
      ...(render.secret === undefined ? {} : { [RENDER_HEADER]: render.secret }),
      ...(render.guestIp === undefined ? {} : { [GUEST_IP_HEADER]: render.guestIp }),
    },
  });
}

/** A made up key of the right shape (16 letters), which names nothing. */
const madeUpKey = () =>
  Array.from(
    { length: 16 },
    () => 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ'[Math.floor(Math.random() * 48)],
  ).join('');

/** A workspace with Menu installed and one dish published; its place's key. */
async function publishedMenuKey(): Promise<string> {
  const m = await memberWithWorkspace(app);
  await m.client.hospitality.install({
    workspace: m.slug,
    app: 'menu',
    business: {
      name: 'Cafe Limits',
      kind: 'cafe',
      place: { country: 'GB', timeZone: 'Europe/London' },
      currency: 'GBP',
    },
    mutationId: newId(),
  });
  const draft = await m.client.menu.draft({ workspace: m.slug });
  const place = draft.places[0];
  if (place === undefined) throw new Error('No place.');
  const menuId = newId();
  const sectionId = newId();
  await m.client.menu.saveMenu({
    workspace: m.slug,
    id: menuId,
    name: 'Dinner',
    placeIds: [place.id],
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
  await m.client.menu.publish({ workspace: m.slug, mutationId: newId() });
  return place.menuKey;
}

/** Spends `from`'s window on `key`, every read answered as `expected`. */
async function spend(key: string, from: string, render: { secret?: string; guestIp?: string }, expected = 200) {
  for (let i = 0; i < PER_ADDRESS; i += 1) expect((await read(key, from, render)).status).toBe(expected);
}

describe('the guest menu read under the server render (should-fix 4)', () => {
  it('ignores a forwarded guest address without the secret, or with a wrong one', async () => {
    const key = await publishedMenuKey();
    const from = newIp();
    // Each read claims a fresh guest, but none carries the secret: all of them count against `from`.
    for (let i = 0; i < PER_ADDRESS; i += 1) {
      const render =
        i % 2 === 0 ? { guestIp: newIp() } : { secret: 'not-the-edge-secret-but-long-enough-anyway', guestIp: newIp() };
      expect((await read(key, from, render)).status).toBe(200);
    }
    const refused = await read(key, from, { guestIp: newIp() });
    expect(refused.status).toBe(429);
    expect(refused.headers.get('cache-control')).toBe('no-store');
  });

  it('with the secret, counts each guest on their own window, never the function’s', async () => {
    const key = await publishedMenuKey();
    const fn = newIp();
    const first = newIp();
    await spend(key, fn, { secret: TEST_EDGE_SECRET, guestIp: first });
    expect((await read(key, fn, { secret: TEST_EDGE_SECRET, guestIp: first })).status).toBe(429);
    // Another guest through the same function is untouched, and so is the function's own address.
    expect((await read(key, fn, { secret: TEST_EDGE_SECRET, guestIp: newIp() })).status).toBe(200);
    expect((await read(key, fn)).status).toBe(200);
  });

  it('never lets a spray of made up keys spend a real menu’s renders', async () => {
    const key = await publishedMenuKey();
    const fn = newIp();
    // The render with no guest address: each made up key spends only its own window.
    for (let i = 0; i <= PER_ADDRESS; i += 1) {
      expect((await read(madeUpKey(), fn, { secret: TEST_EDGE_SECRET })).status).toBe(404);
    }
    expect((await read(key, fn, { secret: TEST_EDGE_SECRET })).status).toBe(200);
    // A direct spray from the function's address spends that address, and still not the render's budget.
    await spend(madeUpKey(), fn, {}, 404);
    expect((await read(madeUpKey(), fn)).status).toBe(429);
    expect((await read(key, fn, { secret: TEST_EDGE_SECRET })).status).toBe(200);
    // A key that can't be one is turned away before any window or lookup.
    expect((await read('short', fn, { secret: TEST_EDGE_SECRET })).status).toBe(404);
  });
});
