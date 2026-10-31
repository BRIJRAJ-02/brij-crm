// Link page blocks and reach through the real app (spec 0061) and the real Postgres, with a file store in memory: a
// picture uploaded, served from our origin only while a live block of that page uses it and never by another handle
// (AC-6101, AC-6129); a view's facts counted from what the page sent (AC-6116); the Insights CSV (AC-6120); and the
// sitemap and robots (AC-6123).
import { newId } from '@crm/core';
import type { Database, IdentityStore } from '@crm/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app.ts';
import { EDGE_HEADER, ORIGIN_HEADER } from './edge.ts';
import { APP_URL, TEST_EDGE_SECRET, testEnv, testServices } from './testing.ts';
import { createMailpitMailer } from './mail/mailpit.ts';
import { MAILPIT_URL, newIp, testConnections } from '../test/sign-in.ts';
import { memberWithWorkspace } from '../test/workspace.ts';
import type { FileStore } from './storage/blob.ts';

let db: Database;
let identity: IdentityStore;
let app: ReturnType<typeof createApp>;
const pending: Promise<unknown>[] = [];
const kept = new Map<string, { bytes: Uint8Array; type: string }>();

/** A store in memory. */
const files: FileStore = {
  put(path, body, contentType) {
    if (kept.has(path)) return Promise.reject(new Error('exists'));
    kept.set(path, { bytes: body, type: contentType });
    return Promise.resolve();
  },
  get(path) {
    const found = kept.get(path);
    return Promise.resolve(
      found === undefined
        ? undefined
        : { stream: new Blob([found.bytes]).stream(), size: found.bytes.byteLength, contentType: found.type },
    );
  },
  copy: () => Promise.reject(new Error('unused')),
  remove(paths) {
    for (const path of paths) kept.delete(path);
    return Promise.resolve();
  },
};

beforeAll(() => {
  ({ db, identity } = testConnections());
  const env = testEnv();
  app = createApp({
    services: {
      ...testServices(env, {
        db,
        identity,
        files,
        mailer: createMailpitMailer({ url: MAILPIT_URL, from: env.MAIL_FROM }),
      }),
      keepAlive: (work: Promise<unknown>) => {
        pending.push(work);
      },
    },
    env,
  });
});
afterAll(async () => {
  await identity.close();
  await db.close();
});

/** Every background count so far, finished. */
const settled = async () => {
  await Promise.all(pending.splice(0));
};

/** A PNG of 4 by 3 with a text chunk carrying a place: the walk keeps the picture and drops the words. */
function png(): Uint8Array {
  const chunk = (type: string, data: readonly number[]) => [
    ...[0, 0, 0, data.length],
    ...Buffer.from(type, 'latin1'),
    ...data,
    0,
    0,
    0,
    0,
  ];
  return Uint8Array.from([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    ...chunk('IHDR', [0, 0, 0, 4, 0, 0, 0, 3, 8, 6, 0, 0, 0]),
    ...chunk('tEXt', [...Buffer.from('Comment\0GPS 51.5 N', 'latin1')]),
    ...chunk('IDAT', [1, 2, 3]),
    ...chunk('IEND', []),
  ]);
}

/** A request through the edge, from a browser on our own page. */
function edge(
  path: string,
  init: { method?: string; body?: string | Uint8Array; headers?: Record<string, string> } = {},
) {
  return app.request(path, {
    method: init.method ?? 'GET',
    headers: {
      [EDGE_HEADER]: TEST_EDGE_SECRET,
      [ORIGIN_HEADER]: APP_URL,
      origin: APP_URL,
      'x-forwarded-for': newIp(),
      'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
      'sec-fetch-site': 'same-origin',
      ...init.headers,
    },
    ...(init.body === undefined ? {} : { body: init.body }),
  });
}

async function owner() {
  const m = await memberWithWorkspace(app);
  const handle = `reach-${newId().slice(-8)}`;
  await m.client.profile.update({ workspace: m.slug, handle, mutationId: newId() });
  return { ...m, handle };
}

describe('a link page’s pictures (AC-6101, AC-6129)', () => {
  it('keeps an upload without its metadata, and serves it only while a live block of that page uses it', async () => {
    const ada = await owner();
    const bob = await owner();
    const upload = await edge('/api/profile/images', {
      method: 'POST',
      body: png(),
      headers: { cookie: ada.cookie, 'content-type': 'image/png', 'x-crm-workspace': ada.slug },
    });
    expect(upload.status).toBe(200);
    const { image, width, height } = (await upload.json()) as { image: string; width: number; height: number };
    expect([width, height]).toEqual([4, 3]);
    const [stored] = [...kept.values()].filter((each) => each.type === 'image/png');
    expect(Buffer.from(stored?.bytes ?? []).toString('latin1')).not.toContain('GPS');
    const path = `/api/public/profiles/${ada.handle}/images/${image}`;
    // Kept, but no block uses it yet: nobody is served it.
    expect((await edge(path)).status).toBe(404);
    const block = await ada.client.profile.saveItem({
      workspace: ada.slug,
      id: newId(),
      block: { kind: 'image', image, alt: 'A view' },
      mutationId: newId(),
    });
    const served = await edge(path);
    expect(served.status).toBe(200);
    expect(served.headers.get('content-type')).toBe('image/png');
    expect(served.headers.get('cache-control')).toBe('public, max-age=3600, s-maxage=86400');
    expect(served.headers.get('set-cookie')).toBeNull();
    // Ada's picture through Bob's handle, or with a query on it, is no picture.
    expect((await edge(`/api/public/profiles/${bob.handle}/images/${image}`)).status).toBe(404);
    expect((await edge(`${path}?v=2`)).status).toBe(404);
    // Bob can't place Ada's picture on his own page.
    await expect(
      bob.client.profile.saveItem({
        workspace: bob.slug,
        id: newId(),
        block: { kind: 'image', image, alt: 'Not mine' },
        mutationId: newId(),
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await ada.client.profile.archiveItem({ workspace: ada.slug, id: block.id, archived: true, mutationId: newId() });
    expect((await edge(path)).status).toBe(404);
  });

  it('refuses an SVG upload, whatever it is called', async () => {
    const ada = await owner();
    const svg = await edge('/api/profile/images', {
      method: 'POST',
      body: '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
      headers: { cookie: ada.cookie, 'content-type': 'image/png', 'x-crm-workspace': ada.slug },
    });
    expect(svg.status).toBe(400);
  });
});

describe('a view’s facts (AC-6116)', () => {
  it('counts the referring host, the source, the country and the device, and nothing raw', async () => {
    const ada = await owner();
    const read = await edge(
      `/api/public/handles/${ada.handle}?ref=${encodeURIComponent('https://www.instagram.com/ada/')}&src=IG_Bio`,
      { headers: { 'x-vercel-ip-country': 'GB' } },
    );
    expect(read.status).toBe(200);
    expect(read.headers.get('set-cookie')).toBeNull();
    await edge(
      `/api/public/handles/${ada.handle}?ref=${encodeURIComponent('<script>')}&src=${encodeURIComponent('=cmd()')}`,
    );
    await settled();
    const counts = await ada.client.profile.counts({ workspace: ada.slug, days: 7 });
    expect(counts.views).toBe(2);
    expect(counts.facts?.referrer).toEqual(
      expect.arrayContaining([
        { value: 'instagram.com', views: 1, visitors: 1 },
        { value: 'Direct', views: 1, visitors: 1 },
      ]),
    );
    expect(counts.facts?.source).toEqual([{ value: 'ig_bio', views: 1, visitors: 1 }]);
    // Two addresses are two visitors (the day's HMAC), each counted once for the device they share.
    expect(counts.facts?.device).toEqual([{ value: 'mobile', views: 2, visitors: 2 }]);
  });
});

describe('the Insights CSV (AC-6120)', () => {
  it('downloads one file named for the page, and refuses more than 365 days', async () => {
    const ada = await owner();
    const today = new Date().toISOString().slice(0, 10);
    const csv = await edge(`/api/profile/insights.csv?workspace=${ada.slug}&from=${today}&to=${today}`, {
      headers: { cookie: ada.cookie },
    });
    expect(csv.status).toBe(200);
    expect(csv.headers.get('content-disposition')).toBe(
      `attachment; filename="${ada.handle}-insights-${today}-${today}.csv"`,
    );
    expect(await csv.text()).toContain('day,metric,key,count');
    const long = await edge(`/api/profile/insights.csv?workspace=${ada.slug}&from=2025-01-01&to=2026-01-01`, {
      headers: { cookie: ada.cookie },
    });
    expect(long.status).toBeGreaterThanOrEqual(400);
  });
});

describe('the crawl files (AC-6123)', () => {
  it('lists a public page with a live block, and robots names the sitemap', async () => {
    const ada = await owner();
    await ada.client.profile.saveItem({
      workspace: ada.slug,
      id: newId(),
      block: { kind: 'link', title: 'Site', url: 'ada.example.com' },
      mutationId: newId(),
    });
    const sitemap = await edge('/api/public/sitemap-handles.xml');
    expect(sitemap.headers.get('cache-control')).toBe('public, max-age=3600, s-maxage=3600');
    expect(await sitemap.text()).toContain(`/${ada.handle}</loc>`);
    const robots = await (await edge('/api/public/robots.txt')).text();
    expect(robots).toContain('/sitemap-handles.xml');
  });
});
