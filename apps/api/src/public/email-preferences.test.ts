// An email's preferences link through the real app (the emails lane): its
// signed token, in the page's header, reads and changes the member's own
// choices; the one click unsubscribe works with its own token in its query
// and no Origin (a mail service's POST), or in the header from the page that
// asks first, and opened in a browser it goes to that page; neither token
// opens the other's endpoints; the page's own writes still need the app's
// origin, and a token that is forged, expired or names a removed member
// opens nothing. The page is rate limited per client address; the one click
// per member and topic, with only a token that opens nothing counted
// against the address.
import { createWorkspace, emailLinkToken, newId, type EmailLink } from '@crm/core';
import type { Database, IdentityStore } from '@crm/db';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.ts';
import { EDGE_HEADER, ORIGIN_HEADER } from '../edge.ts';
import { emailLinkKey } from '../email-link.ts';
import { APP_URL, TEST_EDGE_SECRET, testEnv, testServices } from '../testing.ts';
import { newIp, testConnections } from '../../test/sign-in.ts';
import { EMAIL_LINK_HEADER } from './email-preferences.ts';
import { createMemoryLimiter } from './limits.ts';

let db: Database;
let identity: IdentityStore;
let app: ReturnType<typeof createApp>;
const env = testEnv();
const KEY = emailLinkKey(env);

beforeAll(() => {
  ({ db, identity } = testConnections());
  app = createApp({
    services: { ...testServices(env, { db, identity }), emailPreferenceLimiter: createMemoryLimiter() },
    env,
  });
});
afterAll(async () => {
  await identity.close();
  await db.close();
});

/**
 * A request as the preferences page sends it through the edge, its token in
 * the header; or as a mail service does (`origin: null`, the token in `path`).
 */
function call(
  path: string,
  init: {
    method?: string;
    body?: unknown;
    ip?: string;
    origin?: string | null;
    type?: string;
    token?: string;
  } = {},
) {
  const headers: Record<string, string> = {
    [EDGE_HEADER]: TEST_EDGE_SECRET,
    'x-forwarded-for': init.ip ?? newIp(),
    'content-type': init.type ?? 'application/json',
  };
  if (init.origin !== null) {
    headers[ORIGIN_HEADER] = init.origin ?? APP_URL;
    headers.origin = init.origin ?? APP_URL;
  }
  if (init.token !== undefined) headers[EMAIL_LINK_HEADER] = init.token;
  return app.request(`/api/public/email-preferences${path}`, {
    method: init.method ?? 'GET',
    headers,
    ...(init.body === undefined ? {} : { body: typeof init.body === 'string' ? init.body : JSON.stringify(init.body) }),
  });
}

/** The one click, as a mail service posts it. */
function unsubscribe(token: string, ip?: string) {
  return call(`/unsubscribe?t=${encodeURIComponent(token)}`, {
    method: 'POST',
    origin: null,
    type: 'application/x-www-form-urlencoded',
    body: 'List-Unsubscribe=One-Click',
    ...(ip === undefined ? {} : { ip }),
  });
}

async function member() {
  const created = await createWorkspace(db, {
    name: 'Acme',
    slug: `prefs-${newId().slice(-12)}`,
    firstMember: { name: 'Ada', email: 'ada@example.com' },
  });
  // Bea, a member the owner can remove: the link is hers.
  const bea = newId();
  await db.withWorkspace(created.workspaceId, (tx) =>
    tx.execute(sql`
      insert into members (workspace_id, id, name, email, role, created_by_type, updated_by_type)
      values (${created.workspaceId}, ${bea}, 'Bea', 'bea@example.com', 'member', 'system', 'system')
    `),
  );
  const link: EmailLink = { workspaceId: created.workspaceId, memberId: bea, topic: 'mentions' };
  return {
    ...created,
    bea,
    link,
    token: emailLinkToken(KEY, link, new Date(), 'page'),
    oneClick: emailLinkToken(KEY, link, new Date(), 'unsubscribe'),
  };
}

const ON = [
  { topic: 'form_submissions', subscribed: true },
  { topic: 'mentions', subscribed: true },
];

describe('the email preferences page’s endpoints', () => {
  it('reads every topic on, then turns one off and on again, answering the whole page each time', async () => {
    const m = await member();
    const read = await call('', { token: m.token });
    expect(read.status).toBe(200);
    expect(read.headers.get('cache-control')).toBe('private, no-store');
    expect(await read.json()).toEqual({ workspaceName: 'Acme', topic: 'mentions', preferences: ON });
    const off = await call('', {
      token: m.token,
      method: 'POST',
      body: { topic: 'form_submissions', subscribed: false },
    });
    expect(await off.json()).toEqual({
      workspaceName: 'Acme',
      topic: 'mentions',
      preferences: [
        { topic: 'form_submissions', subscribed: false },
        { topic: 'mentions', subscribed: true },
      ],
    });
    const on = await call('', {
      token: m.token,
      method: 'POST',
      body: { topic: 'form_submissions', subscribed: true },
    });
    expect(await on.json()).toMatchObject({ preferences: ON });
  });

  it('opens the page only with the token in its header, never in the address', async () => {
    const m = await member();
    expect((await call(`?t=${m.token}`)).status).toBe(404);
  });

  it('takes the one click unsubscribe with no Origin, turning the link’s own topic off', async () => {
    const m = await member();
    const clicked = await unsubscribe(m.oneClick);
    expect(clicked.status).toBe(200);
    expect(await clicked.json()).toEqual({ unsubscribed: true, workspaceName: 'Acme', topic: 'mentions' });
    const page = (await (await call('', { token: m.token })).json()) as { preferences: unknown };
    expect(page.preferences).toEqual([
      { topic: 'form_submissions', subscribed: true },
      { topic: 'mentions', subscribed: false },
    ]);
    // The page's own write still needs the app's origin.
    const foreign = await call('', {
      token: m.token,
      method: 'POST',
      origin: 'https://evil.example',
      body: { topic: 'mentions', subscribed: true },
    });
    expect(foreign.status).toBe(403);
  });

  it('sends the unsubscribe address opened in a browser to the page that asks first, changing nothing', async () => {
    const m = await member();
    const opened = await call(`/unsubscribe?t=${encodeURIComponent(m.oneClick)}`);
    expect(opened.status).toBe(303);
    expect(opened.headers.get('location')).toBe(`/email-preferences#u=${encodeURIComponent(m.oneClick)}`);
    const page = (await (await call('', { token: m.token })).json()) as { preferences: unknown };
    expect(page.preferences).toEqual(ON);
    expect((await call('/unsubscribe')).headers.get('location')).toBe('/email-preferences');
    // That page posts the token in the header, with the app's origin.
    const asked = await call('/unsubscribe', { method: 'POST', token: m.oneClick });
    expect(await asked.json()).toEqual({ unsubscribed: true, workspaceName: 'Acme', topic: 'mentions' });
  });

  it('opens neither endpoint with the other’s token', async () => {
    const m = await member();
    // The one click's token sits in request logs: it never reads or changes the page.
    expect((await call('', { token: m.oneClick })).status).toBe(404);
    expect(
      (await call('', { token: m.oneClick, method: 'POST', body: { topic: 'mentions', subscribed: true } })).status,
    ).toBe(404);
    expect((await unsubscribe(m.token)).status).toBe(404);
  });

  it('opens nothing for a forged, tampered or removed member’s link, and refuses a change it doesn’t know', async () => {
    const m = await member();
    const forged = emailLinkToken(Buffer.alloc(32, 1), m.link, new Date());
    for (const token of [forged, `${m.token}x`, '', 'ep1.e30.x']) {
      const answer = await call('', { token });
      expect(answer.status, token).toBe(404);
      expect(await answer.json()).toEqual({
        code: 'NOT_FOUND',
        message: 'This link doesn’t open email preferences any more.',
      });
      expect((await unsubscribe(token)).status, token).toBe(404);
    }
    expect((await unsubscribe(emailLinkToken(Buffer.alloc(32, 1), m.link, new Date(), 'unsubscribe'))).status).toBe(
      404,
    );
    const bad = await call('', { token: m.token, method: 'POST', body: { topic: 'everything', subscribed: false } });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { code: string }).code).toBe('INPUT_INVALID');
    await db.withWorkspace(m.workspaceId, (tx) =>
      tx.execute(sql`update members set status = 'removed' where id = ${m.bea}::uuid`),
    );
    expect((await call('', { token: m.token })).status).toBe(404);
    expect((await unsubscribe(m.oneClick)).status).toBe(404);
  });

  it('answers the page 429 past 30 calls a minute from one address', async () => {
    const m = await member();
    const ip = newIp();
    for (let made = 0; made < 30; made += 1) expect((await call('', { token: m.token, ip })).status).toBe(200);
    const limited = await call('', { token: m.token, ip });
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toMatch(/^\d+$/);
  });

  it('limits the one click per member and topic, and only a token that opens nothing per address', async () => {
    const m = await member();
    // A mail service posts everyone's unsubscribes from one address: another topic's still goes through.
    const service = newIp();
    for (let made = 0; made < 5; made += 1) expect((await unsubscribe(m.oneClick, service)).status).toBe(200);
    expect((await unsubscribe(m.oneClick, service)).status).toBe(429);
    const other = emailLinkToken(KEY, { ...m.link, topic: 'form_submissions' }, new Date(), 'unsubscribe');
    expect((await unsubscribe(other, service)).status).toBe(200);
    // Walking tokens from one address: refused past 30, while a good link from it still works.
    const walker = newIp();
    for (let made = 0; made < 30; made += 1) expect((await unsubscribe(`ep1.${made}.x`, walker)).status).toBe(404);
    expect((await unsubscribe('ep1.30.x', walker)).status).toBe(429);
    const fresh = await member();
    expect((await unsubscribe(fresh.oneClick, walker)).status).toBe(200);
  });
});
