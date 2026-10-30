// The host's changes to a booking (spec 0025, AC-640), bound to one workspace
// for the Bookings screens: the data layer's cancel, move, move slots and
// guest link, and the toasts that say how Copy guest link went; and linking a
// booking to a record by hand (polish F2) over the workspace's objects.
import type { DataLayer, ObjectSummary } from '@crm/data';
import type { Toasts } from '@crm/ui';
import { recordLinks } from '../records/timeline.ts';
import type { BookingLinking, HostBookingActions } from './BookingActions.tsx';

/**
 * The objects a booking may be linked to by hand: those the member may change, live, but People and Companies (its
 * guest's, filed when it was made); Deals first, then the sidebar's order.
 */
export function linkableObjects(objects: readonly ObjectSummary[]): readonly ObjectSummary[] {
  return objects
    .filter(
      (object) =>
        object.access === 'write' &&
        !object.isArchived &&
        object.standardKey !== 'people' &&
        object.standardKey !== 'companies',
    )
    .toSorted(
      (a, b) => Number(b.standardKey === 'deals') - Number(a.standardKey === 'deals') || a.position - b.position,
    );
}

/** Linking for `slug`'s bookings: the objects to link from, the link itself, and record pages. */
export function bookingLinking(data: DataLayer, slug: string, objects: readonly ObjectSummary[]): BookingLinking {
  const link = recordLinks(slug, objects);
  return {
    slug,
    objects: linkableObjects(objects),
    link: (bookingId, record) => data.bookings.link(slug, bookingId, record),
    hrefOf: (record) => link(record.objectId, record.recordId),
  };
}

/** The card's changes for `slug`'s bookings; with the workspace's objects, linking too. */
export function hostActions(
  data: DataLayer,
  toasts: Toasts,
  slug: string,
  objects?: readonly ObjectSummary[],
): HostBookingActions {
  return {
    cancel: (bookingId, reason) => data.bookings.cancel(slug, bookingId, reason),
    move: (bookingId, start, minutes) => data.bookings.move(slug, bookingId, start, minutes),
    moveSlots: (bookingId, from, to, minutes) => data.bookings.moveSlots(slug, bookingId, from, to, minutes),
    guestLink: (bookingId) => data.bookings.guestLink(slug, bookingId),
    assignments: (bookingId) => data.bookings.assignments(slug, bookingId),
    reassign: (bookingId, to) => data.bookings.reassign(slug, bookingId, to),
    rotations: () => data.rotations.held(slug),
    markNoShow: (bookingId, noShow) => data.bookings.markNoShow(slug, bookingId, noShow),
    notify: (tone, message, action) => toasts.toast({ tone, message, ...(action === undefined ? {} : { action }) }),
    ...(objects === undefined ? {} : { linking: bookingLinking(data, slug, objects) }),
  };
}
