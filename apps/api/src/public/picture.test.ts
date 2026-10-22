// A host's account picture from our own origin (23 Oct 2026): the fetch goes only to Google's picture hosts, follows
// no redirect elsewhere, and answers only a real JPEG, PNG, WebP or GIF of at most 1 MB; the routes answer it
// cacheable and nosniff for a personal page and a profile, and 404 for a team page, a picture elsewhere, or none.
import { randomUUID } from 'node:crypto';
import { createBookingPage, createWorkspace, newId, updateMyMemberProfile } from '@crm/core';
import { testScope } from '@crm/core/testing';
import type { Database, IdentityStore } from '@crm/db';
import { testQuery } from '@crm/db/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createApp } from '../app.ts';
import { EDGE_HEADER } from '../edge.ts';
import { TEST_EDGE_SECRET, testEnv, testServices } from '../testing.ts';
import { newIp, testConnections } from '../../test/sign-in.ts';
import { createMemoryLimiter } from './limits.ts';
import { createPictureFetch, PICTURE_CACHE_CONTROL, type FetchedPicture, type PictureFetch } from './picture.ts';

const GOOGLE = 'https://lh3.googleusercontent.com/a/ACg8ocK_abc-123=s96-c';
const SIZED = 'https://lh3.googleusercontent.com/a/ACg8ocK_abc-123=s256-c';
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

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

const image =
  (bytes: Uint8Array, type: string, headers: Record<string, string> = {}) =>
  () =>
    new Response(bytes, { headers: { 'content-type': type, ...headers } });
const redirect = (location: string) => () => new Response(null, { status: 302, headers: { location } });

describe('createPictureFetch', () => {
  it('fetches a picture on Google’s hosts, following a redirect between them', async () => {
    const other = 'https://lh4.googleusercontent.com/a/elsewhere=s256-c';
    const { fetch, asked } = fakeFetch({
      [SIZED]: redirect(other),
      [other]: image(JPEG, 'image/jpeg; charset=binary'),
    });
    const fetched = await createPictureFetch({ fetch })(new URL(SIZED));
    expect(fetched).toMatchObject({ ok: true, type: 'image/jpeg' });
    expect(asked).toEqual([SIZED, other]);
  });

  it('never leaves Google’s picture hosts: not first, not by a redirect', async () => {
    const { fetch, asked } = fakeFetch({ [SIZED]: redirect('https://evil.example/x.png') });
    expect(await createPictureFetch({ fetch })(new URL('https://evil.example/x.png'))).toEqual({
      ok: false,
      reason: 'redirect',
    });
    expect(asked).toEqual([]);
    expect(await createPictureFetch({ fetch })(new URL(SIZED))).toEqual({ ok: false, reason: 'redirect' });
    expect(asked).toEqual([SIZED]);
  });

  it('gives up after two redirects', async () => {
    const a = 'https://lh3.googleusercontent.com/a/one';
    const b = 'https://lh3.googleusercontent.com/a/two';
    const { fetch } = fakeFetch({ [SIZED]: redirect(a), [a]: redirect(b), [b]: redirect(SIZED) });
    expect(await createPictureFetch({ fetch })(new URL(SIZED))).toEqual({ ok: false, reason: 'redirect' });
  });

  it('answers only an image whose first bytes match its type', async () => {
    const cases: readonly [() => Response, FetchedPicture][] = [
      [image(PNG, 'image/png'), { ok: true, type: 'image/png', bytes: PNG }],
      [image(PNG, 'image/svg+xml'), { ok: false, reason: 'type' }],
      [image(PNG, 'text/html'), { ok: false, reason: 'type' }],
      [image(new TextEncoder().encode('<html>hi</html>'), 'image/png'), { ok: false, reason: 'type' }],
      [image(JPEG, 'image/png'), { ok: false, reason: 'type' }],
      [() => new Response('', { status: 500 }), { ok: false, reason: 'status' }],
    ];
    for (const [answer, expected] of cases) {
      const { fetch } = fakeFetch({ [SIZED]: answer });
      const fetched = await createPictureFetch({ fetch })(new URL(SIZED));
      expect(fetched.ok ? { ...fetched, bytes: Uint8Array.from(fetched.bytes) } : fetched).toEqual(expected);
    }
  });

  it('reads at most the size cap, by its length or as it streams', async () => {
    const big = new Uint8Array(64).fill(1);
    big.set(PNG);
    const declared = fakeFetch({ [SIZED]: image(big, 'image/png', { 'content-length': '64' }) });
    expect(await createPictureFetch({ fetch: declared.fetch, maxBytes: 32 })(new URL(SIZED))).toEqual({
      ok: false,
      reason: 'size',
    });
    const streamed = fakeFetch({
      [SIZED]: () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(big.slice(0, 24));
              controller.enqueue(big.slice(24));
              controller.close();
            },
          }),
          { headers: { 'content-type': 'image/png' } },
        ),
    });
    expect(await createPictureFetch({ fetch: streamed.fetch, maxBytes: 32 })(new URL(SIZED))).toEqual({
      ok: false,
      reason: 'size',
    });
  });

  it('gives up at its timeout, and a failed network is no picture', async () => {
    const hangs = ((_input: unknown, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new Error('aborted'));
        });
      })) as typeof globalThis.fetch;
    expect(await createPictureFetch({ fetch: hangs, timeoutMs: 20 })(new URL(SIZED))).toEqual({
      ok: false,
      reason: 'timeout',
    });
    const fails = (() => Promise.reject(new TypeError('fetch failed'))) as typeof globalThis.fetch;
    expect(await createPictureFetch({ fetch: fails })(new URL(SIZED))).toEqual({ ok: false, reason: 'network' });
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
  // Google answers every picture as a small PNG; the test sees which URLs were asked for.
  const pictureFetch: PictureFetch = (url) => {
    fetched.push(url.href);
    return Promise.resolve({ ok: true, type: 'image/png', bytes: PNG });
  };
  app = createApp({
    services: { ...testServices(env, { db, identity }), bookingLimiter: createMemoryLimiter(), pictureFetch },
    env,
  });
});
afterAll(async () => {
  await identity.close();
  await db.close();
});

/** A GET as the public page sends it through the edge. */
const visit = (path: string) =>
  app.request(`/api/public/${path}`, { headers: { [EDGE_HEADER]: TEST_EDGE_SECRET, 'x-forwarded-for': newIp() } });

/** A person with this account picture (or none), their workspace, and a personal page of theirs. */
async function host(image: string | null) {
  const userId = randomUUID();
  await testQuery(ownerUrl, `insert into auth."user" (id, name, email, image) values ($1, $2, $3, $4)`, [
    userId,
    'Ada Lovelace',
    `${userId}@example.com`,
    image,
  ]);
  const created = await createWorkspace(db, {
    name: 'Pictures',
    slug: `pictures-${newId().slice(-12)}`,
    firstMember: { name: 'Ada Lovelace', email: `${userId}@example.com`, userId },
  });
  const scope = testScope({
    db,
    workspaceId: created.workspaceId,
    actor: { type: 'member', id: created.memberId },
    userId,
  });
  const page = await createBookingPage(scope, { id: newId(), title: 'Intro call', timeZone: 'UTC' });
  return { ...created, scope, page };
}

describe('GET /api/public/booking/:publicKey/picture', () => {
  it('answers the owner’s Google picture from our origin, cacheable and nosniff, and the facts point at it', async () => {
    const { page } = await host(GOOGLE);
    const facts = await visit(`booking/${page.publicKey}`);
    const body = await facts.text();
    expect(JSON.parse(body)).toMatchObject({ hostImage: `/api/public/booking/${page.publicKey}/picture` });
    expect(body).not.toContain('googleusercontent');

    const picture = await visit(`booking/${page.publicKey}/picture`);
    expect(picture.status).toBe(200);
    expect(picture.headers.get('content-type')).toBe('image/png');
    expect(picture.headers.get('cache-control')).toBe(PICTURE_CACHE_CONTROL);
    expect(picture.headers.get('x-content-type-options')).toBe('nosniff');
    expect(picture.headers.get('cross-origin-resource-policy')).toBe('same-origin');
    expect(new Uint8Array(await picture.arrayBuffer())).toEqual(PNG);
    expect(fetched.at(-1)).toBe(SIZED);
  });

  it('answers 404 without fetching for a picture elsewhere, or none', async () => {
    for (const image of ['https://evil.example/me.png', 'https://169.254.169.254/latest', null]) {
      const { page } = await host(image);
      const before = fetched.length;
      const facts = (await (await visit(`booking/${page.publicKey}`)).json()) as Record<string, unknown>;
      expect(facts.hostImage, String(image)).toBeUndefined();
      const picture = await visit(`booking/${page.publicKey}/picture`);
      expect(picture.status, String(image)).toBe(404);
      expect(picture.headers.get('cache-control')).toBe('no-store');
      expect(fetched.length).toBe(before);
    }
  });

  it('answers 404 for a team page, which names no member (AC-754), and for an unknown key', async () => {
    const { page, workspaceId, memberId } = await host(GOOGLE);
    await db.withWorkspace(workspaceId, async (tx) => {
      await tx.execute(sql`update booking_pages set kind = 'collective' where id = ${page.id}::uuid`);
      await tx.execute(sql`delete from booking_page_members where page_id = ${page.id}::uuid`);
      await tx.execute(
        sql`insert into booking_page_members (workspace_id, page_id, member_id, position) values (${workspaceId}, ${page.id}, ${memberId}, 0)`,
      );
    });
    const before = fetched.length;
    const facts = (await (await visit(`booking/${page.publicKey}`)).json()) as Record<string, unknown>;
    expect(facts.team).toBeDefined();
    expect(facts.hostImage).toBeUndefined();
    expect((await visit(`booking/${page.publicKey}/picture`)).status).toBe(404);
    expect((await visit('booking/AAAAAAAAAAAAAAAA/picture')).status).toBe(404);
    expect(fetched.length).toBe(before);
  });
});

describe('GET /api/public/profiles/:handle/picture', () => {
  it('answers the profile’s picture, and the profile points at it; an unknown handle is 404', async () => {
    const { scope } = await host(GOOGLE);
    const handle = `ada-${randomUUID().slice(0, 8)}`;
    await updateMyMemberProfile(scope, { handle });
    const profile = await visit(`handles/${handle}`);
    const body = await profile.text();
    expect(JSON.parse(body)).toMatchObject({ image: `/api/public/profiles/${handle}/picture` });
    expect(body).not.toContain('googleusercontent');
    const picture = await visit(`profiles/${handle}/picture`);
    expect(picture.status).toBe(200);
    expect(picture.headers.get('cache-control')).toBe(PICTURE_CACHE_CONTROL);
    expect(fetched.at(-1)).toBe(SIZED);
    expect((await visit(`profiles/nobody-${randomUUID().slice(0, 8)}/picture`)).status).toBe(404);
  });
});
