// `@crm/data/booking`: the public booking page's one way to the API (spec
// 0025). The public bundle never loads the app's data layer, the oRPC client
// or Zod: plain calls to `/api/public/booking/*` on the page's own
// origin, each failure a `DataError` with the API's code (`SLOT_TAKEN`,
// `BOOKING_CLOSED`, `NOT_FOUND`, `RATE_LIMITED` with its wait, `INPUT_INVALID`
// with issues), and being offline `API_UNAVAILABLE`.
import type {
  PublicBooked,
  PublicBookInput,
  PublicBookingPage,
  PublicChatInput,
  PublicChatReply,
  PublicManagedBooking,
  PublicSlots,
  PublicViewerAnswer,
} from '@crm/contracts/booking';
import { dataError, isFetchFailure, parseRetryAfter, toDataError, type DataError } from '../errors.ts';
import type { FetchLike } from '../fetch.ts';

export type {
  PublicBooked,
  PublicChanged,
  PublicGuestsAnswer,
  PublicBookInput,
  PublicBooking,
  PublicManagedBooking,
  PublicBookingPage,
  PublicChatInput,
  PublicChatLine,
  PublicChatReply,
  PublicLocation,
  PublicSlot,
  PublicSlots,
  PublicViewer,
  PublicViewerAnswer,
  SlotsOverlay,
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
  /** One turn of the booking chat (spec 0041); a turn that booked carries the guest page's token. */
  chat(publicKey: string, input: PublicChatInput, signal?: AbortSignal): Promise<PublicChatReply>;
  /** The guest page's booking. */
  managed(token: string): Promise<PublicManagedBooking>;
  /** Where the booking's calendar file downloads from (a plain link: Add to calendar, Apple and .ics). */
  icsUrl(token: string): string;
  /** Who the visitor is (spec 0028): signed in to Timefix here, a guest who connected Google, or nobody. */
  viewer(publicKey: string): Promise<PublicViewerAnswer>;
  /** Where Connect calendar goes: Google for this visit, then back to `returnPath` (this page's own address). */
  connectUrl(publicKey: string, returnPath: string): string;
  /** Forgets a guest's connected calendar at once. */
  forget(): Promise<void>;
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

/** What a public client is made on: the page's own origin, and `fetch` and the clock for tests. */
export interface PublicClientOptions {
  readonly origin: string;
  readonly fetch?: FetchLike;
  readonly now?: () => number;
}

/**
 * The plain calls the public clients make to `/api/public/booking/*`: each
 * failure a DataError with the API's code, being offline `API_UNAVAILABLE`.
 */
export function publicCaller(options: PublicClientOptions) {
  const send = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const now = options.now ?? Date.now;
  const base = `${options.origin}/api/public/booking`;
  const call = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
    let response: Response;
    try {
      // Cookies go only where they say who the visitor is (spec 0028): the viewer, the slots and forgetting.
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
  const post = <T>(path: string, body: unknown): Promise<T> =>
    call<T>(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { base, call, post };
}

/** The client, on `origin` (the page's own), with `fetch` passed in for tests. */
export function createBookingClient(options: PublicClientOptions): BookingClient {
  const { base, call } = publicCaller(options);
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
        { credentials: 'same-origin', ...(signal === undefined ? {} : { signal }) },
      ),
    book: (publicKey, input) =>
      call<PublicBooked>(`${encodeURIComponent(publicKey)}/book`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      }),
    chat: (publicKey, input, signal) =>
      call<PublicChatReply>(`${encodeURIComponent(publicKey)}/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
        ...(signal === undefined ? {} : { signal }),
      }),
    managed: (token) => call<PublicManagedBooking>(`manage/${encodeURIComponent(token)}`),
    icsUrl: (token) => `${base}/manage/${encodeURIComponent(token)}/ics`,
    viewer: (publicKey) =>
      call<PublicViewerAnswer>(`${encodeURIComponent(publicKey)}/viewer`, { credentials: 'same-origin' }),
    connectUrl: (publicKey, returnPath) =>
      `${base}/${encodeURIComponent(publicKey)}/connect?${new URLSearchParams({ return: returnPath }).toString()}`,
    forget: async () => {
      await call<unknown>('connect/forget', { method: 'POST', credentials: 'same-origin' });
    },
  };
}

/** The message the editor's preview posts to its frame: `{ type: 'crm:preview', draft }`. */
export const PREVIEW_MESSAGE = 'crm:preview';

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null;

const PREVIEW_DURATIONS: readonly number[] = [15, 30, 45, 60, 90];

const isDuration = (value: unknown): value is PublicBookingPage['durations'][number] =>
  typeof value === 'number' && PREVIEW_DURATIONS.includes(value);

/** A draft's location, when it is one the page can show. */
function previewLocation(value: unknown): PublicBookingPage['location'] | undefined {
  if (!isRecord(value)) return undefined;
  if (value.type === 'video' || value.type === 'phone') return { type: value.type };
  if ((value.type === 'address' || value.type === 'custom') && typeof value.value === 'string') {
    return { type: value.type, value: value.value };
  }
  return undefined;
}

/**
 * The page with the editor's unsaved draft laid over it (spec 0025, AC-679),
 * from a preview message: only the title, description, durations and location,
 * each taken only when it has the right shape, so a stray message changes
 * nothing. Anything that isn't a preview message answers `undefined`.
 */
export function withPreviewDraft(page: PublicBookingPage, message: unknown): PublicBookingPage | undefined {
  if (!isRecord(message) || message.type !== PREVIEW_MESSAGE || !isRecord(message.draft)) return undefined;
  const { title, description, durations, location } = message.draft;
  const lengths = Array.isArray(durations) ? durations.filter(isDuration) : [];
  const place = previewLocation(location);
  return {
    ...page,
    ...(typeof title === 'string' && title.trim() !== '' ? { title } : {}),
    ...(typeof description === 'string' ? { description } : {}),
    ...(lengths.length > 0 ? { durations: lengths } : {}),
    ...(place === undefined ? {} : { location: place }),
  };
}
