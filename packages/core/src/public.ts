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
  mayPreviewDraft,
  countItemPress,
  countProfileBooking,
  countProfileView,
  countLinkVisit,
  enterContactCard,
  enterLinkBlocks,
  enterLinkImage,
  enterLinkPage,
  enterTimesBlock,
  listSitemapHandles,
  enterShareImage,
  findHandleOwner,
  findLockupLogo,
  readHandleOffer,
  putGuestHandoff,
  takeGuestHandoff,
  type GuestHandoff,
  type BookingEntry,
  type HandleOwner,
  type LinkPageRow,
  type OwnedPageEntry,
  type ProfileCursor,
} from './access/door.ts';
export {
  bookPublicSlot,
  countBookingVisit,
  countPageView,
  finishBookingVisit,
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
// The booking file's one name, on the guest page and in email (bookings redesign step 1).
export { icsFilename, icsMethodOf } from './booking/ics.ts';
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
export {
  declaredIcon,
  faviconSources,
  faviconVersion,
  isFaviconSite,
  FAVICON_PATH,
  type IconPick,
} from './booking/favicon.ts';

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
// Insights (spec 0067): a visit's origin from what its page sent, and a share link's numbers only page.
export { originOf, type VisitOrigin } from './insights/visits.ts';
export { readInsightShare } from './insights/shares.ts';

// The guest menu (spec 0065, H1, AC-6528): a menu key's door (ids only, through `crm_menu_by_key`), the place's live
// snapshot with Sold out over it, and its photos, only those the snapshot shows.
export {
  enterMenuPage,
  menuLookPin,
  menuLookStylesheet,
  menuLookVersion,
  readMenuPhoto,
  readPublicMenu,
  type MenuEntry,
  type PublicMenuRead,
} from './hospitality/public-menu.ts';
// Menu QR (spec 0065, H2): the table a QR's code names on the key's own place, counting the scan.
export { scanTable } from './hospitality/qr.ts';

// Table seating's guest page (spec 0066 B7 lite): the door by a place's public key, and the guest's reads and writes.
export { enterTablePage, TABLE_KEY_PATTERN, type TableEntry } from './access/table-door.ts';
export {
  guestCancel,
  guestChange,
  guestIcs,
  guestReserve,
  guestTimes,
  guestVisit,
  readTableLook,
  readTablePage,
  UPCOMING_PER_EMAIL,
  type GuestKey,
  type GuestReserved,
} from './visits/public.ts';
// News and offers by double opt-in (migration 0203): the confirm a reservation's email link opens.
export { confirmNews, NEWS_LINK_DAYS, type NewsConfirmed } from './visits/news.ts';

/** The business pages search engines may list (spec 0066, AC-6644), for sitemap-handles.xml. */
export { bookingCompanyOf, listSitemapBusinesses } from './hospitality/public-page.ts';
/** The business's and its guest menus' edge cache tags (spec 0066): an opaque id, never the workspace's id. */
export { businessCacheTags, menuWorkspaceCacheTags } from './hospitality/cache-tags.ts';
