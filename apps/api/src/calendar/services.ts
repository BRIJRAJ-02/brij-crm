// What calendar sync needs in the api (spec 0024), made once from the
// environment when `CALENDAR_SYNC=on`: the provider adapter, the token key,
// the key the OAuth state is signed with (derived from the token key for that
// one purpose), and the address Google sends the member back to. Absent, the
// connect routes say calendar sync isn't set up, and `calendar.connections`
// answers `enabled: false`.
import { deriveKey, type CalendarProvider, type TokenKey } from '@crm/core';
import type { CalendarSettings } from '../env.ts';
import { createGoogleCalendar } from './google.ts';

/** The OAuth callback's path under the app's origin (the app and the API share one). */
export const GOOGLE_CALLBACK_PATH = '/api/calendar/google/callback';

/** Calendar sync's api services. */
export interface CalendarServices {
  /** The adapter for each provider this deployment connects (Google in milestone 1). */
  readonly providers: { readonly google: CalendarProvider };
  readonly tokenKey: TokenKey;
  /** Signs the OAuth state: derived from the token key, never the key itself. */
  readonly stateKey: Buffer;
  /** Where Google sends the member back: `<APP_URL>/api/calendar/google/callback`. */
  readonly redirectUri: string;
}

/** The api's calendar services from checked settings (the Google adapter on the real network unless given one). */
export function createCalendarServices(
  settings: CalendarSettings,
  appUrl: string,
  google: CalendarProvider = createGoogleCalendar({ clientId: settings.clientId, clientSecret: settings.clientSecret }),
): CalendarServices {
  return {
    providers: { google },
    tokenKey: settings.tokenKey,
    stateKey: deriveKey(settings.tokenKey, 'calendar-oauth-state'),
    redirectUri: new URL(GOOGLE_CALLBACK_PATH, new URL(appUrl).origin).toString(),
  };
}
