// A link block's own site icon from our own origin (26 Oct 2026): the fetch tries the site's `/favicon.ico` and
// then the icon its head declares, answers only a real image of a type we serve, and never leaves a plain https
// site; the route answers it cacheable and nosniff for a link a page owner saved, and 404 for any other address,
// a stale version, a link that draws a network's mark or a picked icon, and a handle no one holds.
import { randomUUID } from 'node:crypto';
import { createWorkspace, newId, saveProfileItem, updateMyMemberProfile } from '@crm/core';
import { faviconVersion } from '@crm/core/public';
import { testScope } from '@crm/core/testing';
import type { Database, IdentityStore } from '@crm/db';
import { testQuery } from '@crm/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createApp } from '../app.ts';
import { EDGE_HEADER } from '../edge.ts';
import { TEST_EDGE_SECRET, testEnv, testServices } from '../testing.ts';
import { newIp, testConnections } from '../../test/sign-in.ts';
import { createMemoryLimiter } from './limits.ts';
import { imageTypeOf } from '@crm/core/public';
import { createFaviconFetch, FAVICON_CACHE_CONTROL, type FaviconFetch } from './favicon.ts';

const SITE = 'https://ada.dev/notes';
const GUESS = 'https://ada.dev/favicon.ico';
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const ICO = Uint8Array.from([0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 1, 2, 3]);
const GIF = Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 2, 3]);

/** A fake fetch answering from a table of URL to Response, recording what it was asked. */
function fakeFetch(answers: Readonly<Record<string, () => Response>>) {
  const asked: string[] = [];
  const fetch = ((input: string | URL | Request) => {
    const url = input instanceof Request ? input.url : String(input);
    asked.push(url);
    const make = answers[url];
    return Promise.resolve(make === undefined ? new Response('', { status: 404 }) : make());
  }) as typeof globalThis.fetch;
  return { fetch, asked };
}

const body = (bytes: Uint8Array | string, type: string) => () =>
  new Response(bytes, { headers: { 'content-type': type } });
const redirect = (location: string) => () => new Response(null, { status: 302, headers: { location } });

// Every host in these tests resolves to one public address: what a name resolves to is the outside fetch's own
// table test (`outside.test.ts`), and an icon only narrows which addresses it will ask for at all.
const lookup = () => Promise.resolve(['93.184.216.34']);

const iconFetch = (options: { fetch: typeof globalThis.fetch; timeoutMs?: number }) =>
  createFaviconFetch({ ...options, lookup });

describe('imageTypeOf, as an icon narrows it', () => {
  it('reads the type from the bytes, never from what a server claimed', () => {
    expect(imageTypeOf(PNG)).toBe('image/png');
    expect(imageTypeOf(ICO)).toBe('image/x-icon');
    expect(imageTypeOf(GIF)).toBe('image/gif');
    expect(imageTypeOf(Uint8Array.from([0xff, 0xd8, 0xff]))).toBe('image/jpeg');
    expect(imageTypeOf(new TextEncoder().encode('<svg xmlns="..."'))).toBeUndefined();
    expect(imageTypeOf(new TextEncoder().encode('<html>'))).toBeUndefined();
    // An icon file says how many images it holds; none is not an icon.
    expect(imageTypeOf(Uint8Array.from([0x00, 0x00, 0x01, 0x00, 0x00, 0x00]))).toBeUndefined();
  });
});

describe('createFaviconFetch', () => {
  it('takes the site’s own favicon.ico and asks for nothing else', async () => {
    const { fetch, asked } = fakeFetch({ [GUESS]: body(ICO, 'image/x-icon') });
    expect(await iconFetch({ fetch })(SITE)).toMatchObject({ ok: true, type: 'image/x-icon' });
    expect(asked).toEqual([GUESS]);
  });

  it('answers a PNG served as an icon by what its bytes say, which is what browsers do', async () => {
    const { fetch } = fakeFetch({ [GUESS]: body(PNG, 'image/x-icon') });
    expect(await iconFetch({ fetch })(SITE)).toMatchObject({ ok: true, type: 'image/png' });
  });

  it('reads the page’s head when the site has no favicon.ico', async () => {
    const declared = 'https://cdn.ada.dev/icon.png';
    const { fetch, asked } = fakeFetch({
      [GUESS]: () => new Response('', { status: 404 }),
      [SITE]: body(`<head><link rel="icon" href="${declared}"></head>`, 'text/html; charset=utf-8'),
      [declared]: body(PNG, 'image/png'),
    });
    expect(await iconFetch({ fetch })(SITE)).toMatchObject({ ok: true, type: 'image/png' });
    expect(asked).toEqual([GUESS, SITE, declared]);
  });

  it('never fetches anything but a plain https site, first or by a redirect', async () => {
    for (const link of ['http://ada.dev/x', 'https://ada.dev:8443/x', 'https://u:p@ada.dev/x', 'https://localhost/x']) {
      const { fetch, asked } = fakeFetch({});
      expect(await iconFetch({ fetch })(link)).toEqual({ ok: false, reason: 'url' });
      expect(asked, link).toEqual([]);
    }
    const hop = fakeFetch({ [GUESS]: redirect('http://ada.dev/icon.png') });
    expect(await iconFetch({ fetch: hop.fetch })(SITE)).toMatchObject({ ok: false });
  });

  it('answers nothing for a document, a script or an SVG dressed as an icon', async () => {
    for (const [bytes, type] of [
      ['<html>hi</html>', 'image/png'],
      ['<svg xmlns="http://www.w3.org/2000/svg"></svg>', 'image/svg+xml'],
      ['alert(1)', 'application/javascript'],
    ] as const) {
      const { fetch } = fakeFetch({ [GUESS]: body(bytes, type), [SITE]: body('<head></head>', 'text/html') });
      expect(await iconFetch({ fetch })(SITE), type).toEqual({ ok: false, reason: 'type' });
    }
  });

  it('keeps the first miss when the page declares no icon', async () => {
    const { fetch, asked } = fakeFetch({
      [GUESS]: () => new Response('', { status: 500 }),
      [SITE]: body('<head><link rel="stylesheet" href="/a.css"></head>', 'text/html'),
    });
    expect(await iconFetch({ fetch })(SITE)).toEqual({ ok: false, reason: 'status' });
    expect(asked).toEqual([GUESS, SITE]);
  });

  it('gives up at its timeout', async () => {
    const hangs = ((_input: unknown, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new Error('aborted'));
        });
      })) as typeof globalThis.fetch;
    expect(await iconFetch({ fetch: hangs, timeoutMs: 20 })(SITE)).toEqual({ ok: false, reason: 'timeout' });
  });
});

const { ownerUrl } = inject('testDatabase');
let db: Database;
let identity: IdentityStore;
let app: ReturnType<typeof createApp>;
const fetched: string[] = [];

beforeAll(() => {
  ({ db, identity } = testConnections());
  const env = testEnv();
  // Every site answers a small PNG; the test sees which addresses were asked for.
  const faviconFetch: FaviconFetch = (link) => {
    fetched.push(link);
    return Promise.resolve({ ok: true, type: 'image/png', bytes: PNG });
  };
  app = createApp({
    services: { ...testServices(env, { db, identity }), bookingLimiter: createMemoryLimiter(), faviconFetch },
    env,
  });
});
afterAll(async () => {
  await identity.close();
  await db.close();
});

/** A GET as the public page sends it through the edge. */
const visit = (path: string) =>
  app.request(`/api/public/${path}`, {
    headers: { [EDGE_HEADER]: TEST_EDGE_SECRET, 'x-forwarded-for': newIp() },
  });

/** A person with a handle and a link page, and their scope. */
async function owner() {
  const userId = randomUUID();
  await testQuery(ownerUrl, `insert into auth."user" (id, name, email) values ($1, $2, $3)`, [
    userId,
    'Ada Lovelace',
    `${userId}@example.com`,
  ]);
  const created = await createWorkspace(db, {
    name: 'Icons',
    slug: `icons-${newId().slice(-12)}`,
    firstMember: { name: 'Ada Lovelace', email: `${userId}@example.com`, userId },
  });
  const scope = testScope({
    db,
    workspaceId: created.workspaceId,
    actor: { type: 'member', id: created.memberId },
    userId,
  });
  const handle = `ada-${randomUUID().slice(0, 8)}`;
  await updateMyMemberProfile(scope, { handle });
  return { userId, scope, handle };
}

describe('GET /api/public/profiles/:handle/items/:id/icon', () => {
  it('answers a saved link’s icon from our origin, and the page points at it', async () => {
    const { scope, handle } = await owner();
    const saved = await saveProfileItem(scope, {
      id: newId(),
      block: { kind: 'link', title: 'Notes', url: SITE },
    });
    const path = `profiles/${handle}/items/${saved.id}/icon?v=${faviconVersion(saved.id, SITE)}`;

    const page = await visit(`handles/${handle}`);
    expect(await page.json()).toMatchObject({ items: [{ id: saved.id, siteIcon: `/api/public/${path}` }] });

    const icon = await visit(path);
    expect(icon.status).toBe(200);
    expect(icon.headers.get('content-type')).toBe('image/png');
    expect(icon.headers.get('cache-control')).toBe(FAVICON_CACHE_CONTROL);
    expect(icon.headers.get('x-content-type-options')).toBe('nosniff');
    expect(fetched).toContain(SITE);
  });

  it('fetches nothing for a stale version, a made up id, or a handle no one holds', async () => {
    const { scope, handle } = await owner();
    const saved = await saveProfileItem(scope, {
      id: newId(),
      block: { kind: 'link', title: 'Notes', url: SITE },
    });
    const current = `v=${faviconVersion(saved.id, SITE)}`;
    const before = fetched.length;
    const refusals = [
      `profiles/${handle}/items/${saved.id}/icon`,
      `profiles/${handle}/items/${saved.id}/icon?v=000000000000`,
      `profiles/${handle}/items/${saved.id}/icon?${current}&x=1`,
      `profiles/${handle}/items/${randomUUID()}/icon?${current}`,
      `profiles/${handle}/items/not-an-id/icon?${current}`,
      `profiles/nobody-at-all/items/${saved.id}/icon?${current}`,
    ];
    for (const path of refusals) {
      const refused = await visit(path);
      expect(refused.status, path).toBe(404);
      expect(refused.headers.get('cache-control'), path).toBe('no-store');
    }
    expect(fetched.length).toBe(before);
  });

  it('has no icon to fetch for a link that draws a network’s mark or an icon its owner picked', async () => {
    const { scope, handle } = await owner();
    const social = await saveProfileItem(scope, {
      id: newId(),
      block: { kind: 'link', title: 'GitHub', url: 'https://github.com/ada' },
    });
    const picked = await saveProfileItem(scope, {
      id: newId(),
      block: { kind: 'link', title: 'Shop', url: 'https://ada.shop', icon: 'store' },
    });
    const page = await visit(`handles/${handle}`);
    const items: readonly Record<string, unknown>[] = (
      (await page.json()) as { readonly items: readonly Record<string, unknown>[] }
    ).items;
    for (const item of items) expect(item.siteIcon, String(item.title)).toBeUndefined();

    const before = fetched.length;
    for (const id of [social.id, picked.id]) {
      // Whatever version is guessed: these have none, so the route refuses before it reads anything.
      const refused = await visit(`profiles/${handle}/items/${id}/icon?v=${faviconVersion(id, 'https://ada.shop')}`);
      expect(refused.status).toBe(404);
    }
    expect(fetched.length).toBe(before);
  });
});
