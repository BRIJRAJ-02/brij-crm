// `@crm/core/public`: what the api's public, unauthenticated routes may call
// (spec 0025). The door that turns a booking page's public key into the
// `booking` actor's narrow scope (and the guest page's, by its manage token), and the services that take them. Lint
// keeps this import to `apps/api/src/public/**`.
export {
  enterBookingAddress,
  enterBookingByToken,
  enterBookingPage,
  enterBookingProfile,
  findHandleOwner,
  type BookingEntry,
  type HandleOwner,
  type ProfileCursor,
  type ProfilePageEntry,
} from './access/door.ts';
export {
  bookPublicSlot,
  readAddressedPage,
  readBookingProfile,
  readHandoffPrefill,
  getPublicBookingPage,
  isPageHost,
  managedBookingIcs,
  readManagedBooking,
  readPagePicture,
  readProfilePicture,
  readPublicSlots,
  type IcsOrigin,
  type PublicBookingDeps,
  type PublicPictureDeps,
} from './booking/public.ts';
// A host's account picture (23 Oct 2026): only Google's picture hosts, so the api's fetch goes nowhere else.
export { isPictureHost, pictureVersion, type AccountPicture, type AccountPictureReader } from './booking/picture.ts';
// The booking chat (spec 0042): one turn, through the slots and booking services above.
export { chatTurn, type ChatTurn } from './booking/chat/turn.ts';
// The guest page's changes (milestone 2): move, add guests, cancel, and where it could move.
export { addGuests, cancelBooking, guestTarget, moveBooking, readMoveSlots, removeGuest } from './booking/change.ts';
// An email's preferences link (the emails lane): its token read, the member's narrow scope, and their choices.
export { enterEmailLink } from './access/door.ts';
export { readEmailLinkToken, readEmailPreferences, setEmailPreference } from './emails/preferences.ts';
