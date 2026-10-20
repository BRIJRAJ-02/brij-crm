// The fake calendar provider (spec 0024): one calendar per account, held in
// memory, that answers the provider interface the way Google does (full sync
// over a window, incremental sync by token with cancelled events as stubs, a
// sync token that can expire, a grant that can be revoked), so every sync
// path is tested without a network. Exported from `@crm/core/testing` only.
import {
  providerError,
  type CalendarChannel,
  type CalendarErrorCode,
  type CalendarProvider,
  type CalendarTokens,
  type ExchangedTokens,
  type NewEvent,
  type ProviderEvent,
} from './provider.ts';

/** One stored change: the event as it now is, and the change number that made it so. */
interface Held {
  readonly event: ProviderEvent;
  readonly version: number;
}

/** What a test can do to the fake, and what it can read back. */
export interface FakeCalendar {
  readonly provider: CalendarProvider;
  /** Adds or changes an event in `account`'s calendar. */
  put(account: string, event: ProviderEvent): void;
  /** Cancels an event: an incremental sync then reports a stub with its id only. */
  cancel(account: string, eventId: string): void;
  /** The next refresh fails with invalid grant (the member revoked access), and every one after it. */
  revoke(account: string): void;
  /** The next `listChanges` with a token answers 410 Gone. */
  expireSyncToken(account: string): void;
  /** The next calls of `method` fail with `code`, `times` times (1 by default). */
  failNext(method: keyof CalendarProvider, code: CalendarErrorCode, times?: number): void;
  /** How often each method was called. */
  calls(method: keyof CalendarProvider): number;
  /** Every channel `watch` opened, newest last: its address and the token it carries back on each notice. */
  watched(): readonly { readonly channel: CalendarChannel; readonly address: string; readonly token: string }[];
  /** The tokens `exchangeCode` hands out for `account`, as the provider made them. */
  tokensFor(account: string, expiresAt?: string): CalendarTokens;
}

/** The access token the fake hands out: the account and a counter, so a refresh is visible. */
const accessTokenOf = (account: string, round: number) => `fake-access:${account}:${String(round)}`;

/**
 * A fake provider. `exchangeCode('code:<account>')` connects `<account>`;
 * tokens name their account, so every call reads that account's calendar.
 */
export function createFakeCalendarProvider(options: { readonly now?: () => Date } = {}): FakeCalendar {
  const now = options.now ?? (() => new Date());
  const calendars = new Map<string, Map<string, Held>>();
  const revoked = new Set<string>();
  const expiring = new Set<string>();
  const failures = new Map<string, { code: CalendarErrorCode; times: number }>();
  const counts = new Map<string, number>();
  const channels: { readonly channel: CalendarChannel; readonly address: string; readonly token: string }[] = [];
  let version = 0;
  let round = 0;

  const calendarOf = (account: string) => {
    const found = calendars.get(account);
    if (found !== undefined) return found;
    const made = new Map<string, Held>();
    calendars.set(account, made);
    return made;
  };
  const accountOf = (tokens: CalendarTokens): string => {
    const [, account] = tokens.refreshToken.split(':');
    if (account === undefined) throw providerError('CALENDAR_AUTH', 'The fake knows no such token.');
    return account;
  };
  const enter = (method: keyof CalendarProvider) => {
    counts.set(method, (counts.get(method) ?? 0) + 1);
    const failure = failures.get(method);
    if (failure === undefined || failure.times <= 0) return;
    failure.times -= 1;
    throw providerError(failure.code, `The fake failed ${method} with ${failure.code}.`);
  };
  const tokensFor = (account: string, expiresAt?: string): CalendarTokens => {
    round += 1;
    return {
      accessToken: accessTokenOf(account, round),
      refreshToken: `fake-refresh:${account}`,
      expiresAt: expiresAt ?? new Date(now().getTime() + 3_600_000).toISOString(),
    };
  };
  const inWindow = (event: ProviderEvent, from: string, to: string) =>
    event.start === undefined || (event.start.at < to && (event.end?.at ?? event.start.at) >= from);

  const raw: CalendarProvider = {
    authorizeUrl(state, redirectUri) {
      enter('authorizeUrl');
      const url = new URL('https://calendar.fake/authorize');
      url.searchParams.set('state', state);
      url.searchParams.set('redirect_uri', redirectUri);
      return url.toString();
    },
    exchangeCode(code) {
      enter('exchangeCode');
      if (!code.startsWith('code:')) return Promise.reject(providerError('CALENDAR_AUTH', 'That code is not one.'));
      const account = code.slice('code:'.length).trim().toLowerCase();
      revoked.delete(account);
      const exchanged: ExchangedTokens = { ...tokensFor(account), accountEmail: account };
      return Promise.resolve(exchanged);
    },
    refresh(tokens) {
      enter('refresh');
      const account = accountOf(tokens);
      if (revoked.has(account)) {
        return Promise.reject(providerError('CALENDAR_AUTH_REVOKED', 'The account revoked access.'));
      }
      return Promise.resolve(tokensFor(account));
    },
    listChanges(tokens, _calendarId, syncToken, window) {
      enter('listChanges');
      const account = accountOf(tokens);
      if (revoked.has(account)) return Promise.reject(providerError('CALENDAR_AUTH', 'The grant was revoked.'));
      const held = [...calendarOf(account).values()];
      if (syncToken === undefined) {
        const events = held
          .filter((each) => each.event.status !== 'cancelled' && inWindow(each.event, window.from, window.to))
          .map((each) => each.event);
        return Promise.resolve({ events, nextSyncToken: `fake-sync:${String(version)}` });
      }
      if (expiring.delete(account)) {
        return Promise.reject(providerError('CALENDAR_SYNC_TOKEN_GONE', 'The sync token expired.'));
      }
      const since = Number(syncToken.slice('fake-sync:'.length));
      if (!syncToken.startsWith('fake-sync:') || !Number.isInteger(since)) {
        return Promise.reject(providerError('CALENDAR_SYNC_TOKEN_GONE', 'That sync token is not one.'));
      }
      const events = held.filter((each) => each.version > since).map((each) => each.event);
      return Promise.resolve({ events, nextSyncToken: `fake-sync:${String(version)}` });
    },
    freeBusy(tokens, from, to) {
      enter('freeBusy');
      const busy = [...calendarOf(accountOf(tokens)).values()]
        .map((each) => each.event)
        .filter((event) => event.status !== 'cancelled' && event.start !== undefined && inWindow(event, from, to))
        .map((event) => ({ start: event.start?.at ?? from, end: event.end?.at ?? to }));
      return Promise.resolve(busy);
    },
    createEvent(tokens, input: NewEvent) {
      enter('createEvent');
      const account = accountOf(tokens);
      version += 1;
      const id = `fake-event-${String(version)}`;
      const event: ProviderEvent = {
        id,
        status: 'confirmed',
        icalUid: `${id}@calendar.fake`,
        title: input.title,
        start: { at: input.start, allDay: false },
        end: { at: input.end, allDay: false },
        ...(input.video ? { videoUrl: `https://meet.fake/${input.requestId}` } : {}),
        organizerEmail: account,
        attendees: [
          { email: account, response: 'accepted', isOrganizer: true, isSelf: true },
          ...input.attendees.map((attendee) => ({
            email: attendee.email,
            ...(attendee.name === undefined ? {} : { name: attendee.name }),
            response: 'needs_action' as const,
            isOrganizer: false,
            isSelf: false,
          })),
        ],
        isPrivate: false,
      };
      calendarOf(account).set(id, { event, version });
      return Promise.resolve(event);
    },
    updateEvent(tokens, eventId, input) {
      enter('updateEvent');
      const calendar = calendarOf(accountOf(tokens));
      const held = calendar.get(eventId);
      if (held === undefined) return Promise.reject(providerError('CALENDAR_UNAVAILABLE', 'No such event.'));
      version += 1;
      const event: ProviderEvent = {
        ...held.event,
        ...(input.title === undefined ? {} : { title: input.title }),
        ...(input.start === undefined ? {} : { start: { at: input.start, allDay: false } }),
        ...(input.end === undefined ? {} : { end: { at: input.end, allDay: false } }),
      };
      calendar.set(eventId, { event, version });
      return Promise.resolve(event);
    },
    cancelEvent(tokens, eventId) {
      enter('cancelEvent');
      fake.cancel(accountOf(tokens), eventId);
      return Promise.resolve();
    },
    watch(_tokens, _calendarId, address, token) {
      enter('watch');
      const channel: CalendarChannel = {
        id: `fake-channel-${String(channels.length + 1)}`,
        resourceId: 'fake-resource',
        expiresAt: new Date(now().getTime() + 7 * 86_400_000).toISOString(),
      };
      channels.push({ channel, address, token });
      return Promise.resolve(channel);
    },
    stopWatch() {
      enter('stopWatch');
      return Promise.resolve();
    },
  };

  /** A call that fails synchronously (a told failure, a bad token) still answers as a rejected promise. */
  const settle =
    <A extends unknown[], T>(work: (...args: A) => Promise<T>) =>
    (...args: A): Promise<T> => {
      try {
        return work(...args);
      } catch (error) {
        return Promise.reject(error instanceof Error ? error : new Error(String(error)));
      }
    };
  const provider: CalendarProvider = {
    authorizeUrl: raw.authorizeUrl,
    exchangeCode: settle(raw.exchangeCode),
    refresh: settle(raw.refresh),
    listChanges: settle(raw.listChanges),
    freeBusy: settle(raw.freeBusy),
    createEvent: settle(raw.createEvent),
    updateEvent: settle(raw.updateEvent),
    cancelEvent: settle(raw.cancelEvent),
    watch: settle(raw.watch),
    stopWatch: settle(raw.stopWatch),
  };

  const fake: FakeCalendar = {
    provider,
    put(account, event) {
      version += 1;
      calendarOf(account).set(event.id, { event, version });
    },
    cancel(account, eventId) {
      version += 1;
      // What an incremental sync reports for a deletion: the id and the status, nothing else.
      calendarOf(account).set(eventId, {
        event: { id: eventId, status: 'cancelled', attendees: [], isPrivate: false },
        version,
      });
    },
    revoke(account) {
      revoked.add(account);
    },
    expireSyncToken(account) {
      expiring.add(account);
    },
    failNext(method, code, times = 1) {
      failures.set(method, { code, times });
    },
    calls: (method) => counts.get(method) ?? 0,
    watched: () => [...channels],
    tokensFor,
  };
  return fake;
}
