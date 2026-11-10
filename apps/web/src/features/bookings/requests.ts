// Meetings › Requests (the Bookings redesign, 9 November 2026): every booking waiting for the host's Accept, across
// the pages (spec 0062, AC-6203), soonest first. The data layer holds them (`bookingFlow.waiting`) and reads them again
// in place on a `bookings` event, so a request made, answered elsewhere or expired shows with no reload. Accept and
// Decline go through it too: the row goes at once and comes back on a refusal.
import { type BookingPageView, type RequestsHeld, type RequestsState, type WaitingRequestView } from '@crm/data';
import { useRequests } from '@crm/data/react';
import { useMemo } from 'react';

/** What Requests reads and writes, bound to the workspace by the route. */
export interface MeetingRequestsSource {
  /** The held requests (`data.bookingFlow.waiting`). */
  readonly held: RequestsHeld;
  /** Whether it was accepted now: `false` when the request was already answered. */
  readonly confirm: (bookingId: string) => Promise<boolean>;
  /** Whether it was declined now; `reason` goes to the guest. */
  readonly decline: (bookingId: string, reason?: string) => Promise<boolean>;
}

/** One request and the page it was made on (its title and place). */
export interface HeldRequest {
  readonly request: WaitingRequestView;
  readonly page: BookingPageView;
}

/** The requests as shown: waiting, failed, or ready. */
export type MeetingRequestsState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly message: string }
  | { readonly status: 'ready'; readonly items: readonly HeldRequest[] };

const READY_NONE: RequestsState = { status: 'ready', items: [] };

/** No requests to hold (no source): none waiting, at once. */
const NO_REQUESTS: RequestsHeld = {
  subscribe: () => () => undefined,
  getSnapshot: () => READY_NONE,
  retain: () => () => undefined,
  reload: () => undefined,
  hide: () => () => undefined,
};

/**
 * The held requests, each with its page: one on a page the reader's pages don't list is left out, as it was when the
 * tab read page by page. Accept and Decline take the row away at once and put it back if the server refuses (the
 * refusal is the caller's to say).
 */
export function useMeetingRequests(source: MeetingRequestsSource | undefined, pages: readonly BookingPageView[]) {
  const held = source?.held ?? NO_REQUESTS;
  const read = useRequests(held);
  const state = useMemo((): MeetingRequestsState => {
    if (read.status !== 'ready') return read;
    const byId = new Map(pages.map((page) => [page.id, page]));
    return {
      status: 'ready',
      items: read.items.flatMap((request) => {
        const page = byId.get(request.pageId);
        return page === undefined ? [] : [{ request, page }];
      }),
    };
  }, [read, pages]);
  const answer = (bookingId: string, call: () => Promise<boolean>) => {
    const restore = held.hide(bookingId);
    return call().catch((error: unknown) => {
      restore();
      throw error;
    });
  };
  return {
    state,
    reload: held.reload,
    accept: (bookingId: string) =>
      source === undefined ? Promise.resolve(false) : answer(bookingId, () => source.confirm(bookingId)),
    decline: (bookingId: string, reason?: string) =>
      source === undefined ? Promise.resolve(false) : answer(bookingId, () => source.decline(bookingId, reason)),
  };
}
