// The Google Calendar adapter (spec 0024): the only module that calls Google
// for calendars, behind core's `CalendarProvider`. Plain REST over `fetch`
// (Calendar API v3, OAuth 2.0), no `googleapis` SDK: a handful of endpoints
// don't need ten megabytes of client. Adapted from an earlier scheduling
// build's Google boundary, which only polled; this one adds incremental sync
// (`syncToken`, a 410 Gone meaning "sync in full") and push channels (`watch`,
// milestone 2), and answers in core's shapes.
//
// Every failure is sorted the way that build learned to, so our mistake never
// reads as the member's: Google refusing the grant on a refresh
// (`invalid_grant`) is `CALENDAR_AUTH_REVOKED`; a 401 or 403 on a call is
// `CALENDAR_AUTH`; a 429, a 5xx, the network, a body that won't parse, or our
// own client being refused (`invalid_client`, a deploy's missing or wrong
// secret) is `CALENDAR_UNAVAILABLE`, which is tried again and never marks a
// connection broken. No message quotes a token, and no token is logged.
import {
  normaliseEmail,
  providerError,
  type BusyInterval,
  type CalendarChannel,
  type CalendarErrorCode,
  type CalendarProvider,
  type CalendarTokens,
  type ExchangedTokens,
  type NewEvent,
  type ProviderAttendee,
  type ProviderEvent,
  type ProviderResponse,
  type ProviderTime,
} from '@crm/core';
import {
  CALENDAR_CONNECT_SCOPES,
  GUEST_CONNECT_SCOPES,
  grantsFreeBusy,
  missingCalendarCapabilities,
  parseGrantedScopes,
} from './scopes.ts';

const AUTHORIZE_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const USERINFO_ENDPOINT = 'https://openidconnect.googleapis.com/v1/userinfo';
const REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke';
const CALENDAR_API = 'https://www.googleapis.com/calendar/v3';

/** Events one list page asks for (Google's most). */
const PAGE_SIZE = 2500;

/** The most pages one change list reads: 50,000 events, far past the 5,000 a window is built for. */
const MAX_PAGES = 20;

/** The event fields a sync reads: never the description or attachments (AC-613). */
const EVENT_FIELDS =
  'id,etag,status,iCalUID,summary,start,end,originalStartTime,location,hangoutLink,conferenceData(entryPoints(entryPointType,uri),conferenceSolution/key/type,createRequest/status),organizer(email,self),attendees(email,displayName,responseStatus,organizer,self),visibility,transparency';

/** How long a call may take before it counts as Google not answering. */
const CALL_TIMEOUT_MS = 20_000;

/** What the adapter needs: the OAuth client, and (tests) a fetch of its own. */
export interface GoogleCalendarOptions {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly fetch?: typeof fetch;
  readonly now?: () => Date;
}

/**
 * Google's verdict on one API call: 401 and 403 are about the grant, a 429
 * or a 5xx about the minute we asked in. A 404 says the calendar is gone,
 * not that the grant is bad.
 */
export function codeForStatus(status: number): CalendarErrorCode {
  return status === 401 || status === 403 ? 'CALENDAR_AUTH' : 'CALENDAR_UNAVAILABLE';
}

/** Google's event as the list returns it, the fields the sync reads. */
interface GoogleEvent {
  readonly id?: string;
  readonly etag?: string;
  readonly status?: string;
  readonly iCalUID?: string;
  readonly summary?: string;
  readonly start?: GoogleTime;
  readonly end?: GoogleTime;
  readonly originalStartTime?: GoogleTime;
  readonly location?: string;
  readonly hangoutLink?: string;
  readonly conferenceData?: {
    readonly entryPoints?: readonly { readonly entryPointType?: string; readonly uri?: string }[];
    readonly createRequest?: { readonly status?: { readonly statusCode?: string } };
  };
  readonly organizer?: { readonly email?: string; readonly self?: boolean };
  readonly attendees?: readonly {
    readonly email?: string;
    readonly displayName?: string;
    readonly responseStatus?: string;
    readonly organizer?: boolean;
    readonly self?: boolean;
  }[];
  readonly visibility?: string;
  readonly transparency?: string;
}

interface GoogleTime {
  readonly dateTime?: string;
  readonly date?: string;
}

/** A Google time as core's: a moment in UTC, or an all day event's day at midnight UTC. */
function timeOf(time: GoogleTime | undefined): ProviderTime | undefined {
  if (time?.dateTime !== undefined && !Number.isNaN(Date.parse(time.dateTime))) {
    return { at: new Date(time.dateTime).toISOString(), allDay: false };
  }
  if (time?.date !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(time.date)) {
    return { at: `${time.date}T00:00:00.000Z`, allDay: true };
  }
  return undefined;
}

const RESPONSES: Readonly<Record<string, ProviderResponse>> = {
  accepted: 'accepted',
  declined: 'declined',
  tentative: 'tentative',
  needsAction: 'needs_action',
};

/** `hangoutLink` is Meet's shortcut; the video entry point is the general form, and the fallback. */
export function meetingUrlOf(event: Pick<GoogleEvent, 'hangoutLink' | 'conferenceData'>): string | undefined {
  if (event.hangoutLink !== undefined) return event.hangoutLink;
  return event.conferenceData?.entryPoints?.find((entry) => entry.entryPointType === 'video')?.uri;
}

/** A Google event as core's. A deleted one may carry only its id and status. */
export function eventOf(event: GoogleEvent): ProviderEvent | undefined {
  if (event.id === undefined) return undefined;
  const start = timeOf(event.start);
  const end = timeOf(event.end);
  const originalStart = timeOf(event.originalStartTime);
  const videoUrl = meetingUrlOf(event);
  const attendees = (event.attendees ?? []).flatMap((attendee): ProviderAttendee[] =>
    attendee.email === undefined
      ? []
      : [
          {
            email: normaliseEmail(attendee.email),
            ...(attendee.displayName === undefined ? {} : { name: attendee.displayName }),
            response: RESPONSES[attendee.responseStatus ?? ''] ?? 'needs_action',
            isOrganizer: attendee.organizer === true,
            isSelf: attendee.self === true,
          },
        ],
  );
  return {
    id: event.id,
    status: event.status === 'cancelled' ? 'cancelled' : event.status === 'tentative' ? 'tentative' : 'confirmed',
    ...(event.iCalUID === undefined ? {} : { icalUid: event.iCalUID }),
    ...(originalStart === undefined ? {} : { originalStart: originalStart.at }),
    ...(event.summary === undefined ? {} : { title: event.summary }),
    ...(start === undefined ? {} : { start }),
    ...(end === undefined ? {} : { end }),
    ...(event.location === undefined ? {} : { location: event.location }),
    ...(videoUrl === undefined ? {} : { videoUrl }),
    ...(event.organizer?.email === undefined ? {} : { organizerEmail: normaliseEmail(event.organizer.email) }),
    attendees,
    isPrivate: event.visibility === 'private' || event.visibility === 'confidential',
    ...(event.transparency === 'transparent' ? { isFree: true } : {}),
    ...(event.etag === undefined ? {} : { etag: event.etag }),
  };
}

/** Google's token answer. */
interface TokenAnswer {
  readonly access_token?: string;
  readonly refresh_token?: string;
  readonly expires_in?: number;
  readonly scope?: string;
  readonly error?: string;
}

/** The Google adapter for one OAuth client. */
export function createGoogleCalendar(options: GoogleCalendarOptions): CalendarProvider {
  const send = options.fetch ?? fetch;
  const now = options.now ?? (() => new Date());

  /** One call: a network failure or a timeout is Google not answering, never a verdict on the grant. */
  const call = async (url: string, init: RequestInit = {}): Promise<Response> => {
    try {
      return await send(url, { ...init, signal: AbortSignal.timeout(CALL_TIMEOUT_MS) });
    } catch {
      throw providerError('CALENDAR_UNAVAILABLE', 'Google’s calendar didn’t answer.');
    }
  };

  /** A response's JSON, or `CALENDAR_UNAVAILABLE` for a body that won't parse. */
  const json = async <T>(response: Response): Promise<T> => {
    try {
      return (await response.json()) as T;
    } catch {
      throw providerError('CALENDAR_UNAVAILABLE', 'Google answered with something that wasn’t JSON.');
    }
  };

  /** A calendar API call with the member's access token; a failed status is refused by `codeForStatus`. */
  const api = async <T>(tokens: CalendarTokens, path: string, init: RequestInit = {}): Promise<T> => {
    const response = await call(`${CALENDAR_API}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${tokens.accessToken}`,
        ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
    });
    if (!response.ok) {
      throw providerError(
        codeForStatus(response.status),
        `Google refused the calendar call (${String(response.status)}).`,
      );
    }
    return response.status === 204 ? (undefined as T) : json<T>(response);
  };

  /** The token endpoint, with the client's credentials. */
  const token = async (
    body: Readonly<Record<string, string>>,
  ): Promise<{ readonly status: number; readonly answer: TokenAnswer }> => {
    const response = await call(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ ...body, client_id: options.clientId, client_secret: options.clientSecret }),
    });
    return { status: response.status, answer: await json<TokenAnswer>(response) };
  };

  const expiry = (seconds: number | undefined) =>
    new Date(now().getTime() + Math.max(0, seconds ?? 3600) * 1000).toISOString();

  return {
    authorizeUrl(state, redirectUri) {
      const url = new URL(AUTHORIZE_ENDPOINT);
      url.searchParams.set('client_id', options.clientId);
      url.searchParams.set('redirect_uri', redirectUri);
      url.searchParams.set('response_type', 'code');
      // Offline, and consent every time: Google hands a refresh token only on consent.
      url.searchParams.set('access_type', 'offline');
      url.searchParams.set('prompt', 'consent');
      url.searchParams.set('scope', CALENDAR_CONNECT_SCOPES.join(' '));
      url.searchParams.set('include_granted_scopes', 'true');
      url.searchParams.set('state', state);
      return url.toString();
    },

    async exchangeCode(code, redirectUri): Promise<ExchangedTokens> {
      const { status, answer } = await token({ grant_type: 'authorization_code', code, redirect_uri: redirectUri });
      if (status >= 500) throw providerError('CALENDAR_UNAVAILABLE', 'Google didn’t answer the sign in.');
      if (status === 401 || answer.error === 'invalid_client') {
        throw providerError('CALENDAR_UNAVAILABLE', 'Google refused Timefix’s own calendar client.');
      }
      if (status >= 400 || answer.access_token === undefined) {
        throw providerError('CALENDAR_AUTH', 'Google didn’t accept that sign in. Try connecting again.');
      }
      // What Google granted, not what we asked for: a partial grant is a failed connection.
      if (missingCalendarCapabilities(parseGrantedScopes(answer.scope)).length > 0) {
        throw providerError('CALENDAR_SCOPE_DECLINED', 'The calendar was connected without the access Timefix needs.');
      }
      if (answer.refresh_token === undefined) {
        throw providerError('CALENDAR_AUTH', 'Google gave no lasting access. Try connecting again.');
      }
      const response = await call(USERINFO_ENDPOINT, { headers: { Authorization: `Bearer ${answer.access_token}` } });
      if (!response.ok) throw providerError(codeForStatus(response.status), 'Google didn’t say whose calendar it is.');
      const profile = await json<{ readonly email?: string; readonly email_verified?: boolean }>(response);
      if (profile.email === undefined || profile.email_verified === false) {
        throw providerError('CALENDAR_AUTH', 'Google didn’t say whose calendar it is.');
      }
      return {
        accessToken: answer.access_token,
        refreshToken: answer.refresh_token,
        expiresAt: expiry(answer.expires_in),
        accountEmail: normaliseEmail(profile.email),
      };
    },

    async refresh(tokens) {
      const { status, answer } = await token({ grant_type: 'refresh_token', refresh_token: tokens.refreshToken });
      if (status >= 500 || status === 429)
        throw providerError('CALENDAR_UNAVAILABLE', 'Google didn’t answer the refresh.');
      // Our own client refused (a wrong secret in this deploy) is ours to fix, never the member's.
      if (status === 401 || answer.error === 'invalid_client' || answer.error === 'unauthorized_client') {
        throw providerError('CALENDAR_UNAVAILABLE', 'Google refused Timefix’s own calendar client.');
      }
      if (answer.error === 'invalid_grant') {
        throw providerError('CALENDAR_AUTH_REVOKED', 'Google no longer accepts this calendar’s access.');
      }
      if (status >= 400 || answer.access_token === undefined) {
        throw providerError('CALENDAR_AUTH', 'Google refused the refresh.');
      }
      return {
        accessToken: answer.access_token,
        // Google keeps the refresh token unless it hands a new one.
        refreshToken: answer.refresh_token ?? tokens.refreshToken,
        expiresAt: expiry(answer.expires_in),
      };
    },

    async listChanges(tokens, calendarId, syncToken, window) {
      const events: ProviderEvent[] = [];
      let pageToken: string | undefined;
      for (let page = 0; page < MAX_PAGES; page += 1) {
        const params = new URLSearchParams({
          singleEvents: 'true',
          showDeleted: 'true',
          maxResults: String(PAGE_SIZE),
          fields: `items(${EVENT_FIELDS}),nextPageToken,nextSyncToken`,
        });
        // A sync token takes no window (Google refuses both); a full sync takes the window.
        if (syncToken === undefined) {
          params.set('timeMin', window.from);
          params.set('timeMax', window.to);
        } else {
          params.set('syncToken', syncToken);
        }
        if (pageToken !== undefined) params.set('pageToken', pageToken);
        const response = await call(
          `${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events?${params.toString()}`,
          { headers: { Authorization: `Bearer ${tokens.accessToken}` } },
        );
        if (response.status === 410) {
          throw providerError('CALENDAR_SYNC_TOKEN_GONE', 'Google asked for a full sync.');
        }
        if (!response.ok) {
          throw providerError(
            codeForStatus(response.status),
            `Google refused the change list (${String(response.status)}).`,
          );
        }
        const body = await json<{
          readonly items?: readonly GoogleEvent[];
          readonly nextPageToken?: string;
          readonly nextSyncToken?: string;
        }>(response);
        for (const item of body.items ?? []) {
          const event = eventOf(item);
          if (event !== undefined) events.push(event);
        }
        if (body.nextPageToken !== undefined) {
          pageToken = body.nextPageToken;
          continue;
        }
        if (body.nextSyncToken === undefined) {
          throw providerError('CALENDAR_UNAVAILABLE', 'Google ended the change list without a sync token.');
        }
        return { events, nextSyncToken: body.nextSyncToken };
      }
      throw providerError('CALENDAR_UNAVAILABLE', 'The calendar has more changes than one sync reads.');
    },

    async freeBusy(tokens, from, to) {
      const body = await api<{
        readonly calendars?: { readonly primary?: { readonly busy?: readonly BusyInterval[] } };
      }>(tokens, '/freeBusy', {
        method: 'POST',
        body: JSON.stringify({ timeMin: from, timeMax: to, items: [{ id: 'primary' }] }),
      });
      return (body.calendars?.primary?.busy ?? []).map((busy) => ({
        start: new Date(busy.start).toISOString(),
        end: new Date(busy.end).toISOString(),
      }));
    },

    async createEvent(tokens, input: NewEvent) {
      // sendUpdates=all: Google invites the attendees, so the event reaches their calendars without their consent.
      const params = new URLSearchParams({ sendUpdates: 'all' });
      // Version 1 is the only one that reads conferenceData; without it the Meet request is silently ignored.
      if (input.video) params.set('conferenceDataVersion', '1');
      // The event's id comes from the request id (Google takes base32hex, which a uuid's hex digits are), so a
      // retry after a lost answer meets 409 and reads back the event the first try made: one invitation, never two.
      const eventId = input.requestId.toLowerCase().replace(/[^0-9a-v]/g, '');
      const response = await call(`${CALENDAR_API}/calendars/primary/events?${params.toString()}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokens.accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: eventId,
          summary: input.title,
          ...(input.description === undefined ? {} : { description: input.description }),
          ...(input.location === undefined ? {} : { location: input.location }),
          start: { dateTime: input.start, timeZone: input.timeZone },
          end: { dateTime: input.end, timeZone: input.timeZone },
          attendees: input.attendees.map((attendee) => ({
            email: attendee.email,
            ...(attendee.name === undefined ? {} : { displayName: attendee.name }),
          })),
          // The request id is Google's idempotency key: a retry never makes a second Meet link.
          ...(input.video
            ? {
                conferenceData: {
                  createRequest: { requestId: input.requestId, conferenceSolutionKey: { type: 'hangoutsMeet' } },
                },
              }
            : {}),
        }),
      });
      if (!response.ok && response.status !== 409) {
        throw providerError(
          codeForStatus(response.status),
          `Google refused the calendar call (${String(response.status)}).`,
        );
      }
      const made =
        response.status === 409
          ? await api<GoogleEvent>(tokens, `/calendars/primary/events/${encodeURIComponent(eventId)}`)
          : await json<GoogleEvent>(response);
      const event = eventOf(made);
      if (event === undefined) throw providerError('CALENDAR_UNAVAILABLE', 'Google made no event.');
      return event;
    },

    async updateEvent(tokens, eventId, input) {
      // PATCH, not PUT: a full replace would drop what the member added since, and no conferenceData keeps the link.
      const changed = await api<GoogleEvent>(
        tokens,
        `/calendars/primary/events/${encodeURIComponent(eventId)}?sendUpdates=all`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            ...(input.title === undefined ? {} : { summary: input.title }),
            ...(input.start === undefined ? {} : { start: { dateTime: input.start, timeZone: input.timeZone } }),
            ...(input.end === undefined ? {} : { end: { dateTime: input.end, timeZone: input.timeZone } }),
          }),
        },
      );
      const event = eventOf(changed);
      if (event === undefined) throw providerError('CALENDAR_UNAVAILABLE', 'Google changed no event.');
      return event;
    },

    async cancelEvent(tokens, eventId) {
      const response = await call(
        `${CALENDAR_API}/calendars/primary/events/${encodeURIComponent(eventId)}?sendUpdates=all`,
        { method: 'DELETE', headers: { Authorization: `Bearer ${tokens.accessToken}` } },
      );
      // Already gone is what a cancel asks for.
      if (response.ok || response.status === 404 || response.status === 410) return;
      throw providerError(codeForStatus(response.status), `Google refused the cancel (${String(response.status)}).`);
    },

    async watch(tokens, calendarId, address, channelToken): Promise<CalendarChannel> {
      const id = crypto.randomUUID();
      const made = await api<{ readonly id?: string; readonly resourceId?: string; readonly expiration?: string }>(
        tokens,
        `/calendars/${encodeURIComponent(calendarId)}/events/watch`,
        { method: 'POST', body: JSON.stringify({ id, type: 'web_hook', address, token: channelToken }) },
      );
      const expires = Number(made.expiration);
      if (made.resourceId === undefined || !Number.isFinite(expires)) {
        throw providerError('CALENDAR_UNAVAILABLE', 'Google opened no channel.');
      }
      return { id: made.id ?? id, resourceId: made.resourceId, expiresAt: new Date(expires).toISOString() };
    },

    async stopWatch(tokens, channel) {
      const response = await call(`${CALENDAR_API}/channels/stop`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokens.accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: channel.id, resourceId: channel.resourceId }),
      });
      if (response.ok || response.status === 404) return;
      throw providerError(
        codeForStatus(response.status),
        `Google refused to stop the channel (${String(response.status)}).`,
      );
    },
    async revoke(tokens) {
      // The refresh token ends the whole grant; Google answers 400 for one already gone, which counts as done.
      const response = await call(REVOKE_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token: tokens.refreshToken }),
      });
      if (response.ok || response.status === 400) return;
      throw providerError(
        codeForStatus(response.status),
        `Google refused to revoke the grant (${String(response.status)}).`,
      );
    },
  };
}

/** A guest's grant for one visit (spec 0028): an access token, its expiry, and who they are. Never stored. */
export interface GuestGrant {
  readonly accessToken: string;
  /** When the access token stops working, ISO 8601 in UTC. */
  readonly expiresAt: string;
  readonly email: string;
  readonly name: string;
}

/**
 * A booking page visitor's own Google calendar, for one visit (spec 0028,
 * AC-722): free and busy only, online access (no refresh token), and nothing
 * kept but what the visitor's own cookie carries.
 */
export interface GuestCalendar {
  authorizeUrl(state: string, redirectUri: string): string;
  /** The code for a grant; a grant without free and busy is `CALENDAR_SCOPE_DECLINED`. */
  exchange(code: string, redirectUri: string): Promise<GuestGrant>;
  freeBusy(accessToken: string, from: string, to: string): Promise<readonly BusyInterval[]>;
  /** Asks Google to forget the grant; best effort, never throws. */
  revoke(accessToken: string): Promise<void>;
}

/** The guest leg over the same OAuth client, its free and busy read through `provider`. */
export function createGoogleGuest(options: GoogleCalendarOptions, provider: CalendarProvider): GuestCalendar {
  const send = options.fetch ?? fetch;
  const now = options.now ?? (() => new Date());
  const call = async (url: string, init: RequestInit = {}): Promise<Response> => {
    try {
      return await send(url, { ...init, signal: AbortSignal.timeout(CALL_TIMEOUT_MS) });
    } catch {
      throw providerError('CALENDAR_UNAVAILABLE', 'Google’s calendar didn’t answer.');
    }
  };
  const json = async <T>(response: Response): Promise<T> => {
    try {
      return (await response.json()) as T;
    } catch {
      throw providerError('CALENDAR_UNAVAILABLE', 'Google answered with something that wasn’t JSON.');
    }
  };
  return {
    authorizeUrl(state, redirectUri) {
      const url = new URL(AUTHORIZE_ENDPOINT);
      url.searchParams.set('client_id', options.clientId);
      url.searchParams.set('redirect_uri', redirectUri);
      url.searchParams.set('response_type', 'code');
      // Online: no refresh token, so nothing outlives the visit.
      url.searchParams.set('access_type', 'online');
      url.searchParams.set('prompt', 'select_account');
      url.searchParams.set('scope', GUEST_CONNECT_SCOPES.join(' '));
      url.searchParams.set('state', state);
      return url.toString();
    },

    async exchange(code, redirectUri) {
      const response = await call(TOKEN_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirectUri,
          client_id: options.clientId,
          client_secret: options.clientSecret,
        }),
      });
      const answer = await json<TokenAnswer>(response);
      if (response.status >= 500) throw providerError('CALENDAR_UNAVAILABLE', 'Google didn’t answer the sign in.');
      if (response.status === 401 || answer.error === 'invalid_client') {
        throw providerError('CALENDAR_UNAVAILABLE', 'Google refused Timefix’s own calendar client.');
      }
      if (response.status >= 400 || answer.access_token === undefined) {
        throw providerError('CALENDAR_AUTH', 'Google didn’t accept that sign in. Try connecting again.');
      }
      if (!grantsFreeBusy(parseGrantedScopes(answer.scope))) {
        throw providerError('CALENDAR_SCOPE_DECLINED', 'The calendar was connected without seeing when you’re busy.');
      }
      const profile = await call(USERINFO_ENDPOINT, { headers: { Authorization: `Bearer ${answer.access_token}` } });
      if (!profile.ok) throw providerError(codeForStatus(profile.status), 'Google didn’t say whose calendar it is.');
      const person = await json<{ readonly email?: string; readonly email_verified?: boolean; readonly name?: string }>(
        profile,
      );
      if (person.email === undefined || person.email_verified === false) {
        throw providerError('CALENDAR_AUTH', 'Google didn’t say whose calendar it is.');
      }
      const seconds = Math.min(3600, Math.max(0, answer.expires_in ?? 3600));
      return {
        accessToken: answer.access_token,
        expiresAt: new Date(now().getTime() + seconds * 1000).toISOString(),
        email: normaliseEmail(person.email),
        name: (person.name ?? '').trim().slice(0, 200),
      };
    },

    freeBusy(accessToken, from, to) {
      return provider.freeBusy({ accessToken, refreshToken: '', expiresAt: '' }, from, to);
    },

    async revoke(accessToken) {
      try {
        await call(REVOKE_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ token: accessToken }),
        });
      } catch {
        // Best effort: the token dies within the hour anyway.
      }
    },
  };
}
