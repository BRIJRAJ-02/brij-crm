// Meetings › Requests (the Bookings redesign, 9 November 2026): every booking waiting for the host's Accept, across
// the pages that confirm first (spec 0062, AC-6203), soonest first. The data layer reads each such page's requests
// (`bookingFlow.requests`), Accept and Decline go through it too, and its answers refresh the held Bookings views.
import { isDataError, type BookingPageView, type BookingRequestView } from '@crm/data';
import { useCallback, useEffect, useMemo, useState } from 'react';

/** What Requests reads and writes, bound to the workspace by the route. */
export interface MeetingRequestsSource {
  readonly list: (pageId: string) => Promise<readonly BookingRequestView[]>;
  /** Whether it was accepted now: `false` when the request was already answered. */
  readonly confirm: (bookingId: string) => Promise<boolean>;
  /** Whether it was declined now; `reason` goes to the guest. */
  readonly decline: (bookingId: string, reason?: string) => Promise<boolean>;
}

/** One request and the page it was made on (its title and place). */
export interface HeldRequest {
  readonly request: BookingRequestView;
  readonly page: BookingPageView;
}

/** The requests as read: waiting, failed, or ready. */
export type MeetingRequestsState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly message: string }
  | { readonly status: 'ready'; readonly items: readonly HeldRequest[] };

/** Whether a page asks its host to confirm each booking. */
const confirmsFirst = (page: BookingPageView) => page.requiresConfirmation;

/**
 * The requests on every page that confirms first, soonest first, read again on `reload`. Accept and Decline take the
 * row away at once and put it back if the server refuses (the refusal is the caller's to say).
 */
export function useMeetingRequests(source: MeetingRequestsSource | undefined, pages: readonly BookingPageView[]) {
  const asking = useMemo(() => pages.filter(confirmsFirst), [pages]);
  const [state, setState] = useState<MeetingRequestsState>({ status: 'loading' });
  const [reads, setReads] = useState(0);
  // Answered here and waiting for the server: hidden meanwhile, back on a refusal.
  const [answering, setAnswering] = useState<ReadonlySet<string>>(new Set());
  // Nothing to read (no page confirms first): none waiting, at once.
  const isIdle = source === undefined || asking.length === 0;
  useEffect(() => {
    if (source === undefined || asking.length === 0) return;
    let live = true;
    Promise.all(
      asking.map((page) => source.list(page.id).then((requests) => requests.map((request) => ({ request, page })))),
    ).then(
      (lists) => {
        if (!live) return;
        const items = lists.flat().sort((a, b) => Date.parse(a.request.start) - Date.parse(b.request.start));
        setState({ status: 'ready', items });
      },
      (error: unknown) => {
        if (live) setState({ status: 'error', message: isDataError(error) ? error.message : '' });
      },
    );
    return () => {
      live = false;
    };
  }, [source, asking, reads]);
  const reload = useCallback(() => setReads((count) => count + 1), []);
  const answer = useCallback(
    (bookingId: string, call: () => Promise<boolean>) => {
      setAnswering((held) => new Set([...held, bookingId]));
      const settle = () =>
        setAnswering((held) => {
          const next = new Set(held);
          next.delete(bookingId);
          return next;
        });
      return call().then(
        (done) => {
          // Kept hidden: answered, it never comes back, and the read below agrees.
          reload();
          return done;
        },
        (error: unknown) => {
          settle();
          throw error;
        },
      );
    },
    [reload],
  );
  const shown: MeetingRequestsState = isIdle
    ? { status: 'ready', items: [] }
    : state.status === 'ready'
      ? { status: 'ready', items: state.items.filter((item) => !answering.has(item.request.bookingId)) }
      : state;
  return {
    state: shown,
    reload,
    accept: (bookingId: string) =>
      source === undefined ? Promise.resolve(false) : answer(bookingId, () => source.confirm(bookingId)),
    decline: (bookingId: string, reason?: string) =>
      source === undefined ? Promise.resolve(false) : answer(bookingId, () => source.decline(bookingId, reason)),
  };
}
