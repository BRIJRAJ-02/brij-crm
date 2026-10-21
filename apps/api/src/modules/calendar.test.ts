// Calendar sync in the API (spec 0024, milestone 1), with the fake provider
// standing in for Google: the connect routes (the signed state, the cookie
// that makes it single use and bound to the browser, the member check, every
// result Settings › Calendar is told), the first sync queued, and the
// `calendar.*` procedures behind the member door, with calendar sync off too.
// Milestone 2: Google's change notice (no Origin, the channel's token its only
// key), Add as person and the workspace's calendar settings.
import { createHash } from 'node:crypto';
import { newId } from '@crm/core';
import { createFakeCalendarProvider } from '@crm/core/testing';
import type { Database, IdentityStore } from '@crm/db';
import { testQuery } from '@crm/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { rpcClient, signIn, signInApp, testConnections } from '../../test/sign-in.ts';
import { failure, memberWithWorkspace } from '../../test/workspace.ts';
import { STATE_COOKIE } from '../calendar/routes.ts';
import { createCalendarServices, GOOGLE_CALLBACK_PATH, MICROSOFT_CALLBACK_PATH } from '../calendar/services.ts';
import { EDGE_HEADER, ORIGIN_HEADER } from '../edge.ts';
import { APP_URL, TEST_EDGE_SECRET } from '../testing.ts';
import { decodeTokenKey } from '@crm/core';

const { ownerUrl } = inject('testDatabase');
let db: Database;
let identity: IdentityStore;
const fake = createFakeCalendarProvider();
// Outlook's adapter in these tests: the same fake, standing in for Graph.
const outlookFake = createFakeCalendarProvider({ noVideo: true });
const outlook = createCalendarServices(
  {
    clientId: 'test-client',
    clientSecret: 'test-secret',
    tokenKey: decodeTokenKey(Buffer.alloc(32, 5).toString('base64')),
    webhookOrigin: undefined,
    microsoft: { clientId: 'app', clientSecret: 'app-secret', tenant: 'common' },
  },
  APP_URL,
  fake.provider,
  undefined,
  outlookFake.provider,
);
const calendar = createCalendarServices(
  {
    clientId: 'test-client',
    clientSecret: 'test-secret',
    tokenKey: decodeTokenKey(Buffer.alloc(32, 5).toString('base64')),
    webhookOrigin: undefined,
    microsoft: undefined,
  },
  APP_URL,
  fake.provider,
);
let pokes = 0;
let app: ReturnType<typeof signInApp>['app'];
let off: ReturnType<typeof signInApp>['app'];
let withOutlook: ReturnType<typeof signInApp>['app'];

beforeAll(() => {
  ({ db, identity } = testConnections());
  ({ app } = signInApp({ db, identity }, {}, { calendar, wakeRelay: () => (pokes += 1) }));
  ({ app: withOutlook } = signInApp({ db, identity }, {}, { calendar: outlook, wakeRelay: () => (pokes += 1) }));
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
    expect(listed).toMatchObject({ enabled: true, providers: ['google'], max: 6 });
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
    for (const account of ['a@acme.dev', 'b@acme.dev', 'c@acme.dev', 'd@acme.dev', 'e@acme.dev', 'f@acme.dev']) {
      expect(resultOf(await connect(account))).toBe('connected');
    }
    expect(resultOf(await connect('g@acme.dev'))).toBe('limit');

    const signedOut = await navigate(app, `/api/calendar/google/start?workspace=${m.slug}`);
    expect(signedOut.headers.get('location')).toBe(
      `${APP_URL}/sign-in?redirect=${encodeURIComponent(`/w/${m.slug}/settings/calendar`)}`,
    );
  });

  it('comes back to first run’s calendar step when the start asks, and only from the signed state (spec 0036, AC-1217)', async () => {
    const m = await memberWithWorkspace(app);
    const started = await navigate(app, `/api/calendar/google/start?workspace=${m.slug}&then=welcome`, m.cookie);
    const state = new URL(started.headers.get('location') ?? '').searchParams.get('state') ?? '';
    const browser = stateCookie(started);
    const back = await navigate(
      app,
      `${GOOGLE_CALLBACK_PATH}?code=${encodeURIComponent('code:ada@acme.dev')}&state=${encodeURIComponent(state)}&then=settings`,
      `${m.cookie}; ${browser}`,
    );
    expect(back.headers.get('location')).toBe(
      `${APP_URL}/welcome?step=calendar&workspace=${m.slug}&calendar=connected`,
    );

    // A start without it, and a callback that asks for first run in its own query, still go to Settings.
    const plain = await start(m.slug, m.cookie);
    const declined = await navigate(
      app,
      `${GOOGLE_CALLBACK_PATH}?error=access_denied&then=welcome&state=${encodeURIComponent(plain.state)}`,
      `${m.cookie}; ${plain.browser}`,
    );
    expect(declined.headers.get('location')).toBe(`${APP_URL}/w/${m.slug}/settings/calendar?calendar=denied`);

    // Any other value is Settings; signed out, sign in comes back to the step asked for.
    const odd = await navigate(app, `/api/calendar/google/start?workspace=${m.slug}&then=https://evil.example`);
    expect(odd.headers.get('location')).toBe(
      `${APP_URL}/sign-in?redirect=${encodeURIComponent(`/w/${m.slug}/settings/calendar`)}`,
    );
    const signedOut = await navigate(app, `/api/calendar/google/start?workspace=${m.slug}&then=welcome`);
    expect(signedOut.headers.get('location')).toBe(
      `${APP_URL}/sign-in?redirect=${encodeURIComponent(`/welcome?step=calendar&workspace=${m.slug}`)}`,
    );
    const offWelcome = await navigate(off, `/api/calendar/google/start?workspace=${m.slug}&then=welcome`, m.cookie);
    expect(offWelcome.headers.get('location')).toBe(
      `${APP_URL}/welcome?step=calendar&workspace=${m.slug}&calendar=off`,
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
      max: 6,
    });
    // Outlook too, where it isn't on (AC-1012).
    const outlook = await navigate(app, `/api/calendar/microsoft/start?workspace=${m.slug}`, m.cookie);
    expect(outlook.headers.get('location')).toBe(`${APP_URL}/w/${m.slug}/settings/calendar?calendar=off`);
  });
});

describe('system.status (spec 0036, AC-1216)', () => {
  it('says whether calendar sync is set up here, so first run offers a calendar only where it can', async () => {
    expect((await rpcClient(app).system.status()).calendarSync).toBe(true);
    expect((await rpcClient(off).system.status()).calendarSync).toBe(false);
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

describe('push notices and milestone 2 procedures (AC-602, AC-609)', () => {
  /** Google's notice: a POST through the edge with no Origin and no session, its channel in the headers. */
  const notice = (target: ReturnType<typeof signInApp>['app'], headers: Readonly<Record<string, string>>) =>
    Promise.resolve(
      target.fetch(
        new Request(`${APP_URL}/api/calendar/google/notify`, {
          method: 'POST',
          headers: { [EDGE_HEADER]: TEST_EDGE_SECRET, ...headers },
        }),
      ),
    );

  it('queues a sync for a notice with the channel’s token, and answers every notice the same', async () => {
    const m = await memberWithWorkspace(app);
    const { state, browser } = await start(m.slug, m.cookie);
    await navigate(
      app,
      `${GOOGLE_CALLBACK_PATH}?code=${encodeURIComponent('code:ada@acme.dev')}&state=${encodeURIComponent(state)}`,
      `${m.cookie}; ${browser}`,
    );
    const [connection] = (await m.client.calendar.connections.list({ workspace: m.slug })).connections;
    const id = connection?.id ?? '';
    const secret = 'notice-secret';
    // A channel from before milestone 5: its token names the connection, and it lives on the main calendar now.
    await testQuery(ownerUrl, `update calendar_connections set status = 'connected' where id = $1`, [id]);
    await testQuery(
      ownerUrl,
      `update calendar_calendars set channel = jsonb_build_object('id', 'channel-1',
        'resourceId', 'resource-1', 'expiresAt', (now() + interval '7 days')::text, 'tokenHash', $2::text)
       where connection_id = $1 and is_primary`,
      [id, createHash('sha256').update(secret).digest('hex')],
    );
    const key = `crm-calendar:${m.workspace.id}:${id}`;
    await testQuery(ownerUrl, `select graphile_worker.remove_job($1)`, [key]);
    const queued = () => testQuery(ownerUrl, `select 1 from graphile_worker.jobs where key = $1`, [key]);

    const before = pokes;
    const forged = await notice(app, {
      'x-goog-channel-id': 'channel-1',
      'x-goog-channel-token': `${m.workspace.id}.${id}.wrong`,
      'x-goog-resource-state': 'exists',
    });
    expect(forged.status).toBe(200);
    expect(await forged.text()).toBe('');
    expect(await queued()).toEqual([]);
    expect(pokes).toBe(before);

    const real = await notice(app, {
      'x-goog-channel-id': 'channel-1',
      'x-goog-channel-token': `${m.workspace.id}.${id}.${secret}`,
      'x-goog-resource-state': 'exists',
    });
    expect(real.status).toBe(200);
    expect(await queued()).toHaveLength(1);
    expect(pokes).toBe(before + 1);
    // With calendar sync off, a notice is answered and ignored.
    expect((await notice(off, { 'x-goog-channel-id': 'channel-1' })).status).toBe(200);
  });

  it('reads and changes the workspace’s calendar settings, and adds only an attendee the member can see', async () => {
    const m = await memberWithWorkspace(app);
    expect(await m.client.calendar.settings.get({ workspace: m.slug })).toEqual({
      createUnknownPeople: false,
      canManage: true,
    });
    expect(
      await m.client.calendar.settings.update({ workspace: m.slug, createUnknownPeople: true, mutationId: newId() }),
    ).toEqual({ createUnknownPeople: true, canManage: true });
    expect((await m.client.calendar.settings.get({ workspace: m.slug })).createUnknownPeople).toBe(true);
    const missing = await failure(() =>
      m.client.calendar.meetings.addAttendee({
        workspace: m.slug,
        recordId: newId(),
        meetingId: newId(),
        email: 'cy@northwind.com',
        mutationId: newId(),
      }),
    );
    expect(missing.code).toBe('NOT_FOUND');
  });
});

describe('Outlook, calendars and health (spec 0024 milestones 4 and 5, spec 0037 AC-1307)', () => {
  /** Graph's post to the notify address: no Origin, no session. */
  const graphPost = (path: string, body?: unknown) =>
    Promise.resolve(
      withOutlook.fetch(
        new Request(`${APP_URL}/api/calendar/microsoft/notify${path}`, {
          method: 'POST',
          headers: { [EDGE_HEADER]: TEST_EDGE_SECRET, 'content-type': 'application/json' },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        }),
      ),
    );

  it('connects Outlook through its own callback, a Google state never finishing it, and lists both providers', async () => {
    const m = await memberWithWorkspace(withOutlook);
    const started = await navigate(withOutlook, `/api/calendar/microsoft/start?workspace=${m.slug}`, m.cookie);
    const location = new URL(started.headers.get('location') ?? '');
    expect(location.searchParams.get('redirect_uri')).toBe(`${APP_URL}${MICROSOFT_CALLBACK_PATH}`);
    const state = location.searchParams.get('state') ?? '';
    const browser = stateCookie(started);
    // The state was Outlook's: Google's callback refuses it.
    const crossed = await navigate(
      withOutlook,
      `${GOOGLE_CALLBACK_PATH}?code=${encodeURIComponent('code:ada@outlook.example')}&state=${encodeURIComponent(state)}`,
      `${m.cookie}; ${browser}`,
    );
    expect(resultOf(crossed)).toBe('failed');
    const again = await navigate(withOutlook, `/api/calendar/microsoft/start?workspace=${m.slug}`, m.cookie);
    const back = await navigate(
      withOutlook,
      `${MICROSOFT_CALLBACK_PATH}?code=${encodeURIComponent('code:ada@outlook.example')}&state=${encodeURIComponent(
        new URL(again.headers.get('location') ?? '').searchParams.get('state') ?? '',
      )}`,
      `${m.cookie}; ${stateCookie(again)}`,
    );
    expect(resultOf(back)).toBe('connected');
    const list = await m.client.calendar.calendars.list({ workspace: m.slug });
    expect(list).toMatchObject({ enabled: true, providers: ['google', 'microsoft'], max: 6 });
    expect(list.accounts).toEqual([
      expect.objectContaining({ provider: 'microsoft', accountEmail: 'ada@outlook.example' }),
    ]);
    expect(list.accounts[0]?.calendars).toEqual([expect.objectContaining({ isPrimary: true, isDestination: true })]);
  });

  it('answers Graph’s validation with its token, and takes a notice only with the subscription’s client state', async () => {
    const SUBSCRIPTION = '7f105c7d-2dc5-4530-97cd-4e7ae6534c07';
    const validated = await graphPost(`?validationToken=${encodeURIComponent('Validation: token 123')}`);
    expect(validated.status).toBe(200);
    expect(validated.headers.get('content-type')).toMatch(/^text\/plain/);
    // Text a stranger chose, on the app's origin: never sniffed as a page.
    expect(validated.headers.get('x-content-type-options')).toBe('nosniff');
    expect(validated.headers.get('content-security-policy')).toBe("default-src 'none'");
    // Larger than any real post: refused before it is read.
    expect((await graphPost('', { value: [], pad: 'x'.repeat(300 * 1024) })).status).toBe(413);
    expect(await validated.text()).toBe('Validation: token 123');
    expect((await graphPost('?validationToken=%00bad')).status).toBe(400);

    const m = await memberWithWorkspace(withOutlook);
    const started = await navigate(withOutlook, `/api/calendar/microsoft/start?workspace=${m.slug}`, m.cookie);
    await navigate(
      withOutlook,
      `${MICROSOFT_CALLBACK_PATH}?code=${encodeURIComponent('code:bea@outlook.example')}&state=${encodeURIComponent(
        new URL(started.headers.get('location') ?? '').searchParams.get('state') ?? '',
      )}`,
      `${m.cookie}; ${stateCookie(started)}`,
    );
    const [account] = (await m.client.calendar.calendars.list({ workspace: m.slug })).accounts;
    const main = account?.calendars[0]?.id ?? '';
    const secret = 'graph-secret';
    await testQuery(ownerUrl, `update calendar_connections set status = 'connected' where id = $1`, [account?.id]);
    await testQuery(
      ownerUrl,
      `update calendar_calendars set channel = jsonb_build_object('id', $3::text, 'resourceId', 'me/calendar/events',
        'expiresAt', (now() + interval '2 days')::text, 'tokenHash', $2::text) where id = $1`,
      [main, createHash('sha256').update(secret).digest('hex'), SUBSCRIPTION],
    );
    const key = `crm-calendar:${m.workspace.id}:${account?.id ?? ''}`;
    await testQuery(ownerUrl, `select graphile_worker.remove_job($1)`, [key]);
    const queued = () => testQuery(ownerUrl, `select 1 from graphile_worker.jobs where key = $1`, [key]);
    const forged = await graphPost('', {
      value: [{ subscriptionId: SUBSCRIPTION, clientState: `${m.workspace.id}.${main}.wrong`, changeType: 'updated' }],
    });
    expect(forged.status).toBe(202);
    expect(await queued()).toEqual([]);
    expect((await graphPost('', { value: 'nonsense' })).status).toBe(202);
    const real = await graphPost('', {
      value: [
        {
          subscriptionId: SUBSCRIPTION,
          clientState: `${m.workspace.id}.${main}.${secret}`,
          lifecycleEvent: 'reauthorizationRequired',
        },
      ],
    });
    expect(real.status).toBe(202);
    expect(await queued()).toHaveLength(1);
    // The lifecycle notice marked the subscription for renewal.
    const [channel] = await testQuery<{ expires: string }>(
      ownerUrl,
      `select channel ->> 'expiresAt' as expires from calendar_calendars where id = $1`,
      [main],
    );
    expect(Date.parse(channel?.expires ?? '')).toBeLessThanOrEqual(Date.now() + 1000);
  });

  it('changes only the member’s own calendars, picks a writable destination, and answers health without names', async () => {
    const m = await memberWithWorkspace(app);
    const { state, browser } = await start(m.slug, m.cookie);
    await navigate(
      app,
      `${GOOGLE_CALLBACK_PATH}?code=${encodeURIComponent('code:cy@acme.dev')}&state=${encodeURIComponent(state)}`,
      `${m.cookie}; ${browser}`,
    );
    const [account] = (await m.client.calendar.calendars.list({ workspace: m.slug })).accounts;
    const main = account?.calendars[0];
    expect(
      await m.client.calendar.calendars.update({
        workspace: m.slug,
        calendarId: main?.id ?? '',
        showInWeek: false,
        colourOverride: 'purple',
        mutationId: newId(),
      }),
    ).toMatchObject({ showInWeek: false, hue: 'purple', checkConflicts: true });
    expect(
      await m.client.calendar.destination.set({ workspace: m.slug, calendarId: main?.id ?? '', mutationId: newId() }),
    ).toEqual({ destinationId: main?.id });
    const missing = await failure(() =>
      m.client.calendar.calendars.update({ workspace: m.slug, calendarId: newId(), sync: true, mutationId: newId() }),
    );
    expect(missing.code).toBe('NOT_FOUND');
    expect(
      await m.client.calendar.connections.refresh({
        workspace: m.slug,
        connectionId: account?.id ?? '',
        mutationId: newId(),
      }),
    ).toEqual({ queued: true });
    // Health: a status and nothing else (spec 0037, AC-1307).
    const [self] = await testQuery<{ id: string }>(
      ownerUrl,
      `select id::text as id from members where workspace_id = $1`,
      [m.workspace.id],
    );
    const health = await m.client.calendar.health({ workspace: m.slug, memberIds: [self?.id ?? '', newId()] });
    expect(health).toEqual({ members: [{ memberId: self?.id, status: 'connected' }] });
    expect(JSON.stringify(health)).not.toContain('acme.dev');
  });
});
