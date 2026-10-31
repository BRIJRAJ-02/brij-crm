export { brandImages, passImages, writePass, type PassInput, type PassImages } from './profile/pass.ts';
export { type PassSigningKeys } from './profile/pkcs7.ts';
// `@crm/core/public`: what the api's public, unauthenticated routes may call
// (spec 0025). The door that turns a booking page's public key into the
// `booking` actor's narrow scope (and the guest page's, by its manage token), and the services that take them. Lint
// keeps this import to `apps/api/src/public/**`.
export {
  enterBookingAddress,
  enterBookingByToken,
  enterBookingPage,
  countItemPress,
  countProfileBooking,
  countProfileView,
  enterContactCard,
  enterLinkBlocks,
  enterLinkImage,
  enterLinkPage,
  enterTimesBlock,
  listSitemapHandles,
  enterShareImage,
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
  linkIconOf,
  readLinkPage,
  readHandoffPrefill,
  getPublicBookingPage,
  isPageHost,
  managedBookingIcs,
  readManagedBooking,
  readPagePicture,
  readProfilePicture,
  readPublicSlots,
  readTimesPage,
  type IcsOrigin,
  type PublicBookingDeps,
  type PublicPictureDeps,
} from './booking/public.ts';
// The link page's contact card as a vCard (spec 0051, AC-5114).
export { writeVcard, type VcardPhoto } from './profile/vcard.ts';
// A host's account picture (23 Oct 2026): only Google's picture hosts, so the api's fetch goes nowhere else.
export {
  isPictureHost,
  pictureVersion,
  type AccountPicture,
  type AccountPictureReader,
  type PersonPicture,
} from './booking/picture.ts';
// What a picture's own bytes say it is: every image taken from outside is decided here, never by a claimed type.
export { imageTypeOf, type ImageType } from './booking/image-type.ts';

// A link block's own icon from our own origin (26 Oct 2026): what may be fetched for one, and nothing else.
export { declaredIcon, faviconSources, faviconVersion, isFaviconSite, FAVICON_PATH } from './booking/favicon.ts';

// Whether a path parameter is an id at all, so a public route turns away what the door would only refuse.
export { isUuid } from './engine/ids.ts';

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

// What the public pages wear of a brand (spec 0060): a booking page's, a form's and a link page's accent, photos and
// logo, and the small stylesheets that carry the accent.
export {
  brandStylesheet,
  LOOK_IMAGE_PROPERTIES,
  lookStylesheet,
  readBookingBrand,
  readFormBrand,
  readHandleLook,
  type LookImage,
  type PageBrand,
  type PageLook,
} from './brand/public.ts';

// Link page blocks and reach (spec 0061): media links read into a provider and id and every address built back from
// them; a view's four facts; a picture's checks and its metadata taken out; a page's own `og:` picture and title.
export {
  isMediaInfoHost,
  isMediaPosterHost,
  mediaInfoSource,
  readOembed,
  cleanTitle,
  MEDIA_FRAME_ORIGINS,
} from './profile/embeds.ts';
export { viewFacts, type ViewFacts } from './profile/sources.ts';
export { checkProfileImage, readPageMeta, profileImageStorePath, type CheckedImage } from './profile/images.ts';
export { isShownAt } from './profile/schedule.ts';
