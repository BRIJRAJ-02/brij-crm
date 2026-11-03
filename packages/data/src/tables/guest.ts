// `@crm/data/tables`: a place's reservation page's one way to the API (spec 0066 B7 lite). Like the booking page's
// client, the public bundle never loads the app's data layer, the oRPC client or Zod: plain calls to
// `/api/public/tables/*` on the page's own origin, each failure a DataError with the API's code (`SLOT_TAKEN` carries
// the next free times in `next`, `BOOKING_CLOSED`, `NOT_FOUND`, `RATE_LIMITED` with its wait, `INPUT_INVALID` with
// issues), and being offline `API_UNAVAILABLE`. The guest's key (token, or code and email) is always sent in a body.
import type {
  PublicReserveInput,
  PublicReserved,
  PublicTablePage,
  PublicTableTimes,
  PublicTableVisit,
} from '@crm/contracts';
import { dataError, isFetchFailure, parseRetryAfter, toDataError, type DataError } from '../errors.ts';
import type { FetchLike } from '../fetch.ts';

export type { PublicReserveInput, PublicReserved, PublicTablePage, PublicTableTimes, PublicTableVisit };
export { isDataError, type DataError } from '../errors.ts';

/** Who the guest is on the manage page: the link's token, or the code with the email. */
export type GuestKey = { readonly token: string } | { readonly code: string; readonly email: string };

/** A refusal to a reservation or change: SLOT_TAKEN carries the next free times (ISO instants). */
export type TableRefusal = DataError & { readonly next?: readonly string[] };

/** What the reservation and manage pages call. */
export interface TableClient {
  page(key: string): Promise<PublicTablePage>;
  times(
    key: string,
    query: { readonly party: number; readonly date: string },
    signal?: AbortSignal,
  ): Promise<PublicTableTimes>;
  reserve(key: string, input: PublicReserveInput): Promise<PublicReserved>;
  visit(key: string, guest: GuestKey): Promise<PublicTableVisit>;
  change(
    key: string,
    guest: GuestKey,
    change: { readonly start: string; readonly party?: number },
  ): Promise<PublicTableVisit>;
  cancel(key: string, guest: GuestKey, reason?: string): Promise<PublicTableVisit>;
  /** The calendar file's address (Add to calendar), by the link's token. */
  icsUrl(key: string, token: string): string;
}

/** The client, on `origin` (the page's own), with `fetch` and the clock passed in for tests. */
export function createTableClient(options: {
  readonly origin: string;
  readonly fetch?: FetchLike;
  readonly now?: () => number;
}): TableClient {
  const send = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const now = options.now ?? Date.now;
  const base = `${options.origin}/api/public/tables`;
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
    if (response.ok) return (await response.json()) as T;
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      body = undefined;
    }
    const fields = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
    const mapped = toDataError({ ...fields, status: response.status });
    const data =
      typeof fields.data === 'object' && fields.data !== null ? (fields.data as DataError['data']) : mapped.data;
    const refused: TableRefusal = Object.assign(
      dataError(
        mapped.code,
        mapped.message,
        data,
        parseRetryAfter(response.headers.get('retry-after'), now()) ?? mapped.retryAfterSeconds,
      ),
      Array.isArray(fields.next)
        ? { next: fields.next.filter((each): each is string => typeof each === 'string') }
        : {},
    );
    throw refused;
  };
  const post = <T>(path: string, body: unknown): Promise<T> =>
    call<T>(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const at = (key: string) => encodeURIComponent(key);
  return {
    page: (key) => call<PublicTablePage>(at(key)),
    times: (key, query, signal) =>
      call<PublicTableTimes>(
        `${at(key)}/times?${new URLSearchParams({ party: String(query.party), date: query.date }).toString()}`,
        signal === undefined ? {} : { signal },
      ),
    reserve: (key, input) => post<PublicReserved>(`${at(key)}/reserve`, input),
    visit: async (key, guest) => (await post<{ visit: PublicTableVisit }>(`${at(key)}/visit`, { guest })).visit,
    change: async (key, guest, change) =>
      (await post<{ visit: PublicTableVisit }>(`${at(key)}/change`, { guest, ...change })).visit,
    cancel: async (key, guest, reason) =>
      (
        await post<{ visit: PublicTableVisit }>(`${at(key)}/cancel`, {
          guest,
          ...(reason === undefined ? {} : { reason }),
        })
      ).visit,
    icsUrl: (key, token) => `${base}/${at(key)}/manage/${encodeURIComponent(token)}/ics`,
  };
}
