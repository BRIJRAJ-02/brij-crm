// The Menu app through the real app (spec 0065, H1): the guest menu's public read answers only what Publish froze and
// is filed under the place's edge tag (AC-6531), Publish, Sold out, a profile change and removing Menu purge that tag
// (Rules settled: Routes), and a photo goes up at two widths, Manage hospitality only, cleaned, and is served only as
// the live snapshot names it (AC-6527). Real sessions, real Postgres, an in memory store.
import { menuCacheTags, type MenuDraft, type PublicMenu } from '@crm/contracts';
import { menuWorkspaceCacheTags, newId } from '@crm/core';
import type { Database, IdentityStore } from '@crm/db';
import { testQuery } from '@crm/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { jpegWith } from '../test/pictures.ts';
import { newIp, rpcClient, signIn, signInApp, testConnections } from '../test/sign-in.ts';
import { memberWithWorkspace } from '../test/workspace.ts';
import { EDGE_HEADER, ORIGIN_HEADER } from './edge.ts';
import type { FileStore } from './storage/blob.ts';
import { APP_URL, TEST_EDGE_SECRET } from './testing.ts';

const { ownerUrl } = inject('testDatabase');
let db: Database;
let identity: IdentityStore;
let app: ReturnType<typeof signInApp>['app'];
const kept = new Map<string, { body: Uint8Array; contentType: string }>();
const store: FileStore = {
  put: (pathname, body, contentType) => {
    kept.set(pathname, { body, contentType });
    return Promise.resolve();
  },
  get: (pathname) => {
    const found = kept.get(pathname);
    if (found === undefined) return Promise.resolve(undefined);
    return Promise.resolve({
      stream: new Blob([found.body]).stream(),
      size: found.body.byteLength,
      contentType: found.contentType,
    });
  },
  copy: () => Promise.reject(new Error('Not used here.')),
  remove: (pathnames) => {
    for (const pathname of pathnames) kept.delete(pathname);
    return Promise.resolve();
  },
};

const tagged: string[][] = [];
const forgotten: string[][] = [];

beforeAll(() => {
  ({ db, identity } = testConnections());
  ({ app } = signInApp(
    { db, identity },
    {},
    {
      files: store,
      edgeCache: {
        tag: (tags) => void tagged.push([...tags]),
        forget: (tags) => {
          forgotten.push([...tags]);
          return Promise.resolve();
        },
      },
    },
  ));
});
afterAll(async () => {
  await identity.close();
  await db.close();
});

function send(path: string, init: { method?: string; cookie?: string; workspace?: string; body?: FormData } = {}) {
  return app.request(path, {
    method: init.method ?? 'GET',
    headers: {
      [EDGE_HEADER]: TEST_EDGE_SECRET,
      'x-forwarded-for': newIp(),
      [ORIGIN_HEADER]: APP_URL,
      origin: APP_URL,
      ...(init.cookie === undefined ? {} : { cookie: init.cookie }),
      ...(init.workspace === undefined ? {} : { 'x-crm-workspace': init.workspace }),
    },
    ...(init.body === undefined ? {} : { body: init.body }),
  });
}

/** A workspace with Menu installed, a menu with one dish at its place, answering what the tests need. */
async function menuWorkspace() {
  const m = await memberWithWorkspace(app);
  await testQuery(ownerUrl, `update workspaces set early_access = '{business_apps}' where id = $1`, [m.workspace.id]);
  await m.client.hospitality.install({
    workspace: m.slug,
    app: 'menu',
    business: {
      name: 'Cafe Nowhere',
      kind: 'cafe',
      place: { country: 'GB', timeZone: 'Europe/London' },
      currency: 'GBP',
    },
    mutationId: newId(),
  });
  const first = await m.client.menu.draft({ workspace: m.slug });
  const place = first.places[0];
  if (place === undefined) throw new Error('No place.');
  const menuId = newId();
  const sectionId = newId();
  const itemId = newId();
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
    id: itemId,
    sectionId,
    item: {
      name: 'Soup',
      priceMinor: 650,
      diet: ['vegan'],
      allergens: [{ code: 'celery', level: 'contains' }],
      kcal: null,
      featured: false,
      sizes: [],
      groupIds: [],
    },
    mutationId: newId(),
  });
  return { m, place, itemId };
}

describe('the guest menu read (AC-6528, AC-6531)', () => {
  it('answers nothing before Publish, then the snapshot, edge cached under the place’s tag', async () => {
    const { m, place, itemId } = await menuWorkspace();
    expect((await send(`/api/public/menu/${place.menuKey}`)).status).toBe(404);
    forgotten.length = 0;
    await m.client.menu.publish({ workspace: m.slug, mutationId: newId() });
    expect(forgotten).toContainEqual([...menuCacheTags(place.id)]);
    tagged.length = 0;
    const read = await send(`/api/public/menu/${place.menuKey}`);
    expect(tagged.flat()).toContain(menuWorkspaceCacheTags(m.workspace.id)[0]);
    expect(read.status).toBe(200);
    expect(read.headers.get('cache-control')).toBe('public, max-age=0, s-maxage=86400');
    expect(tagged.flat()).toContain(`menu:${place.id}`);
    const menu = (await read.json()) as PublicMenu;
    expect(menu.menu.items[itemId]?.name).toBe('Soup');
    expect(menu.place.timeZone).toBe('Europe/London');
    expect(menu.soldOut).toEqual([]);
    // Nothing of the draft or a member: no counts, no member ids. Nor the workspace's id: its cache tag is opaque.
    expect(JSON.stringify(menu)).not.toMatch(/changes|memberId|published_by/);
    expect(JSON.stringify(menu)).not.toContain(m.workspace.id);
    expect(tagged.flat().filter((tag) => tag.startsWith('menu-ws:'))).toEqual([`menu-ws:${menu.cacheId}`]);
  });

  it('purges on Sold out and shows it live; a profile change and removing Menu purge too, and the page goes', async () => {
    const { m, place, itemId } = await menuWorkspace();
    await m.client.menu.publish({ workspace: m.slug, mutationId: newId() });
    forgotten.length = 0;
    await m.client.menu.setSoldOut({ workspace: m.slug, itemId, soldOut: true, mutationId: newId() });
    expect(forgotten).toContainEqual([...menuCacheTags(place.id)]);
    expect(((await (await send(`/api/public/menu/${place.menuKey}`)).json()) as PublicMenu).soldOut).toEqual([itemId]);
    forgotten.length = 0;
    await m.client.hospitality.saveBusiness({
      workspace: m.slug,
      profile: { name: 'Cafe Somewhere', kind: 'cafe' },
      mutationId: newId(),
    });
    expect(forgotten).toContainEqual([...menuCacheTags(place.id)]);
    forgotten.length = 0;
    await m.client.hospitality.remove({ workspace: m.slug, app: 'menu', mutationId: newId() });
    expect(forgotten).toContainEqual([...menuCacheTags(place.id)]);
    // Every answer carries the workspace's own tag too, which a deleted workspace or closed early access forgets.
    expect(tagged.flat()).toContain(menuWorkspaceCacheTags(m.workspace.id)[0]);
    const gone = await send(`/api/public/menu/${place.menuKey}`);
    expect(gone.status).toBe(404);
    expect(gone.headers.get('cache-control')).toBe('no-store');
  });

  it('turns away a key that can’t be one without reading, and a look at a version it doesn’t wear', async () => {
    const { m, place } = await menuWorkspace();
    await m.client.menu.publish({ workspace: m.slug, mutationId: newId() });
    expect((await send('/api/public/menu/short')).status).toBe(404);
    expect((await send(`/api/public/menu/${place.menuKey}/look.css?v=000000000000`)).status).toBe(404);
  });
});

describe('menu photos (AC-6527)', () => {
  /** A JPEG that says it is `width` by `height` (a start of frame after its first marker). */
  const sized = (width: number, height: number) => {
    const plain = jpegWith({ exif: true });
    const sof = new Uint8Array([
      0xff,
      0xc0,
      0,
      11,
      8,
      height >> 8,
      height & 255,
      width >> 8,
      width & 255,
      1,
      1,
      0x11,
      0,
    ]);
    return new Uint8Array([...plain.subarray(0, 2), ...sof, ...plain.subarray(2)]);
  };
  const photoBody = (small: Uint8Array = sized(400, 300)) => {
    const body = new FormData();
    body.set('large', new Blob([sized(1200, 900)], { type: 'image/jpeg' }), 'large.jpg');
    body.set('small', new Blob([new Uint8Array(small)], { type: 'image/jpeg' }), 'small.jpg');
    return body;
  };

  it('refuses a photo wider than the width it was drawn at, or a header that unpacks enormous', async () => {
    const { m, itemId } = await menuWorkspace();
    for (const small of [sized(401, 300), sized(400, 30_000), jpegWith({ exif: true })]) {
      const refused = await send(`/api/menu/items/${itemId}/photo`, {
        method: 'POST',
        cookie: m.cookie,
        workspace: m.slug,
        body: photoBody(small),
      });
      expect(refused.status).toBe(400);
    }
  });

  it('takes both widths from Manage hospitality only, cleaned, and serves only what the live snapshot shows', async () => {
    const { m, place, itemId } = await menuWorkspace();
    // A plain member is refused before any byte is kept.
    const { cookie: memberCookie, email } = await signIn(app);
    const [user] = await testQuery<{ id: string }>(ownerUrl, 'select id from auth."user" where email = $1', [email]);
    await testQuery(
      ownerUrl,
      `insert into members (workspace_id, id, user_id, name, email, role, created_by_type, updated_by_type)
       values ($1, $2, $3, 'Bea', $4, 'member', 'system', 'system')`,
      [m.workspace.id, newId(), user?.id, email],
    );
    expect(rpcClient(app, memberCookie)).toBeDefined();
    const before = kept.size;
    const refused = await send(`/api/menu/items/${itemId}/photo`, {
      method: 'POST',
      cookie: memberCookie,
      workspace: m.slug,
      body: photoBody(),
    });
    expect(refused.status).toBe(403);
    expect(kept.size).toBe(before);

    const uploaded = await send(`/api/menu/items/${itemId}/photo`, {
      method: 'POST',
      cookie: m.cookie,
      workspace: m.slug,
      body: photoBody(),
    });
    expect(uploaded.status).toBe(200);
    const draft = (await uploaded.json()) as MenuDraft;
    const photo = draft.items[0]?.photo;
    expect(photo).toBeDefined();
    expect(kept.size).toBe(before + 2);
    if (photo === undefined) return;
    const path = `/api/public/menu/${place.menuKey}/photos/${photo.id}/small?v=${photo.version}`;
    // Still a draft change: guests can't fetch it until Publish.
    expect((await send(path)).status).toBe(404);
    await m.client.menu.publish({ workspace: m.slug, mutationId: newId() });
    const served = await send(path);
    expect(served.status).toBe(200);
    expect(served.headers.get('content-type')).toBe('image/jpeg');
    // The metadata is gone from what is served.
    const bytes = new Uint8Array(await served.arrayBuffer());
    expect(Buffer.from(bytes).includes(Buffer.from('Exif'))).toBe(false);
    // Taking it off and publishing removes both files from the store.
    await m.client.menu.removePhoto({ workspace: m.slug, itemId, mutationId: newId() });
    await m.client.menu.publish({ workspace: m.slug, mutationId: newId() });
    expect(kept.size).toBe(before);
    expect((await send(path)).status).toBe(404);
  });
});

describe('the editor’s preview look', () => {
  it('serves the guests’ Warm look to a member before any Publish, and nothing to anyone else', async () => {
    const { m } = await menuWorkspace();
    const look = await send(`/api/menu/look.css?workspace=${m.slug}`, { cookie: m.cookie });
    expect(look.status).toBe(200);
    expect(look.headers.get('content-type')).toContain('text/css');
    expect(look.headers.get('cache-control')).toContain('private');
    const css = await look.text();
    // Checklabs' guest look, value for value: the device's face, a white ground, cream chips, near black ink.
    expect(css).toContain('--menu-face:ui-sans-serif, system-ui');
    expect(css).toContain('--menu-ground:#ffffff');
    expect(css).toContain('--menu-chip:#f5f1ea');
    expect(css).toContain('--menu-text:#1a1a1a');
    expect(css).toContain('--menu-scrim:#00000066');
    // Its press feel: the overshoot, how far each part eases down, and every part still under reduced motion.
    expect(css).toContain('--menu-press-ease:cubic-bezier(0.34, 1.56, 0.64, 1)');
    expect(css).toContain('--menu-press-row:0.985');
    expect(css).toContain('--menu-press-add:0.82');
    expect(css).toContain('@media (prefers-reduced-motion: reduce){:root{--menu-press-row:1;');
    expect((await send(`/api/menu/look.css?workspace=${m.slug}`)).status).toBe(401);
    const { cookie: stranger } = await signIn(app);
    expect((await send(`/api/menu/look.css?workspace=${m.slug}`, { cookie: stranger })).status).toBe(404);
  });

  it('refuses a member with neither hospitality power, and everyone once Menu is removed (security review)', async () => {
    const { m } = await menuWorkspace();
    const { cookie: memberCookie, email } = await signIn(app);
    const [user] = await testQuery<{ id: string }>(ownerUrl, 'select id from auth."user" where email = $1', [email]);
    await testQuery(
      ownerUrl,
      `insert into members (workspace_id, id, user_id, name, email, role, created_by_type, updated_by_type)
       values ($1, $2, $3, 'Bea', $4, 'member', 'system', 'system')`,
      [m.workspace.id, newId(), user?.id, email],
    );
    const plain = await send(`/api/menu/look.css?workspace=${m.slug}`, { cookie: memberCookie });
    expect(plain.status).toBe(403);
    expect(await plain.text()).not.toContain('--menu-ground');
    await m.client.hospitality.remove({ workspace: m.slug, app: 'menu', mutationId: newId() });
    const off = await send(`/api/menu/look.css?workspace=${m.slug}`, { cookie: m.cookie });
    expect(off.status).not.toBe(200);
    expect(await off.text()).not.toContain('--menu-ground');
  });
});

describe('Live or Hidden', () => {
  it('hides every guest menu at once, purged at the edge, keeping only the header, then shows it again', async () => {
    const { m, place, itemId } = await menuWorkspace();
    // Nothing live to hide before the first Publish.
    await expect(m.client.menu.setHidden({ workspace: m.slug, hidden: true, mutationId: newId() })).rejects.toThrow();
    await m.client.menu.publish({ workspace: m.slug, mutationId: newId() });
    forgotten.length = 0;
    const draft = await m.client.menu.setHidden({ workspace: m.slug, hidden: true, mutationId: newId() });
    expect(draft.hidden).toBe(true);
    expect(draft.changes).toBe(0);
    expect(forgotten).toContainEqual([...menuCacheTags(place.id)]);
    const read = await send(`/api/public/menu/${place.menuKey}`);
    expect(read.status).toBe(200);
    const hidden = (await read.json()) as PublicMenu;
    expect(hidden.hidden).toBe(true);
    expect(hidden.business.name).toBe('Cafe Nowhere');
    expect(hidden.menu).toEqual({ currency: 'GBP', menus: [], items: {}, groups: {} });
    expect(JSON.stringify(hidden)).not.toContain('Soup');
    expect(JSON.stringify(hidden)).not.toContain(itemId);
    forgotten.length = 0;
    await m.client.menu.setHidden({ workspace: m.slug, hidden: false, mutationId: newId() });
    expect(forgotten).toContainEqual([...menuCacheTags(place.id)]);
    const shown = (await (await send(`/api/public/menu/${place.menuKey}`)).json()) as PublicMenu;
    expect(shown.hidden).toBeUndefined();
    expect(shown.menu.items[itemId]?.name).toBe('Soup');
  });
});

describe('the workspace’s own menu tag (security review)', () => {
  it('is forgotten when the workspace is deleted', async () => {
    const { m } = await menuWorkspace();
    forgotten.length = 0;
    await m.client.workspace.delete({ workspace: m.slug, confirmName: m.workspace.name, mutationId: newId() });
    expect(forgotten).toContainEqual([...menuWorkspaceCacheTags(m.workspace.id)]);
  });
});
