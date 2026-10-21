// What the CRM asks Google for when a member connects a calendar (spec 0024,
// AC-597), and how to tell whether a grant covers it, adapted from an earlier
// scheduling build. A scope string isn't the unit that matters, a capability
// is: Google answers a free and busy read from any of four scopes, so a grant
// is judged by what it can do, not by matching the list we asked for.
//
// Google's consent screen lets a person untick a permission and approve the
// rest, which still returns a working code. So a grant missing either
// capability is refused before anything is stored: "there is a connection"
// and "the connection can do the job" stay the same statement.

/** Free and busy reads (milestone 3): what we request, and the wider scopes that include it. */
const FREEBUSY_SCOPES = [
  'https://www.googleapis.com/auth/calendar.freebusy',
  'https://www.googleapis.com/auth/calendar.events.freebusy',
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/calendar',
] as const;

/** Listing, reading and writing events on the primary calendar, and Meet links: only `calendar` is wider. */
const EVENTS_SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar',
] as const;

/** Listing the account's calendars (spec 0024 milestone 5, AC-991): what we request, and the wider scopes. */
const CALENDAR_LIST_SCOPES = [
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
  'https://www.googleapis.com/auth/calendar.calendarlist',
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/calendar',
] as const;

/** The calendar scopes requested, in the order Google shows them: the reads, then the write. */
export const CALENDAR_SCOPES = [
  'https://www.googleapis.com/auth/calendar.freebusy',
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
  'https://www.googleapis.com/auth/calendar.events',
] as const;

/**
 * The connect leg's full list: `openid` and `email` on top, since this leg
 * goes through no sign in library that adds them, and without them Google's
 * userinfo has no address. No `profile`: the leg reads an address, never a
 * name or a photo.
 */
export const CALENDAR_CONNECT_SCOPES = ['openid', 'email', ...CALENDAR_SCOPES] as const;

/**
 * A booking page guest's list (spec 0028, AC-722): who they are, and free and
 * busy only. `profile` too, for the name the booking form fills.
 */
export const GUEST_CONNECT_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/calendar.freebusy',
] as const;

/** Granted scopes as Google returns them (space separated) or as stored (comma separated). */
export function parseGrantedScopes(raw: string | undefined): ReadonlySet<string> {
  if (raw === undefined) return new Set();
  return new Set(
    raw
      .split(/[\s,]+/)
      .map((scope) => scope.trim())
      .filter(Boolean),
  );
}

/** Whether a grant can answer a free and busy query. */
export function grantsFreeBusy(granted: ReadonlySet<string>): boolean {
  return FREEBUSY_SCOPES.some((scope) => granted.has(scope));
}

/** Whether a grant can list the account's calendars (milestone 5). */
export function grantsCalendarList(granted: ReadonlySet<string>): boolean {
  return CALENDAR_LIST_SCOPES.some((scope) => granted.has(scope));
}

/** Whether a grant can list, read, write, move and cancel events on the account's calendars. */
export function grantsCalendarEvents(granted: ReadonlySet<string>): boolean {
  return EVENTS_SCOPES.some((scope) => granted.has(scope));
}

/** The capabilities a grant lacks, in words a member can read; empty means it is complete. */
export function missingCalendarCapabilities(granted: ReadonlySet<string>): readonly string[] {
  return [
    ...(grantsFreeBusy(granted) ? [] : ['see when you are busy']),
    ...(grantsCalendarList(granted) ? [] : ['see your list of calendars']),
    ...(grantsCalendarEvents(granted) ? [] : ['see and add events']),
  ];
}
