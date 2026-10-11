// Google sign in (spec 0005, AC-28), with a fake Google: the real app on a
// test database, the browser's steps by hand (start, Google's redirect back
// to the callback), and Google's token endpoint answered here, so the whole
// code path runs without the owner's OAuth client. Better Auth reads the
// person from the id token the token endpoint hands back, so the fake's
// claims (email, email_verified) are what Google would say.
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, inject, it, vi } from 'vitest';
import type { Database, IdentityStore } from '@crm/db';
import { testQuery } from '@crm/db/testing';
import { APP_URL, TEST_EDGE_SECRET } from '../testing.ts';
import { EDGE_HEADER, ORIGIN_HEADER } from '../edge.ts';
import {
  authPost,
  cookieFrom,
  newEmail,
  newIp,
  rpcClient,
  signIn,
  signInApp,
  testConnections,
} from '../../test/sign-in.ts';

const { identityUrl } = inject('testDatabase');
const GOOGLE = { GOOGLE_CLIENT_ID: 'test-client.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: 'test-secret' };
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
let db: Database;
let identity: IdentityStore;

beforeAll(() => {
  ({ db, identity } = testConnections());
});
afterAll(async () => {
  await identity.close();
  await db.close();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

/** What the fake Google says about the person. */
interface GooglePerson {
  readonly sub: string;
  readonly email: string;
  readonly emailVerified: boolean;
  readonly name?: string;
}

/** A JWT shaped like Google's id token; unsigned, as Better Auth only decodes one from the token endpoint. */
function idToken(person: GooglePerson): string {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  return [
    part({ alg: 'RS256', typ: 'JWT', kid: 'test' }),
    part({
      iss: 'https://accounts.google.com',
      aud: GOOGLE.GOOGLE_CLIENT_ID,
      sub: person.sub,
      email: person.email,
      email_verified: person.emailVerified,
      name: person.name ?? 'Grace Hopper',
      iat: now,
      exp: now + 3600,
    }),
    'signature',
  ].join('.');
}

/** Answers Google's token endpoint with `person`; every other address goes to the real fetch (Mailpit). */
function fakeGoogle(person: GooglePerson): { readonly tokenCalls: () => number } {
  const real = globalThis.fetch;
  let calls = 0;
  vi.stubGlobal('fetch', (input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    if (!url.startsWith(TOKEN_ENDPOINT)) return real(input, init);
    calls += 1;
    return Promise.resolve(
      Response.json({
        access_token: `access-${randomUUID()}`,
        id_token: idToken(person),
        expires_in: 3599,
        token_type: 'Bearer',
        scope: 'openid email profile',
      }),
    );
  });
  return { tokenCalls: () => calls };
}

type App = ReturnType<typeof signInApp>['app'];

/**
 * The browser's round trip: "Continue with Google" (`/sign-in/social`), then
 * Google sending it back to the callback with a code and the state. Answers
 * the callback's redirect and the cookie it set.
 */
async function googleRoundTrip(app: App, ip: string): Promise<{ location: string; cookie: string }> {
  const started = await authPost(
    app,
    '/sign-in/social',
    { provider: 'google', callbackURL: `${APP_URL}/`, errorCallbackURL: `${APP_URL}/sign-in` },
    { 'x-forwarded-for': ip },
  );
  expect(started.status).toBe(200);
  const { url } = (await started.json()) as { url: string };
  const authorize = new URL(url);
  expect(authorize.origin).toBe('https://accounts.google.com');
  const state = authorize.searchParams.get('state');
  expect(state).not.toBeNull();
  const callback = await app.fetch(
    new Request(`${APP_URL}/api/auth/callback/google?code=fake-code&state=${String(state)}`, {
      headers: {
        cookie: cookieFrom(started),
        'x-forwarded-for': ip,
        [EDGE_HEADER]: TEST_EDGE_SECRET,
        [ORIGIN_HEADER]: APP_URL,
      },
    }),
  );
  expect(callback.status).toBe(302);
  return { location: callback.headers.get('location') ?? '', cookie: cookieFrom(callback) };
}

/** The users and Google accounts stored for `email`. */
async function stored(email: string) {
  const users = await testQuery<{ id: string; email_verified: boolean }>(
    identityUrl,
    'select id, email_verified from auth."user" where email = $1',
    [email],
  );
  const accounts = await testQuery<{ user_id: string; account_id: string }>(
    identityUrl,
    `select a.user_id, a.account_id from auth.account a join auth."user" u on u.id = a.user_id
     where u.email = $1 and a.provider_id = 'google'`,
    [email],
  );
  return { users, accounts };
}

describe('Google sign in, against a fake Google (AC-28)', () => {
  it('says Google is on in system.status only when both variables are set', async () => {
    const on = signInApp({ db, identity }, GOOGLE);
    const off = signInApp({ db, identity });
    expect((await rpcClient(on.app).system.status()).providers).toEqual({ google: true });
    expect((await rpcClient(off.app).system.status()).providers).toEqual({ google: false });
  });

  it('signs a new person up with a verified Google email, and the session answers me.get', async () => {
    const { app } = signInApp({ db, identity }, GOOGLE);
    const email = newEmail();
    const google = fakeGoogle({ sub: randomUUID(), email, emailVerified: true });
    const { location, cookie } = await googleRoundTrip(app, newIp());
    expect(google.tokenCalls()).toBe(1);
    expect(location).toBe(`${APP_URL}/`);
    expect((await rpcClient(app, cookie).me.get()).user).toMatchObject({ email });
    const { users, accounts } = await stored(email);
    expect(users).toEqual([{ id: expect.any(String) as string, email_verified: true }]);
    expect(accounts).toHaveLength(1);
  });

  it('lands a verified Google email that already has an account in that same account', async () => {
    const { app } = signInApp({ db, identity }, GOOGLE);
    const { email } = await signIn(app);
    const before = await stored(email);
    fakeGoogle({ sub: randomUUID(), email, emailVerified: true });
    const { location, cookie } = await googleRoundTrip(app, newIp());
    expect(location).toBe(`${APP_URL}/`);
    const me = await rpcClient(app, cookie).me.get();
    expect(me.user.id).toBe(before.users[0]?.id);
    const after = await stored(email);
    expect(after.users).toHaveLength(1);
    expect(after.accounts.map((account) => account.user_id)).toEqual([before.users[0]?.id]);
  });

  it('never attaches a Google account whose email Google has not verified to an existing account', async () => {
    const { app } = signInApp({ db, identity }, GOOGLE);
    const { email } = await signIn(app);
    fakeGoogle({ sub: randomUUID(), email, emailVerified: false });
    const { location, cookie } = await googleRoundTrip(app, newIp());
    const back = new URL(location);
    expect(back.pathname).toBe('/sign-in');
    expect(back.searchParams.get('error')).toBe('account_not_linked');
    expect(cookie).not.toContain('session_token');
    expect((await stored(email)).accounts).toEqual([]);
  });

  it('makes no account from a Google email Google has not verified', async () => {
    const { app } = signInApp({ db, identity }, GOOGLE);
    const email = newEmail();
    fakeGoogle({ sub: randomUUID(), email, emailVerified: false });
    const { location, cookie } = await googleRoundTrip(app, newIp());
    const back = new URL(location);
    expect(back.pathname).toBe('/sign-in');
    expect(back.searchParams.get('error')).toBe('EMAIL_UNVERIFIED');
    expect(cookie).not.toContain('session_token');
    expect((await stored(email)).users).toEqual([]);
  });

  it('keeps sign up closed to a new Google email off the allowlist, and lets a listed one in', async () => {
    const listed = newEmail();
    const { app } = signInApp({ db, identity }, { ...GOOGLE, SIGNUP_ALLOWLIST: [listed] });
    const stranger = newEmail();
    fakeGoogle({ sub: randomUUID(), email: stranger, emailVerified: true });
    const refused = await googleRoundTrip(app, newIp());
    expect(new URL(refused.location).pathname).toBe('/sign-in');
    expect(new URL(refused.location).searchParams.get('error')).toBe('SIGNUP_CLOSED');
    expect((await stored(stranger)).users).toEqual([]);

    vi.unstubAllGlobals();
    fakeGoogle({ sub: randomUUID(), email: listed, emailVerified: true });
    const admitted = await googleRoundTrip(app, newIp());
    expect(admitted.location).toBe(`${APP_URL}/`);
    expect((await stored(listed)).users).toHaveLength(1);
  });

  it('signs the same Google account in again to the same person', async () => {
    const { app } = signInApp({ db, identity }, GOOGLE);
    const email = newEmail();
    const sub = randomUUID();
    fakeGoogle({ sub, email, emailVerified: true });
    const first = await googleRoundTrip(app, newIp());
    const second = await googleRoundTrip(app, newIp());
    const [one, two] = await Promise.all([
      rpcClient(app, first.cookie).me.get(),
      rpcClient(app, second.cookie).me.get(),
    ]);
    expect(two.user.id).toBe(one.user.id);
    expect((await stored(email)).accounts).toHaveLength(1);
  });
});
