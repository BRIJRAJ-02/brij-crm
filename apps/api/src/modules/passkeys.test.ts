// Passkeys (spec 0033, milestone 3: AC-887 to AC-889, AC-896): adding one
// after a recent check, signing in with it alone (a session that counts as
// two factor), a passkey that skipped the PIN refused, a step up by passkey
// that makes no new session, renaming, and removing only after a recent
// check. A software authenticator answers like a browser's would.
import { ORPCError } from '@orpc/client';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import type { Database, IdentityStore } from '@crm/db';
import { testQuery } from '@crm/db/testing';
import { EDGE_HEADER, ORIGIN_HEADER } from '../edge.ts';
import { APP_URL, TEST_EDGE_SECRET } from '../testing.ts';
import { createTestAuthenticator, type TestAuthenticator } from '../../test/authenticator.ts';
import {
  authPost,
  cookieFrom,
  newIp,
  rpcClient,
  signIn,
  signInApp,
  testConnections,
  withCookies,
} from '../../test/sign-in.ts';

const { identityUrl } = inject('testDatabase');
const RP_ID = new URL(APP_URL).hostname;
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

async function failure(call: () => Promise<unknown>): Promise<ORPCError<string, unknown>> {
  try {
    await call();
  } catch (error) {
    if (error instanceof ORPCError) return error;
    throw error;
  }
  throw new Error('The call succeeded.');
}

/** A GET to one of sign in's routes, as the browser would send it. */
async function authGet(path: string, cookie = '', ip = newIp()): Promise<Response> {
  return app.fetch(
    new Request(`${APP_URL}/api/auth${path}`, {
      headers: {
        origin: APP_URL,
        [EDGE_HEADER]: TEST_EDGE_SECRET,
        [ORIGIN_HEADER]: APP_URL,
        'x-forwarded-for': ip,
        ...(cookie === '' ? {} : { cookie }),
      },
    }),
  );
}

/** Adds a passkey to the account `cookie` signs in, named `name`. Answers the add's response. */
async function addPasskey(cookie: string, device: TestAuthenticator, name?: string): Promise<Response> {
  const options = await authGet('/passkey/generate-register-options', cookie);
  if (options.status !== 200) return options;
  const challenge = ((await options.json()) as { challenge: string }).challenge;
  return authPost(
    app,
    '/passkey/verify-registration',
    { response: device.register({ challenge }), ...(name === undefined ? {} : { name }) },
    { cookie: withCookies(cookie, cookieFrom(options)) },
  );
}

/** Signs in with a passkey alone, from no session. */
async function passkeySignIn(device: TestAuthenticator, how?: { verified?: boolean }): Promise<Response> {
  const options = await authGet('/passkey/generate-authenticate-options');
  expect(options.status).toBe(200);
  const challenge = ((await options.json()) as { challenge: string }).challenge;
  return authPost(
    app,
    '/passkey/verify-authentication',
    { response: device.assert({ challenge }, how) },
    { cookie: cookieFrom(options) },
  );
}

/** Makes every session of `email` last checked 11 minutes ago: no longer fresh. */
async function ageSessions(email: string): Promise<void> {
  await testQuery(
    identityUrl,
    `update auth.session set verified_at = now() - interval '11 minutes'
      where user_id = (select id from auth."user" where email = $1)`,
    [email],
  );
}

async function kindsOf(email: string): Promise<string[]> {
  const rows = await testQuery<{ kind: string }>(
    identityUrl,
    `select e.kind from auth.security_event e join auth."user" u on u.id = e.user_id where u.email = $1 order by e.at, e.id`,
    [email],
  );
  return rows.map((row) => row.kind);
}

describe('passkeys (spec 0033, milestone 3)', () => {
  it('adds a named passkey after a fresh sign in, and lists it without its key', async () => {
    const { email, cookie } = await signIn(app);
    const device = createTestAuthenticator(RP_ID, APP_URL);
    const added = await addPasskey(cookie, device, 'MacBook');
    expect(added.status).toBe(200);
    const security = await rpcClient(app, cookie).account.security.get();
    expect(security.passkeys).toEqual([
      { id: expect.any(String) as string, name: 'MacBook', createdAt: expect.any(String) as string },
    ]);
    expect(JSON.stringify(security)).not.toContain(device.credentialId);
    expect(await kindsOf(email)).toContain('passkey_added');
  });

  it('refuses adding a passkey on a session not checked in the last 10 minutes', async () => {
    const { email, cookie } = await signIn(app);
    await ageSessions(email);
    const refused = await addPasskey(cookie, createTestAuthenticator(RP_ID, APP_URL));
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ code: 'STEP_UP_REQUIRED' });
  });

  it('refuses a body that asks for a new session or names a passkey too long', async () => {
    const { cookie } = await signIn(app);
    const options = await authGet('/passkey/generate-register-options', cookie);
    const challenge = ((await options.json()) as { challenge: string }).challenge;
    const device = createTestAuthenticator(RP_ID, APP_URL);
    const jar = withCookies(cookie, cookieFrom(options));
    for (const extra of [{ createSession: true }, { name: 'x'.repeat(61) }]) {
      const refused = await authPost(
        app,
        '/passkey/verify-registration',
        { response: device.register({ challenge }), ...extra },
        { cookie: jar },
      );
      expect(refused.status).toBe(400);
    }
  });

  it('signs in with a passkey alone: a session that counts as two factor, and its use noted', async () => {
    const { email, cookie } = await signIn(app);
    const device = createTestAuthenticator(RP_ID, APP_URL);
    expect((await addPasskey(cookie, device)).status).toBe(200);

    const signedIn = await passkeySignIn(device);
    expect(signedIn.status).toBe(200);
    const body = await signedIn.text();
    expect(body).not.toMatch(/"token"/);
    const session = cookieFrom(signedIn);
    const security = await rpcClient(app, session).account.security.get();
    expect(security.session).toMatchObject({ withSecondFactor: true, freshUntil: expect.any(String) as string });
    expect(security.passkeys[0]?.lastUsedAt).toEqual(expect.any(String));
    const methods = await testQuery<{ method: string }>(
      identityUrl,
      `select e.detail->>'method' as method from auth.security_event e join auth."user" u on u.id = e.user_id
        where u.email = $1 and e.kind = 'sign_in' order by e.at desc limit 1`,
      [email],
    );
    expect(methods[0]?.method).toBe('passkey');
  });

  it('refuses a passkey that skipped the PIN, and one no account has', async () => {
    const { cookie } = await signIn(app);
    const device = createTestAuthenticator(RP_ID, APP_URL);
    expect((await addPasskey(cookie, device)).status).toBe(200);
    const unverified = await passkeySignIn(device, { verified: false });
    expect(unverified.status).toBe(400);
    expect(cookieFrom(unverified)).not.toMatch(/session_token/);

    const stranger = await passkeySignIn(createTestAuthenticator(RP_ID, APP_URL));
    expect(stranger.status).toBe(422);
    expect(await stranger.json()).toMatchObject({ code: 'CODE_INVALID' });
  });

  it('refuses a passkey made for another site', async () => {
    const { cookie } = await signIn(app);
    const elsewhere = createTestAuthenticator('evil.test', 'https://evil.test');
    expect((await addPasskey(cookie, elsewhere)).status).toBe(422);
  });

  it('steps up with a passkey, as a second factor, making no new session; never with another’s passkey', async () => {
    const { email, cookie } = await signIn(app);
    const device = createTestAuthenticator(RP_ID, APP_URL);
    expect((await addPasskey(cookie, device)).status).toBe(200);
    await ageSessions(email);
    const client = rpcClient(app, cookie);

    const { options } = await client.account.stepUp.passkeyOptions();
    expect(options.allowCredentials?.map((each) => each.id)).toEqual([device.credentialId]);
    const fresh = await client.account.stepUp.verifyPasskey({
      response: device.assert(options) as Parameters<typeof client.account.stepUp.verifyPasskey>[0]['response'],
    });
    expect(fresh).toMatchObject({ withSecondFactor: true, freshUntil: expect.any(String) as string });
    const sessions = await client.account.sessions.list();
    expect(sessions.items).toHaveLength(1);

    // The challenge is used up: the same answer again proves nothing.
    expect(
      await failure(() =>
        client.account.stepUp.verifyPasskey({
          response: device.assert(options) as Parameters<typeof client.account.stepUp.verifyPasskey>[0]['response'],
        }),
      ),
    ).toMatchObject({ code: 'CODE_INVALID' });

    // Someone else's passkey, answering this session's challenge, proves nothing either.
    const other = await signIn(app);
    const theirs = createTestAuthenticator(RP_ID, APP_URL);
    expect((await addPasskey(other.cookie, theirs)).status).toBe(200);
    const again = await client.account.stepUp.passkeyOptions();
    expect(
      await failure(() =>
        client.account.stepUp.verifyPasskey({
          response: theirs.assert(again.options) as Parameters<
            typeof client.account.stepUp.verifyPasskey
          >[0]['response'],
        }),
      ),
    ).toMatchObject({ code: 'CODE_INVALID' });
  });

  it('answers no passkey step up for an account without one', async () => {
    const { cookie } = await signIn(app);
    expect(await failure(() => rpcClient(app, cookie).account.stepUp.passkeyOptions())).toMatchObject({
      code: 'INPUT_INVALID',
    });
  });

  it('renames a passkey, removes it only after a fresh check, and never reaches another’s', async () => {
    const { email, cookie } = await signIn(app);
    expect((await addPasskey(cookie, createTestAuthenticator(RP_ID, APP_URL))).status).toBe(200);
    const client = rpcClient(app, cookie);
    const [mine] = (await client.account.security.get()).passkeys;
    if (mine === undefined) throw new Error('No passkey listed.');

    expect(await client.account.passkeys.rename({ id: mine.id, name: '  Work phone ' })).toMatchObject({
      name: 'Work phone',
    });
    const other = await signIn(app);
    const otherClient = rpcClient(app, other.cookie);
    expect(await failure(() => otherClient.account.passkeys.rename({ id: mine.id, name: 'Mine now' }))).toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(await failure(() => otherClient.account.passkeys.remove({ id: mine.id }))).toMatchObject({
      code: 'NOT_FOUND',
    });

    await ageSessions(email);
    expect(await failure(() => client.account.passkeys.remove({ id: mine.id }))).toMatchObject({
      code: 'STEP_UP_REQUIRED',
    });
    await testQuery(
      identityUrl,
      `update auth.session set verified_at = now() where user_id = (select id from auth."user" where email = $1)`,
      [email],
    );
    expect(await client.account.passkeys.remove({ id: mine.id })).toEqual({ ok: true });
    expect((await client.account.security.get()).passkeys).toEqual([]);
    expect(await kindsOf(email)).toContain('passkey_removed');
  });

  it('keeps the plugin’s own list, rename and remove routes shut', async () => {
    const { cookie } = await signIn(app);
    expect((await authGet('/passkey/list-user-passkeys', cookie)).status).toBe(404);
    expect((await authPost(app, '/passkey/delete-passkey', { id: 'x' }, { cookie })).status).toBe(404);
    expect((await authPost(app, '/passkey/update-passkey', { id: 'x', name: 'y' }, { cookie })).status).toBe(404);
  });
});
