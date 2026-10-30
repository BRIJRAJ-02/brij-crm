// How connecting a calendar went (`?calendar=`): plain values with no imports, so the Calendars route's
// `validateSearch` (in the first load) can read the address without pulling in the page's words, as
// object-tabs.ts does for the object settings route. `calendar-strings.ts` has one note for each.

/** The results the connect routes send the browser back with. */
export const CONNECT_RESULTS = ['connected', 'denied', 'scope', 'limit', 'off', 'failed'] as const;

/** What the browser came back with, as `?calendar=` names it. */
export type ConnectResult = (typeof CONNECT_RESULTS)[number];

/** True when `value` is one of the results the connect routes send back. */
export function isConnectResult(value: unknown): value is ConnectResult {
  return typeof value === 'string' && (CONNECT_RESULTS as readonly string[]).includes(value);
}
