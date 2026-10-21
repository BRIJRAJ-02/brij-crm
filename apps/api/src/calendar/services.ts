// What calendar sync needs in the api (spec 0024), made once from the
// environment when `CALENDAR_SYNC=on`: the provider adapters (Google, and
// Outlook where `CALENDAR_OUTLOOK=on`), the token key, the key the OAuth state
// is signed with (derived from the token key for that one purpose), and the
// addresses each provider sends the member back to. Absent, the connect
// routes say calendar sync isn't set up, and `calendar.connections` answers
// `enabled: false`.
import { deriveKey, type CalendarProvider, type TokenKey } from '@crm/core';
import type { CalendarSettings } from '../env.ts';
import { createFreeDomains } from './free-domains.ts';
import { createGoogleCalendar, createGoogleGuest, type GuestCalendar } from './google.ts';
import { createMicrosoftCalendar } from './microsoft.ts';

/** The providers a member may connect. */
export type ConnectProvider = 'google' | 'microsoft';

/** The OAuth callback's path under the app's origin (the app and the API share one). */
export const GOOGLE_CALLBACK_PATH = '/api/calendar/google/callback';

/** Where Google posts push channels' change notices (milestone 2), under the same origin's API. */
export const GOOGLE_NOTIFY_PATH = '/api/calendar/google/notify';

/** Outlook's OAuth callback (milestone 4). */
export const MICROSOFT_CALLBACK_PATH = '/api/calendar/microsoft/callback';

/** Where Graph posts change and lifecycle notices for Outlook subscriptions (AC-1008). */
export const MICROSOFT_NOTIFY_PATH = '/api/calendar/microsoft/notify';

/** Each provider's callback path. */
export const CALLBACK_PATHS: Readonly<Record<ConnectProvider, string>> = {
  google: GOOGLE_CALLBACK_PATH,
  microsoft: MICROSOFT_CALLBACK_PATH,
};

/** Calendar sync's api services. */
export interface CalendarServices {
  /** The adapter for each provider this deployment connects: Google, and Outlook where it is on. */
  readonly providers: { readonly google: CalendarProvider; readonly microsoft?: CalendarProvider };
  readonly tokenKey: TokenKey;
  /** Signs the OAuth state: derived from the token key, never the key itself. */
  readonly stateKey: Buffer;
  /** Where Google sends the member back: `<APP_URL>/api/calendar/google/callback`. */
  readonly redirectUri: string;
  /** Where each provider sends the member back. */
  readonly redirectUris: Readonly<Record<ConnectProvider, string>>;
  /** A booking page visitor's own calendar for one visit (spec 0028), over the same OAuth client. */
  readonly guest: GuestCalendar;
  /** Signs a guest connect's state: derived from the token key for that one purpose. */
  readonly guestStateKey: Buffer;
  /** Whether an email domain is a free one (gmail.com), which names no company (AC-607, AC-609). */
  readonly isFreeDomain: (domain: string) => boolean;
}

/** The api's calendar services from checked settings (the adapters on the real network unless given ones). */
export function createCalendarServices(
  settings: CalendarSettings,
  appUrl: string,
  google: CalendarProvider = createGoogleCalendar({ clientId: settings.clientId, clientSecret: settings.clientSecret }),
  guest: GuestCalendar = createGoogleGuest(
    { clientId: settings.clientId, clientSecret: settings.clientSecret },
    google,
  ),
  microsoft: CalendarProvider | undefined = settings.microsoft === undefined
    ? undefined
    : createMicrosoftCalendar(settings.microsoft),
): CalendarServices {
  const origin = new URL(appUrl).origin;
  const redirectUris = {
    google: new URL(GOOGLE_CALLBACK_PATH, origin).toString(),
    microsoft: new URL(MICROSOFT_CALLBACK_PATH, origin).toString(),
  };
  return {
    guest,
    guestStateKey: deriveKey(settings.tokenKey, 'booking-guest-state'),
    providers: microsoft === undefined ? { google } : { google, microsoft },
    tokenKey: settings.tokenKey,
    stateKey: deriveKey(settings.tokenKey, 'calendar-oauth-state'),
    redirectUri: redirectUris.google,
    redirectUris,
    isFreeDomain: createFreeDomains(),
  };
}
