// `@crm/core/public`: what the api's public, unauthenticated routes may call
// (spec 0025). The door that turns a booking page's public key into the
// `booking` actor's narrow scope, and the three services that take it. Lint
// keeps this import to `apps/api/src/public/**`.
export { enterBookingPage, type BookingEntry } from './access/door.ts';
export { bookPublicSlot, getPublicBookingPage, readPublicSlots, type PublicBookingDeps } from './booking/public.ts';
