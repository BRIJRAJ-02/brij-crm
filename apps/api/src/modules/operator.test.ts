// The operator console's gate and reads (spec 0047): NOT_FOUND to anyone off
// OPERATOR_EMAILS, two factor and a recent sign in for those on it, one log row
// per read, and the reads themselves; the marketing site's beacon; and a
// booking page's view is counted in public/booking.test.ts.
import { randomUUID } from 'node:crypto';
import { ORPCError } from '@orpc/client';
import type { Database, IdentityStore } from '@crm/db';
import { testQuery } from '@crm/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { newEmail, rpcClient, signIn, signInApp, testConnections, turnOnTwoFactor } from '../../test/sign-in.ts';
import { totpCode } from '../auth/two-factor.ts';
import { APP_URL, TEST_EDGE_SECRET } from '../testing.ts';
import { EDGE_HEADER } from '../edge.ts';

const { identityUrl } = inject('testDatabase');
const SITE = 'https://site.test';
const OPERATOR = newEmail();
const UNVERIFIED = newEmail();
const CHROME =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

let db: Database;
let identity: IdentityStore;
let app: ReturnType<typeof signInApp>['app'];

beforeAll(() => {
  ({ db, identity } = testConnections());
  ({ app } = signInApp({ db, identity }, { OPERATOR_EMAILS: [OPERATOR, UNVERIFIED], SITE_ORIGINS: [SITE] }));
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

/** The operator, signed in with two factor on, this session proven with the app (a step up): a fresh session. */
async function operatorCookie(): Promise<string> {
  const { cookie } = await signIn(app, OPERATOR);
  const { cookie: withApp, secret } = await turnOnTwoFactor(app, cookie);
  await rpcClient(app, withApp).account.stepUp.verify({ method: 'totp', code: totpCode(secret) });
  return withApp;
}

let operator: string | undefined;
const asOperator = async () => (operator ??= await operatorCookie());

describe('the operator gate (AC-1617 to AC-1620)', () => {
  it('answers NOT_FOUND to a person not on the list, and tells the menu no', async () => {
    const { cookie } = await signIn(app);
    const client = rpcClient(app, cookie);
    expect((await client.me.get()).isOperator).toBe(false);
    const id = randomUUID();
    for (const call of [
      () => client.operator.overview({ period: '30d' }),
      () => client.operator.users({ period: '30d' }),
      () => client.operator.user({ userId: id, period: '30d' }),
      () => client.operator.pages({ period: '30d' }),
      () => client.operator.page({ pageId: id, period: '30d' }),
      () => client.operator.site({ period: '30d' }),
    ]) {
      expect((await failure(call)).code).toBe('NOT_FOUND');
    }
    expect((await failure(() => rpcClient(app).operator.overview({ period: '30d' }))).code).toBe('UNAUTHENTICATED');
  });

  it('answers NOT_FOUND to a listed address that is not verified', async () => {
    const { cookie } = await signIn(app, UNVERIFIED);
    const client = rpcClient(app, cookie);
    const me = (await client.me.get()).user.id;
    await testQuery(identityUrl, 'update auth.user set email_verified = false where id = $1', [me]);
    expect((await client.me.get()).isOperator).toBe(false);
    expect((await failure(() => client.operator.overview({ period: '30d' }))).code).toBe('NOT_FOUND');
  });

  it('asks a listed person for two factor first, then lets them in and logs each read', async () => {
    const { cookie } = await signIn(app, OPERATOR);
    const client = rpcClient(app, cookie);
    expect((await client.me.get()).isOperator).toBe(true);
    expect((await failure(() => client.operator.overview({ period: '7d' }))).code).toBe('TWO_FACTOR_REQUIRED');

    const signedIn = rpcClient(app, await asOperator());
    const overview = await signedIn.operator.overview({ period: '7d' });
    expect(overview.days).toHaveLength(7);
    expect(overview.people.total).toBeGreaterThan(0);
    expect(overview.active.today).toBeGreaterThan(0);
    const me = (await signedIn.me.get()).user.id;
    const logged = await testQuery<{ action: string; period: string }>(
      identityUrl,
      `select action, period from auth.operator_event where user_id = $1 order by at`,
      [me],
    );
    expect(logged.map((row) => row.action)).toContain('operator.overview');
    expect(logged.at(-1)).toEqual({ action: 'operator.overview', period: '7d' });
  });

  it('asks for a sign in again once the session last proved itself over 12 hours ago', async () => {
    const client = rpcClient(app, await asOperator());
    const me = (await client.me.get()).user.id;
    const setProof = (age: string) =>
      testQuery(identityUrl, `update auth.session set verified_at = now() - $2::interval where user_id = $1`, [
        me,
        age,
      ]);
    await setProof('13 hours');
    expect((await failure(() => client.operator.overview({ period: '7d' }))).code).toBe('SIGN_IN_AGAIN');
    await setProof('0 hours');
    expect((await client.operator.overview({ period: '7d' })).days).toHaveLength(7);
    // A remembered device (or an email code step up) proved it without the app: not enough here.
    await testQuery(identityUrl, `update auth.session set verified_with = 'email' where user_id = $1`, [me]);
    expect((await failure(() => client.operator.overview({ period: '7d' }))).code).toBe('SIGN_IN_AGAIN');
    await testQuery(identityUrl, `update auth.session set verified_with = 'second_factor' where user_id = $1`, [me]);
  });

  it('reads nothing when the log row cannot be written (AC-1620)', async () => {
    const broken = signInApp(
      { db, identity: { ...identity, logOperatorEvent: () => Promise.reject(new Error('The log is down.')) } },
      { OPERATOR_EMAILS: [OPERATOR] },
    ).app;
    const client = rpcClient(broken, await asOperator());
    expect((await failure(() => client.operator.overview({ period: '7d' }))).code).toBe('INTERNAL');
  });
});

describe('the reads (AC-1629 to AC-1632)', () => {
  it('lists people by pages and finds one, with their page', async () => {
    const client = rpcClient(app, await asOperator());
    const first = await client.operator.users({ period: '30d' });
    expect(first.users.length).toBeGreaterThan(0);
    const found = await client.operator.users({ period: '30d', q: OPERATOR });
    expect(found.users.map((user) => user.email)).toEqual([OPERATOR]);
    // Who looked whom up: the search is in the log.
    const searched = await testQuery<{ q: string }>(
      identityUrl,
      `select q from auth.operator_event where action = 'operator.users' and q is not null order by at desc limit 1`,
    );
    expect(searched).toEqual([{ q: OPERATOR }]);
    const [row] = found.users;
    if (row === undefined) throw new Error('No row.');
    expect(row).toMatchObject({ twoFactor: true, activeDays: 1 });
    const detail = await client.operator.user({ userId: row.id, period: '7d' });
    expect(detail.user).toMatchObject({ email: OPERATOR, methods: ['email'], twoFactor: true });
    expect(detail.days).toHaveLength(7);
    expect(detail.days.at(-1)).toMatchObject({ active: true });
    expect((await failure(() => client.operator.user({ userId: randomUUID(), period: '7d' }))).code).toBe('NOT_FOUND');
  });

  it('reads booking pages and the website, and refuses a page that is not there', async () => {
    const client = rpcClient(app, await asOperator());
    const pages = await client.operator.pages({ period: '30d' });
    expect(pages.days).toHaveLength(30);
    expect(pages.totals.views.value).toBeGreaterThanOrEqual(0);
    expect((await failure(() => client.operator.page({ pageId: randomUUID(), period: '7d' }))).code).toBe('NOT_FOUND');
    const site = await client.operator.site({ period: '90d' });
    expect(site.days).toHaveLength(90);
  });
});

/** A beacon as a browser on `origin` sends it. */
function hit(body: string, headers: Record<string, string> = {}) {
  return Promise.resolve(
    app.fetch(
      new Request(`${APP_URL}/api/public/site/hit`, {
        method: 'POST',
        headers: {
          origin: SITE,
          'content-type': 'text/plain;charset=UTF-8',
          'user-agent': CHROME,
          [EDGE_HEADER]: TEST_EDGE_SECRET,
          'x-forwarded-for': `10.9.${String(Math.floor(Math.random() * 250))}.1`,
          ...headers,
        },
        body,
      }),
    ),
  );
}

describe('the marketing site beacon (AC-1627)', () => {
  it('keeps a page shown, its path without the query, the referrer host and the source', async () => {
    const path = `/p-${randomUUID().slice(0, 8)}`;
    const answered = await hit(
      JSON.stringify({ path: `${path}?email=ada@example.com`, referrer: 'www.Google.com', source: 'Newsletter' }),
    );
    expect(answered.status).toBe(204);
    await new Promise((resolve) => setTimeout(resolve, 200));
    const rows = await testQuery<Record<string, unknown>>(
      identityUrl,
      `select site, path, referrer, source, device, length(visitor) as visitor from auth.site_visit where path = $1`,
      [path],
    );
    expect(rows).toEqual([
      { site: 'site.test', path, referrer: 'google.com', source: 'newsletter', device: 'desktop', visitor: 32 },
    ]);
  });

  it('refuses another origin, and drops a bot or a malformed body without keeping anything', async () => {
    expect((await hit(JSON.stringify({ path: '/' }), { origin: 'https://evil.test' })).status).toBe(403);
    const path = `/bot-${randomUUID().slice(0, 8)}`;
    expect((await hit(JSON.stringify({ path }), { 'user-agent': 'Googlebot/2.1' })).status).toBe(204);
    expect((await hit('not json')).status).toBe(204);
    expect((await hit(JSON.stringify({ path: 'no-slash' }))).status).toBe(204);
    await new Promise((resolve) => setTimeout(resolve, 200));
    const rows = await testQuery(identityUrl, `select 1 from auth.site_visit where path = $1`, [path]);
    expect(rows).toEqual([]);
  });
});
