// What a visitor's browser reads and sends on a public booking page (spec
// 0025): plain Zod, no oRPC, so the public bundle and the API's public REST
// routes share one definition. Nothing here carries a member's email, other
// bookings, busy event titles, or an internal id but the page's public key
// (AC-644).
import * as z from 'zod';
import { Timestamp } from '../values/attribute-values.ts';
import { BookingDefaultView, BookingDuration, TimeZoneName } from './settings.ts';
import { Uuid } from '../values/ids.ts';
import { PageTheme, PublicLook } from './page-theme.ts';
import { PublicBrand } from '../workspace-brand.ts';
import { PublicProfileItem } from './link-page.ts';
import { SOCIAL_LINK_NETWORKS } from '../values/social-networks.ts';
import { PublicQuestion } from '../forms/public.ts';
import { compactPhone, internationalPhone } from '../forms/dial-codes.ts';

/** A page's public key: 16 URL safe characters. */
export const PublicKey = z.string().regex(/^[A-Za-z0-9_-]{16}$/, { error: 'That booking link isn’t right.' });
/** A page's public key. */
export type PublicKey = z.infer<typeof PublicKey>;

/** Where the meeting happens, as a visitor sees it before booking. */
export const PublicLocation = z.discriminatedUnion('type', [
  z.object({ type: z.literal('video') }),
  z.object({ type: z.literal('phone') }),
  z.object({ type: z.literal('address'), value: z.string() }),
  z.object({ type: z.literal('custom'), value: z.string() }),
]);
/** Where the meeting happens. */
export type PublicLocation = z.infer<typeof PublicLocation>;

/**
 * One of the host's social links as a public page draws it (booking socials, 25 Oct 2026): the network (its mark and
 * name), the stored canonical link, and what it reads as ("@ada", "ada.dev"), made by the server so the public
 * pages carry no link parsing.
 */
export const PublicSocialLink = z.object({
  network: z.enum(SOCIAL_LINK_NETWORKS),
  href: z.string(),
  label: z.string(),
});
/** One of the host's social links on a public page. */
export type PublicSocialLink = z.infer<typeof PublicSocialLink>;

/** `GET /api/public/booking/:publicKey`: the page's facts. */
export const PublicBookingPage = z.object({
  publicKey: PublicKey,
  title: z.string(),
  description: z.string(),
  /** The host's name as the workspace shows it (never their email). */
  hostName: z.string(),
  /**
   * The host's picture on our own origin (`/api/public/booking/<key>/picture?v=`, 23 Oct 2026): only on a personal
   * page whose owner's account has a Google picture, never Google's address itself. A team page has none (AC-754).
   */
  hostImage: z.string().optional(),
  durations: z.array(BookingDuration),
  location: PublicLocation,
  /** The host's zone, for "times shown in …" when the visitor changes theirs. */
  hostTimeZone: z.string(),
  /** How many days ahead a slot may start. */
  windowDays: z.number().int(),
  /**
   * How soon a time may start, in minutes, when the page keeps any notice (bookings fix, 5 Nov 2026): the rail says
   * it plainly. The slots read's own number (a private page none, a request page at least an hour). Left out: none.
   */
  minNoticeMinutes: z.number().int().positive().optional(),
  /**
   * The view the page opens in (owner, 25 Oct 2026), travelling with the page's other facts so the first paint is
   * already the right one. A visitor's own remembered choice on this browser wins over it.
   */
  defaultView: BookingDefaultView,
  /**
   * A team page's members as the rail stacks them (spec 0029, AC-733): up to
   * 4 initials (a picture when one is served from our origin) and how many
   * more. No names, no emails (AC-754); `hostName` is then the workspace's.
   */
  team: z
    .object({
      avatars: z.array(z.object({ initials: z.string(), image: z.string().optional() })),
      more: z.number().int().min(0),
    })
    .optional(),
  /**
   * The page's address once its owner has a handle, `/<handle>/<slug>` (22 Oct 2026): a plain `/b/<key>` visit moves
   * there. Absent while the owner has none.
   */
  path: z.string().optional(),
  /**
   * The host's social links, in their order (booking socials, 25 Oct 2026): only on a personal page whose owner has
   * "Show my social links" on, absent when there are none. A team page names no host, so never has them (AC-754).
   */
  socials: z.array(PublicSocialLink).optional(),
  /** A personal page's host's job title, only while they show it (3 Nov 2026). A team page names no host (AC-754). */
  hostRole: z.string().optional(),
  /**
   * The page's own questions, drawn after the note (spec 0057, AC-5709): what rendering needs (key, label, type,
   * choices, required, show when), never where an answer is filed. Absent on a page that asks none (AC-5704).
   */
  questions: z.array(PublicQuestion).optional(),
  /**
   * The page books only through a form (spec 0037, AC-1388) and this visit carries no hand off: the visitor sees the
   * page's closed state. Only the host's own editor preview draws it anyway. Absent otherwise.
   */
  formOnly: z.literal(true).optional(),
  /**
   * The brand it wears (spec 0060, AC-4, AC-14): the versions `brandStylesheetPath('booking', …)` and
   * `brandLogoPath('booking', …)` take. A personal page wears its owner's own accent when they set one, else the
   * workspace's, and a team page the workspace's. Absent when it wears the product's own accent and no logo.
   */
  brand: PublicBrand.optional(),
  /** The host confirms each booking first (spec 0062, AC-6203): the page's button says Request. */
  requiresConfirmation: z.literal(true).optional(),
  /** The one off link it was opened with has nothing left to book (AC-6204): "This link has been used". */
  linkUsed: z.literal(true).optional(),
  /** A page that books only through one-time links, opened without one (AC-6204): "This page books by invitation". */
  invitationOnly: z.literal(true).optional(),
});
/** The page's facts. */
export type PublicBookingPage = z.infer<typeof PublicBookingPage>;

/**
 * A personal page's host picture, as our origin serves it: `GET /api/public/booking/:publicKey/picture?v=`. The
 * version names the picture (core's `pictureVersion`), and the route answers only the current one.
 */
export function bookingPicturePath(publicKey: string, version: string): string {
  return `/api/public/booking/${encodeURIComponent(publicKey)}/picture?v=${encodeURIComponent(version)}`;
}

/**
 * A profile's picture, as our origin serves it: `GET /api/public/profiles/:handle/picture?v=`. Under `profiles`, not
 * `handles`: `/handles/:handle/:slug` is a page's address, and `picture` is a slug a page may have.
 */
export function profilePicturePath(handle: string, version: string): string {
  return `/api/public/profiles/${encodeURIComponent(handle)}/picture?v=${encodeURIComponent(version)}`;
}

/**
 * A link page's workspace logo, as our origin serves it: `GET /api/public/profiles/:handle/logo?v=` (3 Nov 2026),
 * answered only while the page has a site address for the lockup to link to.
 */
export function profileLogoPath(handle: string, version: string): string {
  return `/api/public/profiles/${encodeURIComponent(handle)}/logo?v=${encodeURIComponent(version)}`;
}

/**
 * A link page's own share image, as our origin serves it: `GET /api/public/profiles/:handle/share-image?v=`. The
 * picture a pasted link shows instead of the card we draw (spec 0055, AC-5511). Under `profiles` for the same
 * reason a picture is: `/handles/:handle/:slug` is a page's address.
 */
export function profileSharePath(handle: string, version: string): string {
  return `/api/public/profiles/${encodeURIComponent(handle)}/share-image?v=${encodeURIComponent(version)}`;
}

/**
 * A link block's own icon, as our origin serves it: `GET /api/public/profiles/:handle/items/:id/icon?v=`. The api
 * fetches the site's favicon and answers it itself, so `img-src 'self'` is unchanged (AC-5110). Under `profiles`
 * for the same reason a picture is: `/handles/:handle/:slug` is a page's address.
 */
export function linkIconPath(handle: string, itemId: string, version: string): string {
  return `/api/public/profiles/${encodeURIComponent(handle)}/items/${encodeURIComponent(itemId)}/icon?v=${encodeURIComponent(version)}`;
}

/** The signed in person's own picture, for the app (Settings › Profile): `GET /api/me/picture?v=`, never shared. */
export function myPicturePath(version: string): string {
  return `/api/me/picture?v=${encodeURIComponent(version)}`;
}

/** `GET /api/public/handles/:handle/:slug`: the page a handle address names, by its key, and the current handle. */
export const PublicAddress = z.object({
  publicKey: PublicKey,
  /** The owner's current handle: an old one's address moves to it. */
  handle: z.string(),
  /** The page's current slug: an old one's address moves to it (slug history, 22 Oct 2026). */
  slug: z.string(),
});
/** The page a handle address names. */
export type PublicAddress = z.infer<typeof PublicAddress>;

/** How many blocks one profile read answers. */
export const PROFILE_PAGE_SIZE = 20;

/**
 * `GET /api/public/handles/:handle?after&q`: the person and one page of their link page's blocks, every kind together
 * in the owner's order (spec 0051, AC-5108). With `q`, every block that matches, flat, with no headings.
 */
export const PublicProfile = z.object({
  /** The current handle: an old one's address moves to it. */
  handle: z.string(),
  name: z.string(),
  /** Up to two initials, for the avatar without a picture. */
  initials: z.string(),
  /** The person's picture on our own origin (`/api/public/profiles/<handle>/picture?v=`), when the account has one. */
  image: z.string().optional(),
  bio: z.string(),
  /** Their job title, under their name, only while they show it (3 Nov 2026). */
  role: z.string().optional(),
  /**
   * Their workspace's lockup at the top of the page (3 Nov 2026): its name, the logo's path on our own origin when
   * the brand kit has one, and the site both link to. Absent until the owner sets a site address.
   */
  brand: z.object({ name: z.string(), site: z.string(), logo: z.string().optional() }).optional(),
  /** The owner's own line, drawn above "Powered by Timefix" and never in its place (3 Nov 2026). */
  footLine: z.string().optional(),
  /** Their social links, in their order, absent when there are none (booking socials, 25 Oct 2026). */
  socials: z.array(PublicSocialLink).optional(),
  items: z.array(PublicProfileItem),
  /** The look its owner picked (spec 0054, AC-5404): the six names, and no colour value of any kind. */
  theme: PageTheme,
  /**
   * Whether search engines may show the page (spec 0055, AC-5506). The shell reads it with everything else, so a
   * robots line costs no second call. Absent reads as shown, which is what every page said before the switch.
   */
  indexable: z.boolean().optional(),
  /**
   * The picture a pasted link shows instead of the card we draw (spec 0055, AC-5511): a path on our own origin,
   * absent when its owner has set none and the card is drawn. The card function reads this with the profile.
   */
  shareImage: z.string().optional(),
  /**
   * The page's own stylesheet and photos (spec 0060, AC-14): the versions `lookStylesheetPath` and `lookImagePath`
   * take. Absent when the page draws the product's accent and no photo.
   */
  look: PublicLook.optional(),
  /** The cursor of the next page, while there is one. */
  next: z.string().optional(),
});
/** A person's public profile. */
export type PublicProfile = z.infer<typeof PublicProfile>;

/**
 * Why `/<handle>` has nothing to show (25 Oct 2026). A closed pair, never a reason in words:
 * * `free`: nobody holds the address, and nothing keeps anyone from taking it, so the page offers it.
 * * `absent`: anything else, as one answer. A handle somebody holds, a word kept for Timefix
 *   (`RESERVED_HANDLES`) and a word that could never be a handle all read `absent`. That adds no signal beyond
 *   what a profile read already gives: `RESERVED_HANDLES` ships in the browser, so anyone can subtract it, and a
 *   handle somebody holds answers with their profile either way. What the one word does buy is that the offer
 *   itself is never made for an address that is not free to take.
 */
export const HANDLE_OFFERS = ['free', 'absent'] as const;
/** Why `/<handle>` has nothing to show. */
export type HandleOffer = (typeof HANDLE_OFFERS)[number];

/**
 * `GET /api/public/profiles/:handle/offer`: whether the address is free to claim, asked only once a profile read
 * found nothing. The answer is the one word and nothing else: the asker already knows which address it asked
 * about, so the handle is never echoed back.
 */
export const PublicHandleOffer = z.object({ status: z.enum(HANDLE_OFFERS) });
/** Whether `/<handle>` is free to claim. */
export type PublicHandleOffer = z.infer<typeof PublicHandleOffer>;

/** A profile read's query: the cursor after which to read, and words the titles hold. */
export const PublicProfileQuery = z.object({
  after: z
    .string()
    .regex(/^\d{1,3}\.[0-9a-f-]{36}$/, { error: 'That page of blocks isn’t right.' })
    .optional(),
  q: z.string().trim().max(120, { error: 'Keep the search to 120 characters.' }).optional(),
});
/** A profile read's query. */
export type PublicProfileQuery = z.infer<typeof PublicProfileQuery>;

/** The longest range one slots read covers: 62 days, two months of the month view. */
export const PUBLIC_SLOTS_MAX_DAYS = 62;

/**
 * The longest span a slots read may name, in milliseconds: 62 days plus two hours (B-01). The page reads from one
 * local midnight to another, and 62 calendar days holding a clock going back are an hour longer than 62 × 24 hours
 * (two at most, Lord Howe's half hour inside it), so a range across the end of summer time is still one read.
 */
export const PUBLIC_SLOTS_MAX_SPAN_MS = PUBLIC_SLOTS_MAX_DAYS * 86_400_000 + 2 * 3_600_000;

/** Whether a slots read's range is forwards and no longer than `PUBLIC_SLOTS_MAX_SPAN_MS`. */
function slotsSpanOk({ from, to }: { readonly from: string; readonly to: string }): boolean {
  const span = Date.parse(to) - Date.parse(from);
  return span > 0 && span <= PUBLIC_SLOTS_MAX_SPAN_MS;
}

/** `GET /api/public/booking/:publicKey/slots?from&to&duration&tz`. */
export const PublicSlotsQuery = z
  .object({
    from: Timestamp,
    to: Timestamp,
    /**
     * The meeting's length. Left out, the page's first (its default): what the page itself opens on, so the page can
     * ask for its first times beside its facts rather than after them (4 Nov 2026).
     */
    duration: z.coerce.number().pipe(BookingDuration).optional(),
    tz: TimeZoneName,
    /** A form's signed hand off (spec 0043, AC-1609): the slots of the hosts its routing chose. */
    p: z.string().max(2_000).optional(),
    /**
     * A one off link's token hashed (spec 0062, AC-6204; B-10), as the page read sends it: an invitation only page
     * offers its times only beside an open link. The token itself never leaves the address's fragment.
     */
    o: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .optional()
      .catch(undefined),
  })
  .refine(slotsSpanOk, { error: `Ask for a range of at most ${String(PUBLIC_SLOTS_MAX_DAYS)} days.` });
/** A slots read. */
export type PublicSlotsQuery = z.infer<typeof PublicSlotsQuery>;

/** One bookable slot, in UTC. */
export const PublicSlot = z.object({ start: Timestamp, end: Timestamp });
/** One bookable slot. */
export type PublicSlot = z.infer<typeof PublicSlot>;

/**
 * The visitor's own calendar laid over the slots (spec 0028, AC-723 to
 * AC-726), present only for a recognised visitor with a calendar. Slot starts
 * only: the visitor's busy times never leave the server. `unreachable` when
 * their calendar couldn't be read: no clash is known then, and every time shows.
 */
export const SlotsOverlay = z.object({
  calendar: z.enum(['ok', 'unreachable']),
  clashes: z.array(Timestamp),
  best: z.array(Timestamp),
});
/** The visitor's overlay on a slots answer. */
export type SlotsOverlay = z.infer<typeof SlotsOverlay>;

/**
 * The slots in the range, chronological. `calendar` is `unreachable` when the
 * host's calendar refuses us until they reconnect: nothing is offered then, and
 * the page says why (fail closed).
 */
export const PublicSlots = z.object({
  slots: z.array(PublicSlot),
  calendar: z.enum(['ok', 'unreachable']),
  viewer: SlotsOverlay.optional(),
});
/** The slots in the range. */
export type PublicSlots = z.infer<typeof PublicSlots>;

/**
 * Who the visitor is (spec 0028, AC-720 and AC-721), by
 * `GET /api/public/booking/:publicKey/viewer`: signed in to Timefix in this
 * browser (`account`), or a guest who connected Google for this visit
 * (`google`). Absent for anyone else, and for the page's own host. `calendar`:
 * `on` when their busy times will be laid over the slots, `needs-reconnect`
 * when their connected calendar refuses us until they reconnect it.
 */
export const PublicViewer = z.object({
  name: z.string(),
  email: z.email(),
  source: z.enum(['account', 'google']),
  calendar: z.enum(['on', 'none', 'needs-reconnect']),
});
/** A recognised visitor. */
export type PublicViewer = z.infer<typeof PublicViewer>;

/**
 * The viewer read's answer: the visitor, when we know them; `isHost` on the
 * host's own page (no bar, no prefill); `canConnect` when a guest may connect
 * Google here (calendar sync is set up).
 */
export const PublicViewerAnswer = z.object({
  viewer: PublicViewer.optional(),
  isHost: z.boolean(),
  canConnect: z.boolean(),
});
/** The viewer read's answer. */
export type PublicViewerAnswer = z.infer<typeof PublicViewerAnswer>;

/** The longest a visitor's name may be. */
export const VISITOR_NAME_MAX = 200;

/**
 * Whether a code unit is never part of a name or a number: a C0 or C1 control or DEL (a CR or LF would reach a mail
 * header), or an invisible character that can disguise what a name says in "<name> invited you" (a zero width space,
 * a byte order mark, and the bidirectional overrides and isolates that reverse text).
 */
const isHidden = (code: number): boolean =>
  code < 0x20 ||
  (code >= 0x7f && code <= 0x9f) ||
  // A zero width space; the joiners (emoji, Persian and Indic names) and the marks right to left text needs pass.
  code === 0x200b ||
  (code >= 0x202a && code <= 0x202e) ||
  (code >= 0x2066 && code <= 0x2069) ||
  code === 0xfeff;

/** Whether `text` holds a control or invisible character (`isHidden`). */
function hasControl(text: string): boolean {
  for (let at = 0; at < text.length; at += 1) if (isHidden(text.charCodeAt(at))) return true;
  return false;
}

/**
 * A web address in a name (B-06): a scheme, `www.`, a host followed by a path, or a host on a common top level
 * domain, its dot a full stop or a full width or ideographic one (which some mail clients link too). A person's name
 * never needs one, and the guest invitation reads "<name> invited you", so one would turn a booking into a link sent
 * from our domain. Initials ("J.R.R. Tolkien") and a name with a dot before a word no domain uses ("St.John") pass.
 * A denylist can't name every domain: the mail templates draw the name as plain text, which is the real guard.
 */
const WEB_ADDRESS =
  /(?:[a-z][a-z0-9+.-]*:\/\/|\bwww[.。．]|[\p{L}\p{N}-]+[.。．][a-z]{2,}\/|[\p{L}\p{N}-]+[.。．](?:com|net|org|io|co|info|biz|xyz|ru|cn|app|dev|link|site|online|top|me|ly|gl|to|shop|click|live|tk|ml|ga|cf|gq|de|uk|eu|us|ai|cc|ws|su|page|club|vip|icu|buzz|work|fun|store|tech|space|website|win|bid|loan|pw|zip|mov)\b)/iu;

/**
 * Why a visitor's name can't be taken, or undefined when it can: no control characters (B-07), no web address
 * (B-06). The book input and the chat's heard name share it, so neither door takes what the other refuses.
 */
export function visitorNameProblem(name: string): string | undefined {
  if (hasControl(name)) return 'Give your name as plain text.';
  if (WEB_ADDRESS.test(name)) return 'Give your name without a web address.';
  return undefined;
}

/** A visitor's name: trimmed, 1 to 200 characters, plain text with no web address. */
export const VisitorName = z
  .string()
  .trim()
  .min(1, 'Give your name.')
  .max(VISITOR_NAME_MAX, 'Keep your name to 200 characters.')
  .superRefine((name, context) => {
    const problem = visitorNameProblem(name);
    if (problem !== undefined) context.addIssue({ code: 'custom', message: problem });
  });

/**
 * An email address a visitor types (B-12): trimmed and lower cased before the check, so a phone keyboard's trailing
 * space is taken from any caller, not only the page's own form.
 */
export function visitorEmail(message: string) {
  return z
    .string({ error: message })
    .trim()
    .toLowerCase()
    .pipe(z.email({ error: message }).max(254, { error: message }));
}

/**
 * Whether a number to call is one (B-08): the forms' international check (`+`, a known country code, 7 to 15
 * digits), or a national number of 7 to 15 digits with only spaces, brackets, dots and dashes between them. Never
 * words, markup or control characters.
 */
export function isNumberToCall(text: string): boolean {
  if (hasControl(text)) return false;
  if (internationalPhone(text) !== undefined) return true;
  return /^\d{7,15}$/.test(compactPhone(text));
}

/**
 * `POST /api/public/booking/:publicKey/book`. `idempotencyKey` is minted once
 * per chosen slot, so a retry, a double click or a second tab answers the
 * first booking. `company_url` is the honeypot (spec 0023's name) (a field people never see, which
 * must stay empty), `ticket` the fill ticket the page fetched when it loaded
 * (spec 0023's, from `/api/public/booking/:address/ticket`: the server's clock
 * decides the minimum fill time), and `startedAt` when the page loaded
 * (advisory, used only without a ticket).
 */
/** A one off link's token (spec 0062, AC-6204): 32 random bytes, base64url, 43 characters. */
export const OneOffToken = z.string().regex(/^[A-Za-z0-9_-]{43}$/, { error: 'That link isn’t right.' });
/** A one off link's token. */
export type OneOffToken = z.infer<typeof OneOffToken>;

export const PublicBookInput = z.object({
  idempotencyKey: Uuid,
  start: Timestamp,
  duration: BookingDuration,
  name: VisitorName,
  email: visitorEmail('Give an email address such as name@example.com.'),
  timeZone: TimeZoneName,
  /** The visitor's number, for a phone location: one `isNumberToCall` takes (B-08). */
  phone: z
    .string()
    .trim()
    .max(40, { error: 'Keep the phone number to 40 characters.' })
    .refine(isNumberToCall, { error: 'Give a phone number, such as +44 20 7946 0958.' })
    .optional(),
  /** More people to invite, at most 10. */
  guests: z
    .array(visitorEmail('Give each guest’s email address.'))
    .max(10, { error: 'Invite at most 10 guests.' })
    .optional(),
  /** Anything else the host should know. */
  note: z.string().trim().max(2000, { error: 'Keep the note to 2,000 characters.' }).optional(),
  company_url: z.string().max(200).optional(),
  ticket: z.string().max(200).optional(),
  startedAt: z.number().int().nonnegative().optional(),
  /** The signed hand off a form sent the visitor with (AC-1058): links the booking to that submission. */
  prefill: z.string().max(4096).optional(),
  /**
   * The answers to the page's own questions, by question key (spec 0057, AC-5710): checked on the server against the
   * page's questions as they are at booking time, anything else dropped.
   */
  answers: z.record(z.string().max(40), z.unknown()).optional(),
  /**
   * The link page the visitor booked from (spec 0061, AC-6119): only its handle, which the server checks names a page
   * holding this booking page as a live block, and counts one booking that day. Nothing of it is stored on the
   * booking; a `via` that doesn't check out is ignored, never refused. `.catch` so a bad one never fails a booking.
   */
  via: z
    .object({ handle: z.string().max(40) })
    .optional()
    .catch(undefined),
  /**
   * A one off link's token (spec 0062, AC-6204): the 43 characters after `#o=` in the address the host shared. It
   * travels in the body, never the address, so no server log keeps it; the server compares its SHA-256 only.
   */
  oneOffToken: OneOffToken.optional(),
});
/** A visitor's booking. */
export type PublicBookInput = z.infer<typeof PublicBookInput>;

/** A confirmed booking, as its visitor sees it. */
export const PublicBooking = z.object({
  start: Timestamp,
  end: Timestamp,
  title: z.string(),
  hostName: z.string(),
  location: PublicLocation,
  timeZone: z.string(),
});
/** A confirmed booking. */
export type PublicBooking = z.infer<typeof PublicBooking>;

/**
 * `GET /api/public/booking/:publicKey/prefill?p=<token>` (AC-1058, spec 0025
 * AC-642): the name and email a form handed over, read back only from a token
 * the server signed for this page and not yet expired; empty for anything else.
 */
export const PublicPrefill = z.object({
  name: z.string().optional(),
  email: z.string().optional(),
  /**
   * The form's answers to questions this page asks by the same key (spec 0057, AC-5713), as text, so each starts
   * filled in. One the form filed onto the same attribute is never asked again, so it is not here either.
   */
  answers: z.record(z.string(), z.string()).optional(),
  /** The keys of this page's questions the form already answered onto the same attribute: they are not asked. */
  skip: z.array(z.string()).optional(),
});
/** The name and email a form handed over. */
export type PublicPrefill = z.infer<typeof PublicPrefill>;

/** The book answer: the booking, and the guest page's token (only this answer ever carries it). */
export const PublicBooked = z.object({
  booking: PublicBooking,
  manageToken: z.string(),
  /**
   * A booking that waits for the host's Confirm (spec 0062, AC-6203): the page says "Requested" rather than booked.
   * Absent for a booking that is confirmed at once, which is every page that doesn't ask.
   */
  pending: z.literal(true).optional(),
  /**
   * Where a redirect page sends the visitor now that the booking has committed (AC-6201): the host's saved address,
   * with the booking's name, email, start, tz and page added only when the host switched that on. Never anything
   * the visitor sent.
   */
  redirectUrl: z.string().optional(),
});
/** The book answer. */
export type PublicBooked = z.infer<typeof PublicBooked>;

/** The most characters one chat message carries (spec 0042, AC-1503). */
export const CHAT_MESSAGE_MAX = 500;
/** The most lines one chat turn sends (AC-1520): older lines drop off the front. */
export const CHAT_MESSAGES_MAX = 40;

/** One line of a booking chat: who said it and what. */
export const PublicChatLine = z.object({
  role: z.enum(['visitor', 'assistant']),
  text: z
    .string()
    .trim()
    .min(1, 'Type a message.')
    .max(CHAT_MESSAGE_MAX, { error: `Keep a message to ${String(CHAT_MESSAGE_MAX)} characters.` }),
});
/** One line of a booking chat. */
export type PublicChatLine = z.infer<typeof PublicChatLine>;

/**
 * `POST /api/public/booking/:publicKey/chat` (spec 0042): one turn of the
 * booking chat. `conversationId` is minted by the page once per chat and only
 * scopes a booking's idempotency key; `duration`, `timeZone` and `hour12` are
 * the rail's. The server replays the visitor's lines only (AC-1517) and keeps
 * only those on a booking (AC-1521): an assistant line is ignored, since
 * nothing vouches for what a client says the assistant said.
 */
export const PublicChatInput = z
  .object({
    conversationId: Uuid,
    duration: BookingDuration,
    timeZone: TimeZoneName,
    hour12: z.boolean(),
    messages: z.array(PublicChatLine).min(1).max(CHAT_MESSAGES_MAX, { error: 'This chat is too long. Start again.' }),
    /**
     * What the chat collected beside the conversation (4 Nov 2026, chat parity): guests, a note and the page's own
     * questions' answers, sent with each turn and booked with the yes, checked as the details step's are.
     */
    guests: z
      .array(visitorEmail('Give each guest’s email address.'))
      .max(10, { error: 'Invite at most 10 guests.' })
      .optional(),
    note: z.string().trim().max(2000, { error: 'Keep the note to 2,000 characters.' }).optional(),
    answers: z.record(z.string().max(40), z.unknown()).optional(),
    /** A form's signed hand off (spec 0043): a team page then offers only the hosts its routing chose. */
    p: z.string().max(4096).optional(),
    /** The fill ticket the page fetched (spec 0023), and when the page loaded: the bot checks a booking passes. */
    ticket: z.string().max(200).optional(),
    startedAt: z.number().int().nonnegative().optional(),
  })
  .refine(({ messages }) => messages.at(-1)?.role === 'visitor', { error: 'The last line must be the visitor’s.' });
/** One turn of the booking chat. */
export type PublicChatInput = z.infer<typeof PublicChatInput>;

/**
 * A chat turn's answer: the sentence, the times it offers (ISO, chronological),
 * what the visitor could say next, the meeting length the chat settled on, and,
 * when this turn booked, the booking and its guest page token.
 */
export const PublicChatReply = z.object({
  text: z.string(),
  offers: z.array(Timestamp),
  suggestions: z.array(z.string()),
  /** The suggestion that books what was just read back ("Yes, book it"): drawn as the answer's own confirm button. */
  confirm: z.string().optional(),
  /** With `confirm`: what it would book, so the page can draw the read back as a card (when, who). */
  readBack: z.object({ start: Timestamp, name: z.string(), email: z.string() }).optional(),
  /**
   * Which details a held time still waits on (4 Nov 2026): both, the name, the email or a number to call. The page's
   * prompt box asks for exactly that. Absent when nothing is held, or once the details are read back.
   */
  asks: z.enum(['details', 'name', 'email', 'phone']).optional(),
  /** The visitor's name as the chat heard it (4 Nov 2026): the page draws their initials beside their lines. */
  name: z.string().max(200).optional(),
  duration: BookingDuration,
  booked: PublicBooked.optional(),
});
/** A chat turn's answer. */
export type PublicChatReply = z.infer<typeof PublicChatReply>;

/** A manage token: 32 URL safe characters. */
export const ManageToken = z.string().regex(/^[A-Za-z0-9_-]{32}$/, { error: 'That link isn’t right.' });
/** A manage token. */
export type ManageToken = z.infer<typeof ManageToken>;

/** `GET /api/public/booking/manage/:token`: the booking as its guest sees it (AC-674). */
export const PublicManagedBooking = z.object({
  /**
   * `requested` is a booking waiting for the host's Confirm, and `declined` one the host (or the wait) turned down
   * (spec 0062, AC-6203); the rest is what every booking was before.
   */
  state: z.enum(['confirmed', 'requested', 'declined', 'cancelled', 'past']),
  publicKey: z.string(),
  title: z.string(),
  hostName: z.string(),
  start: Timestamp,
  end: Timestamp,
  /** The zone the visitor booked in. */
  timeZone: z.string(),
  location: PublicLocation,
  /** The calendar event's video link, once the event exists, and only while the booking is confirmed (B-15). */
  videoUrl: z.string().optional(),
  /**
   * A link to a meeting over, cancelled or declined more than 30 days ago (B-13): only its state, time, title and
   * page are answered, and `visitorName`, `visitorEmail` and `guests` come back empty.
   */
  aged: z.literal(true).optional(),
  visitorName: z.string(),
  visitorEmail: z.string(),
  guests: z.array(z.string()),
  note: z.string().optional(),
  /** Why it was cancelled, when someone said. */
  cancelReason: z.string().optional(),
  /** The workspace's web address, which the page's Timefix link carries as its referrer (`ref`). */
  workspaceSlug: z.string(),
  /** Whether the guest may still cancel it or add guests: confirmed, and not yet started. */
  canChange: z.boolean(),
  /** Whether it may still move: it can change, its page takes bookings, and it has moved fewer than 5 times. */
  canMove: z.boolean(),
  /**
   * Inside the page's cancel or move cutoff (spec 0062, AC-6202): that change is the host's now, and the page says
   * so in one line. Absent when it isn't.
   */
  cancelTooLate: z.literal(true).optional(),
  moveTooLate: z.literal(true).optional(),
});
/** The booking as its guest sees it. */
export type PublicManagedBooking = z.infer<typeof PublicManagedBooking>;

/** `GET /api/public/booking/manage/:token/slots?from&to&tz`: where the booking could move, its own length. */
export const PublicMoveSlotsQuery = z
  .object({ from: Timestamp, to: Timestamp, tz: TimeZoneName })
  .refine(slotsSpanOk, { error: `Ask for a range of at most ${String(PUBLIC_SLOTS_MAX_DAYS)} days.` });
/** A move's slots read. */
export type PublicMoveSlotsQuery = z.infer<typeof PublicMoveSlotsQuery>;

/** `POST /api/public/booking/manage/:token/move`: the new start, one the slots read offered. */
export const PublicMoveInput = z.object({ start: Timestamp });
/** A guest's move. */
export type PublicMoveInput = z.infer<typeof PublicMoveInput>;

/** The longest reason a cancel carries. */
export const CANCEL_REASON_MAX = 500;

/** `POST /api/public/booking/manage/:token/cancel`: an optional reason, shared with the host. */
export const PublicCancelInput = z.object({
  reason: z
    .string()
    .trim()
    .max(CANCEL_REASON_MAX, { error: `Keep the reason to ${String(CANCEL_REASON_MAX)} characters.` })
    .optional(),
});
/** A guest's cancel. */
export type PublicCancelInput = z.infer<typeof PublicCancelInput>;

/** `POST /api/public/booking/manage/:token/guests`: more people to invite, at most 10 guests in all. */
export const PublicGuestsInput = z.object({
  emails: z
    .array(visitorEmail('Give each guest’s email address.'))
    .min(1, { error: 'Add at least one email address.' })
    .max(10, { error: 'Invite at most 10 guests.' }),
});
/** A guest's new guests. */
export type PublicGuestsInput = z.infer<typeof PublicGuestsInput>;

/** `POST /api/public/booking/manage/:token/guests/remove`: one guest to take off. */
export const PublicRemoveGuestInput = z.object({
  email: visitorEmail('That isn’t an email address.'),
});
/** A guest's removal. */
export type PublicRemoveGuestInput = z.infer<typeof PublicRemoveGuestInput>;

/** The guests answer: how many were new, and everyone now invited. */
export const PublicGuestsAnswer = z.object({ added: z.number().int().min(0), guests: z.array(z.string()) });
/** The guests answer. */
export type PublicGuestsAnswer = z.infer<typeof PublicGuestsAnswer>;

/** A move or cancel's answer: the booking as it is now. */
export const PublicChanged = z.object({ booking: PublicManagedBooking });
/** A move or cancel's answer. */
export type PublicChanged = z.infer<typeof PublicChanged>;
