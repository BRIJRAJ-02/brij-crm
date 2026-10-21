// The booking page's visitor through the real app (spec 0028, AC-720 to
// AC-727), with fake calendars and the real Postgres: a guest connecting
// Google for the visit (the signed state, the single use cookie, the return
// path, a partial grant, forgetting), a signed in visitor's own calendar, the
// host on their own page, and the overlay on slots, failing open.
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
import { GUEST_CALLBACK_PATH, GUEST_COOKIE, GUEST_STATE_COOKIE } from './visitor.ts';

/** Sunday 1 November 2026, midnight UTC. */
const NOW = new Date('2026-11-01T00:00:00.000Z');
const at = (time: string) => `2026-11-02T${time}:00.000Z`;
const MONDAY = `from=${at('00:00')}&to=2026-11-03T00:00:00.000Z&duration=30&tz=UTC`;

let db: Database;
let identity: IdentityStore;
let app: ReturnType<typeof createApp>;

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
  const env = testEnv();
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
  app = createApp({
    services: {
      ...testServices(env, {
        db,
        identity,
        mailer: createMailpitMailer({ url: MAILPIT_URL, from: env.MAIL_FROM }),
        calendar: services,
      }),
      bookingCalendar: calendar,
      bookingLimiter: createMemoryLimiter(),
      now: () => NOW,
    },
    env,
  });
});
afterAll(async () => {
  await identity.close();
  await db.close();
});

/** A browser request through the edge with these cookies, redirects left to the caller. */
function browse(path: string, cookie = '', method = 'GET'): Promise<Response> {
  return Promise.resolve(
    app.fetch(
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
  const start = await browse(`/api/public/booking/${key}/connect?return=${encodeURIComponent(`/b/${key}?d=30`)}`);
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
    const start = await browse(`/api/public/booking/${key}/connect?return=${encodeURIComponent(`/b/${key}?d=30`)}`);
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

  it('sends nobody anywhere but this page, and refuses a state without its cookie', async () => {
    const { key } = await hostPage();
    for (const given of ['https://evil.example/b/x', '//evil.example', `/b/${key}/../../x`, '/b/AAAAAAAAAAAAAAAA']) {
      const start = await browse(`/api/public/booking/${key}/connect?return=${encodeURIComponent(given)}`);
      expect(start.headers.get('location')).toBe(`${APP_URL}/`);
      expect(cookieOf(start, GUEST_STATE_COOKIE)).toBe('');
    }
    const start = await browse(`/api/public/booking/${key}/connect?return=${encodeURIComponent(`/b/${key}`)}`);
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
      const start = await browse(`/api/public/booking/${key}/connect?return=${encodeURIComponent(`/b/${key}`)}`);
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
