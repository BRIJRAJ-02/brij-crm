// What a visitor's browser reads and sends on a public booking page (spec
// 0025): plain Zod, no oRPC, so the public bundle and the API's public REST
// routes share one definition. Nothing here carries a member's email, other
// bookings, busy event titles, or an internal id but the page's public key
// (AC-644).
import * as z from 'zod';
import { Timestamp } from '../values/attribute-values.ts';
import { BookingDefaultView, BookingDuration, TimeZoneName } from './settings.ts';
import { Uuid } from '../values/ids.ts';
import { PageTheme } from './page-theme.ts';
import { PublicProfileItem } from './link-page.ts';
import { SOCIAL_LINK_NETWORKS } from '../values/social-networks.ts';

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
  /** Their social links, in their order, absent when there are none (booking socials, 25 Oct 2026). */
  socials: z.array(PublicSocialLink).optional(),
  items: z.array(PublicProfileItem),
  /** The look its owner picked (spec 0054, AC-5404): the six names, and no colour value of any kind. */
  theme: PageTheme,
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

/** `GET /api/public/booking/:publicKey/slots?from&to&duration&tz`. */
export const PublicSlotsQuery = z
  .object({
    from: Timestamp,
    to: Timestamp,
    duration: z.coerce.number().pipe(BookingDuration),
    tz: TimeZoneName,
    /** A form's signed hand off (spec 0043, AC-1609): the slots of the hosts its routing chose. */
    p: z.string().max(2_000).optional(),
  })
  .refine(
    ({ from, to }) => {
      const span = Date.parse(to) - Date.parse(from);
      return span > 0 && span <= PUBLIC_SLOTS_MAX_DAYS * 86_400_000;
    },
    { error: `Ask for a range of at most ${String(PUBLIC_SLOTS_MAX_DAYS)} days.` },
  );
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
 * `POST /api/public/booking/:publicKey/book`. `idempotencyKey` is minted once
 * per chosen slot, so a retry, a double click or a second tab answers the
 * first booking. `company_url` is the honeypot (spec 0023's name) (a field people never see, which
 * must stay empty), `ticket` the fill ticket the page fetched when it loaded
 * (spec 0023's, from `/api/public/booking/:address/ticket`: the server's clock
 * decides the minimum fill time), and `startedAt` when the page loaded
 * (advisory, used only without a ticket).
 */
export const PublicBookInput = z.object({
  idempotencyKey: Uuid,
  start: Timestamp,
  duration: BookingDuration,
  name: z.string().trim().min(1, 'Give your name.').max(VISITOR_NAME_MAX, 'Keep your name to 200 characters.'),
  email: z.email({ error: 'Give an email address such as name@example.com.' }).trim().toLowerCase().max(254),
  timeZone: TimeZoneName,
  /** The visitor's number, for a phone location. */
  phone: z.string().trim().max(40, { error: 'Keep the phone number to 40 characters.' }).optional(),
  /** More people to invite, at most 10. */
  guests: z
    .array(z.email({ error: 'Give each guest’s email address.' }).trim().toLowerCase().max(254))
    .max(10, { error: 'Invite at most 10 guests.' })
    .optional(),
  /** Anything else the host should know. */
  note: z.string().trim().max(2000, { error: 'Keep the note to 2,000 characters.' }).optional(),
  company_url: z.string().max(200).optional(),
  ticket: z.string().max(200).optional(),
  startedAt: z.number().int().nonnegative().optional(),
  /** The signed hand off a form sent the visitor with (AC-1058): links the booking to that submission. */
  prefill: z.string().max(4096).optional(),
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
export const PublicPrefill = z.object({ name: z.string().optional(), email: z.string().optional() });
/** The name and email a form handed over. */
export type PublicPrefill = z.infer<typeof PublicPrefill>;

/** The book answer: the booking, and the guest page's token (only this answer ever carries it). */
export const PublicBooked = z.object({ booking: PublicBooking, manageToken: z.string() });
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
  state: z.enum(['confirmed', 'cancelled', 'past']),
  publicKey: z.string(),
  title: z.string(),
  hostName: z.string(),
  start: Timestamp,
  end: Timestamp,
  /** The zone the visitor booked in. */
  timeZone: z.string(),
  location: PublicLocation,
  /** The calendar event's video link, once the event exists. */
  videoUrl: z.string().optional(),
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
});
/** The booking as its guest sees it. */
export type PublicManagedBooking = z.infer<typeof PublicManagedBooking>;

/** `GET /api/public/booking/manage/:token/slots?from&to&tz`: where the booking could move, its own length. */
export const PublicMoveSlotsQuery = z.object({ from: Timestamp, to: Timestamp, tz: TimeZoneName }).refine(
  ({ from, to }) => {
    const span = Date.parse(to) - Date.parse(from);
    return span > 0 && span <= PUBLIC_SLOTS_MAX_DAYS * 86_400_000;
  },
  { error: `Ask for a range of at most ${String(PUBLIC_SLOTS_MAX_DAYS)} days.` },
);
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
    .array(z.email({ error: 'Give each guest’s email address.' }).trim().toLowerCase().max(254))
    .min(1, { error: 'Add at least one email address.' })
    .max(10, { error: 'Invite at most 10 guests.' }),
});
/** A guest's new guests. */
export type PublicGuestsInput = z.infer<typeof PublicGuestsInput>;

/** `POST /api/public/booking/manage/:token/guests/remove`: one guest to take off. */
export const PublicRemoveGuestInput = z.object({
  email: z.email({ error: 'That isn’t an email address.' }).trim().toLowerCase().max(254),
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
