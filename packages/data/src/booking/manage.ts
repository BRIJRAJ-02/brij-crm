// The guest page's changes (spec 0025, milestone 2): where the booking could
// move, and moving it, inviting and removing guests and cancelling it, by its
// manage token alone. Apart from `createBookingClient`, so the booking page,
// which never changes a booking, doesn't carry them.
import type { PublicChanged, PublicGuestsAnswer, PublicSlots } from '@crm/contracts/booking';
import { publicCaller, type PublicClientOptions } from './public.ts';

/** The guest page's changes to their booking. */
export interface ManageClient {
  /** Where the guest's booking could move in a range: the page's times, its own length. */
  moveSlots(
    token: string,
    query: { readonly from: string; readonly to: string; readonly tz: string },
    signal?: AbortSignal,
  ): Promise<PublicSlots>;
  /** Moves it; the answer is the booking as it is now. */
  move(token: string, start: string): Promise<PublicChanged>;
  /** Invites more people; the answer says how many were new. */
  addGuests(token: string, emails: readonly string[]): Promise<PublicGuestsAnswer>;
  /** Takes a guest off; the answer is everyone still invited. */
  removeGuest(token: string, email: string): Promise<{ readonly guests: readonly string[] }>;
  /** Cancels it, with an optional reason the host sees. */
  cancel(token: string, reason: string): Promise<PublicChanged>;
}

/** The guest page's changes client, on `origin` (the page's own). */
export function createManageClient(options: PublicClientOptions): ManageClient {
  const { call, post } = publicCaller(options);
  return {
    moveSlots: (token, query, signal) =>
      call<PublicSlots>(
        `manage/${encodeURIComponent(token)}/slots?${new URLSearchParams({
          from: query.from,
          to: query.to,
          tz: query.tz,
        }).toString()}`,
        signal === undefined ? {} : { signal },
      ),
    move: (token, start) => post<PublicChanged>(`manage/${encodeURIComponent(token)}/move`, { start }),
    addGuests: (token, emails) =>
      post<PublicGuestsAnswer>(`manage/${encodeURIComponent(token)}/guests`, { emails: [...emails] }),
    removeGuest: (token, email) =>
      post<{ readonly guests: readonly string[] }>(`manage/${encodeURIComponent(token)}/guests/remove`, { email }),
    cancel: (token, reason) =>
      post<PublicChanged>(`manage/${encodeURIComponent(token)}/cancel`, reason === '' ? {} : { reason }),
  };
}
