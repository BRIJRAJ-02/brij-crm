// `@crm/core/public`: what the api's public, unauthenticated routes may call
// (spec 0025). The door that turns a booking page's public key into the
// `booking` actor's narrow scope (and the guest page's, by its manage token), and the services that take them. Lint
// keeps this import to `apps/api/src/public/**`.
export {
  enterBookingAddress,
  enterBookingByToken,
  enterBookingPage,
  countItemPress,
  countProfileView,
  enterContactCard,
  enterLinkPage,
  findHandleOwner,
  readHandleOffer,
  type BookingEntry,
  type HandleOwner,
  type LinkPageRow,
  type OwnedPageEntry,
  type ProfileCursor,
} from './access/door.ts';
export {
  bookPublicSlot,
  countPageView,
  readAddressedPage,
  readContactCard,
  readLinkPage,
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
// The link page's contact card as a vCard (spec 0051, AC-5114).
export { writeVcard, type VcardPhoto } from './profile/vcard.ts';
// A host's account picture (23 Oct 2026): only Google's picture hosts, so the api's fetch goes nowhere else.
export { isPictureHost, pictureVersion, type AccountPicture, type AccountPictureReader } from './booking/picture.ts';

// Where our server may never be made to send a request (spec 0055, AC-5520). The pure half of the one hardened
// outside fetch: no network, no state, just the rule, so every caller asks the same question.
export { isFetchableUrl, isRefusedAddress } from './booking/addresses.ts';

// Bringing somebody's link in bio page across (spec 0055, AC-5524 to AC-5528): the seven hosts we will read, and
// the parser that turns one of their pages into rows. No network here either.
export {
  isImportableHost,
  LINK_IMPORT_HOSTS,
  LINK_IMPORT_MAX,
  readImportedPage,
  type ImportedPage,
  type ImportedRow,
  type ImportSkip,
  type SkippedRow,
} from './booking/link-import.ts';
// The booking chat (spec 0042): one turn, through the slots and booking services above.
export { chatTurn, type ChatTurn } from './booking/chat/turn.ts';
// The guest page's changes (milestone 2): move, add guests, cancel, and where it could move.
export { addGuests, cancelBooking, guestTarget, moveBooking, readMoveSlots, removeGuest } from './booking/change.ts';
// An email's preferences link (the emails lane): its token read, the member's narrow scope, and their choices.
export { enterEmailLink } from './access/door.ts';
export { readEmailLinkToken, readEmailPreferences, setEmailPreference } from './emails/preferences.ts';
