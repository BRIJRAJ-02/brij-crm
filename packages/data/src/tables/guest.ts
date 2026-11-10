// `@crm/data/tables`: a place's reservation page's one way to the API (spec 0066 B7 lite). Like the booking page's
// client, the public bundle never loads the app's data layer, the oRPC client or Zod: plain calls to
// `/api/public/tables/*` on the page's own origin, each failure a DataError with the API's code (`SLOT_TAKEN` carries
// the next free times in `next`, `BOOKING_CLOSED`, `NOT_FOUND`, `RATE_LIMITED` with its wait, `INPUT_INVALID` with
// issues), and being offline `API_UNAVAILABLE`. The guest's key (token, or code and email) is always sent in a body,
// the calendar file's too.
import type {
  PublicNewsConfirmed,
  PublicNewsResubscribed,
  PublicNewsUnsubscribed,
  PublicReserveInput,
  PublicReserved,
  PublicTablePage,
  PublicTableTimes,
  PublicTableVisit,
} from '@crm/contracts';
import { dataError, isFetchFailure, parseRetryAfter, toDataError, type DataError } from '../errors.ts';
import type { FetchLike } from '../fetch.ts';

export type {
  PublicNewsConfirmed,
  PublicNewsResubscribed,
  PublicNewsUnsubscribed,
  PublicReserveInput,
  PublicReserved,
  PublicTablePage,
  PublicTableTimes,
  PublicTableVisit,
};
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
  /** A fill ticket for the page (spec 0023, B-04); undefined when it can't be had, which a reservation then answers. */
  ticket(key: string): Promise<string | undefined>;
  reserve(key: string, input: PublicReserveInput): Promise<PublicReserved>;
  visit(key: string, guest: GuestKey): Promise<PublicTableVisit>;
  change(
    key: string,
    guest: GuestKey,
    change: { readonly start: string; readonly party?: number },
  ): Promise<PublicTableVisit>;
  cancel(key: string, guest: GuestKey, reason?: string): Promise<PublicTableVisit>;
  /**
   * The reservation's calendar file (Add to calendar), POSTed with the guest's key in the body so the token never
   * sits in an address; the page saves the answer as a file.
   */
  ics(key: string, guest: GuestKey): Promise<Blob>;
  /**
   * Says yes to news and offers from the email's link (double opt-in): the signed token goes in the body, never an
   * address. A second press answers `already`; a link that ran out is NOT_FOUND.
   */
  confirmNews(key: string, token: string): Promise<PublicNewsConfirmed>;
  /**
   * Unsubscribes from news and offers with an unsubscribe link's token (10 November 2026), in the body. Always the
   * one answer, whether or not anything changed; only a token that opens nothing is NOT_FOUND.
   */
  unsubscribeNews(token: string): Promise<PublicNewsUnsubscribed>;
  /** Subscribe again: asks the double opt-in's email once more (never a yes by itself); always the one answer. */
  resubscribeNews(token: string): Promise<PublicNewsResubscribed>;
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
  const callAt = async <T>(url: string, init: RequestInit = {}, as: 'json' | 'blob' = 'json'): Promise<T> => {
    let response: Response;
    try {
      response = await send(url, { credentials: 'omit', ...init });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      if (isFetchFailure(error))
        throw dataError('API_UNAVAILABLE', 'You’re offline. Check your connection and try again.');
      throw toDataError(error);
    }
    if (response.ok) return (as === 'blob' ? await response.blob() : await response.json()) as T;
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
  const call = <T>(path: string, init: RequestInit = {}, as: 'json' | 'blob' = 'json'): Promise<T> =>
    callAt<T>(`${base}/${path}`, init, as);
  const post = <T>(path: string, body: unknown): Promise<T> =>
    call<T>(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const at = (key: string) => encodeURIComponent(key);
  /** The news routes sit beside the tables' (`/api/public/news/*`): the token in a JSON body, never the address. */
  const postNews = <T>(path: 'unsubscribe' | 'subscribe', token: string): Promise<T> =>
    callAt<T>(`${options.origin}/api/public/news/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
    });
  return {
    page: (key) => call<PublicTablePage>(at(key)),
    times: (key, query, signal) =>
      call<PublicTableTimes>(
        `${at(key)}/times?${new URLSearchParams({ party: String(query.party), date: query.date }).toString()}`,
        signal === undefined ? {} : { signal },
      ),
    ticket: async (key) => {
      try {
        const answer = await call<{ readonly ticket?: unknown }>(`${at(key)}/ticket`);
        return typeof answer.ticket === 'string' ? answer.ticket : undefined;
      } catch {
        return undefined;
      }
    },
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
    ics: (key, guest) =>
      call<Blob>(
        `${at(key)}/ics`,
        { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ guest }) },
        'blob',
      ),
    confirmNews: (key, token) => post<PublicNewsConfirmed>(`${at(key)}/news`, { token }),
    unsubscribeNews: (token) => postNews<PublicNewsUnsubscribed>('unsubscribe', token),
    resubscribeNews: (token) => postNews<PublicNewsResubscribed>('subscribe', token),
  };
}
