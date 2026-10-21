// The person's own sessions (spec 0033, milestone 1: AC-890 to AC-892, AC-898):
// listed by id with device and place, never a token; one signed out by id,
// only one of their own; every other one signed out after a fresh sign in;
// and each sign in, sign out and ending kept as a security event.
import { ORPCError } from '@orpc/client';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import type { Database, IdentityStore } from '@crm/db';
import { testQuery } from '@crm/db/testing';
import {
  authPost,
  codeFor,
  cookieFrom,
  newEmail,
  newIp,
  rpcClient,
  sendCode,
  signInApp,
  testConnections,
  verifyCode,
} from '../../test/sign-in.ts';

const { identityUrl } = inject('testDatabase');
let db: Database;
let identity: IdentityStore;
let app: ReturnType<typeof signInApp>['app'];
// Every user whose live connections the app asked the worker to cut.
const cut: string[] = [];

beforeAll(() => {
  ({ db, identity } = testConnections());
  ({ app } = signInApp(
    { db, identity },
    {},
    {
      signedOut: (userId) => {
        cut.push(userId);
        return Promise.resolve();
      },
    },
  ));
});
afterAll(async () => {
  await identity.close();
  await db.close();
});

const MAC_CHROME =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';

/** Signs `email` in by code with these headers (a browser, a place), answering the session cookie. */
async function signInAs(email: string, headers: Record<string, string>): Promise<string> {
  const ip = newIp();
  const sent = await sendCode(app, email, ip, headers);
  expect(sent.status).toBe(200);
  const signedIn = await verifyCode(app, email, await codeFor(email), ip, headers);
  expect(signedIn.status).toBe(200);
  return cookieFrom(signedIn);
}

async function failure(call: () => Promise<unknown>): Promise<ORPCError<string, unknown>> {
  try {
    await call();
  } catch (error) {
    if (error instanceof ORPCError) return error;
    throw error;
  }
  throw new Error('The call succeeded.');
}

async function userIdOf(cookie: string): Promise<string> {
  return (await rpcClient(app, cookie).me.get()).user.id;
}

async function eventsOf(userId: string) {
  return testQuery<{ kind: string; device_label: string | null; country: string | null; detail: unknown }>(
    identityUrl,
    'select kind, device_label, country, detail from auth.security_event where user_id = $1 order by at, id',
    [userId],
  );
}

describe('account.sessions', () => {
  it('lists the person’s sessions by id, with device and place, newest activity first, and no token', async () => {
    const email = newEmail();
    const laptop = await signInAs(email, {
      'user-agent': MAC_CHROME,
      'x-vercel-ip-country': 'de',
      'x-vercel-ip-city': 'Berlin',
    });
    const phone = await signInAs(email, {
      'user-agent': IPHONE_SAFARI,
      'x-vercel-ip-country': 'BR',
      'x-vercel-ip-city': 'S%C3%A3o%20Paulo',
    });
    const page = await rpcClient(app, laptop).account.sessions.list();
    expect(page.nextCursor).toBeUndefined();
    expect(page.items).toHaveLength(2);
    const [newest, oldest] = page.items;
    expect(newest).toMatchObject({ deviceLabel: 'Safari on iOS', country: 'BR', city: 'São Paulo', current: false });
    expect(oldest).toMatchObject({ deviceLabel: 'Chrome on macOS', country: 'DE', city: 'Berlin', current: true });
    for (const item of page.items) {
      expect(Object.keys(item).sort()).toEqual(
        ['city', 'country', 'current', 'deviceLabel', 'id', 'lastActiveAt', 'signedInAt'].sort(),
      );
    }
    // Neither cookie's token appears anywhere in the answer.
    const raw = JSON.stringify(page);
    for (const cookie of [laptop, phone]) {
      const token = decodeURIComponent(cookie.split('=')[1] ?? '').split('.')[0] ?? '';
      expect(token.length).toBeGreaterThan(10);
      expect(raw).not.toContain(token);
    }
    // The phone sees itself as this device.
    const fromPhone = await rpcClient(app, phone).account.sessions.list();
    expect(fromPhone.items.find((item) => item.current)?.deviceLabel).toBe('Safari on iOS');
  });

  it('keeps no place a request carried that isn’t a country and a printable city', async () => {
    const email = newEmail();
    const cookie = await signInAs(email, {
      'user-agent': 'curl/8.7.1',
      'x-vercel-ip-country': 'not a country',
      'x-vercel-ip-city': '%3Cscript%3E',
    });
    const [only] = (await rpcClient(app, cookie).account.sessions.list()).items;
    expect(only).toMatchObject({ deviceLabel: '', current: true });
    expect(only?.country).toBeUndefined();
    expect(only?.city).toBe('script');
  });

  it('signs out one of the person’s own sessions by id: its next call is signed out, and its tabs are cut', async () => {
    const email = newEmail();
    const laptop = await signInAs(email, { 'user-agent': MAC_CHROME });
    const phone = await signInAs(email, { 'user-agent': IPHONE_SAFARI });
    const userId = await userIdOf(laptop);
    const target = (await rpcClient(app, laptop).account.sessions.list()).items.find((item) => !item.current);
    expect(target?.deviceLabel).toBe('Safari on iOS');
    cut.length = 0;
    await expect(rpcClient(app, laptop).account.sessions.revoke({ sessionId: target?.id ?? '' })).resolves.toEqual({
      ok: true,
    });
    expect(cut).toEqual([userId]);
    expect(await failure(() => rpcClient(app, phone).me.get())).toMatchObject({ code: 'UNAUTHENTICATED' });
    // The laptop still works, and lists itself alone.
    expect((await rpcClient(app, laptop).account.sessions.list()).items).toHaveLength(1);
    // Again: gone, so NOT_FOUND.
    expect(
      await failure(() => rpcClient(app, laptop).account.sessions.revoke({ sessionId: target?.id ?? '' })),
    ).toMatchObject({ code: 'NOT_FOUND', status: 404 });
    const kinds = (await eventsOf(userId)).map((event) => event.kind);
    expect(kinds).toEqual(['sign_in', 'sign_in', 'session_revoked']);
  });

  it('answers NOT_FOUND for another person’s session, and leaves it signed in', async () => {
    const mine = await signInAs(newEmail(), { 'user-agent': MAC_CHROME });
    const theirs = await signInAs(newEmail(), { 'user-agent': MAC_CHROME });
    const [their] = (await rpcClient(app, theirs).account.sessions.list()).items;
    cut.length = 0;
    expect(
      await failure(() => rpcClient(app, mine).account.sessions.revoke({ sessionId: their?.id ?? '' })),
    ).toMatchObject({ code: 'NOT_FOUND', status: 404 });
    expect(cut).toEqual([]);
    await expect(rpcClient(app, theirs).me.get()).resolves.toBeDefined();
  });

  it('signs out every other session after a fresh sign in, and refuses STEP_UP_REQUIRED after 10 minutes', async () => {
    const email = newEmail();
    const others = [
      await signInAs(email, { 'user-agent': IPHONE_SAFARI }),
      await signInAs(email, { 'user-agent': IPHONE_SAFARI }),
    ];
    const laptop = await signInAs(email, { 'user-agent': MAC_CHROME });
    const userId = await userIdOf(laptop);
    const [current] = (await rpcClient(app, laptop).account.sessions.list()).items.filter((item) => item.current);
    // Signed in 11 minutes ago: not fresh.
    await testQuery(identityUrl, `update auth.session set verified_at = now() - interval '11 minutes' where id = $1`, [
      current?.id,
    ]);
    expect(await failure(() => rpcClient(app, laptop).account.sessions.revokeOthers())).toMatchObject({
      code: 'STEP_UP_REQUIRED',
      status: 403,
    });
    await testQuery(identityUrl, `update auth.session set verified_at = now() - interval '9 minutes' where id = $1`, [
      current?.id,
    ]);
    cut.length = 0;
    await expect(rpcClient(app, laptop).account.sessions.revokeOthers()).resolves.toEqual({ count: 2 });
    expect(cut).toEqual([userId]);
    for (const other of others) {
      expect(await failure(() => rpcClient(app, other).me.get())).toMatchObject({ code: 'UNAUTHENTICATED' });
    }
    const [only] = (await rpcClient(app, laptop).account.sessions.list()).items;
    expect(only?.current).toBe(true);
    const events = await eventsOf(userId);
    expect(events.at(-1)).toMatchObject({ kind: 'sessions_revoked', detail: { count: 2 } });
  });

  it('keeps a sign in with its method, device and place, and a sign out on the device itself', async () => {
    const email = newEmail();
    const cookie = await signInAs(email, { 'user-agent': MAC_CHROME, 'x-vercel-ip-country': 'FR' });
    const userId = await userIdOf(cookie);
    const out = await authPost(app, '/sign-out', {}, { cookie });
    expect(out.status).toBe(200);
    const events = await eventsOf(userId);
    expect(events).toEqual([
      { kind: 'sign_in', device_label: 'Chrome on macOS', country: 'FR', detail: { method: 'email_code' } },
      { kind: 'sign_out', device_label: 'Chrome on macOS', country: 'FR', detail: {} },
    ]);
  });

  it('refuses a cursor that isn’t one of ours, and answers 401 without a session', async () => {
    const cookie = await signInAs(newEmail(), {});
    expect(
      await failure(() => rpcClient(app, cookie).account.sessions.list({ cursor: 'bm90IGEgY3Vyc29y' })),
    ).toMatchObject({
      code: 'INPUT_INVALID',
    });
    expect(await failure(() => rpcClient(app).account.sessions.list())).toMatchObject({ code: 'UNAUTHENTICATED' });
  });
});
