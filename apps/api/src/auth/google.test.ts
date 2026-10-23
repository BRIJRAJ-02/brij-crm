// Google sign in (spec 0005, AC-28), with a fake Google: the real app on a
// test database, the browser's steps by hand (start, Google's redirect back
// to the callback), and Google's token endpoint answered here, so the whole
// code path runs without the owner's OAuth client. Better Auth reads the
// person from the id token the token endpoint hands back, so the fake's
// claims (email, email_verified) are what Google would say.
import { createHash, randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, inject, it, vi } from 'vitest';
import { newId } from '@crm/core';
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
  turnOnTwoFactor,
  withCookies,
} from '../../test/sign-in.ts';
import { GOOGLE_USERINFO, idTokenPicture } from './google-photo.ts';
import { pendingPicture, pendingPictureValue, totpCode } from './two-factor.ts';

const { identityUrl } = inject('testDatabase');
const GOOGLE = { GOOGLE_CLIENT_ID: 'test-client.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: 'test-secret' };
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
/** A PNG's first bytes: what the fake Google's picture hosts answer. */
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
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
  /** Their profile picture, as Google's id token and userinfo name it. */
  readonly picture?: string;
  /** False when the id token leaves the picture out, as Google may; userinfo still names it. */
  readonly pictureInIdToken?: boolean;
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
      ...(person.picture === undefined || person.pictureInIdToken === false ? {} : { picture: person.picture }),
      iat: now,
      exp: now + 3600,
    }),
    'signature',
  ].join('.');
}

/** What the app sent Google's token endpoint: the code exchange's form fields. */
type TokenRequest = URLSearchParams;

/** Answers Google's token endpoint with `person`, keeping each request; every other address goes to the real fetch (Mailpit). */
function fakeGoogle(person: GooglePerson): {
  readonly tokenCalls: () => number;
  readonly lastTokenRequest: () => TokenRequest | undefined;
  readonly userinfoCalls: () => number;
} {
  const real = globalThis.fetch;
  const requests: TokenRequest[] = [];
  const tokens = new Set<string>();
  let userinfo = 0;
  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    // Google's picture hosts answer every picture as a small PNG.
    if (url.startsWith('https://lh3.googleusercontent.com/')) {
      return new Response(PNG, { headers: { 'content-type': 'image/png' } });
    }
    // Userinfo answers only an access token this fake handed out, as Google answers only its own.
    if (url === GOOGLE_USERINFO) {
      userinfo += 1;
      const bearer = new Headers(init?.headers).get('authorization')?.replace(/^Bearer /, '') ?? '';
      if (!tokens.has(bearer)) return Response.json({ error: 'invalid_token' }, { status: 401 });
      return Response.json({
        sub: person.sub,
        email: person.email,
        ...(person.picture === undefined ? {} : { picture: person.picture }),
      });
    }
    if (!url.startsWith(TOKEN_ENDPOINT)) return real(input, init);
    const body = input instanceof Request ? await input.clone().text() : bodyText(init?.body);
    requests.push(new URLSearchParams(body));
    const accessToken = `access-${randomUUID()}`;
    tokens.add(accessToken);
    return Response.json({
      access_token: accessToken,
      id_token: idToken(person),
      expires_in: 3599,
      token_type: 'Bearer',
      scope: 'openid email profile',
    });
  });
  return { tokenCalls: () => requests.length, lastTokenRequest: () => requests.at(-1), userinfoCalls: () => userinfo };
}

/** A request body as text: the form Better Auth sends, as a string or as URLSearchParams. */
function bodyText(body: RequestInit['body']): string {
  if (typeof body === 'string') return body;
  if (body instanceof URLSearchParams) return body.toString();
  return '';
}

type App = ReturnType<typeof signInApp>['app'];

/**
 * The browser's round trip: "Continue with Google" (`/sign-in/social`), then
 * Google sending it back to the callback with a code and the state. Answers
 * the callback's redirect and the cookie it set.
 */
async function googleRoundTrip(
  app: App,
  ip: string,
  tamper: { readonly state?: string; readonly dropCookie?: boolean } = {},
): Promise<{ location: string; cookie: string; authorize: URL }> {
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
    new Request(`${APP_URL}/api/auth/callback/google?code=fake-code&state=${tamper.state ?? String(state)}`, {
      headers: {
        ...(tamper.dropCookie === true ? {} : { cookie: cookieFrom(started) }),
        'x-forwarded-for': ip,
        [EDGE_HEADER]: TEST_EDGE_SECRET,
        [ORIGIN_HEADER]: APP_URL,
      },
    }),
  );
  expect(callback.status).toBe(302);
  return { location: callback.headers.get('location') ?? '', cookie: cookieFrom(callback), authorize };
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
    const { location, cookie, authorize } = await googleRoundTrip(app, newIp());
    expect(google.tokenCalls()).toBe(1);
    expect(location).toBe(`${APP_URL}/`);
    // PKCE: the code goes back with the verifier whose S256 hash Google was shown, and the same callback address.
    expect(authorize.searchParams.get('code_challenge_method')).toBe('S256');
    const exchange = google.lastTokenRequest();
    const verifier = exchange?.get('code_verifier') ?? '';
    expect(verifier).not.toBe('');
    expect(createHash('sha256').update(verifier).digest('base64url')).toBe(
      authorize.searchParams.get('code_challenge'),
    );
    expect(exchange?.get('redirect_uri')).toBe(`${APP_URL}/api/auth/callback/google`);
    expect(authorize.searchParams.get('redirect_uri')).toBe(`${APP_URL}/api/auth/callback/google`);
    expect((await rpcClient(app, cookie).me.get()).user).toMatchObject({ email });
    const { users, accounts } = await stored(email);
    expect(users).toEqual([{ id: expect.any(String) as string, email_verified: true }]);
    expect(accounts).toHaveLength(1);
  });

  it('holds a Google sign in back for the second step when two factor is on (spec 0033, AC-882)', async () => {
    const { app } = signInApp({ db, identity }, GOOGLE);
    const { email, cookie } = await signIn(app);
    await turnOnTwoFactor(app, cookie);
    fakeGoogle({ sub: randomUUID(), email, emailVerified: true });
    const held = await googleRoundTrip(app, newIp());
    expect(held.location).toBe(`${APP_URL}/two-factor`);
    // Only the pending cookie: no session until the app's code.
    await expect(rpcClient(app, held.cookie).me.get()).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
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

  it('refuses a callback whose state was tampered with, or that comes back without the start cookie', async () => {
    const { app } = signInApp({ db, identity }, GOOGLE);
    for (const tamper of [{ state: 'not-the-state' }, { dropCookie: true }]) {
      const email = newEmail();
      const google = fakeGoogle({ sub: randomUUID(), email, emailVerified: true });
      const { location, cookie } = await googleRoundTrip(app, newIp(), tamper);
      expect(new URL(location).pathname).toBe('/sign-in');
      expect(new URL(location).searchParams.get('error')).not.toBeNull();
      expect(cookie).not.toContain('session_token');
      // Refused before the code is exchanged: nothing reached Google's token endpoint, and no one was made.
      expect(google.tokenCalls()).toBe(0);
      expect((await stored(email)).users).toEqual([]);
      vi.unstubAllGlobals();
    }
  });

  it('refuses an id token handed straight to /sign-in/social: Google signs in only through its own page', async () => {
    const { app } = signInApp({ db, identity }, GOOGLE);
    const email = newEmail();
    const refused = await authPost(
      app,
      '/sign-in/social',
      { provider: 'google', idToken: { token: idToken({ sub: randomUUID(), email, emailVerified: true }) } },
      { 'x-forwarded-for': newIp() },
    );
    expect(refused.status).toBe(400);
    expect(await refused.json()).toMatchObject({ code: 'INPUT_INVALID' });
    expect((await stored(email)).users).toEqual([]);
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

  it('keeps Google’s picture on a new account, as Better Auth does at sign up', async () => {
    const { app } = signInApp({ db, identity }, GOOGLE);
    const email = newEmail();
    const picture = 'https://lh3.googleusercontent.com/a/new-account=s96-c';
    fakeGoogle({ sub: randomUUID(), email, emailVerified: true, picture });
    const { cookie } = await googleRoundTrip(app, newIp());
    const { user } = await rpcClient(app, cookie).me.get();
    expect(await identity.userImage(user.id)).toBe(picture);
  });

  it('fills a picture an account lacks from Google (an email code account linked later), and keeps it Google’s current one', async () => {
    const { app } = signInApp({ db, identity }, GOOGLE);
    const email = newEmail();
    const userId = randomUUID();
    // Made with an email code: no picture. Better Auth fills one only when Google makes the account.
    await testQuery(
      identityUrl,
      `insert into auth."user" (id, name, email, email_verified) values ($1, '', $2, true)`,
      [userId, email],
    );
    const sub = randomUUID();
    const picture = 'https://lh3.googleusercontent.com/a/linked=s96-c';
    fakeGoogle({ sub, email, emailVerified: true, picture });
    await googleRoundTrip(app, newIp());
    expect(await identity.userImage(userId)).toBe(picture);
    // Signed in again with a new picture at Google: the account takes it.
    vi.unstubAllGlobals();
    const newer = 'https://lh3.googleusercontent.com/a/newer=s96-c';
    fakeGoogle({ sub, email, emailVerified: true, picture: newer });
    await googleRoundTrip(app, newIp());
    expect(await identity.userImage(userId)).toBe(newer);
    // A picture from anywhere else (one day, an upload) is never replaced by Google's.
    const own = 'https://pictures.example/own.png';
    await testQuery(identityUrl, `update auth."user" set image = $2 where id = $1`, [userId, own]);
    await googleRoundTrip(app, newIp());
    expect(await identity.userImage(userId)).toBe(own);
  });

  it('saves no picture for a sign in held back for its second step: only one that stands does', async () => {
    const { app } = signInApp({ db, identity }, GOOGLE);
    const email = newEmail();
    const userId = randomUUID();
    await testQuery(
      identityUrl,
      `insert into auth."user" (id, name, email, email_verified, two_factor_enabled) values ($1, '', $2, true, true)`,
      [userId, email],
    );
    fakeGoogle({
      sub: randomUUID(),
      email,
      emailVerified: true,
      picture: 'https://lh3.googleusercontent.com/a/held=s96-c',
    });
    const held = await googleRoundTrip(app, newIp());
    expect(held.location).toBe(`${APP_URL}/two-factor`);
    expect(await identity.userImage(userId)).toBeUndefined();
  });

  it('serves the person’s own Google picture to Settings › Profile from our origin, to them alone', async () => {
    const { app } = signInApp({ db, identity }, GOOGLE);
    const email = newEmail();
    fakeGoogle({
      sub: randomUUID(),
      email,
      emailVerified: true,
      picture: 'https://lh3.googleusercontent.com/a/own=s96-c',
    });
    const { cookie } = await googleRoundTrip(app, newIp());
    const client = rpcClient(app, cookie);
    const { workspace } = await client.workspaces.create({
      id: newId(),
      name: 'Acme',
      slug: `picture-${randomUUID().slice(0, 8)}`,
      memberName: 'Grace',
    });
    const { image } = await client.profile.get({ workspace: workspace.slug });
    expect(image).toMatch(/^\/api\/me\/picture\?v=[0-9a-f]{12}$/);
    const get = (path: string, withCookie: boolean) =>
      app.fetch(
        new Request(`${APP_URL}${path}`, {
          headers: { ...(withCookie ? { cookie } : {}), 'x-forwarded-for': newIp(), [EDGE_HEADER]: TEST_EDGE_SECRET },
        }),
      );
    const own = await get(image ?? '', true);
    expect(own.status).toBe(200);
    expect(own.headers.get('content-type')).toBe('image/png');
    expect(own.headers.get('cache-control')).toBe('private, max-age=3600');
    expect(new Uint8Array(await own.arrayBuffer())).toEqual(PNG);
    // Signed out, or a version that isn't the current picture's: nothing.
    expect((await get(image ?? '', false)).status).toBe(401);
    expect((await get('/api/me/picture?v=000000000000', true)).status).toBe(404);
  });

  it('never fills a picture that isn’t https', async () => {
    const { app } = signInApp({ db, identity }, GOOGLE);
    const email = newEmail();
    const userId = randomUUID();
    await testQuery(
      identityUrl,
      `insert into auth."user" (id, name, email, email_verified) values ($1, '', $2, true)`,
      [userId, email],
    );
    fakeGoogle({ sub: randomUUID(), email, emailVerified: true, picture: 'http://lh3.googleusercontent.com/a/x' });
    await googleRoundTrip(app, newIp());
    expect(await identity.userImage(userId)).toBeUndefined();
  });
});

/** The picture rows kept beside held sign ins for `userId` (`2fa-picture-<pending>`), any expiry. */
async function pendingPictures(userId: string): Promise<readonly { identifier: string }[]> {
  return testQuery<{ identifier: string }>(
    identityUrl,
    `select identifier from auth.verification where identifier like '2fa-picture-%' and value like $1`,
    [`%"userId":"${userId}"%`],
  );
}

/** How many times Google was linked for `userId`, as the security history keeps it. */
async function linkedEvents(userId: string): Promise<number> {
  const rows = await testQuery<{ kind: string }>(
    identityUrl,
    `select kind from auth.security_event where user_id = $1 and kind = 'google_linked'`,
    [userId],
  );
  return rows.length;
}

/** Signs a new person in by email code with two factor on; answers their id, email and second factors. */
async function twoFactorPerson(app: App) {
  const { email, cookie } = await signIn(app);
  const { secret, backupCodes } = await turnOnTwoFactor(app, cookie);
  const userId = (await stored(email)).users[0]?.id ?? '';
  return { email, userId, secret, backupCodes };
}

describe('Google’s picture from a sign in held back for its second step (23 Oct 2026)', () => {
  it('reads a kept picture back only for the person it was kept for', () => {
    const ada = randomUUID();
    const kept = pendingPictureValue(ada, 'https://lh3.googleusercontent.com/a/p');
    expect(pendingPicture(kept, ada)).toBe('https://lh3.googleusercontent.com/a/p');
    expect(pendingPicture(kept, randomUUID())).toBeUndefined();
    for (const junk of ['', 'not json', 'null', '"x"', JSON.stringify({ userId: ada, picture: 7 })]) {
      expect(pendingPicture(junk, ada), junk).toBeUndefined();
    }
  });

  it('saves it once the second step stands, by an app code or a backup code', async () => {
    const { app } = signInApp({ db, identity }, GOOGLE);
    for (const method of ['totp', 'backup'] as const) {
      const { email, userId, secret, backupCodes } = await twoFactorPerson(app);
      const picture = `https://lh3.googleusercontent.com/a/held-${method}=s96-c`;
      fakeGoogle({ sub: randomUUID(), email, emailVerified: true, picture });
      const held = await googleRoundTrip(app, newIp());
      expect(held.location).toBe(`${APP_URL}/two-factor`);
      // Held back: nothing saved yet, the picture waits beside the pending sign in.
      expect(await identity.userImage(userId)).toBeUndefined();
      expect(await pendingPictures(userId)).toHaveLength(1);
      const passed =
        method === 'totp'
          ? await authPost(app, '/two-factor/verify-totp', { code: totpCode(secret) }, { cookie: held.cookie })
          : await authPost(app, '/two-factor/verify-backup-code', { code: backupCodes[0] }, { cookie: held.cookie });
      expect(passed.status).toBe(200);
      expect(await identity.userImage(userId)).toBe(picture);
      expect(await pendingPictures(userId)).toEqual([]);
      vi.unstubAllGlobals();
    }
  });

  it('saves nothing from a second step that failed (too many wrong codes), and drops what it kept', async () => {
    const { app } = signInApp({ db, identity }, GOOGLE);
    const { email, userId, secret } = await twoFactorPerson(app);
    fakeGoogle({ sub: randomUUID(), email, emailVerified: true, picture: 'https://lh3.googleusercontent.com/a/x' });
    const held = await googleRoundTrip(app, newIp());
    expect(held.location).toBe(`${APP_URL}/two-factor`);
    // A wrong code leaves the step open, and its picture with it.
    const wrong = await authPost(app, '/two-factor/verify-totp', { code: '000000' }, { cookie: held.cookie });
    expect(wrong.status).not.toBe(200);
    expect(await pendingPictures(userId)).toHaveLength(1);
    for (let tries = 1; tries < 5; tries += 1) {
      await authPost(app, '/two-factor/verify-totp', { code: '000000' }, { cookie: held.cookie });
    }
    // Out of tries: the step is over, so even the right code saves nothing.
    const late = await authPost(app, '/two-factor/verify-totp', { code: totpCode(secret) }, { cookie: held.cookie });
    expect(late.status).not.toBe(200);
    expect(await identity.userImage(userId)).toBeUndefined();
    expect(await pendingPictures(userId)).toEqual([]);
  });

  it('saves nothing from a second step that expired, and drops what it kept', async () => {
    const { app } = signInApp({ db, identity }, GOOGLE);
    const { email, userId, secret } = await twoFactorPerson(app);
    fakeGoogle({ sub: randomUUID(), email, emailVerified: true, picture: 'https://lh3.googleusercontent.com/a/y' });
    const held = await googleRoundTrip(app, newIp());
    const [kept] = await pendingPictures(userId);
    const pendingId = kept?.identifier.slice('2fa-picture-'.length) ?? '';
    // The 5 minutes pass: the pending sign in, its tries and its picture all expire together.
    await testQuery(
      identityUrl,
      `update auth.verification set expires_at = now() - interval '1 minute' where identifier = any($1)`,
      [[pendingId, `2fa-attempts-${pendingId}`, `2fa-picture-${pendingId}`]],
    );
    const late = await authPost(app, '/two-factor/verify-totp', { code: totpCode(secret) }, { cookie: held.cookie });
    expect(late.status).not.toBe(200);
    expect(await identity.userImage(userId)).toBeUndefined();
    expect(await pendingPictures(userId)).toEqual([]);
  });
});

describe('Sync Google photo, Settings › Profile (23 Oct 2026)', () => {
  /** A Profile page's address on the app's origin. */
  const profileOf = (slug: string) => new URL(`/w/${slug}/settings/account/profile`, APP_URL).href;

  /** A signed in person with a workspace (Profile is per workspace); answers their client and Profile's address. */
  async function profilePerson(app: App) {
    const { email, cookie } = await signIn(app);
    const client = rpcClient(app, cookie);
    const slug = `photo-${randomUUID().slice(0, 8)}`;
    await client.workspaces.create({ id: newId(), name: 'Acme', slug, memberName: 'Grace' });
    const userId = (await stored(email)).users[0]?.id ?? '';
    return { email, cookie, client, slug, userId, profile: profileOf(slug) };
  }

  /** The button's round trip: `/link-social` from Profile, then Google back to the callback. Answers where it went. */
  async function syncRoundTrip(app: App, cookie: string, profile: string, google: string = 'code=fake-code') {
    const ip = newIp();
    const started = await authPost(
      app,
      '/link-social',
      { provider: 'google', callbackURL: profile, errorCallbackURL: profile },
      { cookie, 'x-forwarded-for': ip },
    );
    expect(started.status).toBe(200);
    const { url } = (await started.json()) as { url: string };
    const state = new URL(url).searchParams.get('state') ?? '';
    const callback = await app.fetch(
      new Request(`${APP_URL}/api/auth/callback/google?${google}&state=${state}`, {
        headers: {
          cookie: withCookies(cookie, cookieFrom(started)),
          'x-forwarded-for': ip,
          [EDGE_HEADER]: TEST_EDGE_SECRET,
          [ORIGIN_HEADER]: APP_URL,
        },
      }),
    );
    expect(callback.status).toBe(302);
    return callback.headers.get('location') ?? '';
  }

  it('links Google to an email code account and saves its photo, then takes a newer one with a new version', async () => {
    const { app } = signInApp({ db, identity }, GOOGLE);
    const { email, cookie, client, slug, userId, profile } = await profilePerson(app);
    expect(await client.profile.get({ workspace: slug })).toMatchObject({ google: 'unlinked' });
    expect((await client.profile.get({ workspace: slug })).image).toBeUndefined();
    const sub = randomUUID();
    const picture = 'https://lh3.googleusercontent.com/a/synced=s96-c';
    fakeGoogle({ sub, email, emailVerified: true, picture });
    expect(await syncRoundTrip(app, cookie, profile)).toBe(`${profile}?google-photo=synced`);
    expect(await identity.userImage(userId)).toBe(picture);
    expect((await stored(email)).accounts).toEqual([{ user_id: userId, account_id: sub }]);
    // A new way to sign in, kept in the security history once.
    expect(await linkedEvents(userId)).toBe(1);
    const first = await client.profile.get({ workspace: slug });
    expect(first).toMatchObject({ google: 'linked' });
    expect(first.image).toMatch(/^\/api\/me\/picture\?v=[0-9a-f]{12}$/);
    // Changed at Google: synced again, the account takes it, and its path's version changes past any cache.
    vi.unstubAllGlobals();
    const newer = 'https://lh3.googleusercontent.com/a/newer-synced=s96-c';
    fakeGoogle({ sub, email, emailVerified: true, picture: newer });
    expect(await syncRoundTrip(app, cookie, profile)).toBe(`${profile}?google-photo=synced`);
    expect(await identity.userImage(userId)).toBe(newer);
    const second = await client.profile.get({ workspace: slug });
    expect(second.image).toMatch(/^\/api\/me\/picture\?v=[0-9a-f]{12}$/);
    expect(second.image).not.toBe(first.image);
    // The same photo again is still synced: it is the one on the profile.
    expect(await syncRoundTrip(app, cookie, profile)).toBe(`${profile}?google-photo=synced`);
    expect((await stored(email)).accounts).toHaveLength(1);
    // Refreshing a link that was there is no new way to sign in.
    expect(await linkedEvents(userId)).toBe(1);
  });

  it('says so when Google sends no photo, the person closes Google, or the account isn’t theirs, changing nothing', async () => {
    const { app } = signInApp({ db, identity }, GOOGLE);
    const { email, cookie, userId, profile } = await profilePerson(app);
    fakeGoogle({ sub: randomUUID(), email, emailVerified: true });
    expect(await syncRoundTrip(app, cookie, profile)).toBe(`${profile}?google-photo=none`);
    vi.unstubAllGlobals();
    fakeGoogle({
      sub: randomUUID(),
      email: newEmail(),
      emailVerified: true,
      picture: 'https://lh3.googleusercontent.com/a/z',
    });
    expect(await syncRoundTrip(app, cookie, profile)).toBe(`${profile}?google-photo=other-email`);
    expect(await syncRoundTrip(app, cookie, profile, 'error=access_denied')).toBe(`${profile}?google-photo=cancelled`);
    expect(await identity.userImage(userId)).toBeUndefined();
    // A picture from anywhere but Google's picture hosts is never saved.
    vi.unstubAllGlobals();
    fakeGoogle({ sub: randomUUID(), email, emailVerified: true, picture: 'https://pictures.example/me.png' });
    expect(await syncRoundTrip(app, cookie, profile)).toBe(`${profile}?google-photo=none`);
    expect(await identity.userImage(userId)).toBeUndefined();
  });

  it('finds the photo when the id token leaves it out: Google’s userinfo for the link’s own token', async () => {
    const { app } = signInApp({ db, identity }, GOOGLE);
    const { email, cookie, userId, profile } = await profilePerson(app);
    const picture = 'https://lh3.googleusercontent.com/a/userinfo-only=s96-c';
    const google = fakeGoogle({ sub: randomUUID(), email, emailVerified: true, picture, pictureInIdToken: false });
    expect(await syncRoundTrip(app, cookie, profile)).toBe(`${profile}?google-photo=synced`);
    expect(await identity.userImage(userId)).toBe(picture);
    // The token Better Auth stored (encrypted) was read back and sent as Google handed it out.
    expect(google.userinfoCalls()).toBe(1);
  });

  it('saves nothing when userinfo names a picture that isn’t Google’s', async () => {
    const { app } = signInApp({ db, identity }, GOOGLE);
    const { email, cookie, userId, profile } = await profilePerson(app);
    const google = fakeGoogle({
      sub: randomUUID(),
      email,
      emailVerified: true,
      picture: 'https://pictures.example/me.png',
      pictureInIdToken: false,
    });
    expect(await syncRoundTrip(app, cookie, profile)).toBe(`${profile}?google-photo=none`);
    expect(google.userinfoCalls()).toBe(1);
    expect(await identity.userImage(userId)).toBeUndefined();
  });

  it('asks userinfo nothing when the request already names the photo', async () => {
    const { app } = signInApp({ db, identity }, GOOGLE);
    const { email, cookie, profile } = await profilePerson(app);
    const google = fakeGoogle({
      sub: randomUUID(),
      email,
      emailVerified: true,
      picture: 'https://lh3.googleusercontent.com/a/in-token=s96-c',
    });
    expect(await syncRoundTrip(app, cookie, profile)).toBe(`${profile}?google-photo=synced`);
    expect(google.userinfoCalls()).toBe(0);
  });

  it('reads a stored id token’s picture claim, and nothing from a token that isn’t one', () => {
    const picture = 'https://lh3.googleusercontent.com/a/claim=s96-c';
    expect(idTokenPicture(idToken({ sub: 's', email: 'a@b.test', emailVerified: true, picture }))).toBe(picture);
    expect(idTokenPicture(idToken({ sub: 's', email: 'a@b.test', emailVerified: true }))).toBeUndefined();
    expect(idTokenPicture(undefined)).toBeUndefined();
    expect(idTokenPicture('not-a-token')).toBeUndefined();
    expect(idTokenPicture('a.%%%.c')).toBeUndefined();
  });

  it('refuses a Google account another person signs in with, changing neither picture', async () => {
    const { app } = signInApp({ db, identity }, GOOGLE);
    const sub = randomUUID();
    const theirs = 'https://lh3.googleusercontent.com/a/theirs=s96-c';
    const other = newEmail();
    fakeGoogle({ sub, email: other, emailVerified: true, picture: theirs });
    await googleRoundTrip(app, newIp());
    const otherId = (await stored(other)).users[0]?.id ?? '';
    vi.unstubAllGlobals();
    const { email, cookie, userId, profile } = await profilePerson(app);
    const google = fakeGoogle({
      sub,
      email,
      emailVerified: true,
      picture: 'https://lh3.googleusercontent.com/a/mine=s96-c',
    });
    expect(await syncRoundTrip(app, cookie, profile)).toBe(`${profile}?google-photo=other-account`);
    expect(await identity.userImage(userId)).toBeUndefined();
    expect(await identity.userImage(otherId)).toBe(theirs);
    expect(await linkedEvents(userId)).toBe(0);
    // A refused link reads no one's stored token.
    expect(google.userinfoCalls()).toBe(0);
  });

  it('never takes a sign in’s own data for the photo link: only the server marks one', async () => {
    const { app } = signInApp({ db, identity }, GOOGLE);
    const victim = await profilePerson(app);
    const email = newEmail();
    fakeGoogle({
      sub: randomUUID(),
      email,
      emailVerified: true,
      picture: 'https://lh3.googleusercontent.com/a/forged',
    });
    const ip = newIp();
    const started = await authPost(
      app,
      '/sign-in/social',
      {
        provider: 'google',
        callbackURL: victim.profile,
        additionalData: {
          link: { userId: victim.userId, email: victim.email },
          serverContext: { crmPurpose: 'google-photo', crmWasLinked: false },
        },
      },
      { 'x-forwarded-for': ip },
    );
    expect(started.status).toBe(200);
    const { url } = (await started.json()) as { url: string };
    const state = new URL(url).searchParams.get('state') ?? '';
    const callback = await app.fetch(
      new Request(`${APP_URL}/api/auth/callback/google?code=fake-code&state=${state}`, {
        headers: {
          cookie: cookieFrom(started),
          'x-forwarded-for': ip,
          [EDGE_HEADER]: TEST_EDGE_SECRET,
          [ORIGIN_HEADER]: APP_URL,
        },
      }),
    );
    // A plain sign in of the Google account's own person, back where it asked, with no result and nothing linked.
    expect(callback.headers.get('location')).toBe(victim.profile);
    expect(await identity.userImage(victim.userId)).toBeUndefined();
    expect((await stored(victim.email)).accounts).toEqual([]);
    expect(await linkedEvents(victim.userId)).toBe(0);
  });

  it('keeps a picture that isn’t Google’s', async () => {
    const { app } = signInApp({ db, identity }, GOOGLE);
    const { email, cookie, userId, profile } = await profilePerson(app);
    const own = 'https://pictures.example/own.png';
    await testQuery(identityUrl, `update auth."user" set image = $2 where id = $1`, [userId, own]);
    fakeGoogle({ sub: randomUUID(), email, emailVerified: true, picture: 'https://lh3.googleusercontent.com/a/k' });
    expect(await syncRoundTrip(app, cookie, profile)).toBe(`${profile}?google-photo=kept`);
    expect(await identity.userImage(userId)).toBe(own);
  });

  it('starts only from Profile, for Google, signed in, with nothing else linking takes', async () => {
    const { app } = signInApp({ db, identity }, GOOGLE);
    const { cookie, profile } = await profilePerson(app);
    const start = (body: unknown, withCookie = true) =>
      authPost(app, '/link-social', body, { ...(withCookie ? { cookie } : {}), 'x-forwarded-for': newIp() });
    const base = { provider: 'google', callbackURL: profile, errorCallbackURL: profile };
    for (const body of [
      { ...base, callbackURL: 'https://elsewhere.test/w/acme/settings/account/profile' },
      { ...base, callbackURL: `${APP_URL}/w/acme/settings/account/sessions` },
      { ...base, callbackURL: `${profile}?next=/x` },
      { ...base, errorCallbackURL: `${APP_URL}/sign-in` },
      { ...base, scopes: ['https://www.googleapis.com/auth/drive'] },
      { ...base, idToken: { token: 'x' } },
      { ...base, requestSignUp: true },
      { ...base, additionalData: { purpose: 'x' } },
      { ...base, provider: 'github' },
      { ...base, loginHint: 'someone@example.com' },
      { ...base, additionalParams: { prompt: 'none' } },
      { ...base, newUserCallbackURL: `${APP_URL}/welcome` },
    ]) {
      const refused = await start(body);
      expect(refused.status, JSON.stringify(body)).toBe(400);
      expect(await refused.json()).toMatchObject({ code: 'INPUT_INVALID' });
    }
    expect((await start(base, false)).status).toBe(401);
  });
});
