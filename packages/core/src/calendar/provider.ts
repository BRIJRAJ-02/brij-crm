// The calendar provider interface (spec 0024): the one shape every calendar
// adapter answers to. The Google adapter (`apps/api/src/calendar/google.ts`,
// milestone 1) and the Microsoft one (milestone 4) are the only modules that
// call a provider; core gets an adapter passed in and never reads env. The
// fake (`fake.ts`) stands in for both in tests: no test calls a real provider.
//
// A provider's expected failures are errors with a stable `code` and a plain
// message (`providerError`), sorted the way an earlier scheduling build learned
// to: a refused grant (`CALENDAR_AUTH_REVOKED`, the provider's invalid_grant)
// heals only when the member reconnects; a refused call (`CALENDAR_AUTH`, a
// 401 or 403) usually needs the same; everything else (`CALENDAR_UNAVAILABLE`:
// a 5xx, a 429, the network, a body that won't parse) is the minute we asked
// in, and is tried again. A sync token the provider no longer honours
// (`CALENDAR_SYNC_TOKEN_GONE`, Google's 410, Graph's `syncStateNotFound`)
// means a full sync; a calendar the provider no longer has
// (`CALENDAR_GONE`, a 404 on it) means the account's calendars are listed
// again.
//
// Milestone 5 (amendment of 20 October 2026): every call names its calendar
// (`listCalendars` gives their ids; `PRIMARY_CALENDAR`, `primary`, is the
// account's main calendar until the first listing gives its real id), and
// free and busy answers each calendar on its own, so one failing calendar
// never hides the rest (AC-994, AC-995).

/** An attendee's answer, as the provider says it. */
export type ProviderResponse = 'accepted' | 'declined' | 'tentative' | 'needs_action';

/**
 * The tokens one connection holds. Sealed at rest (`tokens.ts`), never
 * logged, never sent to a browser.
 */
export interface CalendarTokens {
  readonly accessToken: string;
  readonly refreshToken: string;
  /** When the access token stops working, ISO 8601 in UTC. */
  readonly expiresAt: string;
}

/** What a code exchange answers: the tokens, and the account they are for (trimmed, lower case). */
export interface ExchangedTokens extends CalendarTokens {
  readonly accountEmail: string;
}

/** The span a full sync covers, ISO 8601 in UTC: 90 days back and 180 ahead (spec 0024). */
export interface SyncWindow {
  readonly from: string;
  readonly to: string;
}

/** A moment of an event: a time, or (an all day event) the day's start in UTC with `allDay`. */
export interface ProviderTime {
  /** ISO 8601 in UTC. */
  readonly at: string;
  readonly allDay: boolean;
}

/** One attendee of an event, as the provider lists them. */
export interface ProviderAttendee {
  readonly email: string;
  readonly name?: string;
  readonly response: ProviderResponse;
  readonly isOrganizer: boolean;
  /** The connected account itself. */
  readonly isSelf: boolean;
}

/**
 * One event as the provider reports it in a change list. A cancelled one may
 * carry only its id (an incremental sync's deletion). Descriptions and
 * attachments are never read (AC-613).
 */
export interface ProviderEvent {
  readonly id: string;
  readonly status: 'confirmed' | 'tentative' | 'cancelled';
  /** The iCalendar UID, shared by every copy of the event (AC-603). */
  readonly icalUid?: string;
  /** A recurring instance's original start, ISO 8601 in UTC (AC-604). */
  readonly originalStart?: string;
  readonly title?: string;
  readonly start?: ProviderTime;
  readonly end?: ProviderTime;
  readonly location?: string;
  readonly videoUrl?: string;
  readonly organizerEmail?: string;
  /**
   * Everyone invited, the organiser among them (marked `isOrganizer`) on an event the account is invited to, even
   * when the provider lists only the guests: an event someone else organised with the account its one guest is a
   * meeting with that organiser (the owner's case of 23 October 2026), never the account alone.
   */
  readonly attendees: readonly ProviderAttendee[];
  /** Marked private in the calendar itself (AC-612). */
  readonly isPrivate: boolean;
  /** Shown as free in the calendar (Google's `transparency: transparent`): it never makes the member busy. */
  readonly isFree?: boolean;
  readonly etag?: string;
}

/** What a change list answers: every changed event since the token (or in the window), and the next token. */
export interface ProviderChanges {
  readonly events: readonly ProviderEvent[];
  readonly nextSyncToken: string;
}

/** What the member may do with a calendar at the provider (AC-991). */
export type CalendarAccessRole = 'owner' | 'writer' | 'reader' | 'free_busy';

/** One calendar of an account, as `listCalendars` answers it. */
export interface ProviderCalendar {
  readonly id: string;
  readonly name: string;
  /** `#rrggbb`, lower case, when the provider gives one. */
  readonly colour?: string;
  readonly accessRole: CalendarAccessRole;
  /** The account's main calendar. */
  readonly isPrimary: boolean;
  readonly timeZone?: string;
}

/** The account's main calendar before a listing gave its real id: an alias both adapters take. */
export const PRIMARY_CALENDAR = 'primary';

/** A busy span, ISO 8601 in UTC. */
export interface BusyInterval {
  readonly start: string;
  readonly end: string;
}

/** One calendar's free and busy answer: its busy spans, or the code it failed with. */
export type CalendarBusy = { readonly busy: readonly BusyInterval[] } | { readonly error: CalendarErrorCode };

/** What a created event says beyond the event: a video link was asked for and the account can't make one (AC-1011). */
export interface CreatedProviderEvent extends ProviderEvent {
  readonly videoUnavailable?: boolean;
}

/** An event the CRM writes (milestone 3). */
export interface NewEvent {
  readonly title: string;
  readonly start: string;
  readonly end: string;
  readonly timeZone: string;
  readonly attendees: readonly { readonly email: string; readonly name?: string }[];
  /** Ask the provider for a video link (Google Meet, Microsoft Teams). */
  readonly video: boolean;
  /** The idempotency key for the event and its video link (a uuid): the same key never makes a second of either. */
  readonly requestId: string;
  readonly description?: string;
  readonly location?: string;
}

/** A push channel the provider posts change notices to (milestone 2). */
export interface CalendarChannel {
  readonly id: string;
  readonly resourceId: string;
  /** ISO 8601 in UTC. */
  readonly expiresAt: string;
}

/**
 * The provider adapter (spec 0024, Provider adapter). Plain functions on an
 * object (no `this`), so a caller may hand one on by itself.
 */
export interface CalendarProvider {
  /** Where to send the member to consent: offline access, with consent asked every time, carrying `state`. */
  readonly authorizeUrl: (state: string, redirectUri: string) => string;
  /** The tokens for a consent's code, and the account; `CALENDAR_SCOPE_DECLINED` when a needed scope was unticked. */
  readonly exchangeCode: (code: string, redirectUri: string) => Promise<ExchangedTokens>;
  /** A fresh access token; `CALENDAR_AUTH_REVOKED` on the provider's invalid grant. */
  readonly refresh: (tokens: CalendarTokens) => Promise<CalendarTokens>;
  /** Every calendar of the account (milestone 5, AC-991), the main one marked. */
  readonly listCalendars: (tokens: CalendarTokens) => Promise<readonly ProviderCalendar[]>;
  /**
   * Every changed event since `syncToken`, or every event in `window` when
   * there is none (a full sync), each recurring event as its instances.
   * `CALENDAR_SYNC_TOKEN_GONE` means the token expired: sync in full.
   */
  readonly listChanges: (
    tokens: CalendarTokens,
    calendarId: string,
    syncToken: string | undefined,
    window: SyncWindow,
  ) => Promise<ProviderChanges>;
  /**
   * Free and busy for each of `calendarIds` in one request (AC-994): every calendar answers on its own, its busy
   * spans or the code it failed with (AC-995). A failure of the whole request throws.
   */
  readonly freeBusy: (
    tokens: CalendarTokens,
    calendarIds: readonly string[],
    from: string,
    to: string,
  ) => Promise<ReadonlyMap<string, CalendarBusy>>;
  readonly createEvent: (tokens: CalendarTokens, calendarId: string, input: NewEvent) => Promise<CreatedProviderEvent>;
  readonly updateEvent: (
    tokens: CalendarTokens,
    calendarId: string,
    eventId: string,
    input: Partial<NewEvent>,
  ) => Promise<ProviderEvent>;
  readonly cancelEvent: (tokens: CalendarTokens, calendarId: string, eventId: string) => Promise<void>;
  readonly watch: (
    tokens: CalendarTokens,
    calendarId: string,
    address: string,
    token: string,
  ) => Promise<CalendarChannel>;
  readonly stopWatch: (tokens: CalendarTokens, channel: CalendarChannel) => Promise<void>;
  /**
   * Ends the grant with the provider (spec 0031, AC-815): a removed member's
   * tokens stop working everywhere, not just here. A grant already gone
   * counts as done; any other failure throws, so the task tries again.
   */
  readonly revoke: (tokens: CalendarTokens) => Promise<void>;
}

/** Every code a provider fails with. */
export const CALENDAR_ERROR_CODES = [
  'CALENDAR_AUTH_REVOKED',
  'CALENDAR_AUTH',
  'CALENDAR_SYNC_TOKEN_GONE',
  'CALENDAR_UNAVAILABLE',
  'CALENDAR_SCOPE_DECLINED',
  'CALENDAR_GONE',
] as const;

/** One code a provider fails with. */
export type CalendarErrorCode = (typeof CALENDAR_ERROR_CODES)[number];

/**
 * What the provider itself said when it refused a call, for the log: its HTTP status, and its own machine reason
 * (Google's `errors[].reason`, such as `pushNotSupportedForRequestedResource`; Graph's `error.code`), never its
 * message, which can quote an address or a calendar's name.
 */
export interface ProviderAnswer {
  readonly status?: number;
  readonly reason?: string;
}

/** A provider's expected failure: a stable code and a plain message that quotes no token. */
export type CalendarProviderError = Error & { readonly code: CalendarErrorCode } & ProviderAnswer;

/** A provider's reason as a log may keep it: a short machine word, anything else dropped. */
const REASON = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;

/**
 * Builds a provider's expected failure, with what the provider answered when it answered (`answer`): its status,
 * and its reason only when that is a short machine word.
 */
export function providerError(
  code: CalendarErrorCode,
  message: string,
  answer: ProviderAnswer = {},
): CalendarProviderError {
  const status = Number.isInteger(answer.status) ? answer.status : undefined;
  const reason = answer.reason !== undefined && REASON.test(answer.reason) ? answer.reason : undefined;
  return Object.assign(new Error(message), {
    name: 'CalendarProviderError',
    code,
    ...(status === undefined ? {} : { status }),
    ...(reason === undefined ? {} : { reason }),
  });
}

/** A provider failure as a log line holds it (`calendar.channel`): the code, and the provider's status and reason. */
export interface ProviderFailure extends ProviderAnswer {
  readonly code: CalendarErrorCode;
}

/** The loggable part of a provider's failure: never its message. */
export function failureOf(error: CalendarProviderError): ProviderFailure {
  return {
    code: error.code,
    ...(error.status === undefined ? {} : { status: error.status }),
    ...(error.reason === undefined ? {} : { reason: error.reason }),
  };
}

/** True when `error` is a provider's expected failure (with `code`, when given). */
export function isProviderError(error: unknown, code?: CalendarErrorCode): error is CalendarProviderError {
  if (!(error instanceof Error) || error.name !== 'CalendarProviderError' || !('code' in error)) return false;
  const found = (error as { readonly code: unknown }).code;
  if (!CALENDAR_ERROR_CODES.includes(found as CalendarErrorCode)) return false;
  return code === undefined || found === code;
}

/**
 * Whether a failure stays until the member does something (reconnects):
 * only the two the provider attributed to the grant. A deploy missing its
 * client secret is `CALENDAR_UNAVAILABLE`, never this, so a mistake of ours
 * can never mark every member's calendar as broken.
 */
export function isPersistentCode(code: CalendarErrorCode): boolean {
  return code === 'CALENDAR_AUTH_REVOKED' || code === 'CALENDAR_AUTH';
}

/** An email address as the CRM compares it: trimmed and lower case (AC-606). */
export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}
