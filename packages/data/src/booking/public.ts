// `@crm/data/booking`: the public booking page's one way to the API (spec
// 0025). The public bundle never loads the app's data layer, the oRPC client
// or Zod: three plain calls to `/api/public/booking/*` on the page's own
// origin, each failure a `DataError` with the API's code (`SLOT_TAKEN`,
// `BOOKING_CLOSED`, `NOT_FOUND`, `RATE_LIMITED` with its wait, `INPUT_INVALID`
// with issues), and being offline `API_UNAVAILABLE`.
import type {
  PublicBooked,
  PublicBookInput,
  PublicBookingPage,
  PublicManagedBooking,
  PublicSlots,
} from '@crm/contracts/booking';
import { dataError, isFetchFailure, parseRetryAfter, toDataError, type DataError } from '../errors.ts';
import type { FetchLike } from '../fetch.ts';

export type {
  PublicBooked,
  PublicBookInput,
  PublicBooking,
  PublicManagedBooking,
  PublicBookingPage,
  PublicLocation,
  PublicSlot,
} from '@crm/contracts/booking';
export { isDataError, type DataError } from '../errors.ts';

/** What the public page needs: the page's facts, a range of slots, and the booking. */
export interface BookingClient {
  page(publicKey: string): Promise<PublicBookingPage>;
  slots(
    publicKey: string,
    query: { readonly from: string; readonly to: string; readonly duration: number; readonly tz: string },
    signal?: AbortSignal,
  ): Promise<PublicSlots>;
  /** Books; the answer carries the guest page's token. */
  book(publicKey: string, input: PublicBookInput): Promise<PublicBooked>;
  /** The guest page's booking. */
  managed(token: string): Promise<PublicManagedBooking>;
  /** Where the booking's calendar file downloads from (a plain link: Add to calendar, Apple and .ics). */
  icsUrl(token: string): string;
}

/** A failure answer as a DataError: the API's code and message, its wait, and its issues. */
async function failureOf(response: Response, now: number): Promise<DataError> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }
  const error = toDataError({ ...(typeof body === 'object' && body !== null ? body : {}), status: response.status });
  const wait = parseRetryAfter(response.headers.get('retry-after'), now);
  const data =
    typeof body === 'object' && body !== null && 'data' in body && typeof body.data === 'object' && body.data !== null
      ? (body.data as DataError['data'])
      : undefined;
  return dataError(error.code, error.message, data ?? error.data, wait ?? error.retryAfterSeconds);
}

/** The client, on `origin` (the page's own), with `fetch` passed in for tests. */
export function createBookingClient(options: {
  readonly origin: string;
  readonly fetch?: FetchLike;
  readonly now?: () => number;
}): BookingClient {
  const send = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const now = options.now ?? Date.now;
  const base = `${options.origin}/api/public/booking`;
  const call = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
    let response: Response;
    try {
      response = await send(`${base}/${path}`, { credentials: 'omit', ...init });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      if (isFetchFailure(error))
        throw dataError('API_UNAVAILABLE', 'You’re offline. Check your connection and try again.');
      throw toDataError(error);
    }
    if (!response.ok) throw await failureOf(response, now());
    return (await response.json()) as T;
  };
  return {
    page: (publicKey) => call<PublicBookingPage>(encodeURIComponent(publicKey)),
    slots: (publicKey, query, signal) =>
      call<PublicSlots>(
        `${encodeURIComponent(publicKey)}/slots?${new URLSearchParams({
          from: query.from,
          to: query.to,
          duration: String(query.duration),
          tz: query.tz,
        }).toString()}`,
        signal === undefined ? {} : { signal },
      ),
    book: (publicKey, input) =>
      call<PublicBooked>(`${encodeURIComponent(publicKey)}/book`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      }),
    managed: (token) => call<PublicManagedBooking>(`manage/${encodeURIComponent(token)}`),
    icsUrl: (token) => `${base}/manage/${encodeURIComponent(token)}/ics`,
  };
}
