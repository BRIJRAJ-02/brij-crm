// The Google adapter (spec 0024) against a fake `fetch` answering as Google's
// REST endpoints do: the consent address, the code exchange (a partial grant
// refused), the refresh's verdicts, the change list's pages, its sync token
// and its 410, and events in core's shape. The status rule is the one an
// earlier scheduling build pinned down: only 401 and 403 blame the grant.
import { isProviderError } from '@crm/core';
import { describe, expect, it } from 'vitest';
import { codeForStatus, createGoogleCalendar, eventOf } from './google.ts';
import { CALENDAR_SCOPES, missingCalendarCapabilities, parseGrantedScopes } from './scopes.ts';

const NOW = new Date('2026-10-19T09:00:00.000Z');
const TOKENS = { accessToken: 'access', refreshToken: 'refresh', expiresAt: '2026-10-19T10:00:00.000Z' };
const WINDOW = { from: '2026-07-21T09:00:00.000Z', to: '2027-04-17T09:00:00.000Z' };

/** A fetch that answers each call in turn, keeping what it was asked. */
function fakeFetch(answers: readonly (Response | Error)[]) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  let next = 0;
  const send = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    calls.push({ url: input instanceof Request ? input.url : String(input), init });
    const answer = answers[next];
    next += 1;
    if (answer === undefined) return Promise.reject(new Error('No answer left.'));
    return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
  };
  return { send, calls };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const google = (answers: readonly (Response | Error)[]) => {
  const fetched = fakeFetch(answers);
  return {
    ...fetched,
    provider: createGoogleCalendar({ clientId: 'client', clientSecret: 'secret', fetch: fetched.send, now: () => NOW }),
  };
};

/** The failure code a call ends in. */
async function codeOf(call: Promise<unknown>): Promise<string> {
  try {
    await call;
  } catch (error) {
    if (isProviderError(error)) return error.code;
    throw error;
  }
  throw new Error('It succeeded.');
}

describe('which statuses blame the grant', () => {
  it('blames it for 401 and 403 only: a 429, a 5xx or a 404 is the minute, not the grant', () => {
    expect(codeForStatus(401)).toBe('CALENDAR_AUTH');
    expect(codeForStatus(403)).toBe('CALENDAR_AUTH');
    for (const status of [400, 404, 429, 500, 502, 503])
      expect(codeForStatus(status), String(status)).toBe('CALENDAR_UNAVAILABLE');
  });

  it('judges a grant by what it can do, not by the scope strings', () => {
    expect(missingCalendarCapabilities(parseGrantedScopes(CALENDAR_SCOPES.join(' ')))).toEqual([]);
    // A wider scope granted before covers both.
    expect(missingCalendarCapabilities(parseGrantedScopes('openid,https://www.googleapis.com/auth/calendar'))).toEqual(
      [],
    );
    expect(missingCalendarCapabilities(parseGrantedScopes('openid email'))).toEqual([
      'see when you are busy',
      'see and add events',
    ]);
  });
});

describe('connecting', () => {
  it('asks for offline access with consent every time, the calendar scopes and the state', () => {
    const url = new URL(google([]).provider.authorizeUrl('the-state', 'https://app.test/api/calendar/google/callback'));
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      client_id: 'client',
      redirect_uri: 'https://app.test/api/calendar/google/callback',
      response_type: 'code',
      access_type: 'offline',
      prompt: 'consent',
      state: 'the-state',
      scope: `openid email ${CALENDAR_SCOPES.join(' ')}`,
    });
  });

  it('exchanges a code for tokens and the account, and refuses a partial grant before reading anything else', async () => {
    const granted = { access_token: 'a', refresh_token: 'r', expires_in: 3599, scope: CALENDAR_SCOPES.join(' ') };
    const ok = google([json(granted), json({ email: 'Ada@Acme.dev', email_verified: true })]);
    expect(await ok.provider.exchangeCode('code', 'https://app.test/cb')).toEqual({
      accessToken: 'a',
      refreshToken: 'r',
      expiresAt: '2026-10-19T09:59:59.000Z',
      accountEmail: 'ada@acme.dev',
    });
    const sent = ok.calls[0]?.init?.body;
    const body = sent instanceof URLSearchParams ? sent : new URLSearchParams();
    expect(Object.fromEntries(body)).toMatchObject({
      grant_type: 'authorization_code',
      code: 'code',
      client_secret: 'secret',
    });

    const partial = google([
      json({ ...granted, scope: 'openid email https://www.googleapis.com/auth/calendar.freebusy' }),
    ]);
    expect(await codeOf(partial.provider.exchangeCode('code', 'https://app.test/cb'))).toBe('CALENDAR_SCOPE_DECLINED');
    expect(partial.calls).toHaveLength(1);
    const noRefresh = google([json({ ...granted, refresh_token: undefined })]);
    expect(await codeOf(noRefresh.provider.exchangeCode('code', 'https://app.test/cb'))).toBe('CALENDAR_AUTH');
    // Our own client refused is ours to fix, never the member's.
    const client = google([json({ error: 'invalid_client' }, 401)]);
    expect(await codeOf(client.provider.exchangeCode('code', 'https://app.test/cb'))).toBe('CALENDAR_UNAVAILABLE');
  });
});

describe('refreshing', () => {
  it('keeps the refresh token unless Google hands a new one', async () => {
    const { provider } = google([json({ access_token: 'fresh', expires_in: 60 })]);
    expect(await provider.refresh(TOKENS)).toEqual({
      accessToken: 'fresh',
      refreshToken: 'refresh',
      expiresAt: '2026-10-19T09:01:00.000Z',
    });
  });

  it('reads invalid_grant as revoked, its own client refused or a 5xx as unavailable, and the network too', async () => {
    expect(await codeOf(google([json({ error: 'invalid_grant' }, 400)]).provider.refresh(TOKENS))).toBe(
      'CALENDAR_AUTH_REVOKED',
    );
    expect(await codeOf(google([json({ error: 'invalid_client' }, 401)]).provider.refresh(TOKENS))).toBe(
      'CALENDAR_UNAVAILABLE',
    );
    expect(await codeOf(google([json({}, 503)]).provider.refresh(TOKENS))).toBe('CALENDAR_UNAVAILABLE');
    expect(await codeOf(google([new TypeError('fetch failed')]).provider.refresh(TOKENS))).toBe('CALENDAR_UNAVAILABLE');
    expect(await codeOf(google([new Response('not json', { status: 200 })]).provider.refresh(TOKENS))).toBe(
      'CALENDAR_UNAVAILABLE',
    );
  });
});

describe('listing changes', () => {
  const event = (id: string) => ({
    id,
    status: 'confirmed',
    iCalUID: `${id}@google.com`,
    summary: `Event ${id}`,
    start: { dateTime: '2026-10-20T11:00:00+02:00' },
    end: { dateTime: '2026-10-20T11:30:00+02:00' },
    attendees: [{ email: 'ada@acme.dev', self: true, organizer: true, responseStatus: 'accepted' }],
  });

  it('reads a full sync over the window, page by page, singly and with deletions, to the next sync token', async () => {
    const g = google([
      json({ items: [event('a')], nextPageToken: 'page-2' }),
      json({ items: [event('b'), { id: 'gone', status: 'cancelled' }], nextSyncToken: 'sync-1' }),
    ]);
    const changes = await g.provider.listChanges(TOKENS, 'primary', undefined, WINDOW);
    expect(changes.nextSyncToken).toBe('sync-1');
    expect(changes.events.map((each) => [each.id, each.status])).toEqual([
      ['a', 'confirmed'],
      ['b', 'confirmed'],
      ['gone', 'cancelled'],
    ]);
    const first = new URL(g.calls[0]?.url ?? '');
    expect(first.pathname).toBe('/calendar/v3/calendars/primary/events');
    expect(Object.fromEntries(first.searchParams)).toMatchObject({
      singleEvents: 'true',
      showDeleted: 'true',
      timeMin: WINDOW.from,
      timeMax: WINDOW.to,
    });
    expect(first.searchParams.get('fields')).not.toMatch(/description|attachments/);
    expect(new URL(g.calls[1]?.url ?? '').searchParams.get('pageToken')).toBe('page-2');
    expect(g.calls[0]?.init?.headers).toMatchObject({ Authorization: 'Bearer access' });
  });

  it('sends the sync token alone (no window), and reads a 410 as a full sync wanted', async () => {
    const g = google([json({ items: [], nextSyncToken: 'sync-2' }), json({}, 410), json({}, 403)]);
    await g.provider.listChanges(TOKENS, 'primary', 'sync-1', WINDOW);
    const url = new URL(g.calls[0]?.url ?? '');
    expect(url.searchParams.get('syncToken')).toBe('sync-1');
    expect(url.searchParams.has('timeMin')).toBe(false);
    expect(await codeOf(g.provider.listChanges(TOKENS, 'primary', 'sync-1', WINDOW))).toBe('CALENDAR_SYNC_TOKEN_GONE');
    expect(await codeOf(g.provider.listChanges(TOKENS, 'primary', 'sync-1', WINDOW))).toBe('CALENDAR_AUTH');
  });
});

describe('events in core’s shape', () => {
  it('maps times to UTC, an all day event to its day, a recurring instance, privacy, attendees and the Meet link', () => {
    expect(
      eventOf({
        id: 'e1_20261020',
        etag: '"1"',
        status: 'tentative',
        iCalUID: 'e1@google.com',
        summary: 'Weekly',
        start: { dateTime: '2026-10-20T11:00:00+02:00' },
        end: { dateTime: '2026-10-20T11:30:00+02:00' },
        originalStartTime: { dateTime: '2026-10-20T11:00:00+02:00' },
        conferenceData: {
          entryPoints: [
            { entryPointType: 'phone', uri: 'tel:1' },
            { entryPointType: 'video', uri: 'https://meet.google.com/x' },
          ],
        },
        organizer: { email: 'Ada@Acme.dev' },
        attendees: [
          { email: 'Ada@Acme.dev', self: true, organizer: true, responseStatus: 'accepted' },
          { email: 'bea@globex.com', displayName: 'Bea', responseStatus: 'needsAction' },
          { displayName: 'No address' },
        ],
        visibility: 'private',
      }),
    ).toEqual({
      id: 'e1_20261020',
      status: 'tentative',
      icalUid: 'e1@google.com',
      originalStart: '2026-10-20T09:00:00.000Z',
      title: 'Weekly',
      start: { at: '2026-10-20T09:00:00.000Z', allDay: false },
      end: { at: '2026-10-20T09:30:00.000Z', allDay: false },
      videoUrl: 'https://meet.google.com/x',
      organizerEmail: 'ada@acme.dev',
      attendees: [
        { email: 'ada@acme.dev', response: 'accepted', isOrganizer: true, isSelf: true },
        { email: 'bea@globex.com', name: 'Bea', response: 'needs_action', isOrganizer: false, isSelf: false },
      ],
      isPrivate: true,
      etag: '"1"',
    });
    expect(eventOf({ id: 'day', start: { date: '2026-10-20' }, end: { date: '2026-10-21' } })).toMatchObject({
      start: { at: '2026-10-20T00:00:00.000Z', allDay: true },
      end: { at: '2026-10-21T00:00:00.000Z', allDay: true },
      isPrivate: false,
      attendees: [],
    });
    expect(eventOf({ status: 'cancelled' })).toBeUndefined();
    // Shown as free in the calendar: never busy time.
    expect(eventOf({ id: 'free', transparency: 'transparent' })).toMatchObject({ isFree: true });
    expect(eventOf({ id: 'busy', transparency: 'opaque' })).not.toHaveProperty('isFree');
  });
});

describe('writing a booking’s event', () => {
  const event = {
    id: '1f5fd6241f5fd6241f5fd6241f5fd624',
    status: 'confirmed',
    summary: 'Intro call with Grace',
    start: { dateTime: '2026-11-02T20:00:00Z' },
    end: { dateTime: '2026-11-02T20:45:00Z' },
  };
  const input = {
    title: 'Intro call with Grace',
    start: '2026-11-02T20:00:00.000Z',
    end: '2026-11-02T20:45:00.000Z',
    timeZone: 'UTC',
    attendees: [{ email: 'grace@navy.example' }],
    video: false,
    requestId: '1F5FD624-1F5F-D624-1F5F-D6241F5FD624',
  };

  it('names the event by the request id, so a retry can’t invite anyone twice', async () => {
    const g = google([json(event)]);
    await expect(g.provider.createEvent(TOKENS, input)).resolves.toMatchObject({ id: event.id });
    const body = g.calls[0]?.init?.body;
    expect(JSON.parse(typeof body === 'string' ? body : '{}')).toMatchObject({ id: event.id });
  });

  it('reads a 409 as the first try having made it, and answers that event', async () => {
    const g = google([json({ error: { code: 409 } }, 409), json(event)]);
    await expect(g.provider.createEvent(TOKENS, input)).resolves.toMatchObject({ id: event.id });
    expect(g.calls[1]?.url).toContain(`/calendars/primary/events/${event.id}`);
    expect(g.calls[1]?.init?.method).toBeUndefined();
  });
});
