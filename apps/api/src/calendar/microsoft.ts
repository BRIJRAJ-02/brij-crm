// The Outlook adapter (spec 0024 milestone 4, AC-1006 to AC-1011): the only
// module that calls Microsoft for calendars, behind core's `CalendarProvider`,
// with the same shape as the Google one. Plain REST over `fetch` (Microsoft
// identity platform v2 for OAuth, Microsoft Graph v1.0 for calendars), no SDK.
//
// - Connecting: the `common` authority by default (work or school accounts and
//   personal outlook.com ones), scopes `offline_access User.Read
//   Calendars.ReadWrite` plus `openid email`; the account is `/me`'s mail,
//   else its sign in name. A grant without Calendars.ReadWrite is
//   `CALENDAR_SCOPE_DECLINED`; Microsoft turns refresh tokens over, so a
//   refresh keeps the new one.
// - Syncing: `calendarView/delta` per calendar over the window (AC-1007), its
//   pages followed to a delta link, which is the sync token. Graph's delta
//   link keeps the window it began with, so a link begun more than a week
//   before the window's end counts as expired and the calendar syncs in full;
//   an expired link (`syncStateNotFound`, `resyncRequired`, 410) is
//   `CALENDAR_SYNC_TOKEN_GONE`. A removed event arrives as `@removed`, which is
//   a cancellation by its id.
// - Events map like Google's (AC-1009): `iCalUId` for the meeting, `showAs`
//   free or working elsewhere as not busy, `isCancelled` as cancelled,
//   sensitivity private or confidential as private, the account's own answer
//   from `responseStatus`. The organiser is listed among the attendees, as
//   Google lists them, so the rules for a meeting read the same.
// - Free and busy (AC-1010): every conflict calendar's `calendarView`, its
//   busy spans by `showAs`, in one `$batch` request per account (20 per batch).
//   Each calendar answers on its own.
// - Events: created in the destination calendar with the request id as Graph's
//   `transactionId` (a retry makes no second event), with a Teams link when
//   video is asked and the calendar offers Teams (AC-1011); when it doesn't
//   (most personal accounts) the event is made without one and says so.
// - Push (AC-1008): a change notification subscription per calendar on its
//   events, the channel token as its `clientState`, lifecycle notices to the
//   same address; renewed by making a new one before it runs out (they last at
//   most 4,230 minutes).
//
// Failures sort as the Google adapter's do: `invalid_grant` on a refresh is
// `CALENDAR_AUTH_REVOKED`; a 401 or 403 is `CALENDAR_AUTH`; a 404 on a
// calendar `CALENDAR_GONE`; a 429, a 5xx, the network, a body that won't
// parse, or our own client refused (`invalid_client`) is
// `CALENDAR_UNAVAILABLE`. No message quotes a token, and no token is logged.
import { createHash } from 'node:crypto';
import {
  normaliseEmail,
  PRIMARY_CALENDAR,
  providerError,
  type BusyInterval,
  type CalendarBusy,
  type CalendarChannel,
  type CalendarErrorCode,
  type CalendarProvider,
  type CalendarTokens,
  type CreatedProviderEvent,
  type ExchangedTokens,
  type ProviderAttendee,
  type ProviderCalendar,
  type ProviderEvent,
  type ProviderResponse,
} from '@crm/core';

/** The Graph API's root. */
export const GRAPH_API = 'https://graph.microsoft.com/v1.0';

/** The scopes a connect asks for (AC-1006), with `openid email` for who the account is. */
export const MICROSOFT_SCOPES = ['openid', 'email', 'offline_access', 'User.Read', 'Calendars.ReadWrite'] as const;

/** The most pages one change list reads. */
const MAX_PAGES = 100;

/** Events one delta page asks for. */
const PAGE_SIZE = 200;

/** Requests one `$batch` carries (Graph's most). */
const BATCH_MAX = 20;

/** How long a subscription asks to live: a little under Graph's most for events, 4,230 minutes. */
const SUBSCRIPTION_MINUTES = 4_200;

/** A delta link begun this long before the window's end syncs in full, so the window moves (spec: a week). */
const DELTA_STALE_MS = 7 * 86_400_000;

/** How long a call may take before it counts as Microsoft not answering. */
const CALL_TIMEOUT_MS = 20_000;

/** What the adapter needs: the Entra app, its tenant (`common` by default), and (tests) a fetch of its own. */
export interface MicrosoftCalendarOptions {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly tenant?: string;
  readonly fetch?: typeof fetch;
  readonly now?: () => Date;
}

/** Graph's verdict on one call: 401 and 403 are about the grant, a 404 says the calendar is gone. */
export function graphCodeForStatus(status: number): CalendarErrorCode {
  if (status === 404) return 'CALENDAR_GONE';
  return status === 401 || status === 403 ? 'CALENDAR_AUTH' : 'CALENDAR_UNAVAILABLE';
}

/** A Graph date and time (`{ dateTime, timeZone }`) as an ISO moment in UTC. */
function momentOf(value: { readonly dateTime?: string; readonly timeZone?: string } | undefined): string | undefined {
  if (value?.dateTime === undefined) return undefined;
  const zone = value.timeZone ?? 'UTC';
  // Graph answers in the zone asked for (UTC here); a zone left on the text says itself.
  const text = /[zZ]|[+-]\d{2}:\d{2}$/.test(value.dateTime) || zone !== 'UTC' ? value.dateTime : `${value.dateTime}Z`;
  const at = Date.parse(text);
  return Number.isFinite(at) ? new Date(at).toISOString() : undefined;
}

/** An ISO moment as Graph takes it: the local time text and its zone (always UTC from here). */
const graphTime = (iso: string) => ({ dateTime: new Date(iso).toISOString().replace(/Z$/, ''), timeZone: 'UTC' });

/** Graph's event, the fields a sync reads. */
interface GraphEvent {
  readonly id?: string;
  readonly '@removed'?: { readonly reason?: string };
  readonly iCalUId?: string;
  readonly subject?: string;
  readonly start?: { readonly dateTime?: string; readonly timeZone?: string };
  readonly end?: { readonly dateTime?: string; readonly timeZone?: string };
  readonly isAllDay?: boolean;
  readonly isCancelled?: boolean;
  readonly showAs?: string;
  readonly sensitivity?: string;
  readonly location?: { readonly displayName?: string };
  readonly onlineMeeting?: { readonly joinUrl?: string } | null;
  readonly onlineMeetingUrl?: string | null;
  readonly organizer?: { readonly emailAddress?: { readonly address?: string; readonly name?: string } };
  readonly attendees?: readonly {
    readonly emailAddress?: { readonly address?: string; readonly name?: string };
    readonly status?: { readonly response?: string };
  }[];
  readonly responseStatus?: { readonly response?: string };
  readonly changeKey?: string;
  readonly type?: string;
}

const RESPONSES: Readonly<Record<string, ProviderResponse>> = {
  accepted: 'accepted',
  organizer: 'accepted',
  declined: 'declined',
  tentativelyAccepted: 'tentative',
  none: 'needs_action',
  notResponded: 'needs_action',
};

/** Whether `showAs` keeps the member free (AC-1009). */
const isFreeShow = (showAs: string | undefined) => showAs === 'free' || showAs === 'workingElsewhere';

/** A Graph event as core's, for the connected account `self`. A removed one carries only its id. */
export function graphEventOf(event: GraphEvent, self: string): ProviderEvent | undefined {
  if (event.id === undefined) return undefined;
  if (event['@removed'] !== undefined) return { id: event.id, status: 'cancelled', attendees: [], isPrivate: false };
  const start = momentOf(event.start);
  const end = momentOf(event.end);
  const allDay = event.isAllDay === true;
  const organizer = event.organizer?.emailAddress?.address;
  const own = RESPONSES[event.responseStatus?.response ?? ''] ?? 'needs_action';
  const listed: ProviderAttendee[] = (event.attendees ?? []).flatMap((attendee) => {
    const address = attendee.emailAddress?.address;
    if (address === undefined) return [];
    const email = normaliseEmail(address);
    const isSelf = email === self;
    return [
      {
        email,
        ...(attendee.emailAddress?.name === undefined ? {} : { name: attendee.emailAddress.name }),
        response: isSelf ? own : (RESPONSES[attendee.status?.response ?? ''] ?? 'needs_action'),
        isOrganizer: organizer !== undefined && normaliseEmail(organizer) === email,
        isSelf,
      },
    ];
  });
  // The organiser among the attendees, as Google lists them.
  const organizerEmail = organizer === undefined ? undefined : normaliseEmail(organizer);
  const attendees =
    organizerEmail === undefined || listed.some((each) => each.email === organizerEmail)
      ? listed
      : [
          {
            email: organizerEmail,
            ...(event.organizer?.emailAddress?.name === undefined ? {} : { name: event.organizer.emailAddress.name }),
            response: 'accepted' as const,
            isOrganizer: true,
            isSelf: organizerEmail === self,
          },
          ...listed,
        ];
  const videoUrl = event.onlineMeeting?.joinUrl ?? event.onlineMeetingUrl ?? undefined;
  const location = event.location?.displayName;
  return {
    id: event.id,
    status: event.isCancelled === true ? 'cancelled' : own === 'tentative' ? 'tentative' : 'confirmed',
    ...(event.iCalUId === undefined ? {} : { icalUid: event.iCalUId }),
    ...(event.subject === undefined ? {} : { title: event.subject }),
    ...(start === undefined ? {} : { start: { at: allDay ? `${start.slice(0, 10)}T00:00:00.000Z` : start, allDay } }),
    ...(end === undefined ? {} : { end: { at: allDay ? `${end.slice(0, 10)}T00:00:00.000Z` : end, allDay } }),
    ...(location === undefined || location === '' ? {} : { location }),
    ...(videoUrl === undefined ? {} : { videoUrl }),
    ...(organizerEmail === undefined ? {} : { organizerEmail }),
    attendees,
    isPrivate: event.sensitivity === 'private' || event.sensitivity === 'confidential',
    ...(isFreeShow(event.showAs) ? { isFree: true } : {}),
    ...(event.changeKey === undefined ? {} : { etag: event.changeKey }),
  };
}

/** The sync token: Graph's delta link, and the window's end it began with. */
interface DeltaToken {
  readonly link: string;
  readonly to: string;
}

const encodeToken = (token: DeltaToken) => `graph1:${Buffer.from(JSON.stringify(token)).toString('base64url')}`;

/** A stored sync token, or undefined for one this adapter didn't make (or whose link left Graph). */
function decodeToken(value: string): DeltaToken | undefined {
  if (!value.startsWith('graph1:')) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(value.slice('graph1:'.length), 'base64url').toString('utf8')) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return undefined;
    const { link, to } = parsed as Record<string, unknown>;
    if (typeof link !== 'string' || typeof to !== 'string' || !link.startsWith(`${GRAPH_API}/`)) return undefined;
    return { link, to };
  } catch {
    return undefined;
  }
}

/** The token endpoint's answer. */
interface TokenAnswer {
  readonly access_token?: string;
  readonly refresh_token?: string;
  readonly expires_in?: number;
  readonly scope?: string;
  readonly error?: string;
}

/** A calendar's path: `primary` is the account's default calendar. */
const calendarPath = (calendarId: string) =>
  calendarId === PRIMARY_CALENDAR ? '/me/calendar' : `/me/calendars/${encodeURIComponent(calendarId)}`;

/** The Outlook adapter for one Entra app registration. */
export function createMicrosoftCalendar(options: MicrosoftCalendarOptions): CalendarProvider {
  const send = options.fetch ?? fetch;
  const now = options.now ?? (() => new Date());
  const authority = `https://login.microsoftonline.com/${encodeURIComponent(options.tenant ?? 'common')}/oauth2/v2.0`;

  const call = async (url: string, init: RequestInit = {}): Promise<Response> => {
    try {
      return await send(url, { ...init, signal: AbortSignal.timeout(CALL_TIMEOUT_MS) });
    } catch {
      throw providerError('CALENDAR_UNAVAILABLE', 'Microsoft’s calendar didn’t answer.');
    }
  };

  const json = async <T>(response: Response): Promise<T> => {
    try {
      return (await response.json()) as T;
    } catch {
      throw providerError('CALENDAR_UNAVAILABLE', 'Microsoft answered with something that wasn’t JSON.');
    }
  };

  /** A Graph call with the member's access token (a path under the API, or a link Graph handed out). */
  const graph = async <T>(
    tokens: CalendarTokens,
    pathOrLink: string,
    init: RequestInit & { readonly prefer?: string } = {},
  ): Promise<T> => {
    const url = pathOrLink.startsWith('https://') ? pathOrLink : `${GRAPH_API}${pathOrLink}`;
    if (!url.startsWith(`${GRAPH_API}/`)) throw providerError('CALENDAR_UNAVAILABLE', 'That isn’t a Graph address.');
    const { prefer, ...rest } = init;
    const response = await call(url, {
      ...rest,
      headers: {
        Authorization: `Bearer ${tokens.accessToken}`,
        ...(rest.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(prefer === undefined ? {} : { Prefer: prefer }),
      },
    });
    if (!response.ok) {
      throw providerError(
        graphCodeForStatus(response.status),
        `Microsoft refused the calendar call (${String(response.status)}).`,
      );
    }
    return response.status === 202 || response.status === 204 ? (undefined as T) : json<T>(response);
  };

  const token = async (body: Readonly<Record<string, string>>) => {
    const response = await call(`${authority}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ ...body, client_id: options.clientId, client_secret: options.clientSecret }),
    });
    return { status: response.status, answer: await json<TokenAnswer>(response) };
  };

  const expiry = (seconds: number | undefined) =>
    new Date(now().getTime() + Math.max(0, seconds ?? 3600) * 1000).toISOString();

  /** Who the account is: `/me`'s mail, else its sign in name. */
  const accountOf = async (accessToken: string): Promise<string> => {
    const me = await graph<{ readonly mail?: string | null; readonly userPrincipalName?: string }>(
      { accessToken, refreshToken: '', expiresAt: '' },
      '/me?$select=mail,userPrincipalName',
    );
    const email = me.mail ?? me.userPrincipalName;
    if (email === undefined || !email.includes('@')) {
      throw providerError('CALENDAR_AUTH', 'Microsoft didn’t say whose calendar it is.');
    }
    return normaliseEmail(email);
  };

  // Who each access token is for, so a sync of several calendars asks `/me` once per token (an hour at most).
  // Keyed by the token's SHA-256, never the token itself, so a heap dump of the cache holds no credential.
  const selves = new Map<string, string>();
  const selfOf = async (tokens: CalendarTokens): Promise<string> => {
    const key = createHash('sha256').update(tokens.accessToken).digest('base64url');
    const known = selves.get(key);
    if (known !== undefined) return known;
    const email = await accountOf(tokens.accessToken);
    selves.set(key, email);
    if (selves.size > 500) {
      const oldest = selves.keys().next();
      if (oldest.done !== true) selves.delete(oldest.value);
    }
    return email;
  };

  /** One calendar's busy spans from its calendar view, every page of it. */
  const busyFromView = async (
    tokens: CalendarTokens,
    first: { readonly value?: readonly GraphEvent[]; readonly '@odata.nextLink'?: string },
  ): Promise<readonly BusyInterval[]> => {
    const busy: BusyInterval[] = [];
    let page = first;
    for (let index = 0; index < MAX_PAGES; index += 1) {
      for (const item of page.value ?? []) {
        if (item.isCancelled === true || isFreeShow(item.showAs)) continue;
        const start = momentOf(item.start);
        const end = momentOf(item.end);
        if (start !== undefined && end !== undefined && end > start) busy.push({ start, end });
      }
      const next = page['@odata.nextLink'];
      if (next === undefined) return busy;
      page = await graph(tokens, next, { prefer: 'outlook.timezone="UTC"' });
    }
    return busy;
  };

  return {
    authorizeUrl(state, redirectUri) {
      const url = new URL(`${authority}/authorize`);
      url.searchParams.set('client_id', options.clientId);
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('redirect_uri', redirectUri);
      url.searchParams.set('response_mode', 'query');
      url.searchParams.set('scope', MICROSOFT_SCOPES.join(' '));
      url.searchParams.set('prompt', 'select_account');
      url.searchParams.set('state', state);
      return url.toString();
    },

    async exchangeCode(code, redirectUri): Promise<ExchangedTokens> {
      const { status, answer } = await token({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        scope: MICROSOFT_SCOPES.join(' '),
      });
      if (status >= 500) throw providerError('CALENDAR_UNAVAILABLE', 'Microsoft didn’t answer the sign in.');
      if (status === 401 || answer.error === 'invalid_client' || answer.error === 'unauthorized_client') {
        throw providerError('CALENDAR_UNAVAILABLE', 'Microsoft refused Timefix’s own calendar app.');
      }
      if (status >= 400 || answer.access_token === undefined) {
        throw providerError('CALENDAR_AUTH', 'Microsoft didn’t accept that sign in. Try connecting again.');
      }
      const granted = (answer.scope ?? '').toLowerCase().split(/\s+/);
      if (!granted.some((scope) => scope === 'calendars.readwrite' || scope.endsWith('/calendars.readwrite'))) {
        throw providerError('CALENDAR_SCOPE_DECLINED', 'The calendar was connected without the access Timefix needs.');
      }
      if (answer.refresh_token === undefined) {
        throw providerError('CALENDAR_AUTH', 'Microsoft gave no lasting access. Try connecting again.');
      }
      return {
        accessToken: answer.access_token,
        refreshToken: answer.refresh_token,
        expiresAt: expiry(answer.expires_in),
        accountEmail: await accountOf(answer.access_token),
      };
    },

    async refresh(tokens) {
      const { status, answer } = await token({
        grant_type: 'refresh_token',
        refresh_token: tokens.refreshToken,
        scope: MICROSOFT_SCOPES.join(' '),
      });
      if (status >= 500 || status === 429) {
        throw providerError('CALENDAR_UNAVAILABLE', 'Microsoft didn’t answer the refresh.');
      }
      if (status === 401 || answer.error === 'invalid_client' || answer.error === 'unauthorized_client') {
        throw providerError('CALENDAR_UNAVAILABLE', 'Microsoft refused Timefix’s own calendar app.');
      }
      if (answer.error === 'invalid_grant' || answer.error === 'interaction_required') {
        throw providerError('CALENDAR_AUTH_REVOKED', 'Microsoft no longer accepts this calendar’s access.');
      }
      if (status >= 400 || answer.access_token === undefined) {
        throw providerError('CALENDAR_AUTH', 'Microsoft refused the refresh.');
      }
      return {
        accessToken: answer.access_token,
        // Microsoft turns refresh tokens over: keep the new one.
        refreshToken: answer.refresh_token ?? tokens.refreshToken,
        expiresAt: expiry(answer.expires_in),
      };
    },

    async listCalendars(tokens) {
      const calendars: ProviderCalendar[] = [];
      let next: string | undefined = '/me/calendars?$select=id,name,hexColor,canEdit,isDefaultCalendar,owner&$top=100';
      for (let page = 0; page < MAX_PAGES && next !== undefined; page += 1) {
        const body: {
          readonly value?: readonly {
            readonly id?: string;
            readonly name?: string;
            readonly hexColor?: string;
            readonly canEdit?: boolean;
            readonly isDefaultCalendar?: boolean;
            readonly owner?: { readonly address?: string };
          }[];
          readonly '@odata.nextLink'?: string;
        } = await graph(tokens, next);
        for (const item of body.value ?? []) {
          if (item.id === undefined) continue;
          const colour = item.hexColor?.toLowerCase();
          calendars.push({
            id: item.id,
            name: item.name ?? item.id,
            ...(colour !== undefined && /^#[0-9a-f]{6}$/.test(colour) ? { colour } : {}),
            accessRole: item.isDefaultCalendar === true ? 'owner' : item.canEdit === true ? 'writer' : 'reader',
            isPrimary: item.isDefaultCalendar === true,
          });
        }
        next = body['@odata.nextLink'];
      }
      return calendars;
    },

    async listChanges(tokens, calendarId, syncToken, window) {
      const self = await selfOf(tokens);
      const stored = syncToken === undefined ? undefined : decodeToken(syncToken);
      if (syncToken !== undefined && stored === undefined) {
        throw providerError('CALENDAR_SYNC_TOKEN_GONE', 'That sync token is not one of Graph’s.');
      }
      // A link begun with a window that has since moved a week: in full, so the new days arrive.
      if (stored !== undefined && Date.parse(window.to) - Date.parse(stored.to) > DELTA_STALE_MS) {
        throw providerError('CALENDAR_SYNC_TOKEN_GONE', 'The window moved since this sync began.');
      }
      const start = new URLSearchParams({ startDateTime: window.from, endDateTime: window.to });
      let link = stored?.link ?? `${GRAPH_API}${calendarPath(calendarId)}/calendarView/delta?${start.toString()}`;
      const events: ProviderEvent[] = [];
      for (let page = 0; page < MAX_PAGES; page += 1) {
        const response = await call(link, {
          headers: {
            Authorization: `Bearer ${tokens.accessToken}`,
            Prefer: `odata.maxpagesize=${String(PAGE_SIZE)}, outlook.timezone="UTC"`,
          },
        });
        if (response.status === 410)
          throw providerError('CALENDAR_SYNC_TOKEN_GONE', 'Microsoft asked for a full sync.');
        if (!response.ok) {
          const failure = await json<{ readonly error?: { readonly code?: string } }>(response).catch(() => ({}));
          const code = (failure as { readonly error?: { readonly code?: string } }).error?.code;
          if (code === 'syncStateNotFound' || code === 'resyncRequired' || code === 'SyncStateNotFound') {
            throw providerError('CALENDAR_SYNC_TOKEN_GONE', 'Microsoft asked for a full sync.');
          }
          throw providerError(
            graphCodeForStatus(response.status),
            `Microsoft refused the change list (${String(response.status)}).`,
          );
        }
        const body = await json<{
          readonly value?: readonly GraphEvent[];
          readonly '@odata.nextLink'?: string;
          readonly '@odata.deltaLink'?: string;
        }>(response);
        for (const item of body.value ?? []) {
          const event = graphEventOf(item, self);
          if (event !== undefined) events.push(event);
        }
        const next = body['@odata.nextLink'];
        if (next !== undefined) {
          if (!next.startsWith(`${GRAPH_API}/`))
            throw providerError('CALENDAR_UNAVAILABLE', 'That isn’t a Graph address.');
          link = next;
          continue;
        }
        const delta = body['@odata.deltaLink'];
        if (delta === undefined || !delta.startsWith(`${GRAPH_API}/`)) {
          throw providerError('CALENDAR_UNAVAILABLE', 'Microsoft ended the change list without a delta link.');
        }
        return { events, nextSyncToken: encodeToken({ link: delta, to: stored?.to ?? window.to }) };
      }
      throw providerError('CALENDAR_UNAVAILABLE', 'The calendar has more changes than one sync reads.');
    },

    async freeBusy(tokens, calendarIds, from, to) {
      const answers = new Map<string, CalendarBusy>();
      const range = new URLSearchParams({
        startDateTime: from,
        endDateTime: to,
        $select: 'showAs,start,end,isCancelled',
        $top: '1000',
      });
      for (let at = 0; at < calendarIds.length; at += BATCH_MAX) {
        const chunk = calendarIds.slice(at, at + BATCH_MAX);
        const batch = await graph<{
          readonly responses?: readonly { readonly id?: string; readonly status?: number; readonly body?: unknown }[];
        }>(tokens, '/$batch', {
          method: 'POST',
          body: JSON.stringify({
            requests: chunk.map((calendarId, index) => ({
              id: String(index),
              method: 'GET',
              url: `${calendarPath(calendarId)}/calendarView?${range.toString()}`,
              headers: { Prefer: 'outlook.timezone="UTC"' },
            })),
          }),
        });
        for (const [index, calendarId] of chunk.entries()) {
          const answer = batch.responses?.find((each) => each.id === String(index));
          if (answer?.status === undefined || answer.status < 200 || answer.status >= 300) {
            answers.set(calendarId, { error: graphCodeForStatus(answer?.status ?? 503) });
            continue;
          }
          try {
            answers.set(calendarId, {
              busy: await busyFromView(tokens, answer.body ?? {}),
            });
          } catch {
            answers.set(calendarId, { error: 'CALENDAR_UNAVAILABLE' });
          }
        }
      }
      return answers;
    },

    async createEvent(tokens, calendarId, input): Promise<CreatedProviderEvent> {
      const self = await selfOf(tokens);
      // Teams only where the calendar offers it (AC-1011): most personal accounts don't.
      let teams = false;
      if (input.video) {
        const calendar = await graph<{ readonly allowedOnlineMeetingProviders?: readonly string[] }>(
          tokens,
          `${calendarPath(calendarId)}?$select=allowedOnlineMeetingProviders`,
        );
        teams = (calendar.allowedOnlineMeetingProviders ?? []).includes('teamsForBusiness');
      }
      const made = await graph<GraphEvent>(tokens, `${calendarPath(calendarId)}/events`, {
        method: 'POST',
        prefer: 'outlook.timezone="UTC"',
        body: JSON.stringify({
          subject: input.title,
          // The request id: Graph makes no second event for a retry with the same transaction id.
          transactionId: input.requestId,
          ...(input.description === undefined ? {} : { body: { contentType: 'text', content: input.description } }),
          ...(input.location === undefined ? {} : { location: { displayName: input.location } }),
          start: graphTime(input.start),
          end: graphTime(input.end),
          attendees: input.attendees.map((attendee) => ({
            emailAddress: { address: attendee.email, ...(attendee.name === undefined ? {} : { name: attendee.name }) },
            type: 'required',
          })),
          ...(teams ? { isOnlineMeeting: true, onlineMeetingProvider: 'teamsForBusiness' } : {}),
        }),
      });
      const event = graphEventOf(made, self);
      if (event === undefined) throw providerError('CALENDAR_UNAVAILABLE', 'Microsoft made no event.');
      return input.video && !teams ? { ...event, videoUnavailable: true } : event;
    },

    async updateEvent(tokens, calendarId, eventId, input) {
      const self = await selfOf(tokens);
      const changed = await graph<GraphEvent>(
        tokens,
        `${calendarPath(calendarId)}/events/${encodeURIComponent(eventId)}`,
        {
          method: 'PATCH',
          prefer: 'outlook.timezone="UTC"',
          body: JSON.stringify({
            ...(input.title === undefined ? {} : { subject: input.title }),
            ...(input.start === undefined ? {} : { start: graphTime(input.start) }),
            ...(input.end === undefined ? {} : { end: graphTime(input.end) }),
          }),
        },
      );
      const event = graphEventOf(changed, self);
      if (event === undefined) throw providerError('CALENDAR_UNAVAILABLE', 'Microsoft changed no event.');
      return event;
    },

    async cancelEvent(tokens, calendarId, eventId) {
      const path = `${GRAPH_API}${calendarPath(calendarId)}/events/${encodeURIComponent(eventId)}`;
      // The organiser cancels, which tells the attendees; anyone else can only remove their copy.
      const cancelled = await call(`${path}/cancel`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokens.accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ comment: '' }),
      });
      if (cancelled.ok || cancelled.status === 404 || cancelled.status === 410) return;
      if (cancelled.status === 400) {
        const removed = await call(path, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${tokens.accessToken}` },
        });
        if (removed.ok || removed.status === 404) return;
        throw providerError(
          graphCodeForStatus(removed.status),
          `Microsoft refused the cancel (${String(removed.status)}).`,
        );
      }
      throw providerError(
        graphCodeForStatus(cancelled.status),
        `Microsoft refused the cancel (${String(cancelled.status)}).`,
      );
    },

    async watch(tokens, calendarId, address, channelToken): Promise<CalendarChannel> {
      const resource = `${calendarPath(calendarId)}/events`;
      const made = await graph<{
        readonly id?: string;
        readonly resource?: string;
        readonly expirationDateTime?: string;
      }>(tokens, '/subscriptions', {
        method: 'POST',
        body: JSON.stringify({
          changeType: 'created,updated,deleted',
          notificationUrl: address,
          lifecycleNotificationUrl: address,
          resource: resource.slice(1),
          expirationDateTime: new Date(now().getTime() + SUBSCRIPTION_MINUTES * 60_000).toISOString(),
          clientState: channelToken,
        }),
      });
      const expires = Date.parse(made.expirationDateTime ?? '');
      if (made.id === undefined || !Number.isFinite(expires)) {
        throw providerError('CALENDAR_UNAVAILABLE', 'Microsoft made no subscription.');
      }
      return { id: made.id, resourceId: made.resource ?? resource, expiresAt: new Date(expires).toISOString() };
    },

    async stopWatch(tokens, channel) {
      const response = await call(`${GRAPH_API}/subscriptions/${encodeURIComponent(channel.id)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${tokens.accessToken}` },
      });
      if (response.ok || response.status === 404) return;
      throw providerError(
        graphCodeForStatus(response.status),
        `Microsoft refused to stop the subscription (${String(response.status)}).`,
      );
    },
    // A removed member's grant (spec 0031, AC-815): Microsoft has no way for an app to end its own delegated grant
    // (revokeSignInSessions would sign the person out of every Microsoft app). The sealed tokens go with the row, so
    // nothing here can use them again; the person removes the app from their Microsoft account's apps page.
    revoke() {
      return Promise.resolve();
    },
  };
}
