// The host's changes to a booking (spec 0025, AC-640), bound to one workspace
// for the Bookings screens: the data layer's cancel, move, move slots and
// guest link, and the toasts that say how Copy guest link went.
import type { DataLayer } from '@crm/data';
import type { Toasts } from '@crm/ui';
import type { HostBookingActions } from './BookingActions.tsx';

/** The card's changes for `slug`'s bookings. */
export function hostActions(data: DataLayer, toasts: Toasts, slug: string): HostBookingActions {
  return {
    cancel: (bookingId, reason) => data.bookings.cancel(slug, bookingId, reason),
    move: (bookingId, start) => data.bookings.move(slug, bookingId, start),
    moveSlots: (bookingId, from, to) => data.bookings.moveSlots(slug, bookingId, from, to),
    guestLink: (bookingId) => data.bookings.guestLink(slug, bookingId),
    notify: (tone, message) => toasts.toast({ tone, message }),
  };
}
