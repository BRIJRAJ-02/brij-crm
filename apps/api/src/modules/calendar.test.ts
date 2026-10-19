// Calendar sync in the API (spec 0024, milestone 1), with the fake provider
// standing in for Google: the connect routes (the signed state, the cookie
// that makes it single use and bound to the browser, the member check, every
// result Settings › Calendar is told), the first sync queued, and the
// `calendar.*` procedures behind the member door, with calendar sync off too.
import { newId } from '@crm/core';
import { createFakeCalendarProvider } from '@crm/core/testing';
import type { Database, IdentityStore } from '@crm/db';
import { testQuery } from '@crm/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { rpcClient, signIn, signInApp, testConnections } from '../../test/sign-in.ts';
import { failure, memberWithWorkspace } from '../../test/workspace.ts';
import { STATE_COOKIE } from '../calendar/routes.ts';
import { createCalendarServices, GOOGLE_CALLBACK_PATH } from '../calendar/services.ts';
import { EDGE_HEADER, ORIGIN_HEADER } from '../edge.ts';
import { APP_URL, TEST_EDGE_SECRET } from '../testing.ts';
import { decodeTokenKey } from '@crm/core';

const { ownerUrl } = inject('testDatabase');
let db: Database;
let identity: IdentityStore;
const fake = createFakeCalendarProvider();
const calendar = createCalendarServices(
  {
    clientId: 'test-client',
    clientSecret: 'test-secret',
    tokenKey: decodeTokenKey(Buffer.alloc(32, 5).toString('base64')),
    webhookOrigin: undefined,
  },
  APP_URL,
  fake.provider,
);
let pokes = 0;
let app: ReturnType<typeof signInApp>['app'];
let off: ReturnType<typeof signInApp>['app'];

beforeAll(() => {
  ({ db, identity } = testConnections());
  ({ app } = signInApp({ db, identity }, {}, { calendar, wakeRelay: () => (pokes += 1) }));
  ({ app: off } = signInApp({ db, identity }));
});
afterAll(async () => {
  await identity.close();
  await db.close();
});

/** A browser navigation: a GET through the edge with these cookies, redirects left to the caller. */
function navigate(target: ReturnType<typeof signInApp>['app'], path: string, cookie = ''): Promise<Response> {
  return Promise.resolve(
    target.fetch(
      new Request(`${APP_URL}${path}`, {
        headers: { [EDGE_HEADER]: TEST_EDGE_SECRET, [ORIGIN_HEADER]: APP_URL, ...(cookie === '' ? {} : { cookie }) },
        redirect: 'manual',
      }),
    ),
  );
}

/** The state cookie a start set, as a browser sends it back. */
function stateCookie(response: Response): string {
  const cookie = response.headers.getSetCookie().find((each) => each.startsWith(`${STATE_COOKIE}=`)) ?? '';
  return cookie.split(';')[0] ?? '';
}

/** Starts a connect as `cookie`'s member of `slug`: Google's address (the fake's), and the browser's state cookie. */
async function start(slug: string, cookie: string) {
  const response = await navigate(app, `/api/calendar/google/start?workspace=${slug}`, cookie);
  expect(response.status).toBe(302);
  const location = new URL(response.headers.get('location') ?? '');
  return { location, state: location.searchParams.get('state') ?? '', browser: stateCookie(response), response };
}

/** Where a callback sent the browser, as Settings › Calendar reads it. */
function resultOf(response: Response): string | null {
  return new URL(response.headers.get('location') ?? '').searchParams.get('calendar');
}

describe('connecting a Google calendar (AC-597)', () => {
  it('sends a member to consent with a signed state, and back connected, the first sync queued', async () => {
    const m = await memberWithWorkspace(app);
    const { location, state, browser, response } = await start(m.slug, m.cookie);
    expect(location.origin).toBe('https://calendar.fake');
    expect(location.searchParams.get('redirect_uri')).toBe(`${APP_URL}${GOOGLE_CALLBACK_PATH}`);
    expect(state).toMatch(/^cs1\./);
    const set = response.headers.getSetCookie().find((each) => each.startsWith(`${STATE_COOKIE}=`)) ?? '';
    expect(set).toMatch(/HttpOnly/i);
    expect(set).toMatch(/Path=\/api\/calendar\//);

    const before = pokes;
    const back = await navigate(
      app,
      `${GOOGLE_CALLBACK_PATH}?code=${encodeURIComponent('code:ada@acme.dev')}&state=${encodeURIComponent(state)}`,
      `${m.cookie}; ${browser}`,
    );
    expect(back.status).toBe(302);
    expect(back.headers.get('location')).toBe(`${APP_URL}/w/${m.slug}/settings/calendar?calendar=connected`);
    // The cookie is spent.
    expect(back.headers.getSetCookie().some((each) => each.startsWith(`${STATE_COOKIE}=;`))).toBe(true);
    expect(pokes).toBe(before + 1);

    const listed = await m.client.calendar.connections.list({ workspace: m.slug });
    expect(listed).toMatchObject({ enabled: true, providers: ['google'], max: 3 });
    expect(listed.connections).toEqual([
      expect.objectContaining({ accountEmail: 'ada@acme.dev', status: 'syncing', sharing: 'shared', isDefault: true }),
    ]);
    const id = listed.connections[0]?.id ?? '';
    const queued = await testQuery<{ task: string }>(
      ownerUrl,
      `select task_identifier as task from graphile_worker.jobs where key = $1`,
      [`crm-calendar:${m.workspace.id}:${id}`],
    );
    expect(queued).toEqual([{ task: 'crm_calendar_sync' }]);

    // The same callback again (its cookie spent) connects nothing.
    const replay = await navigate(
      app,
      `${GOOGLE_CALLBACK_PATH}?code=${encodeURIComponent('code:other@acme.dev')}&state=${encodeURIComponent(state)}`,
      m.cookie,
    );
    expect(resultOf(replay)).toBe('failed');
    expect((await m.client.calendar.connections.list({ workspace: m.slug })).connections).toHaveLength(1);
  });

  it('refuses a state from another browser, another member, or a forged one, and says when the member declined', async () => {
    const m = await memberWithWorkspace(app);
    const { state, browser } = await start(m.slug, m.cookie);
    const code = encodeURIComponent('code:ada@acme.dev');
    // Someone else's browser (their session, no state cookie of this connect) gets nothing.
    const other = await signIn(app);
    const elsewhere = await navigate(
      app,
      `${GOOGLE_CALLBACK_PATH}?code=${code}&state=${encodeURIComponent(state)}`,
      other.cookie,
    );
    expect(resultOf(elsewhere)).toBe('failed');
    // The right cookie but another person signed in: the state was for the member who started.
    const swapped = await navigate(
      app,
      `${GOOGLE_CALLBACK_PATH}?code=${code}&state=${encodeURIComponent(state)}`,
      `${other.cookie}; ${browser}`,
    );
    expect(resultOf(swapped)).toBe('failed');
    // A forged state.
    const forged = await navigate(
      app,
      `${GOOGLE_CALLBACK_PATH}?code=${code}&state=cs1.e30.AAAA`,
      `${m.cookie}; ${browser}`,
    );
    expect(resultOf(forged)).toBe('failed');
    expect((await m.client.calendar.connections.list({ workspace: m.slug })).connections).toEqual([]);

    const again = await start(m.slug, m.cookie);
    const declined = await navigate(
      app,
      `${GOOGLE_CALLBACK_PATH}?error=access_denied&state=${encodeURIComponent(again.state)}`,
      `${m.cookie}; ${again.browser}`,
    );
    expect(resultOf(declined)).toBe('denied');
  });

  it('says when a permission was unticked or the limit reached, and sends the signed out to sign in', async () => {
    const m = await memberWithWorkspace(app);
    const connect = async (account: string) => {
      const { state, browser } = await start(m.slug, m.cookie);
      return navigate(
        app,
        `${GOOGLE_CALLBACK_PATH}?code=${encodeURIComponent(`code:${account}`)}&state=${encodeURIComponent(state)}`,
        `${m.cookie}; ${browser}`,
      );
    };
    fake.failNext('exchangeCode', 'CALENDAR_SCOPE_DECLINED');
    expect(resultOf(await connect('ada@acme.dev'))).toBe('scope');
    for (const account of ['a@acme.dev', 'b@acme.dev', 'c@acme.dev']) {
      expect(resultOf(await connect(account))).toBe('connected');
    }
    expect(resultOf(await connect('d@acme.dev'))).toBe('limit');

    const signedOut = await navigate(app, `/api/calendar/google/start?workspace=${m.slug}`);
    expect(signedOut.headers.get('location')).toBe(
      `${APP_URL}/sign-in?redirect=${encodeURIComponent(`/w/${m.slug}/settings/calendar`)}`,
    );
  });

  it('says calendar sync is off where it isn’t set up, and lists no providers', async () => {
    const m = await memberWithWorkspace(off);
    const response = await navigate(off, `/api/calendar/google/start?workspace=${m.slug}`, m.cookie);
    expect(response.headers.get('location')).toBe(`${APP_URL}/w/${m.slug}/settings/calendar?calendar=off`);
    expect(await m.client.calendar.connections.list({ workspace: m.slug })).toEqual({
      enabled: false,
      providers: [],
      connections: [],
      max: 3,
    });
  });
});

describe('the calendar procedures (AC-599, AC-611)', () => {
  it('changes and removes only the member’s own connections, and pages a record’s meetings through the door', async () => {
    const m = await memberWithWorkspace(app);
    const { state, browser } = await start(m.slug, m.cookie);
    await navigate(
      app,
      `${GOOGLE_CALLBACK_PATH}?code=${encodeURIComponent('code:ada@acme.dev')}&state=${encodeURIComponent(state)}`,
      `${m.cookie}; ${browser}`,
    );
    const [connection] = (await m.client.calendar.connections.list({ workspace: m.slug })).connections;
    const id = connection?.id ?? '';
    const updated = await m.client.calendar.connections.update({
      workspace: m.slug,
      connectionId: id,
      sharing: 'private',
      mutationId: newId(),
    });
    expect(updated).toMatchObject({ id, sharing: 'private', isDefault: true });
    expect(updated).not.toHaveProperty('tokens');

    // Another workspace's member finds no such connection.
    const other = await memberWithWorkspace(app);
    const theirs = await failure(() =>
      other.client.calendar.connections.remove({ workspace: other.slug, connectionId: id, mutationId: newId() }),
    );
    expect(theirs.code).toBe('NOT_FOUND');

    const person = newId();
    await m.client.records.create({
      workspace: m.slug,
      objectId: m.people.id,
      id: person,
      values: { [m.attribute('name')]: { firstName: 'Bea' } },
      mutationId: newId(),
    });
    expect(await m.client.calendar.meetings.forRecord({ workspace: m.slug, recordId: person })).toEqual({ items: [] });
    const unknown = await failure(() => m.client.calendar.meetings.forRecord({ workspace: m.slug, recordId: newId() }));
    expect(unknown.code).toBe('NOT_FOUND');

    expect(
      await m.client.calendar.connections.remove({ workspace: m.slug, connectionId: id, mutationId: newId() }),
    ).toEqual({ connectionId: id, meetingsRemoved: 0 });
    expect((await m.client.calendar.connections.list({ workspace: m.slug })).connections).toEqual([]);
  });

  it('refuses a signed out caller', async () => {
    const m = await memberWithWorkspace(app);
    const error = await failure(() => rpcClient(app).calendar.connections.list({ workspace: m.slug }));
    expect(error.code).toBe('UNAUTHENTICATED');
  });
});
