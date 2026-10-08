// What is never a fault in the browser (spec 0010, AC-163): a DataError (a
// refusal, or being offline, as the data layer answers it), the router's not
// found and redirect (how routing works), and fetch's own failure when the
// network is gone. Used by every door into Sentry: what the app reports, the
// buffer's window listeners, and the SDK's beforeSend. No vendor here.
import { isDataError } from '@crm/data';
import { isNotFound, isRedirect } from '@tanstack/react-router';

// What each browser's fetch rejects with when it can't reach the server.
const OFFLINE_MESSAGES: ReadonlySet<string> = new Set([
  'Failed to fetch',
  'NetworkError when attempting to fetch resource.',
  'Load failed',
  'The network connection was lost.',
  'The Internet connection appears to be offline.',
]);

/** Whether a thrown value is how the app works, or the network being gone, rather than a fault. */
export function isExpected(error: unknown): boolean {
  if (isDataError(error) || isNotFound(error) || isRedirect(error)) return true;
  return error instanceof TypeError && OFFLINE_MESSAGES.has(error.message);
}
