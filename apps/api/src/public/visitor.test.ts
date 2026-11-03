// The booking page's visitor through the real app (spec 0028, AC-720 to
// AC-727), with fake calendars and the real Postgres: a guest connecting
// Google for the visit (the signed state, the single use cookie, the return
// path, a partial grant, forgetting), a signed in visitor's own calendar, the
// host on their own page, and the overlay on slots, failing open.
import { createHash } from 'node:crypto';
import { decodeTokenKey, newId, providerError, type BookingCalendar, type BusyInterval } from '@crm/core';
import { createFakeCalendarProvider } from '@crm/core/testing';
import type { Database, IdentityStore } from '@crm/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.ts';
import type { GuestCalendar } from '../calendar/google.ts';
import { createCalendarServices, GOOGLE_CALLBACK_PATH } from '../calendar/services.ts';
import { EDGE_HEADER, ORIGIN_HEADER } from '../edge.ts';
import { createMailpitMailer } from '../mail/mailpit.ts';
import { APP_URL, TEST_EDGE_SECRET, testEnv, testServices } from '../testing.ts';
import { MAILPIT_URL, newIp, signIn, testConnections } from '../../test/sign-in.ts';
import { memberWithWorkspace } from '../../test/workspace.ts';
import { createMemoryLimiter } from './limits.ts';
import { returnPath, returnShape } from './booking.ts';
import {
  GUEST_CALLBACK_PATH,
  GUEST_COOKIE,
  GUEST_LAND_COOKIE,
  GUEST_LAND_PATH,
  GUEST_STATE_COOKIE,
} from './visitor.ts';

/** Sunday 1 November 2026, midnight UTC. */
const NOW = new Date('2026-11-01T00:00:00.000Z');
const at = (time: string) => `2026-11-02T${time}:00.000Z`;
const MONDAY = `from=${at('00:00')}&to=2026-11-03T00:00:00.000Z&duration=30&tz=UTC`;

let db: Database;
let identity: IdentityStore;
let app: ReturnType<typeof createApp>;
/** The same app with the public pages on their own origin, as Timefix serves them (timefix.com beside app.). */
let pagesApp: ReturnType<typeof createApp>;
const PAGES = 'https://pages.test';
/** The public host app's clock, which a test moves on to let a ticket run out. */
let pagesClock: Date;

/** Busy times by workspace: the host's at noon, and a signed in visitor's where a test puts them. */
const memberBusy = new Map<string, readonly BusyInterval[] | 'blocked' | 'broken'>();
const calendar: BookingCalendar = {
  busy: ({ workspaceId }) => {
    const busy = memberBusy.get(workspaceId);
    if (busy === 'blocked') return Promise.resolve({ status: 'blocked' });
    // A connection whose sealed tokens no longer open, say: the reader throws.
    if (busy === 'broken') return Promise.reject(new Error('The stored calendar tokens did not open.'));
    return Promise.resolve({ status: 'read', busy: busy ?? [{ start: at('12:00'), end: at('13:00') }] });
  },
  events: () => Promise.resolve({}),
};

/** The guest's Google: `code:<email>` grants, `partial` grants no free and busy, `down@…` can't be read. */
const guestBusy = new Map<string, readonly BusyInterval[]>();
const revoked: string[] = [];
const guest: GuestCalendar = {
  authorizeUrl: (state, redirectUri) =>
    `https://guest.fake/auth?${new URLSearchParams({ state, redirect_uri: redirectUri }).toString()}`,
  exchange: (code) => {
    if (code === 'partial') {
      return Promise.reject(providerError('CALENDAR_SCOPE_DECLINED', 'No free and busy.'));
    }
    const email = code.replace(/^code:/, '');
    return Promise.resolve({
      accessToken: `guest:${email}`,
      expiresAt: new Date(NOW.getTime() + 3600_000).toISOString(),
      email,
      name: 'Grace Hopper',
    });
  },
  freeBusy: (token) => {
    const email = token.replace(/^guest:/, '');
    if (email.startsWith('down@')) return Promise.reject(providerError('CALENDAR_UNAVAILABLE', 'Down.'));
    return Promise.resolve(guestBusy.get(email) ?? []);
  },
  revoke: (token) => {
    revoked.push(token);
    return Promise.resolve();
  },
};

beforeAll(() => {
  ({ db, identity } = testConnections());
  app = buildApp(testEnv());
  pagesClock = NOW;
  pagesApp = buildApp(testEnv({ BOOKING_PUBLIC_ORIGIN: PAGES }), () => pagesClock);
});

/** The app on `env`, with the fake calendars. */
function buildApp(env: ReturnType<typeof testEnv>, now: () => Date = () => NOW): ReturnType<typeof createApp> {
  const fake = createFakeCalendarProvider({ now: () => NOW });
  const services = createCalendarServices(
    {
      clientId: 'test-client',
      clientSecret: 'test-secret',
      tokenKey: decodeTokenKey(Buffer.alloc(32, 7).toString('base64')),
      webhookOrigin: undefined,
      microsoft: undefined,
    },
    APP_URL,
    fake.provider,
    guest,
  );
  return createApp({
    services: {
      ...testServices(env, {
        db,
        identity,
        mailer: createMailpitMailer({ url: MAILPIT_URL, from: env.MAIL_FROM }),
        calendar: services,
      }),
      bookingCalendar: calendar,
      bookingLimiter: createMemoryLimiter(),
      now,
    },
    env,
  });
}
afterAll(async () => {
  await identity.close();
  await db.close();
});

/** A browser request through the edge with these cookies, redirects left to the caller. */
function browse(path: string, cookie = '', method = 'GET', on = app): Promise<Response> {
  return Promise.resolve(
    on.fetch(
      new Request(`${APP_URL}${path}`, {
        method,
        headers: {
          [EDGE_HEADER]: TEST_EDGE_SECRET,
          [ORIGIN_HEADER]: APP_URL,
          origin: APP_URL,
          'x-forwarded-for': newIp(),
          ...(cookie === '' ? {} : { cookie }),
        },
        redirect: 'manual',
      }),
    ),
  );
}

/** The cookie `name` a response set, as a browser sends it back (empty when it set none). */
function cookieOf(response: Response, name: string): string {
  return (response.headers.getSetCookie().find((each) => each.startsWith(`${name}=`)) ?? '').split(';')[0] ?? '';
}

/** A host's live page. */
async function hostPage() {
  const host = await memberWithWorkspace(app);
  const page = await host.client.bookingPages.create({
    workspace: host.slug,
    id: newId(),
    title: 'Intro call',
    timeZone: 'UTC',
    mutationId: newId(),
  });
  return { host, key: page.publicKey };
}

/** A guest who connected Google as `email` on the page at `key`: the browser's guest cookie. */
async function connectGuest(key: string, email: string): Promise<string> {
  const start = await browse(
    `/api/public/booking/${key}/connect?via=app&return=${encodeURIComponent(`/b/${key}?d=30`)}`,
  );
  const state = new URL(start.headers.get('location') ?? '').searchParams.get('state') ?? '';
  const back = await browse(
    `${GUEST_CALLBACK_PATH}?code=${encodeURIComponent(`code:${email}`)}&state=${encodeURIComponent(state)}`,
    cookieOf(start, GUEST_STATE_COOKIE),
  );
  return cookieOf(back, GUEST_COOKIE);
}

const slotsOf = async (response: Response) =>
  (await response.json()) as {
    slots: { start: string }[];
    viewer?: { calendar: string; clashes: string[]; best: string[] };
  };

describe('a guest connecting Google for the visit (AC-721, AC-722)', () => {
  it('sends the guest to consent with a signed state, and back to the same page connected', async () => {
    const { key } = await hostPage();
    const start = await browse(
      `/api/public/booking/${key}/connect?via=app&return=${encodeURIComponent(`/b/${key}?d=30`)}`,
    );
    expect(start.status).toBe(302);
    const location = new URL(start.headers.get('location') ?? '');
    expect(location.origin).toBe('https://guest.fake');
    expect(location.searchParams.get('redirect_uri')).toBe(`${APP_URL}${GUEST_CALLBACK_PATH}`);
    const state = location.searchParams.get('state') ?? '';
    expect(state).toMatch(/^gs1\./);
    const stateSet = start.headers.getSetCookie().find((each) => each.startsWith(`${GUEST_STATE_COOKIE}=`)) ?? '';
    expect(stateSet).toMatch(/HttpOnly/i);
    expect(stateSet).toMatch(/Path=\/api\/public\/booking\/connect\//);

    const back = await browse(
      `${GUEST_CALLBACK_PATH}?code=${encodeURIComponent('code:grace@navy.example')}&state=${encodeURIComponent(state)}`,
      cookieOf(start, GUEST_STATE_COOKIE),
    );
    expect(back.status).toBe(302);
    expect(back.headers.get('location')).toBe(`${APP_URL}/b/${key}?d=30&calendar=connected`);
    const set = back.headers.getSetCookie().find((each) => each.startsWith(`${GUEST_COOKIE}=`)) ?? '';
    expect(set).toMatch(/HttpOnly/i);
    expect(set).toMatch(/Path=\/api\/public\/booking(;|$)/);
    expect(set).toMatch(/SameSite=Lax/i);
    const maxAge = Number(/Max-Age=(\d+)/i.exec(set)?.[1]);
    expect(maxAge).toBeGreaterThan(0);
    expect(maxAge).toBeLessThanOrEqual(3600);
    // The token never rides in the clear.
    expect(set).not.toContain('guest:grace@navy.example');
    // The state is spent.
    expect(back.headers.getSetCookie().some((each) => each.startsWith(`${GUEST_STATE_COOKIE}=;`))).toBe(true);

    const viewer = await browse(`/api/public/booking/${key}/viewer`, cookieOf(back, GUEST_COOKIE));
    expect(viewer.headers.get('cache-control')).toBe('private, no-store');
    expect(await viewer.json()).toEqual({
      viewer: { name: 'Grace Hopper', email: 'grace@navy.example', source: 'google', calendar: 'on' },
      isHost: false,
      canConnect: true,
    });
  });

  it('hops a start through the app’s own address first, once, so the callback can read its cookie', async () => {
    const { key } = await hostPage();
    const start = await browse(`/api/public/booking/${key}/connect?return=${encodeURIComponent(`/b/${key}`)}`);
    expect(start.status).toBe(302);
    const hop = new URL(start.headers.get('location') ?? '');
    expect(hop.origin).toBe(APP_URL);
    expect(hop.pathname).toBe(`/api/public/booking/${key}/connect`);
    expect(hop.searchParams.get('via')).toBe('app');
    expect(hop.searchParams.get('return')).toBe(`/b/${key}`);
    expect(cookieOf(start, GUEST_STATE_COOKIE)).toBe('');
    const onward = await browse(`${hop.pathname}${hop.search}`);
    expect(new URL(onward.headers.get('location') ?? '').origin).toBe('https://guest.fake');
    expect(cookieOf(onward, GUEST_STATE_COOKIE)).not.toBe('');
  });

  it('sends nobody anywhere but this page, and refuses a state without its cookie', async () => {
    const { key } = await hostPage();
    for (const given of [
      'https://evil.example/b/x',
      '//evil.example',
      `/b/${key}/../../x`,
      '/b/AAAAAAAAAAAAAAAA',
      `/\\evil.example/b/${key}`,
      // A handle address that names no page, or another one.
      `/nobody-${newId().slice(-8)}/intro-call`,
    ]) {
      const start = await browse(`/api/public/booking/${key}/connect?via=app&return=${encodeURIComponent(given)}`);
      expect(start.headers.get('location')).toBe(`${APP_URL}/`);
      expect(cookieOf(start, GUEST_STATE_COOKIE)).toBe('');
    }
    const start = await browse(`/api/public/booking/${key}/connect?via=app&return=${encodeURIComponent(`/b/${key}`)}`);
    const state = new URL(start.headers.get('location') ?? '').searchParams.get('state') ?? '';
    // Another browser (no nonce cookie) gets nothing.
    const elsewhere = await browse(
      `${GUEST_CALLBACK_PATH}?code=${encodeURIComponent('code:mallory@evil.example')}&state=${encodeURIComponent(state)}`,
    );
    expect(elsewhere.headers.get('location')).toBe(`${APP_URL}/b/${key}?calendar=failed`);
    expect(cookieOf(elsewhere, GUEST_COOKIE)).toBe('');
    // A forged state goes home.
    const forged = await browse(
      `${GUEST_CALLBACK_PATH}?code=x&state=gs1.e30.AAAA`,
      cookieOf(start, GUEST_STATE_COOKIE),
    );
    expect(forged.headers.get('location')).toBe(`${APP_URL}/`);
  });

  it('says when the guest declined or unticked free and busy, and keeps nothing', async () => {
    const { key } = await hostPage();
    const go = async (query: string) => {
      const start = await browse(
        `/api/public/booking/${key}/connect?via=app&return=${encodeURIComponent(`/b/${key}`)}`,
      );
      const state = new URL(start.headers.get('location') ?? '').searchParams.get('state') ?? '';
      return browse(
        `${GUEST_CALLBACK_PATH}?${query}&state=${encodeURIComponent(state)}`,
        cookieOf(start, GUEST_STATE_COOKIE),
      );
    };
    const denied = await go('error=access_denied');
    expect(denied.headers.get('location')).toBe(`${APP_URL}/b/${key}?calendar=denied`);
    const partial = await go('code=partial');
    expect(partial.headers.get('location')).toBe(`${APP_URL}/b/${key}?calendar=scope`);
    expect(cookieOf(partial, GUEST_COOKIE)).toBe('');
  });

  it('forgets the calendar at once and asks Google to revoke it; a tampered cookie is nobody', async () => {
    const { key } = await hostPage();
    const cookie = await connectGuest(key, 'forget@navy.example');
    const forgot = await browse('/api/public/booking/connect/forget', cookie, 'POST');
    expect(forgot.status).toBe(200);
    expect(forgot.headers.getSetCookie().some((each) => each.startsWith(`${GUEST_COOKIE}=;`))).toBe(true);
    expect(revoked).toContain('guest:forget@navy.example');
    const tampered = `${cookie.slice(0, -4)}AAAA`;
    expect(await (await browse(`/api/public/booking/${key}/viewer`, tampered)).json()).toEqual({
      isHost: false,
      canConnect: true,
    });
    expect(await (await browse(`/api/public/booking/${key}/viewer`)).json()).toEqual({
      isHost: false,
      canConnect: true,
    });
  });
});

describe('the return address of a guest connect (4 Nov 2026)', () => {
  const KEY = 'abcdefghijklmnop';
  const yes = () => Promise.resolve(true);
  const no = () => Promise.resolve(false);

  it('takes the page’s own /b/<key> or a handle address, with a plain query, and nothing else', () => {
    expect(returnShape(`/b/${KEY}?d=30&tz=America%2FNew_York`)).toEqual({ kind: 'key', publicKey: KEY });
    expect(returnShape('/anish/meeting?d=30')).toEqual({ kind: 'handle', handle: 'anish', slug: 'meeting' });
    for (const given of [
      undefined,
      '',
      'https://evil.example/anish/meeting',
      '//evil.example/meeting',
      '///evil.example/meeting',
      '/\\evil.example/meeting',
      '\\\\evil.example/anish/meeting',
      '/anish\\meeting',
      '/anish%2Fmeeting/x',
      '/anish/meeting%2F..',
      '/anish/%2e%2e',
      `/b/${KEY}%2F`,
      '/anish/meeting/extra',
      '/anish/meeting#calendar',
      '/Anish/meeting',
      '/settings/meeting',
      '/anish/meeting?next=/x',
      `/anish/meeting?${'a'.repeat(512)}`,
    ]) {
      expect(returnShape(given)).toBeUndefined();
    }
  });

  it('takes a handle address only when it names this page, and /b/ only for this key', async () => {
    expect(await returnPath(KEY, '/anish/meeting?d=30', yes)).toBe('/anish/meeting?d=30');
    expect(await returnPath(KEY, '/anish/meeting?d=30', no)).toBeUndefined();
    expect(await returnPath(KEY, `/b/${KEY}`, no)).toBe(`/b/${KEY}`);
    expect(await returnPath(KEY, '/b/AAAAAAAAAAAAAAAA', yes)).toBeUndefined();
    expect(await returnPath('not a key', '/anish/meeting', yes)).toBeUndefined();
  });

  /** A host's live page at `/<handle>/intro-call`. */
  async function handlePage() {
    const { host, key } = await hostPage();
    const handle = `guest-${newId().slice(-8)}`;
    await host.client.profile.update({ workspace: host.slug, handle, mutationId: newId() });
    return { key, handle, path: `/${handle}/intro-call` };
  }

  /** Whether a response is kept by no cache and names nothing to the next site. */
  const unkept = (response: Response) => ({
    cache: response.headers.get('cache-control'),
    referrer: response.headers.get('referrer-policy'),
  });
  const UNKEPT = { cache: 'no-store', referrer: 'no-referrer' };

  /**
   * A connect started at `path`, wherever the browser asked first: the hop to the public host, its landing nonce, the
   * hop to the app's host, then Google's address and the state cookie.
   */
  async function startOnPages(key: string, path: string) {
    const first = await browse(
      `/api/public/booking/${key}/connect?return=${encodeURIComponent(path)}`,
      '',
      'GET',
      pagesApp,
    );
    const toPages = new URL(first.headers.get('location') ?? '');
    expect(toPages.origin).toBe(PAGES);
    expect(toPages.searchParams.get('via')).toBe('pub');
    // Nothing is set until the browser is on the public host.
    expect(cookieOf(first, GUEST_LAND_COOKIE)).toBe('');
    const onPages = await browse(`${toPages.pathname}${toPages.search}`, '', 'GET', pagesApp);
    expect(unkept(onPages)).toEqual(UNKEPT);
    const hop = new URL(onPages.headers.get('location') ?? '');
    expect(hop.origin).toBe(APP_URL);
    expect(hop.searchParams.get('via')).toBe('app');
    expect(hop.searchParams.get('land')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const land = cookieOf(onPages, GUEST_LAND_COOKIE);
    expect(land).not.toBe('');
    const onward = await browse(`${hop.pathname}${hop.search}`, '', 'GET', pagesApp);
    expect(new URL(onward.headers.get('location') ?? '').origin).toBe('https://guest.fake');
    const state = new URL(onward.headers.get('location') ?? '').searchParams.get('state') ?? '';
    return { land, state, stateCookie: cookieOf(onward, GUEST_STATE_COOKIE) };
  }

  /** Google's answer for `email` to a start's state, on the app's host. */
  const callback = (state: string, stateCookie: string, email: string) =>
    browse(
      `${GUEST_CALLBACK_PATH}?code=${encodeURIComponent(`code:${email}`)}&state=${encodeURIComponent(state)}`,
      stateCookie,
      'GET',
      pagesApp,
    );

  it('brings a visitor back to the same handle address on the public host, connected, from either host', async () => {
    const { key, path } = await handlePage();
    const { land, state, stateCookie } = await startOnPages(key, `${path}?d=30`);
    const back = await callback(state, stateCookie, 'lin@navy.example');
    // The callback exchanged the code itself and keeps the grant; the hop carries only an id and a signed ticket.
    const landing = new URL(back.headers.get('location') ?? '');
    expect(`${landing.origin}${landing.pathname}`).toBe(`${PAGES}${GUEST_LAND_PATH}`);
    expect([...landing.searchParams.keys()].toSorted()).toEqual(['s', 't']);
    expect(landing.search).not.toContain('code');
    expect(unkept(back)).toEqual(UNKEPT);
    expect(cookieOf(back, GUEST_COOKIE)).toBe('');

    // Another browser (no landing nonce), or the ticket with another id, gets nothing and takes nothing.
    const stranger = await browse(`${landing.pathname}${landing.search}`, '', 'GET', pagesApp);
    expect(stranger.headers.get('location')).toBe(`${PAGES}${path}?d=30&calendar=failed`);
    expect(unkept(stranger)).toEqual(UNKEPT);
    expect(cookieOf(stranger, GUEST_COOKIE)).toBe('');
    const swapped = new URL(landing);
    swapped.searchParams.set('t', 'A'.repeat(43));
    const otherId = await browse(`${swapped.pathname}${swapped.search}`, land, 'GET', pagesApp);
    expect(otherId.headers.get('location')).toBe(`${PAGES}${path}?d=30&calendar=failed`);

    const landed = await browse(`${landing.pathname}${landing.search}`, land, 'GET', pagesApp);
    expect(landed.headers.get('location')).toBe(`${PAGES}${path}?d=30&calendar=connected`);
    expect(unkept(landed)).toEqual(UNKEPT);
    const guest = cookieOf(landed, GUEST_COOKIE);
    expect(guest).not.toBe('');
    expect(landed.headers.getSetCookie().some((each) => each.startsWith(`${GUEST_LAND_COOKIE}=;`))).toBe(true);
    const viewer = await browse(`/api/public/booking/${key}/viewer`, guest, 'GET', pagesApp);
    expect(await viewer.json()).toMatchObject({ viewer: { email: 'lin@navy.example', calendar: 'on' } });

    // Once only: the same landing again, nonce and all, finds nothing.
    const again = await browse(`${landing.pathname}${landing.search}`, land, 'GET', pagesApp);
    expect(again.headers.get('location')).toBe(`${PAGES}${path}?d=30&calendar=failed`);
    expect(cookieOf(again, GUEST_COOKIE)).toBe('');
  });

  it('refuses an expired ticket, and a state passed as one', async () => {
    const { key, path } = await handlePage();
    const { land, state, stateCookie } = await startOnPages(key, path);
    const landing = new URL((await callback(state, stateCookie, 'late@navy.example')).headers.get('location') ?? '');
    pagesClock = new Date(NOW.getTime() + 3 * 60 * 1000);
    try {
      const late = await browse(`${landing.pathname}${landing.search}`, land, 'GET', pagesApp);
      expect(late.headers.get('location')).toBe(`${PAGES}/`);
      expect(cookieOf(late, GUEST_COOKIE)).toBe('');
    } finally {
      pagesClock = NOW;
    }
    const other = await startOnPages(key, path);
    const asTicket = new URL(landing);
    asTicket.searchParams.set('s', other.state);
    const stateTicket = await browse(`${asTicket.pathname}${asTicket.search}`, other.land, 'GET', pagesApp);
    expect(stateTicket.headers.get('location')).toBe(`${PAGES}/`);
    const forged = await browse(`${GUEST_LAND_PATH}?t=x&s=gl1.e30.AAAA`, '', 'GET', pagesApp);
    expect(forged.headers.get('location')).toBe(`${PAGES}/`);
  });

  it('fails a callback with no landing nonce, and one whose nonce the browser never held', async () => {
    const { key, path } = await handlePage();
    // A start straight to the app's leg, no `land`: nothing is exchanged and the visitor is told it failed.
    const bare = await browse(
      `/api/public/booking/${key}/connect?via=app&return=${encodeURIComponent(path)}`,
      '',
      'GET',
      pagesApp,
    );
    const bareState = new URL(bare.headers.get('location') ?? '').searchParams.get('state') ?? '';
    const noLand = await callback(bareState, cookieOf(bare, GUEST_STATE_COOKIE), 'bare@navy.example');
    expect(noLand.headers.get('location')).toBe(`${PAGES}${path}?calendar=failed`);
    expect(cookieOf(noLand, GUEST_COOKIE)).toBe('');

    // An attacker's own `land=` on a link to the app's leg: the victim's browser never held that nonce.
    const attackerNonce = 'attacker-nonce-attacker';
    const chosen = createHash('sha256').update(attackerNonce).digest('base64url');
    const lured = await browse(
      `/api/public/booking/${key}/connect?via=app&land=${chosen}&return=${encodeURIComponent(path)}`,
      '',
      'GET',
      pagesApp,
    );
    const luredState = new URL(lured.headers.get('location') ?? '').searchParams.get('state') ?? '';
    const victim = await callback(luredState, cookieOf(lured, GUEST_STATE_COOKIE), 'victim@navy.example');
    const landing = new URL(victim.headers.get('location') ?? '');
    expect(`${landing.origin}${landing.pathname}`).toBe(`${PAGES}${GUEST_LAND_PATH}`);
    const victimLands = await browse(`${landing.pathname}${landing.search}`, '', 'GET', pagesApp);
    expect(victimLands.headers.get('location')).toBe(`${PAGES}${path}?calendar=failed`);
    expect(cookieOf(victimLands, GUEST_COOKIE)).toBe('');
  });

  it('sends every other ending, and every refusal, to the public host too', async () => {
    const { key, path } = await handlePage();
    const { state, stateCookie } = await startOnPages(key, path);
    const denied = await browse(
      `${GUEST_CALLBACK_PATH}?error=access_denied&state=${encodeURIComponent(state)}`,
      stateCookie,
      'GET',
      pagesApp,
    );
    expect(denied.headers.get('location')).toBe(`${PAGES}${path}?calendar=denied`);
    // A malformed return is refused at the first leg; another page's handle address at the leg that reads.
    for (const given of ['//evil.example/x', `https://evil.example${path}`, `/\\evil.example${path}`]) {
      const start = await browse(
        `/api/public/booking/${key}/connect?return=${encodeURIComponent(given)}`,
        '',
        'GET',
        pagesApp,
      );
      expect(start.headers.get('location')).toBe(`${PAGES}/`);
      expect(cookieOf(start, GUEST_LAND_COOKIE)).toBe('');
    }
    const other = await handlePage();
    const foreign = await browse(
      `/api/public/booking/${key}/connect?via=app&return=${encodeURIComponent(other.path)}`,
      '',
      'GET',
      pagesApp,
    );
    expect(foreign.headers.get('location')).toBe(`${PAGES}/`);
    expect(cookieOf(foreign, GUEST_STATE_COOKIE)).toBe('');
  });
});

describe('the overlay on slots (AC-723 to AC-727)', () => {
  it('answers clashes and Best slots for a guest, never their busy times', async () => {
    const { key } = await hostPage();
    guestBusy.set('ada@visitor.example', [{ start: at('10:00'), end: at('11:00') }]);
    const cookie = await connectGuest(key, 'ada@visitor.example');
    const answer = await browse(`/api/public/booking/${key}/slots?${MONDAY}`, cookie);
    expect(answer.headers.get('cache-control')).toBe('private, no-store');
    const body = await slotsOf(answer);
    expect(body.slots).toHaveLength(14);
    expect(body.viewer).toEqual({
      calendar: 'ok',
      clashes: [at('10:00'), at('10:30')],
      // 09:30 ends as the busy hour starts, 11:00 starts as it ends: neither has 15 minutes clear.
      best: [at('09:00'), at('11:30'), at('13:00')],
    });
    // Slot starts only: nothing else of the visitor's calendar.
    expect(Object.keys(body).toSorted()).toEqual(['calendar', 'slots', 'viewer']);
    // Without the cookie, no overlay.
    expect((await slotsOf(await browse(`/api/public/booking/${key}/slots?${MONDAY}`))).viewer).toBeUndefined();
  });

  it('fails open when the visitor’s calendar can’t be read', async () => {
    const { key } = await hostPage();
    const cookie = await connectGuest(key, 'down@visitor.example');
    const body = await slotsOf(await browse(`/api/public/booking/${key}/slots?${MONDAY}`, cookie));
    expect(body.slots).toHaveLength(14);
    expect(body.viewer).toEqual({ calendar: 'unreachable', clashes: [], best: [] });
  });
});

describe('a signed in visitor (AC-720)', () => {
  it('is known by their session, with their own connected calendar laid over the slots', async () => {
    const { key } = await hostPage();
    const visitor = await memberWithWorkspace(app);
    // Their calendar, connected as a member of their own workspace.
    const start = await browse(`/api/calendar/google/start?workspace=${visitor.slug}`, visitor.cookie);
    const state = new URL(start.headers.get('location') ?? '').searchParams.get('state') ?? '';
    await browse(
      `${GOOGLE_CALLBACK_PATH}?code=${encodeURIComponent(`code:${visitor.email}`)}&state=${encodeURIComponent(state)}`,
      `${visitor.cookie}; ${cookieOf(start, 'crm_calendar_state')}`,
    );
    memberBusy.set(visitor.workspace.id, [{ start: at('14:00'), end: at('15:00') }]);

    const known = (await (await browse(`/api/public/booking/${key}/viewer`, visitor.cookie)).json()) as {
      viewer?: Record<string, unknown>;
    };
    expect(known.viewer).toMatchObject({ email: visitor.email, source: 'account', calendar: 'on' });
    const body = await slotsOf(await browse(`/api/public/booking/${key}/slots?${MONDAY}`, visitor.cookie));
    expect(body.viewer).toMatchObject({ calendar: 'ok', clashes: [at('14:00'), at('14:30')] });

    // Their calendar refusing us until they reconnect still shows every time (another range: a read keeps its minute).
    memberBusy.set(visitor.workspace.id, 'blocked');
    const later = MONDAY.replace('2026-11-03T00:00:00.000Z', '2026-11-02T23:30:00.000Z');
    const blocked = await slotsOf(await browse(`/api/public/booking/${key}/slots?${later}`, visitor.cookie));
    expect(blocked.viewer).toEqual({ calendar: 'unreachable', clashes: [], best: [] });

    // A reader that throws fails open too: the host's slots still answer.
    memberBusy.set(visitor.workspace.id, 'broken');
    const latest = MONDAY.replace('2026-11-03T00:00:00.000Z', '2026-11-02T23:00:00.000Z');
    const broken = await browse(`/api/public/booking/${key}/slots?${latest}`, visitor.cookie);
    expect(broken.status).toBe(200);
    const failedOpen = await slotsOf(broken);
    expect(failedOpen).toMatchObject({ calendar: 'ok', viewer: { calendar: 'unreachable', clashes: [], best: [] } });
    expect(Object.keys(failedOpen).toSorted()).toEqual(['calendar', 'slots', 'viewer']);
  });

  it('knows a visitor with no calendar, and in no workspace at all, without an overlay', async () => {
    const { key } = await hostPage();
    const member = await memberWithWorkspace(app);
    const known = (await (await browse(`/api/public/booking/${key}/viewer`, member.cookie)).json()) as {
      viewer?: Record<string, unknown>;
    };
    expect(known.viewer).toMatchObject({ email: member.email, source: 'account', calendar: 'none' });
    const nowhere = await signIn(app);
    const alone = (await (await browse(`/api/public/booking/${key}/viewer`, nowhere.cookie)).json()) as {
      viewer?: Record<string, unknown>;
    };
    expect(alone.viewer).toMatchObject({ email: nowhere.email, calendar: 'none' });
    expect((await slotsOf(await browse(`/api/public/booking/${key}/slots?${MONDAY}`, member.cookie))).viewer).toBe(
      undefined,
    );
  });

  it('is nobody on their own page: no prefill, no overlay', async () => {
    const { host, key } = await hostPage();
    expect(await (await browse(`/api/public/booking/${key}/viewer`, host.cookie)).json()).toEqual({
      isHost: true,
      canConnect: true,
    });
    expect((await slotsOf(await browse(`/api/public/booking/${key}/slots?${MONDAY}`, host.cookie))).viewer).toBe(
      undefined,
    );
  });
});
