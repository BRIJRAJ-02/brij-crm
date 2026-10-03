// Sign in by email code (spec 0005, AC-27, AC-29, AC-31, AC-33), for real: the
// app on a test database, Better Auth on the identity login, and codes read
// back from Mailpit (`docker compose up -d mailpit`).
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';
import type { Database, IdentityStore } from '@crm/db';
import { createTestUser, testQuery } from '@crm/db/testing';
import {
  codeFor,
  cookieFrom,
  mailTo,
  newEmail,
  newIp,
  rpcClient,
  sendCode,
  signIn,
  signInApp,
  testConnections,
  verifyCode,
} from '../../test/sign-in.ts';
import { captureLogs } from '../testing.ts';
import { CODE_SENDS_PER_EMAIL, CODE_SENDS_PER_IP } from './auth.ts';

const { identityUrl } = inject('testDatabase');
let db: Database;
let identity: IdentityStore;

beforeAll(() => {
  ({ db, identity } = testConnections());
});
afterAll(async () => {
  await identity.close();
  await db.close();
});

/** One statement as the identity login, to look at what Better Auth stored. */
function authSql<Row extends Record<string, unknown>>(text: string, params: readonly unknown[] = []) {
  return testQuery<Row>(identityUrl, text, params);
}

async function userCount(email: string): Promise<number> {
  const users = await authSql('select 1 from auth."user" where email = $1', [email]);
  return users.length;
}

describe('signing in by email code', () => {
  it('sends a 6 digit code to Mailpit, signs in with it, and the session answers me.get', async () => {
    const { app } = signInApp({ db, identity });
    const email = newEmail();
    const ip = newIp();

    const sent = await sendCode(app, email, ip);
    expect(sent.status).toBe(200);
    expect(await sent.json()).toEqual({ success: true });
    const [mail] = await mailTo(email);
    expect(mail?.Subject).toBe('Your sign in code');
    expect(mail?.HTML).toContain('Your sign in code');
    const code = await codeFor(email);
    expect(code).toMatch(/^\d{6}$/);
    // Stored hashed, never as typed.
    const stored = await authSql<{ value: string }>('select value from auth.verification where identifier = $1', [
      `sign-in-otp-${email}`,
    ]);
    expect(stored[0]?.value).not.toContain(code);

    const signedIn = await verifyCode(app, email, code, ip);
    expect(signedIn.status).toBe(200);
    const cookie = signedIn.headers.getSetCookie().find((value) => value.includes('session_token'));
    // Host only, HttpOnly, SameSite=Lax, 30 days (Secure outside local, see below).
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).not.toMatch(/Domain=/i);
    expect(cookie).toMatch(/Max-Age=2592000/);

    const me = await rpcClient(app, cookieFrom(signedIn)).me.get();
    expect(me).toEqual({ user: { id: expect.any(String) as string, name: '', email }, workspaces: [] });
    // The session is 30 days, in the database, with the trusted IP.
    const session = await authSql<{ days: number; ip_address: string | null }>(
      `select round(extract(epoch from expires_at - now()) / 86400)::int as days, ip_address
       from auth.session where user_id = $1`,
      [me.user.id],
    );
    expect(session).toEqual([{ days: 30, ip_address: ip }]);
  });

  it('refuses a wrong code with INVALID_OTP and signs nothing in', async () => {
    const { app } = signInApp({ db, identity });
    const email = newEmail();
    const ip = newIp();
    await sendCode(app, email, ip);
    const code = await codeFor(email);
    const wrong = code === '000000' ? '111111' : '000000';
    const refused = await verifyCode(app, email, wrong, ip);
    expect(refused.status).toBe(400);
    expect(await refused.json()).toEqual({
      code: 'INVALID_OTP',
      message: "That code isn't right. Check it, or send a new one.",
    });
    expect(refused.headers.getSetCookie().some((value) => value.includes('session_token='))).toBe(false);
    expect(await userCount(email)).toBe(0);
    // The right code still works after a wrong one.
    expect((await verifyCode(app, email, code, ip)).status).toBe(200);
  });

  it('allows 5 wrong tries per code, then refuses even the right one', async () => {
    const { app } = signInApp({ db, identity });
    const email = newEmail();
    const ip = newIp();
    await sendCode(app, email, ip);
    const code = await codeFor(email);
    const wrong = code === '000000' ? '111111' : '000000';
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect((await verifyCode(app, email, wrong, ip)).status).toBe(400);
    }
    const locked = await verifyCode(app, email, code, ip);
    expect(locked.status).toBe(403);
    expect(await locked.json()).toMatchObject({ code: 'TOO_MANY_ATTEMPTS' });
    expect(await userCount(email)).toBe(0);
  });

  it('refuses an expired code with OTP_EXPIRED', async () => {
    const { app } = signInApp({ db, identity });
    const email = newEmail();
    const ip = newIp();
    await sendCode(app, email, ip);
    const code = await codeFor(email);
    await authSql(`update auth.verification set expires_at = now() - interval '1 second' where identifier = $1`, [
      `sign-in-otp-${email}`,
    ]);
    const expired = await verifyCode(app, email, code, ip);
    expect(expired.status).toBe(400);
    expect(await expired.json()).toEqual({ code: 'OTP_EXPIRED', message: 'That code has expired. Send a new one.' });
    expect(await userCount(email)).toBe(0);
  });

  it('refuses a code used once already', async () => {
    const { app } = signInApp({ db, identity });
    const email = newEmail();
    const ip = newIp();
    await sendCode(app, email, ip);
    const code = await codeFor(email);
    expect((await verifyCode(app, email, code, ip)).status).toBe(200);
    const reused = await verifyCode(app, email, code, ip);
    expect(reused.status).toBe(400);
    expect(await reused.json()).toMatchObject({ code: 'INVALID_OTP' });
  });

  it('signs out, and the cookie no longer answers me.get', async () => {
    const { app } = signInApp({ db, identity });
    const { cookie } = await signIn(app);
    expect((await rpcClient(app, cookie).me.get()).workspaces).toEqual([]);
    const out = await app.fetch(
      new Request('https://app.test/api/auth/sign-out', {
        method: 'POST',
        headers: { origin: 'https://app.test', cookie, 'content-type': 'application/json' },
        body: '{}',
      }),
    );
    expect(out.status).toBe(200);
    await expect(rpcClient(app, cookie).me.get()).rejects.toMatchObject({ code: 'UNAUTHENTICATED', status: 401 });
  });

  it('answers a send that only some other type would use with INPUT_INVALID, and sends nothing', async () => {
    const { app } = signInApp({ db, identity });
    const email = newEmail();
    await createTestUser(identityUrl, { email });
    const response = await app.fetch(
      new Request('https://app.test/api/auth/email-otp/send-verification-otp', {
        method: 'POST',
        headers: { origin: 'https://app.test', 'content-type': 'application/json', 'x-forwarded-for': newIp() },
        body: JSON.stringify({ email, type: 'forget-password' }),
      }),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: 'INPUT_INVALID' });
    expect(await mailTo(email)).toEqual([]);
  });
});

describe('rate limits', () => {
  it(`sends ${CODE_SENDS_PER_EMAIL.max} codes per email in 10 minutes, whatever the IP, then answers 429 RATE_LIMITED`, async () => {
    const { app } = signInApp({ db, identity });
    const email = newEmail();
    for (let send = 0; send < CODE_SENDS_PER_EMAIL.max; send += 1) {
      expect((await sendCode(app, email, newIp())).status).toBe(200);
    }
    const sixth = await sendCode(app, email, newIp());
    expect(sixth.status).toBe(429);
    expect(await sixth.json()).toEqual({
      code: 'RATE_LIMITED',
      message: 'Too many codes were sent to this email. Wait a few minutes.',
    });
    expect(Number(sixth.headers.get('retry-after'))).toBeGreaterThan(500);
    expect(await mailTo(email)).toHaveLength(CODE_SENDS_PER_EMAIL.max);
  });

  it(`sends ${CODE_SENDS_PER_IP.max} codes per client IP in 10 minutes, then answers 429 with Retry-After`, async () => {
    const { app } = signInApp({ db, identity });
    const ip = newIp();
    for (let send = 0; send < CODE_SENDS_PER_IP.max; send += 1) {
      expect((await sendCode(app, newEmail(), ip)).status).toBe(200);
    }
    const email = newEmail();
    const over = await sendCode(app, email, ip);
    expect(over.status).toBe(429);
    expect(await over.json()).toMatchObject({ code: 'RATE_LIMITED' });
    expect(Number(over.headers.get('retry-after'))).toBeGreaterThan(500);
    expect(await mailTo(email)).toEqual([]);
    // Another IP is unaffected.
    expect((await sendCode(app, newEmail(), newIp())).status).toBe(200);
  });
});

describe('the sign up allowlist (AC-29)', () => {
  it('sends no code and makes no user for a new email off the list', async () => {
    const listed = newEmail();
    const { app } = signInApp({ db, identity }, { SIGNUP_ALLOWLIST: [listed] });
    const stranger = newEmail();
    const refused = await sendCode(app, stranger, newIp());
    expect(refused.status).toBe(403);
    expect(await refused.json()).toEqual({ code: 'SIGNUP_CLOSED', message: "Sign up isn't open yet." });
    expect(await mailTo(stranger)).toEqual([]);
    expect(await userCount(stranger)).toBe(0);
    // A listed email signs up.
    await signIn(app, listed);
    expect(await userCount(listed)).toBe(1);
  });

  it('compares the list lowercased', async () => {
    const email = newEmail();
    const { app } = signInApp({ db, identity }, { SIGNUP_ALLOWLIST: [` ${email.toUpperCase()} `] });
    expect((await sendCode(app, email.toUpperCase(), newIp())).status).toBe(200);
    expect(await mailTo(email)).toHaveLength(1);
  });

  it('never blocks an existing user, even one no longer listed', async () => {
    const email = newEmail();
    await createTestUser(identityUrl, { email, name: 'Ada' });
    const { app } = signInApp({ db, identity }, { SIGNUP_ALLOWLIST: [newEmail()] });
    const { cookie } = await signIn(app, email);
    expect((await rpcClient(app, cookie).me.get()).user).toMatchObject({ email, name: 'Ada' });
  });

  it('is closed to everyone new outside local when no list is set', async () => {
    const { app } = signInApp({ db, identity }, { APP_ENV: 'preview' });
    const email = newEmail();
    const refused = await sendCode(app, email, newIp());
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ code: 'SIGNUP_CLOSED' });
  });

  it('refuses the account itself too, whatever path makes it (the user create hook)', async () => {
    // A code sent while the email was allowed, used after the list stopped allowing it.
    const email = newEmail();
    const open = signInApp({ db, identity });
    const ip = newIp();
    await sendCode(open.app, email, ip);
    const code = await codeFor(email);
    const closed = signInApp({ db, identity }, { SIGNUP_ALLOWLIST: [newEmail()] });
    const refused = await verifyCode(closed.app, email, code, ip);
    expect(refused.status).toBe(403);
    expect(await refused.json()).toEqual({ code: 'SIGNUP_CLOSED', message: "Sign up isn't open yet." });
    expect(await userCount(email)).toBe(0);
  });
});

describe('mail failures', () => {
  let logs: ReturnType<typeof captureLogs>;
  beforeEach(() => {
    logs = captureLogs();
  });
  afterEach(() => logs.restore());

  it('answers a failed send the same as a sent one, and logs neither the address nor the code', async () => {
    const codes: string[] = [];
    const failing = {
      transport: 'resend' as const,
      send: (message: { text: string }) => {
        codes.push(/\b(\d{6})\b/.exec(message.text)?.[1] ?? '');
        return Promise.reject(new Error('Resend refused the message (application_error).'));
      },
    };
    const { app } = signInApp({ db, identity }, {}, { mailer: failing });
    const email = newEmail();
    const response = await sendCode(app, email, newIp());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    const lines = logs.lines();
    expect(lines).toContainEqual(expect.objectContaining({ level: 'error', message: 'Sign in code not sent' }));
    const written = JSON.stringify(lines);
    expect(written).not.toContain(email);
    expect(codes[0]).toMatch(/^\d{6}$/);
    expect(written).not.toContain(codes[0]);
  });
});

describe('the client IP (AC-33)', () => {
  it('ignores a forged x-forwarded-for while the edge guard is off outside local', async () => {
    const { app } = signInApp({ db, identity }, { APP_ENV: 'preview', SIGNUP_ALLOWLIST: [] });
    const email = newEmail();
    await createTestUser(identityUrl, { email });
    const forged = '203.0.113.77';
    const sent = await sendCode(app, email, forged);
    expect(sent.status).toBe(200);
    const signedIn = await verifyCode(app, email, await codeFor(email), forged);
    expect(signedIn.status).toBe(200);
    // Outside local the cookie is Secure (and so __Secure- prefixed).
    expect(signedIn.headers.getSetCookie().find((value) => value.includes('session_token'))).toMatch(/; Secure/i);
    const stored = await authSql<{ ip: string | null }>(
      `select s.ip_address as ip from auth.session s join auth."user" u on u.id = s.user_id where u.email = $1`,
      [email],
    );
    expect(stored.map((row) => row.ip)).not.toContain(forged);
    const keys = await authSql('select 1 from auth.rate_limit where key like $1', [`${forged}%`]);
    expect(keys).toEqual([]);
  });

  it('keys limits and sessions on the forwarded IP once the edge guard admits the request', async () => {
    const secret = 'an-edge-secret-of-at-least-32-characters';
    const { app } = signInApp({ db, identity }, { APP_ENV: 'preview', EDGE_SECRET: secret, SIGNUP_ALLOWLIST: [] });
    const email = newEmail();
    await createTestUser(identityUrl, { email });
    const ip = '203.0.113.88';
    const edge = { 'x-crm-edge': secret };
    expect((await sendCode(app, email, ip, edge)).status).toBe(200);
    expect((await verifyCode(app, email, await codeFor(email), ip, edge)).status).toBe(200);
    const keys = await authSql('select 1 from auth.rate_limit where key like $1', [`${ip}|%`]);
    expect(keys.length).toBeGreaterThan(0);
    const stored = await authSql<{ ip: string | null }>(
      `select s.ip_address as ip from auth.session s join auth."user" u on u.id = s.user_id where u.email = $1`,
      [email],
    );
    expect(stored).toEqual([{ ip }]);
  });
});
