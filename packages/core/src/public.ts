// `@crm/core/public`: what the api's public, unauthenticated routes may call
// (spec 0025). The door that turns a booking page's public key into the
// `booking` actor's narrow scope (and the guest page's, by its manage token), and the services that take them. Lint
// keeps this import to `apps/api/src/public/**`.
export { enterBookingByToken, enterBookingPage, type BookingEntry } from './access/door.ts';
export {
  bookPublicSlot,
  readHandoffPrefill,
  getPublicBookingPage,
  isPageHost,
  managedBookingIcs,
  readManagedBooking,
  readPublicSlots,
  type IcsOrigin,
  type PublicBookingDeps,
} from './booking/public.ts';
// The guest page's changes (milestone 2): move, add guests, cancel, and where it could move.
export { addGuests, cancelBooking, guestTarget, moveBooking, readMoveSlots, removeGuest } from './booking/change.ts';
