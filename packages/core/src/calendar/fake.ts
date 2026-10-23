// The fake calendar provider (spec 0024): accounts held in memory, each with
// its calendars (milestone 5), that answer the provider interface the way
// Google does (full sync over a window, incremental sync by token with
// cancelled events as stubs, a sync token that can expire, a grant that can be
// revoked, free and busy per calendar in one request), so every sync path is
// tested without a network. An account's main calendar has the account's
// address as its id, as Google's does, and answers to `primary` too. Exported
// from `@crm/core/testing` only.
import {
  PRIMARY_CALENDAR,
  providerError,
  type CalendarBusy,
  type CalendarChannel,
  type CalendarErrorCode,
  type CalendarProvider,
  type CalendarTokens,
  type CreatedProviderEvent,
  type ExchangedTokens,
  type NewEvent,
  type ProviderAnswer,
  type ProviderCalendar,
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
  /** Adds or changes an event in a calendar of `account` (its main calendar unless `calendarId` names another). */
  put(account: string, event: ProviderEvent, calendarId?: string): void;
  /** Cancels an event: an incremental sync then reports a stub with its id only. */
  cancel(account: string, eventId: string, calendarId?: string): void;
  /** Adds (or changes) a calendar of `account` beside its main one. */
  addCalendar(account: string, calendar: Omit<ProviderCalendar, 'isPrimary'> & { readonly isPrimary?: boolean }): void;
  /** Removes a calendar of `account` at the provider: listing leaves it out, and reading it answers `CALENDAR_GONE`. */
  removeCalendar(account: string, calendarId: string): void;
  /** The next refresh fails with invalid grant (the member revoked access), and every one after it. */
  revoke(account: string): void;
  /** The next `listChanges` with a token answers 410 Gone. */
  expireSyncToken(account: string): void;
  /**
   * Every `freeBusy` for `account` fails with `code` until told otherwise (`undefined` heals it): the whole request,
   * or, with `calendarId`, that one calendar's answer.
   */
  failFreeBusy(account: string, code: CalendarErrorCode | undefined, calendarId?: string): void;
  /** Every `freeBusy` for `account` takes `ms` before it answers (a calendar that doesn't answer in time). */
  slowFreeBusy(account: string, ms: number | undefined): void;
  /**
   * The next calls of `method` fail with `code`, `times` times (1 by default), carrying what the provider answered
   * (`answer`: its status and reason), when given.
   */
  failNext(method: keyof CalendarProvider, code: CalendarErrorCode, times?: number, answer?: ProviderAnswer): void;
  /** How often each method was called. */
  calls(method: keyof CalendarProvider): number;
  /** The calendar ids each `freeBusy` asked for, in order. */
  freeBusyAsked(): readonly (readonly string[])[];
  /** Every channel `watch` opened, newest last: its calendar, address and the token it carries back on each notice. */
  watched(): readonly {
    readonly channel: CalendarChannel;
    readonly calendarId: string;
    readonly address: string;
    readonly token: string;
  }[];
  /** Channels `stopWatch` stopped, by id. */
  stopped(): readonly string[];
  /** The calendar each `createEvent` wrote to, in order. */
  createdIn(): readonly string[];
  /** The tokens `exchangeCode` hands out for `account`, as the provider made them. */
  tokensFor(account: string, expiresAt?: string): CalendarTokens;
}

/** The access token the fake hands out: the account and a counter, so a refresh is visible. */
const accessTokenOf = (account: string, round: number) => `fake-access:${account}:${String(round)}`;

/** One calendar the fake holds: what listing says of it, and its events. */
interface FakeCalendarHeld {
  info: ProviderCalendar;
  readonly events: Map<string, Held>;
}

/**
 * A fake provider. `exchangeCode('code:<account>')` connects `<account>`;
 * tokens name their account, so every call reads that account's calendars.
 */
export function createFakeCalendarProvider(
  options: { readonly now?: () => Date; readonly noVideo?: boolean } = {},
): FakeCalendar {
  const now = options.now ?? (() => new Date());
  const accounts = new Map<string, Map<string, FakeCalendarHeld>>();
  const gone = new Set<string>();
  const revoked = new Set<string>();
  const expiring = new Set<string>();
  const failures = new Map<string, { code: CalendarErrorCode; times: number; answer: ProviderAnswer }>();
  const accountFailures = new Map<string, CalendarErrorCode>();
  const calendarFailures = new Map<string, CalendarErrorCode>();
  const slow = new Map<string, number>();
  const counts = new Map<string, number>();
  const asked: (readonly string[])[] = [];
  const channels: { channel: CalendarChannel; calendarId: string; address: string; token: string }[] = [];
  const stoppedIds: string[] = [];
  const created: string[] = [];
  let version = 0;
  let round = 0;

  const calendarsOf = (account: string) => {
    const found = accounts.get(account);
    if (found !== undefined) return found;
    const made = new Map<string, FakeCalendarHeld>([
      [
        account,
        {
          info: { id: account, name: account, colour: '#4285f4', accessRole: 'owner', isPrimary: true },
          events: new Map(),
        },
      ],
    ]);
    accounts.set(account, made);
    return made;
  };
  /** A calendar of the account by id (`primary` is the main one), or `CALENDAR_GONE`. */
  const calendarOf = (account: string, calendarId: string): FakeCalendarHeld => {
    const id = calendarId === PRIMARY_CALENDAR ? account : calendarId;
    const found = calendarsOf(account).get(id);
    if (found === undefined) throw providerError('CALENDAR_GONE', 'The fake has no such calendar.');
    return found;
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
    throw providerError(failure.code, `The fake failed ${method} with ${failure.code}.`, failure.answer);
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
      calendarsOf(account);
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
    listCalendars(tokens) {
      enter('listCalendars');
      const account = accountOf(tokens);
      if (revoked.has(account)) return Promise.reject(providerError('CALENDAR_AUTH', 'The grant was revoked.'));
      return Promise.resolve([...calendarsOf(account).values()].map((each) => each.info));
    },
    listChanges(tokens, calendarId, syncToken, window) {
      enter('listChanges');
      const account = accountOf(tokens);
      if (revoked.has(account)) return Promise.reject(providerError('CALENDAR_AUTH', 'The grant was revoked.'));
      const held = [...calendarOf(account, calendarId).events.values()];
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
    async freeBusy(tokens, calendarIds, from, to) {
      enter('freeBusy');
      const account = accountOf(tokens);
      asked.push([...calendarIds]);
      const wait = slow.get(account);
      if (wait !== undefined) await new Promise((resolve) => setTimeout(resolve, wait));
      const failing = accountFailures.get(account);
      if (failing !== undefined) throw providerError(failing, `The fake failed freeBusy with ${failing}.`);
      const answers = new Map<string, CalendarBusy>();
      for (const calendarId of calendarIds) {
        const told = calendarFailures.get(`${account}\n${calendarId}`);
        if (told !== undefined) {
          answers.set(calendarId, { error: told });
          continue;
        }
        let calendar: FakeCalendarHeld;
        try {
          calendar = calendarOf(account, calendarId);
        } catch {
          answers.set(calendarId, { error: 'CALENDAR_GONE' });
          continue;
        }
        const busy = [...calendar.events.values()]
          .map((each) => each.event)
          .filter(
            (event) =>
              event.status !== 'cancelled' &&
              event.isFree !== true &&
              event.start !== undefined &&
              inWindow(event, from, to),
          )
          .map((event) => ({ start: event.start?.at ?? from, end: event.end?.at ?? to }));
        answers.set(calendarId, { busy });
      }
      return answers;
    },
    createEvent(tokens, calendarId, input: NewEvent) {
      enter('createEvent');
      const account = accountOf(tokens);
      const calendar = calendarOf(account, calendarId);
      created.push(calendar.info.id);
      // The request id is the event's id, so a retry finds the event the first try made.
      const id = `fake-event-${input.requestId}`;
      const existing = calendar.events.get(id);
      if (existing !== undefined) return Promise.resolve(existing.event);
      version += 1;
      const noVideo = input.video && options.noVideo === true;
      const event: CreatedProviderEvent = {
        id,
        status: 'confirmed',
        icalUid: `${id}@calendar.fake`,
        title: input.title,
        start: { at: input.start, allDay: false },
        end: { at: input.end, allDay: false },
        ...(input.video && !noVideo ? { videoUrl: `https://meet.fake/${input.requestId}` } : {}),
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
      calendar.events.set(id, { event, version });
      return Promise.resolve(noVideo ? { ...event, videoUnavailable: true } : event);
    },
    updateEvent(tokens, calendarId, eventId, input) {
      enter('updateEvent');
      const calendar = calendarOf(accountOf(tokens), calendarId);
      const held = calendar.events.get(eventId);
      if (held === undefined) return Promise.reject(providerError('CALENDAR_UNAVAILABLE', 'No such event.'));
      version += 1;
      const event: ProviderEvent = {
        ...held.event,
        ...(input.title === undefined ? {} : { title: input.title }),
        ...(input.start === undefined ? {} : { start: { at: input.start, allDay: false } }),
        ...(input.end === undefined ? {} : { end: { at: input.end, allDay: false } }),
      };
      calendar.events.set(eventId, { event, version });
      return Promise.resolve(event);
    },
    cancelEvent(tokens, calendarId, eventId) {
      enter('cancelEvent');
      fake.cancel(accountOf(tokens), eventId, calendarId);
      return Promise.resolve();
    },
    watch(tokens, calendarId, address, token) {
      enter('watch');
      calendarOf(accountOf(tokens), calendarId);
      const channel: CalendarChannel = {
        id: `fake-channel-${String(channels.length + 1)}`,
        resourceId: `fake-resource:${calendarId}`,
        expiresAt: new Date(now().getTime() + 7 * 86_400_000).toISOString(),
      };
      channels.push({ channel, calendarId, address, token });
      return Promise.resolve(channel);
    },
    stopWatch(_tokens, channel) {
      enter('stopWatch');
      stoppedIds.push(channel.id);
      return Promise.resolve();
    },
    revoke(tokens) {
      enter('revoke');
      revoked.add(accountOf(tokens));
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
    listCalendars: settle(raw.listCalendars),
    listChanges: settle(raw.listChanges),
    freeBusy: settle(raw.freeBusy),
    createEvent: settle(raw.createEvent),
    updateEvent: settle(raw.updateEvent),
    cancelEvent: settle(raw.cancelEvent),
    watch: settle(raw.watch),
    stopWatch: settle(raw.stopWatch),
    revoke: settle(raw.revoke),
  };

  const fake: FakeCalendar = {
    provider,
    put(account, event, calendarId = PRIMARY_CALENDAR) {
      version += 1;
      calendarOf(account, calendarId).events.set(event.id, { event, version });
    },
    cancel(account, eventId, calendarId = PRIMARY_CALENDAR) {
      version += 1;
      // What an incremental sync reports for a deletion: the id and the status, nothing else.
      calendarOf(account, calendarId).events.set(eventId, {
        event: { id: eventId, status: 'cancelled', attendees: [], isPrivate: false },
        version,
      });
    },
    addCalendar(account, calendar) {
      const calendars = calendarsOf(account);
      const found = calendars.get(calendar.id);
      const info: ProviderCalendar = { ...calendar, isPrimary: calendar.isPrimary ?? false };
      if (found === undefined) calendars.set(calendar.id, { info, events: new Map() });
      else found.info = info;
      gone.delete(`${account}\n${calendar.id}`);
    },
    removeCalendar(account, calendarId) {
      calendarsOf(account).delete(calendarId);
      gone.add(`${account}\n${calendarId}`);
    },
    revoke(account) {
      revoked.add(account);
    },
    expireSyncToken(account) {
      expiring.add(account);
    },
    failFreeBusy(account, code, calendarId) {
      const key = calendarId === undefined ? account : `${account}\n${calendarId}`;
      const map = calendarId === undefined ? accountFailures : calendarFailures;
      if (code === undefined) map.delete(key);
      else map.set(key, code);
    },
    slowFreeBusy(account, ms) {
      if (ms === undefined) slow.delete(account);
      else slow.set(account, ms);
    },
    failNext(method, code, times = 1, answer = {}) {
      failures.set(method, { code, times, answer });
    },
    calls: (method) => counts.get(method) ?? 0,
    freeBusyAsked: () => [...asked],
    watched: () => [...channels],
    stopped: () => [...stoppedIds],
    createdIn: () => [...created],
    tokensFor,
  };
  return fake;
}
