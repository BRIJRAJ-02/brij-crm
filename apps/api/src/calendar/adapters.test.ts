// The shared adapter suite (spec 0024, AC-1013): Google's and Outlook's
// adapters answer core's provider interface the same way, each run against
// responses recorded from its provider's REST API (no live calls). Every case
// is one behaviour both must have: consent, the code exchange, a refused grant,
// the calendar list, a full sync then an incremental one with a deletion, an
// expired sync token, free and busy per calendar with one failing, an event
// written to a named calendar, an idempotent cancel, and a push channel. A few
// cases after the suite are Outlook's own (Teams, delta links, lifecycle).
import { isProviderError, type CalendarProvider } from '@crm/core';
import { describe, expect, it } from 'vitest';
import { createGoogleCalendar } from './google.ts';
import { createMicrosoftCalendar, graphEventOf } from './microsoft.ts';

const NOW = new Date('2026-10-19T09:00:00.000Z');
const TOKENS = { accessToken: 'access', refreshToken: 'refresh', expiresAt: '2026-10-19T10:00:00.000Z' };
const WINDOW = { from: '2026-07-21T09:00:00.000Z', to: '2027-04-17T09:00:00.000Z' };
const SELF = 'ada@acme.dev';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** One recorded exchange: a request it answers (method and a URL test) and the response. */
interface Recorded {
  readonly method?: string;
  readonly url: RegExp;
  readonly answer: () => Response;
}

/** A fetch that answers from recordings, the last matching one winning, keeping what it was asked. */
function recorded(recordings: readonly Recorded[]) {
  const calls: { url: string; method: string; body: unknown }[] = [];
  const send = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = input instanceof Request ? input.url : String(input);
    const method = init?.method ?? 'GET';
    const text =
      typeof init?.body === 'string' ? init.body : init?.body instanceof URLSearchParams ? init.body.toString() : '';
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      // A form body stays text.
    }
    calls.push({ url, method, body });
    const found = [...recordings].reverse().find((each) => (each.method ?? 'GET') === method && each.url.test(url));
    return found === undefined
      ? Promise.reject(new Error(`Nothing recorded for ${method} ${url}`))
      : Promise.resolve(found.answer());
  };
  return { send, calls };
}

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

/** What each provider's recordings say, for the suite to read back. */
interface Subject {
  readonly name: string;
  readonly make: (recordings: readonly Recorded[]) => {
    provider: CalendarProvider;
    calls: ReturnType<typeof recorded>['calls'];
  };
  readonly authorizeHost: string;
  readonly exchange: readonly Recorded[];
  readonly refusedRefresh: readonly Recorded[];
  readonly calendars: readonly Recorded[];
  /** A full sync of `cal-2` with one meeting, then an incremental one that deletes it. */
  readonly changes: readonly Recorded[];
  readonly expiredToken: readonly Recorded[];
  readonly busy: readonly Recorded[];
  readonly create: readonly Recorded[];
  readonly cancelGone: readonly Recorded[];
  readonly watch: readonly Recorded[];
}

const googleEvent = {
  id: 'evt1',
  etag: '"1"',
  status: 'confirmed',
  iCalUID: 'evt1@google.com',
  summary: 'Intro with Globex',
  start: { dateTime: '2026-10-20T10:00:00Z' },
  end: { dateTime: '2026-10-20T10:30:00Z' },
  organizer: { email: SELF, self: true },
  attendees: [
    { email: SELF, responseStatus: 'accepted', organizer: true, self: true },
    { email: 'cy@globex.com', responseStatus: 'needsAction' },
  ],
};

const graphEvent = {
  id: 'evt1',
  changeKey: 'ck1',
  iCalUId: 'evt1@outlook.com',
  subject: 'Intro with Globex',
  start: { dateTime: '2026-10-20T10:00:00.0000000', timeZone: 'UTC' },
  end: { dateTime: '2026-10-20T10:30:00.0000000', timeZone: 'UTC' },
  isAllDay: false,
  isCancelled: false,
  showAs: 'busy',
  sensitivity: 'normal',
  organizer: { emailAddress: { address: SELF, name: 'Ada' } },
  attendees: [{ emailAddress: { address: 'cy@globex.com', name: 'Cy' }, status: { response: 'none' } }],
  responseStatus: { response: 'organizer' },
};

const GRAPH = 'https://graph\\.microsoft\\.com/v1\\.0';
const me = { url: new RegExp(`${GRAPH}/me\\?`), answer: () => json({ mail: SELF, userPrincipalName: SELF }) };

const SUBJECTS: readonly Subject[] = [
  {
    name: 'Google',
    make: (recordings) => {
      const fetched = recorded(recordings);
      return {
        provider: createGoogleCalendar({
          clientId: 'client',
          clientSecret: 'secret',
          fetch: fetched.send,
          now: () => NOW,
        }),
        calls: fetched.calls,
      };
    },
    authorizeHost: 'accounts.google.com',
    exchange: [
      {
        method: 'POST',
        url: /oauth2\.googleapis\.com\/token/,
        answer: () =>
          json({
            access_token: 'a',
            refresh_token: 'r',
            expires_in: 3600,
            scope:
              'openid email https://www.googleapis.com/auth/calendar.freebusy https://www.googleapis.com/auth/calendar.calendarlist.readonly https://www.googleapis.com/auth/calendar.events',
          }),
      },
      { url: /openidconnect\.googleapis\.com/, answer: () => json({ email: 'Ada@Acme.dev', email_verified: true }) },
    ],
    refusedRefresh: [
      { method: 'POST', url: /oauth2\.googleapis\.com\/token/, answer: () => json({ error: 'invalid_grant' }, 400) },
    ],
    calendars: [
      {
        url: /\/users\/me\/calendarList/,
        answer: () =>
          json({
            items: [
              {
                id: SELF,
                summary: SELF,
                backgroundColor: '#4285F4',
                accessRole: 'owner',
                primary: true,
                timeZone: 'Europe/London',
              },
              { id: 'cal-2', summary: 'Team', backgroundColor: '#0b8043', accessRole: 'writer' },
              { id: 'cal-3', summary: 'Holidays', accessRole: 'reader' },
              { id: 'cal-4', summary: 'Room', accessRole: 'freeBusyReader' },
            ],
          }),
      },
    ],
    changes: [
      {
        url: /\/calendars\/cal-2\/events\?.*timeMin=/,
        answer: () => json({ items: [googleEvent], nextSyncToken: 'sync-1' }),
      },
      {
        url: /\/calendars\/cal-2\/events\?.*syncToken=sync-1/,
        answer: () => json({ items: [{ id: 'evt1', status: 'cancelled' }], nextSyncToken: 'sync-2' }),
      },
    ],
    expiredToken: [
      { url: /\/calendars\/cal-2\/events\?.*syncToken=/, answer: () => json({ error: { code: 410 } }, 410) },
    ],
    busy: [
      {
        method: 'POST',
        url: /\/freeBusy$/,
        answer: () =>
          json({
            calendars: {
              [SELF]: { busy: [{ start: '2026-10-20T10:00:00Z', end: '2026-10-20T10:30:00Z' }] },
              'cal-2': { busy: [] },
              'cal-3': { errors: [{ domain: 'global', reason: 'backendError' }] },
            },
          }),
      },
    ],
    create: [
      {
        method: 'POST',
        url: /\/calendars\/cal-2\/events\?/,
        answer: () => json({ ...googleEvent, id: 'made1', hangoutLink: 'https://meet.google.com/abc-defg-hij' }),
      },
    ],
    cancelGone: [
      { method: 'DELETE', url: /\/calendars\/cal-2\/events\/made1/, answer: () => new Response(null, { status: 410 }) },
    ],
    watch: [
      {
        method: 'POST',
        url: /\/calendars\/cal-2\/events\/watch/,
        answer: () =>
          json({ id: 'channel-1', resourceId: 'res-1', expiration: String(NOW.getTime() + 7 * 86_400_000) }),
      },
    ],
  },
  {
    name: 'Outlook',
    make: (recordings) => {
      const fetched = recorded(recordings);
      return {
        provider: createMicrosoftCalendar({
          clientId: 'app',
          clientSecret: 'secret',
          fetch: fetched.send,
          now: () => NOW,
        }),
        calls: fetched.calls,
      };
    },
    authorizeHost: 'login.microsoftonline.com',
    exchange: [
      {
        method: 'POST',
        url: /login\.microsoftonline\.com\/common\/oauth2\/v2\.0\/token/,
        answer: () =>
          json({
            access_token: 'a',
            refresh_token: 'r',
            expires_in: 3600,
            scope: 'openid email https://graph.microsoft.com/Calendars.ReadWrite https://graph.microsoft.com/User.Read',
          }),
      },
      {
        url: new RegExp(`${GRAPH}/me\\?`),
        answer: () => json({ mail: 'Ada@Acme.dev', userPrincipalName: 'ada@acme.dev' }),
      },
    ],
    refusedRefresh: [
      {
        method: 'POST',
        url: /login\.microsoftonline\.com\/common\/oauth2\/v2\.0\/token/,
        answer: () => json({ error: 'invalid_grant', error_description: 'AADSTS70000' }, 400),
      },
    ],
    calendars: [
      {
        url: new RegExp(`${GRAPH}/me/calendars\\?`),
        answer: () =>
          json({
            value: [
              { id: SELF, name: 'Calendar', hexColor: '#4285F4', canEdit: true, isDefaultCalendar: true },
              { id: 'cal-2', name: 'Team', hexColor: '#0b8043', canEdit: true, isDefaultCalendar: false },
              { id: 'cal-3', name: 'Holidays', hexColor: '', canEdit: false, isDefaultCalendar: false },
              { id: 'cal-4', name: 'Room', canEdit: false, isDefaultCalendar: false },
            ],
          }),
      },
    ],
    changes: [
      me,
      {
        url: new RegExp(`${GRAPH}/me/calendars/cal-2/calendarView/delta\\?startDateTime=`),
        answer: () =>
          json({
            value: [graphEvent],
            '@odata.deltaLink': 'https://graph.microsoft.com/v1.0/me/calendars/cal-2/calendarView/delta?$deltatoken=d1',
          }),
      },
      {
        url: /\$deltatoken=d1/,
        answer: () =>
          json({
            value: [{ id: 'evt1', '@removed': { reason: 'deleted' } }],
            '@odata.deltaLink': 'https://graph.microsoft.com/v1.0/me/calendars/cal-2/calendarView/delta?$deltatoken=d2',
          }),
      },
    ],
    expiredToken: [me, { url: /\$deltatoken=/, answer: () => json({ error: { code: 'syncStateNotFound' } }, 400) }],
    busy: [
      {
        method: 'POST',
        url: new RegExp(`${GRAPH}/\\$batch`),
        answer: () =>
          json({
            responses: [
              {
                id: '0',
                status: 200,
                body: {
                  value: [
                    {
                      showAs: 'busy',
                      start: { dateTime: '2026-10-20T10:00:00.0000000', timeZone: 'UTC' },
                      end: { dateTime: '2026-10-20T10:30:00.0000000', timeZone: 'UTC' },
                    },
                    {
                      showAs: 'free',
                      start: { dateTime: '2026-10-20T11:00:00.0000000', timeZone: 'UTC' },
                      end: { dateTime: '2026-10-20T12:00:00.0000000', timeZone: 'UTC' },
                    },
                  ],
                },
              },
              { id: '1', status: 200, body: { value: [] } },
              { id: '2', status: 503, body: { error: { code: 'ServiceUnavailable' } } },
            ],
          }),
      },
    ],
    create: [
      me,
      {
        url: new RegExp(`${GRAPH}/me/calendars/cal-2\\?`),
        answer: () => json({ allowedOnlineMeetingProviders: ['teamsForBusiness'] }),
      },
      {
        method: 'POST',
        url: new RegExp(`${GRAPH}/me/calendars/cal-2/events$`),
        answer: () =>
          json(
            { ...graphEvent, id: 'made1', onlineMeeting: { joinUrl: 'https://teams.microsoft.com/l/meetup-join/abc' } },
            201,
          ),
      },
    ],
    cancelGone: [
      { method: 'POST', url: /\/me\/calendars\/cal-2\/events\/made1\/cancel/, answer: () => json({ error: {} }, 404) },
    ],
    watch: [
      {
        method: 'POST',
        url: new RegExp(`${GRAPH}/subscriptions$`),
        answer: () =>
          json(
            {
              id: 'channel-1',
              resource: 'me/calendars/cal-2/events',
              expirationDateTime: '2026-10-22T07:00:00.0000000Z',
            },
            201,
          ),
      },
    ],
  },
];

describe.each(SUBJECTS)('$name adapter (the shared suite, AC-1013)', (subject) => {
  it('sends the member to consent with the state and the redirect', () => {
    const url = new URL(subject.make([]).provider.authorizeUrl('the-state', 'https://app.test/callback'));
    expect(url.host).toBe(subject.authorizeHost);
    expect(url.searchParams.get('state')).toBe('the-state');
    expect(url.searchParams.get('redirect_uri')).toBe('https://app.test/callback');
  });

  it('exchanges a code for lasting tokens and the account, lower case', async () => {
    const exchanged = await subject.make(subject.exchange).provider.exchangeCode('code', 'https://app.test/callback');
    expect(exchanged).toMatchObject({ accessToken: 'a', refreshToken: 'r', accountEmail: SELF });
  });

  it('reads a refused grant on a refresh as revoked', async () => {
    expect(await codeOf(subject.make(subject.refusedRefresh).provider.refresh(TOKENS))).toBe('CALENDAR_AUTH_REVOKED');
  });

  it('lists the calendars with the main one, roles and colours', async () => {
    const listed = await subject.make(subject.calendars).provider.listCalendars(TOKENS);
    expect(listed.map((each) => [each.id, each.accessRole, each.isPrimary])).toEqual([
      [SELF, 'owner', true],
      ['cal-2', 'writer', false],
      ['cal-3', 'reader', false],
      ['cal-4', subject.name === 'Google' ? 'free_busy' : 'reader', false],
    ]);
    expect(listed[1]).toMatchObject({ name: 'Team', colour: '#0b8043' });
  });

  it('syncs a calendar in full, then by its token, a deletion arriving as a cancellation', async () => {
    const { provider } = subject.make(subject.changes);
    const full = await provider.listChanges(TOKENS, 'cal-2', undefined, WINDOW);
    expect(full.events).toEqual([
      expect.objectContaining({
        id: 'evt1',
        status: 'confirmed',
        title: 'Intro with Globex',
        start: { at: '2026-10-20T10:00:00.000Z', allDay: false },
        end: { at: '2026-10-20T10:30:00.000Z', allDay: false },
        organizerEmail: SELF,
        isPrivate: false,
      }),
    ]);
    expect(full.events[0]?.attendees).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ email: SELF, isSelf: true, isOrganizer: true }),
        expect.objectContaining({ email: 'cy@globex.com', isSelf: false, response: 'needs_action' }),
      ]),
    );
    const next = await provider.listChanges(TOKENS, 'cal-2', full.nextSyncToken, WINDOW);
    expect(next.events).toEqual([expect.objectContaining({ id: 'evt1', status: 'cancelled' })]);
    expect(next.nextSyncToken).not.toBe(full.nextSyncToken);
  });

  it('asks for a full sync when its token expired', async () => {
    const { provider } = subject.make([...subject.changes, ...subject.expiredToken]);
    const full = await provider.listChanges(TOKENS, 'cal-2', undefined, WINDOW);
    expect(await codeOf(provider.listChanges(TOKENS, 'cal-2', full.nextSyncToken, WINDOW))).toBe(
      'CALENDAR_SYNC_TOKEN_GONE',
    );
  });

  it('answers free and busy for each calendar in one request, a failing one on its own', async () => {
    const { provider, calls } = subject.make(subject.busy);
    const answers = await provider.freeBusy(TOKENS, [SELF, 'cal-2', 'cal-3'], WINDOW.from, '2026-10-21T00:00:00.000Z');
    expect(calls).toHaveLength(1);
    expect(answers.get(SELF)).toEqual({
      busy: [{ start: '2026-10-20T10:00:00.000Z', end: '2026-10-20T10:30:00.000Z' }],
    });
    expect(answers.get('cal-2')).toEqual({ busy: [] });
    expect(answers.get('cal-3')).toEqual({ error: 'CALENDAR_UNAVAILABLE' });
  });

  it('writes an event to the named calendar with a video link, and a cancel of one gone is done', async () => {
    const { provider, calls } = subject.make([...subject.create, ...subject.cancelGone]);
    const made = await provider.createEvent(TOKENS, 'cal-2', {
      title: 'Intro',
      start: '2026-10-20T10:00:00.000Z',
      end: '2026-10-20T10:30:00.000Z',
      timeZone: 'UTC',
      attendees: [{ email: 'cy@globex.com' }],
      video: true,
      requestId: '1f5fd624-1f5f-d624-1f5f-d6241f5fd624',
    });
    expect(made.id).toBe('made1');
    expect(made.videoUrl).toMatch(/^https:\/\//);
    expect(made).not.toHaveProperty('videoUnavailable');
    expect(calls.some((call) => call.method === 'POST' && call.url.includes('cal-2/events'))).toBe(true);
    await expect(provider.cancelEvent(TOKENS, 'cal-2', 'made1')).resolves.toBeUndefined();
  });

  it('opens a push channel on one calendar, carrying the token back', async () => {
    const { provider, calls } = subject.make(subject.watch);
    const channel = await provider.watch(TOKENS, 'cal-2', 'https://hooks.test/notify', 'ws.cal.secret');
    expect(channel).toMatchObject({ id: 'channel-1' });
    expect(Date.parse(channel.expiresAt)).toBeGreaterThan(NOW.getTime());
    expect(JSON.stringify(calls[0]?.body)).toContain('ws.cal.secret');
  });
});

describe('Outlook’s own (AC-1007 to AC-1011)', () => {
  const make = (recordings: readonly Recorded[]) => {
    const fetched = recorded(recordings);
    return {
      provider: createMicrosoftCalendar({
        clientId: 'app',
        clientSecret: 'secret',
        fetch: fetched.send,
        now: () => NOW,
      }),
      calls: fetched.calls,
    };
  };

  it('makes an event without a Teams link where the account can’t, and says so (AC-1011)', async () => {
    const { provider, calls } = make([
      me,
      {
        url: new RegExp(`${GRAPH}/me/calendar\\?`),
        answer: () => json({ allowedOnlineMeetingProviders: ['skypeForConsumer'] }),
      },
      {
        method: 'POST',
        url: new RegExp(`${GRAPH}/me/calendar/events$`),
        answer: () => json({ ...graphEvent, id: 'made2' }, 201),
      },
    ]);
    const made = await provider.createEvent(TOKENS, 'primary', {
      title: 'Intro',
      start: '2026-10-20T10:00:00.000Z',
      end: '2026-10-20T10:30:00.000Z',
      timeZone: 'UTC',
      attendees: [],
      video: true,
      requestId: 'request-1',
    });
    expect(made).toMatchObject({ id: 'made2', videoUnavailable: true });
    const body = calls.find((call) => call.method === 'POST')?.body as Record<string, unknown>;
    expect(body).toMatchObject({ transactionId: 'request-1' });
    expect(body).not.toHaveProperty('isOnlineMeeting');
  });

  it('maps free and working elsewhere as not busy, private and cancelled, and keeps the organiser', () => {
    expect(graphEventOf({ ...graphEvent, showAs: 'workingElsewhere' }, SELF)).toMatchObject({ isFree: true });
    expect(graphEventOf({ ...graphEvent, sensitivity: 'private' }, SELF)).toMatchObject({ isPrivate: true });
    expect(graphEventOf({ ...graphEvent, isCancelled: true }, SELF)).toMatchObject({ status: 'cancelled' });
    // Invited: the account's own answer comes from responseStatus.
    const invited = graphEventOf(
      {
        ...graphEvent,
        organizer: { emailAddress: { address: 'cy@globex.com' } },
        attendees: [{ emailAddress: { address: SELF }, status: { response: 'none' } }],
        responseStatus: { response: 'declined' },
      },
      SELF,
    );
    expect(invited?.attendees).toEqual([
      expect.objectContaining({ email: 'cy@globex.com', isOrganizer: true }),
      expect.objectContaining({ email: SELF, isSelf: true, response: 'declined' }),
    ]);
  });

  it('syncs in full again once the delta link began a week before the window’s end, and refuses a foreign link', async () => {
    const { provider } = make(SUBJECTS[1]?.changes ?? []);
    const full = await provider.listChanges(TOKENS, 'cal-2', undefined, WINDOW);
    const later = { from: WINDOW.from, to: new Date(Date.parse(WINDOW.to) + 8 * 86_400_000).toISOString() };
    expect(await codeOf(provider.listChanges(TOKENS, 'cal-2', full.nextSyncToken, later))).toBe(
      'CALENDAR_SYNC_TOKEN_GONE',
    );
    const foreign = `graph1:${Buffer.from(JSON.stringify({ link: 'https://evil.example/x', to: WINDOW.to })).toString('base64url')}`;
    expect(await codeOf(provider.listChanges(TOKENS, 'cal-2', foreign, WINDOW))).toBe('CALENDAR_SYNC_TOKEN_GONE');
  });

  it('asks who an access token is for once, keyed by its hash, and again for a new token', async () => {
    const { provider, calls } = make(SUBJECTS[1]?.changes ?? []);
    const asked = () => calls.filter((each) => /\/me\?/.test(each.url)).length;
    await provider.listChanges(TOKENS, 'cal-2', undefined, WINDOW);
    await provider.listChanges(TOKENS, 'cal-2', undefined, WINDOW);
    expect(asked()).toBe(1);
    // A refreshed token is another key: the cache never matches by anything but the whole token's hash.
    await provider.listChanges({ ...TOKENS, accessToken: 'access-2' }, 'cal-2', undefined, WINDOW);
    expect(asked()).toBe(2);
  });

  it('says what Graph refused with: its status and its own code, never its message (calendar.channel)', async () => {
    const refusal = async (body: () => Response) => {
      const { provider } = make([{ method: 'POST', url: new RegExp(`${GRAPH}/subscriptions$`), answer: body }]);
      try {
        await provider.watch(TOKENS, 'cal-2', 'https://hooks.test/api/calendar/microsoft/notify', 'token');
      } catch (error) {
        if (isProviderError(error)) return { code: error.code, status: error.status, reason: error.reason };
        throw error;
      }
      throw new Error('It succeeded.');
    };
    // The message can quote an address: only the code is kept.
    expect(
      await refusal(() =>
        json(
          { error: { code: 'InvalidRequest', message: 'Subscription validation failed for ada@example.com.' } },
          400,
        ),
      ),
    ).toEqual({ code: 'CALENDAR_UNAVAILABLE', status: 400, reason: 'InvalidRequest' });
    // A body that isn't JSON, or a code that isn't a machine word: the status alone.
    expect(await refusal(() => new Response('<html>busy</html>', { status: 503 }))).toEqual({
      code: 'CALENDAR_UNAVAILABLE',
      status: 503,
      reason: undefined,
    });
    expect(await refusal(() => json({ error: { code: 'Not a word: ada@example.com' } }, 400))).toMatchObject({
      status: 400,
      reason: undefined,
    });
  });

  it('refuses a grant without Calendars.ReadWrite, and blames our app, not the member, for a refused client', async () => {
    const declined = make([
      {
        method: 'POST',
        url: /oauth2\/v2\.0\/token/,
        answer: () => json({ access_token: 'a', refresh_token: 'r', scope: 'openid User.Read' }),
      },
    ]);
    expect(await codeOf(declined.provider.exchangeCode('code', 'https://app.test/cb'))).toBe('CALENDAR_SCOPE_DECLINED');
    const client = make([
      { method: 'POST', url: /oauth2\/v2\.0\/token/, answer: () => json({ error: 'invalid_client' }, 401) },
    ]);
    expect(await codeOf(client.provider.refresh(TOKENS))).toBe('CALENDAR_UNAVAILABLE');
  });
});
