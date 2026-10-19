// `@crm/core/public`: what the api's public, unauthenticated routes may call
// (spec 0025). The door that turns a booking page's public key into the
// `booking` actor's narrow scope (and the guest page's, by its manage token), and the services that take them. Lint
// keeps this import to `apps/api/src/public/**`.
export { enterBookingByToken, enterBookingPage, type BookingEntry } from './access/door.ts';
export {
  bookPublicSlot,
  getPublicBookingPage,
  managedBookingIcs,
  readManagedBooking,
  readPublicSlots,
  type IcsOrigin,
  type PublicBookingDeps,
} from './booking/public.ts';
