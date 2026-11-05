// `@crm/data/booking`: the public booking page's one way to the API (spec
// 0025). The public bundle never loads the app's data layer, the oRPC client
// or Zod: plain calls to `/api/public/booking/*` on the page's own
// origin, each failure a `DataError` with the API's code (`SLOT_TAKEN`,
// `BOOKING_CLOSED`, `NOT_FOUND`, `RATE_LIMITED` with its wait, `INPUT_INVALID`
// with issues), and being offline `API_UNAVAILABLE`.
import type {
  PublicAddress,
  PublicHandleOffer,
  PublicProfile,
  PublicProfileTimes,
  PublicBooked,
  PublicBookInput,
  PublicBookingPage,
  PublicChatInput,
  PublicChatReply,
  PublicManagedBooking,
  PublicPrefill,
  PublicSlots,
  PublicSocialLink,
  PublicViewerAnswer,
} from '@crm/contracts/booking';
import { safeLink } from '@crm/contracts/safe-link';
import { isSocialLinkNetwork, SOCIAL_LINKS_MAX } from '@crm/contracts/social-networks';
import { dataError, isFetchFailure, parseRetryAfter, toDataError, type DataError } from '../errors.ts';
import type { FetchLike } from '../fetch.ts';

export type {
  PublicAddress,
  PublicHandleOffer,
  PublicProfile,
  PublicProfileItem,
  PublicProfileTimes,
  PublicPicture,
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
  PublicPrefill,
  PublicSlot,
  PublicSlots,
  PublicSocialLink,
  PublicViewer,
  PublicViewerAnswer,
  SlotsOverlay,
} from '@crm/contracts/booking';
export { isDataError, type DataError } from '../errors.ts';

/** What the public page needs: the page's facts, a range of slots, and the booking. */
export interface BookingClient {
  /**
   * The page's facts; `handoff`, a form's signed hand off, opens a page that books only through a form (spec 0037);
   * `linkHash`, a one off link's token hashed (spec 0062, AC-6204), says whether that link has anything left.
   */
  page(publicKey: string, handoff?: string, linkHash?: string): Promise<PublicBookingPage>;
  slots(
    publicKey: string,
    query: {
      readonly from: string;
      readonly to: string;
      /** Left out, the page's first length: the page's first read, sent beside its facts before it knows them. */
      readonly duration?: number;
      readonly tz: string;
      /** A form's hand off (spec 0043, AC-1609): a team page then offers only the hosts its routing chose. */
      readonly p?: string;
      /** A one off link's token hashed (spec 0062, B-10): an invitation only page offers times only beside one. */
      readonly o?: string;
    },
    signal?: AbortSignal,
  ): Promise<PublicSlots>;
  /**
   * A fill ticket for the page (spec 0023, B-04): the server's note of when the page loaded, which a booking and a
   * chat turn that books carry. Undefined when it can't be had; the booking is then refused as too fast.
   */
  ticket(publicKey: string): Promise<string | undefined>;
  /** Books; the answer carries the guest page's token. */
  book(publicKey: string, input: PublicBookInput): Promise<PublicBooked>;
  /** One turn of the booking chat (spec 0042); a turn that booked carries the guest page's token. */
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
  /** The name and email a form's signed hand off carries for this page (spec 0023 AC-1058); empty for anything else. */
  prefill(publicKey: string, token: string): Promise<PublicPrefill>;
  /**
   * Counts the visit for Insights (spec 0067, AC-6702): the page was seen, or a step was reached. A beacon, lost on
   * purpose when it can't go; the booking itself is the finish, which the server marks. Nothing comes back.
   */
  event(publicKey: string, body: PageBeacon): void;
}

/** What a booking page's visit beacon says (spec 0067): the server parses it again and keeps only what it allows. */
export interface PageBeacon {
  readonly kind: 'view' | 'step';
  readonly step?: string;
  readonly landing?: {
    readonly utm_source?: string;
    readonly utm_medium?: string;
    readonly utm_campaign?: string;
    readonly utm_term?: true;
    readonly utm_content?: true;
    readonly gclid?: true;
    readonly fbclid?: true;
  };
  readonly referrer?: string;
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
export function publicCaller(
  options: PublicClientOptions,
  area: 'booking' | 'handles' | 'profiles' | 'menu' | 'business' = 'booking',
) {
  const send = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const now = options.now ?? Date.now;
  const base = `${options.origin}/api/public/${area}`;
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

/**
 * The header a form's hand off travels in (security review, 4 Nov 2026): never the query string, which request logs
 * keep. The api reads it on the page, prefill and slots reads.
 */
const HANDOFF_HEADER = 'x-crm-handoff';

/** The hand off as request headers, or none. */
const handoffHeaders = (handoff: string | undefined): Record<string, string> =>
  handoff === undefined ? {} : { [HANDOFF_HEADER]: handoff };

/** The client, on `origin` (the page's own), with `fetch` passed in for tests. */
export function createBookingClient(options: PublicClientOptions): BookingClient {
  const { base, call } = publicCaller(options);
  return {
    page: (publicKey, handoff, linkHash) => {
      const query = new URLSearchParams(linkHash === undefined ? {} : { o: linkHash }).toString();
      return call<PublicBookingPage>(`${encodeURIComponent(publicKey)}${query === '' ? '' : `?${query}`}`, {
        headers: handoffHeaders(handoff),
      });
    },
    slots: (publicKey, query, signal) =>
      call<PublicSlots>(
        `${encodeURIComponent(publicKey)}/slots?${new URLSearchParams({
          from: query.from,
          to: query.to,
          // Left out, the page's first length (the page's first read, sent beside its facts).
          ...(query.duration === undefined ? {} : { duration: String(query.duration) }),
          tz: query.tz,
          ...(query.o === undefined ? {} : { o: query.o }),
        }).toString()}`,
        {
          credentials: 'same-origin',
          headers: handoffHeaders(query.p),
          ...(signal === undefined ? {} : { signal }),
        },
      ),
    ticket: async (publicKey) => {
      try {
        const answer = await call<unknown>(`${encodeURIComponent(publicKey)}/ticket`);
        return typeof answer === 'object' && answer !== null && 'ticket' in answer && typeof answer.ticket === 'string'
          ? answer.ticket
          : undefined;
      } catch {
        return undefined;
      }
    },
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
    prefill: (publicKey, token) =>
      call<PublicPrefill>(`${encodeURIComponent(publicKey)}/prefill`, { headers: handoffHeaders(token) }),
    event: (publicKey, body) => {
      const url = `${base}/${encodeURIComponent(publicKey)}/events`;
      const text = JSON.stringify(body);
      try {
        // A beacon survives the page closing; `text/plain` asks for no preflight. Where there is none, a keepalive post.
        if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
          if (navigator.sendBeacon(url, new Blob([text], { type: 'text/plain' }))) return;
        }
        void call<unknown>(`${encodeURIComponent(publicKey)}/events`, {
          method: 'POST',
          headers: { 'content-type': 'text/plain' },
          body: text,
          keepalive: true,
        }).catch(() => undefined);
      } catch {
        // A count is never worth an error on a visitor's page.
      }
    },
  };
}

/** What a handle address needs (22 Oct 2026): a person's profile, a page of links at a time, and one page's key. */
export interface HandleClient {
  /**
   * The profile at `/<handle>` and its first (or `after`'s next) page of blocks, only those holding `q`. Read with
   * neither, it is a view of the page (AC-5124); `q: ''` (a search cleared) reads the first page without being one.
   */
  profile(
    handle: string,
    query?: {
      readonly after?: string;
      readonly q?: string;
      /**
       * The two facts a view carries from the page (spec 0061, AC-6116): the referring site's host and the
       * `utm_source`, sent only with the view read and checked again on the server, which keeps neither raw.
       */
      readonly ref?: string;
      readonly src?: string;
      /** The owner's own Preview of their draft (spec 0068): answered only to the signed in owner, else ignored. */
      readonly draft?: boolean;
    },
  ): Promise<PublicProfile>;
  /**
   * A next times block's next open times (spec 0061, AC-6110), in `tz`: read when the block nears the screen, and
   * answered with a minute of cache, so a page of three blocks is three light reads at most.
   */
  times(handle: string, itemId: string, tz: string, signal?: AbortSignal): Promise<PublicProfileTimes>;
  /** The page `/<handle>/<slug>` names, by its public key, and the owner's current handle. */
  address(handle: string, slug: string): Promise<PublicAddress>;
  /**
   * Says a block was pressed (spec 0051, AC-5125): a beacon, so the navigation it starts never waits, and lost on
   * purpose when it can't go. Nothing comes back.
   */
  press(handle: string, itemId: string): void;
  /**
   * Whether `/<handle>` is free to claim (25 Oct 2026), asked only once `profile` answered NOT_FOUND. One of two
   * words: `free`, or `absent` for a handle somebody holds, a word kept for Timefix and a word no handle could be
   * alike, so the answer never says whether a private account is behind an address.
   */
  offer(handle: string): Promise<PublicHandleOffer>;
}

/** Sends a beacon: the browser's `navigator.sendBeacon`, or a test's own. */
export type BeaconLike = (url: string, body: string) => boolean;

/** The handle client, on `origin` (the page's own), with `fetch` passed in for tests. */
export function createHandleClient(options: PublicClientOptions & { readonly beacon?: BeaconLike }): HandleClient {
  const { base, call } = publicCaller(options, 'handles');
  const profiles = publicCaller(options, 'profiles');
  const beacon: BeaconLike =
    options.beacon ?? ((url, body) => typeof navigator.sendBeacon === 'function' && navigator.sendBeacon(url, body));
  return {
    profile: (handle, query = {}) => {
      // An empty `q` is still a search (a cleared one), so it is sent, and never counts as a view.
      // The first page's read is a view (AC-5124): it goes with this site's cookies, so the owner's own isn't one.
      const isView = query.after === undefined && query.q === undefined;
      const search = new URLSearchParams({
        ...(query.after === undefined ? {} : { after: query.after }),
        ...(query.q === undefined ? {} : { q: query.q }),
        // The view's facts ride on the view read alone (AC-6116): a search and a further page carry none.
        ...(isView && query.ref !== undefined ? { ref: query.ref } : {}),
        ...(isView && query.src !== undefined ? { src: query.src } : {}),
        ...(query.draft === true ? { draft: '1' } : {}),
      }).toString();
      return call<PublicProfile>(
        `${encodeURIComponent(handle)}${search === '' ? '' : `?${search}`}`,
        isView || query.draft === true ? { credentials: 'same-origin' } : {},
      );
    },
    times: (handle, itemId, tz, signal) =>
      profiles.call<PublicProfileTimes>(
        `${encodeURIComponent(handle)}/items/${encodeURIComponent(itemId)}/times?${new URLSearchParams({ tz }).toString()}`,
        signal === undefined ? {} : { signal },
      ),
    press: (handle, itemId) => {
      try {
        beacon(`${base}/${encodeURIComponent(handle)}/press`, itemId);
      } catch {
        // A press that can't be sent is lost on purpose: nothing on the page waits on it.
      }
    },
    address: (handle, slug) => call<PublicAddress>(`${encodeURIComponent(handle)}/${encodeURIComponent(slug)}`),
    // Under `profiles`, where `/handles/:handle/:slug` would read `offer` as a page's slug.
    offer: (handle) => profiles.call<PublicHandleOffer>(`${encodeURIComponent(handle)}/offer`),
  };
}

/** The message the editor's preview posts to its frame: `{ type: 'crm:preview', draft }`. */
export const PREVIEW_MESSAGE = 'crm:preview';

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null;

/** A length the page can show: 5 to 480 minutes in steps of 5 (contracts' `BookingDuration`). */
const isDuration = (value: unknown): value is PublicBookingPage['durations'][number] =>
  typeof value === 'number' && Number.isInteger(value) && value >= 5 && value <= 480 && value % 5 === 0;

/** A draft's location, when it is one the page can show. */
function previewLocation(value: unknown): PublicBookingPage['location'] | undefined {
  if (!isRecord(value)) return undefined;
  if (value.type === 'video' || value.type === 'phone') return { type: value.type };
  if ((value.type === 'address' || value.type === 'custom') && typeof value.value === 'string') {
    return { type: value.type, value: value.value };
  }
  return undefined;
}

/** A social link a draft may show: a known network, an http or https link `safeLink` takes, and a short label. */
function previewSocial(value: unknown): PublicSocialLink | undefined {
  if (!isRecord(value) || !isSocialLinkNetwork(value.network)) return undefined;
  const { href, label } = value;
  if (typeof href !== 'string' || href.length > 2_048 || !/^https?:\/\//i.test(href) || safeLink(href) === undefined) {
    return undefined;
  }
  if (typeof label !== 'string' || label.length > 200) return undefined;
  return { network: value.network, href, label };
}

/** A draft's social links, when it sends a list: each well formed one, a network once, at most ten. */
function previewSocials(value: unknown): readonly PublicSocialLink[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const seen = new Set<string>();
  return value.slice(0, SOCIAL_LINKS_MAX).flatMap((each: unknown) => {
    const link = previewSocial(each);
    if (link === undefined || seen.has(link.network)) return [];
    seen.add(link.network);
    return [link];
  });
}
/** A draft's opening view, when it is one of the three the page has. */
const previewView = (value: unknown): PublicBookingPage['defaultView'] | undefined =>
  value === 'month' || value === 'list' || value === 'chat' ? value : undefined;

/**
 * The page with the editor's unsaved draft laid over it (spec 0025, AC-679),
 * from a preview message: only the title, description, durations, location and
 * the host's social links as the editor shows them (booking socials), and the
 * view it opens in, each taken only when it has the right shape, so a stray
 * message changes nothing. Anything that isn't a preview message answers
 * `undefined`.
 */
export function withPreviewDraft(page: PublicBookingPage, message: unknown): PublicBookingPage | undefined {
  if (!isRecord(message) || message.type !== PREVIEW_MESSAGE || !isRecord(message.draft)) return undefined;
  const { title, description, durations, location, socials, defaultView } = message.draft;
  const lengths = Array.isArray(durations) ? durations.filter(isDuration) : [];
  const place = previewLocation(location);
  const links = previewSocials(socials);
  const opensIn = previewView(defaultView);
  // A team page never shows anyone's links (AC-754), whatever a message says.
  const { socials: _saved, ...rest } = page;
  return {
    ...(links === undefined || page.team !== undefined ? page : rest),
    ...(typeof title === 'string' && title.trim() !== '' ? { title } : {}),
    ...(typeof description === 'string' ? { description } : {}),
    ...(lengths.length > 0 ? { durations: lengths } : {}),
    ...(place === undefined ? {} : { location: place }),
    ...(links === undefined || links.length === 0 || page.team !== undefined ? {} : { socials: [...links] }),
    ...(opensIn === undefined ? {} : { defaultView: opensIn }),
  };
}
