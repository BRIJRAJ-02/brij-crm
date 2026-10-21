// Two factor sign in and the step up (spec 0033, milestone 2: AC-881 to
// AC-886, AC-892, AC-896, AC-900): the app set up after a recent check, a
// sign in by email code held back for its second step (no session until an
// app or backup code), a backup code working once, a remembered device
// skipping the step, a step up by app code, turning off only after a second
// factor, and no token in any answer.
import { ORPCError } from '@orpc/client';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import type { Database, IdentityStore } from '@crm/db';
import { testQuery } from '@crm/db/testing';
import { totpCode } from '../auth/two-factor.ts';
import { EDGE_HEADER, ORIGIN_HEADER } from '../edge.ts';
import { APP_URL, TEST_EDGE_SECRET } from '../testing.ts';
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
  turnOnTwoFactor,
  verifyCode,
  withCookies,
} from '../../test/sign-in.ts';

const { identityUrl } = inject('testDatabase');
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

/** Signs in by email code; answers the response (held back or not) and its cookies. */
async function emailSignIn(email: string, cookie = '') {
  const ip = newIp();
  expect((await sendCode(app, email, ip)).status).toBe(200);
  const answer = await verifyCode(app, email, await codeFor(email), ip, cookie === '' ? {} : { cookie });
  return { answer, body: (await answer.clone().json()) as Record<string, unknown>, cookie: cookieFrom(answer) };
}

/** A person with the app set up: their session cookie, the app's secret and their backup codes. */
async function withTwoFactor(email = newEmail()) {
  const first = await emailSignIn(email);
  return { email, ...(await turnOnTwoFactor(app, first.cookie)) };
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

describe('two factor sign in (spec 0033, milestone 2)', () => {
  it('sets the app up after a fresh sign in, sends no token back, and counts it on', async () => {
    const { email, cookie, backupCodes } = await withTwoFactor();
    expect(backupCodes).toHaveLength(10);
    const security = await rpcClient(app, cookie).account.security.get();
    expect(security.twoFactor).toEqual({ on: true, backupCodesLeft: 10 });
    expect(await kindsOf(email)).toEqual(['sign_in', 'two_factor_on']);
  });

  it('refuses setup on a session not checked in the last 10 minutes', async () => {
    const email = newEmail();
    const { cookie } = await emailSignIn(email);
    await ageSessions(email);
    const refused = await authPost(app, '/two-factor/enable', {}, { cookie });
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ code: 'STEP_UP_REQUIRED' });
  });

  it('holds an email code sign in back until an app code, with no session meanwhile', async () => {
    const { email, secret } = await withTwoFactor();
    const held = await emailSignIn(email);
    expect(held.body).toMatchObject({ twoFactorRedirect: true });
    expect(held.body).not.toHaveProperty('token');
    // The pending cookie is no session.
    await expect(rpcClient(app, held.cookie).me.get()).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    const wrong = await authPost(app, '/two-factor/verify-totp', { code: '000000' }, { cookie: held.cookie });
    expect(wrong.status).toBe(422);
    expect(await wrong.json()).toMatchObject({ code: 'CODE_INVALID' });
    const passed = await authPost(app, '/two-factor/verify-totp', { code: totpCode(secret) }, { cookie: held.cookie });
    expect(passed.status).toBe(200);
    const body = (await passed.json()) as Record<string, unknown>;
    expect(body).not.toHaveProperty('token');
    const session = cookieFrom(passed);
    await expect(rpcClient(app, session).me.get()).resolves.toBeDefined();
    // Signed in with the second factor: fresh, and proven by it.
    expect((await rpcClient(app, session).account.security.get()).session.withSecondFactor).toBe(true);
    // The held back sign in left no event; the second step's did.
    expect(await kindsOf(email)).toEqual(['sign_in', 'two_factor_on', 'sign_in']);
  });

  it('takes a backup code once, and skips the step on a remembered device', async () => {
    const { email, backupCodes } = await withTwoFactor();
    const [code = ''] = backupCodes;
    const held = await emailSignIn(email);
    const used = await authPost(
      app,
      '/two-factor/verify-backup-code',
      { code, trustDevice: true },
      { cookie: held.cookie },
    );
    expect(used.status).toBe(200);
    const remembered = cookieFrom(used);
    const again = await emailSignIn(email);
    const twice = await authPost(app, '/two-factor/verify-backup-code', { code }, { cookie: again.cookie });
    expect(twice.status).toBe(422);
    // The trust cookie lets the next sign in straight through.
    const trusted = await emailSignIn(email, remembered);
    expect(trusted.body).not.toHaveProperty('twoFactorRedirect');
    await expect(rpcClient(app, withCookies(remembered, trusted.cookie)).me.get()).resolves.toBeDefined();
  });

  it("keeps the second factor's own routes from an email checked session, and its sign in routes from any", async () => {
    const { email, cookie, backupCodes } = await withTwoFactor();
    // Proven by email alone: no new backup codes.
    const codes = await authPost(app, '/two-factor/generate-backup-codes', {}, { cookie });
    expect(codes.status).toBe(403);
    expect(await codes.json()).toMatchObject({ code: 'SECOND_FACTOR_REQUIRED' });
    // Signed in, the second step's routes are shut: no guessing app codes past the lockout.
    expect((await authPost(app, '/two-factor/verify-totp', { code: '000000' }, { cookie })).status).toBe(400);
    expect((await authPost(app, '/two-factor/verify-backup-code', { code: backupCodes[0] }, { cookie })).status).toBe(
      400,
    );
    // A sign in's backup code always makes its session.
    const held = await emailSignIn(email);
    const quiet = await authPost(
      app,
      '/two-factor/verify-backup-code',
      { code: backupCodes[0], disableSession: true },
      { cookie: held.cookie },
    );
    expect(quiet.status).toBe(400);
  });

  it('forgets remembered devices when two factor is turned off', async () => {
    const { email, cookie, secret, backupCodes } = await withTwoFactor();
    const held = await emailSignIn(email);
    const used = await authPost(
      app,
      '/two-factor/verify-backup-code',
      { code: backupCodes[0], trustDevice: true },
      { cookie: held.cookie },
    );
    const remembered = cookieFrom(used);
    await rpcClient(app, cookie).account.stepUp.verify({ method: 'totp', code: totpCode(secret) });
    expect((await authPost(app, '/two-factor/disable', {}, { cookie })).status).toBe(200);
    const rows = await testQuery<{ count: string }>(
      identityUrl,
      `select count(*) from auth.verification v join auth."user" u on v.value = u.id::text
        where u.email = $1 and v.identifier like 'trust-device-%'`,
      [email],
    );
    expect(rows[0]?.count).toBe('0');
    expect(remembered).toContain('trust_device');
  });

  it('steps up with an app code, and turns off only after a second factor', async () => {
    const { cookie, secret } = await withTwoFactor();
    const client = rpcClient(app, cookie);
    // Proven by email at sign in: fresh, but not by a second factor.
    const off = await authPost(app, '/two-factor/disable', {}, { cookie });
    expect(off.status).toBe(403);
    expect(await off.json()).toMatchObject({ code: 'SECOND_FACTOR_REQUIRED' });
    expect(await failure(() => client.account.stepUp.start({ method: 'email' }))).toMatchObject({
      code: 'INPUT_INVALID',
    });
    expect(await failure(() => client.account.stepUp.verify({ method: 'totp', code: '000000' }))).toMatchObject({
      code: 'CODE_INVALID',
      status: 422,
    });
    const fresh = await client.account.stepUp.verify({ method: 'totp', code: totpCode(secret) });
    expect(fresh.withSecondFactor).toBe(true);
    expect(fresh.freshUntil).toBeDefined();
    const turnedOff = await authPost(app, '/two-factor/disable', {}, { cookie });
    expect(turnedOff.status).toBe(200);
    const after = withCookies(cookie, cookieFrom(turnedOff));
    expect((await rpcClient(app, after).account.security.get()).twoFactor.on).toBe(false);
  });

  it('steps up by an emailed code while two factor is off, and then signs another device out', async () => {
    const email = newEmail();
    const other = (await emailSignIn(email)).cookie;
    const { cookie } = await emailSignIn(email);
    await ageSessions(email);
    const client = rpcClient(app, cookie);
    const [device] = (await client.account.sessions.list()).items.filter((item) => !item.current);
    expect(await failure(() => client.account.sessions.revoke({ sessionId: device?.id ?? '' }))).toMatchObject({
      code: 'STEP_UP_REQUIRED',
    });
    await client.account.stepUp.start({ method: 'email' });
    const fresh = await client.account.stepUp.verify({ method: 'email', code: await codeFor(email) });
    expect(fresh).toMatchObject({ withSecondFactor: false });
    await client.account.sessions.revoke({ sessionId: device?.id ?? '' });
    await expect(rpcClient(app, other).me.get()).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('never answers a session token, here or on the session read', async () => {
    const { cookie } = await emailSignIn(newEmail());
    const read = await app.fetch(
      new Request(`${APP_URL}/api/auth/get-session`, {
        headers: { cookie, origin: APP_URL, [EDGE_HEADER]: TEST_EDGE_SECRET, [ORIGIN_HEADER]: APP_URL },
      }),
    );
    const body = (await read.json()) as { session?: Record<string, unknown> };
    expect(body.session).toBeDefined();
    expect(body.session).not.toHaveProperty('token');
  });
});
