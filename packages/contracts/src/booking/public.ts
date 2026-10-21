// What a visitor's browser reads and sends on a public booking page (spec
// 0025): plain Zod, no oRPC, so the public bundle and the API's public REST
// routes share one definition. Nothing here carries a member's email, other
// bookings, busy event titles, or an internal id but the page's public key
// (AC-644).
import * as z from 'zod';
import { Timestamp } from '../values/attribute-values.ts';
import { BookingDuration, TimeZoneName } from './settings.ts';
import { Uuid } from '../values/ids.ts';

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

/** `GET /api/public/booking/:publicKey`: the page's facts. */
export const PublicBookingPage = z.object({
  publicKey: PublicKey,
  title: z.string(),
  description: z.string(),
  /** The host's name as the workspace shows it (never their email). */
  hostName: z.string(),
  durations: z.array(BookingDuration),
  location: PublicLocation,
  /** The host's zone, for "times shown in …" when the visitor changes theirs. */
  hostTimeZone: z.string(),
  /** How many days ahead a slot may start. */
  windowDays: z.number().int(),
});
/** The page's facts. */
export type PublicBookingPage = z.infer<typeof PublicBookingPage>;

/** The longest range one slots read covers: 62 days, two months of the month view. */
export const PUBLIC_SLOTS_MAX_DAYS = 62;

/** `GET /api/public/booking/:publicKey/slots?from&to&duration&tz`. */
export const PublicSlotsQuery = z
  .object({
    from: Timestamp,
    to: Timestamp,
    duration: z.coerce.number().pipe(BookingDuration),
    tz: TimeZoneName,
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
  phone: z.string().trim().max(40).optional(),
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

/** The book answer: the booking, and the guest page's token (only this answer ever carries it). */
export const PublicBooked = z.object({ booking: PublicBooking, manageToken: z.string() });
/** The book answer. */
export type PublicBooked = z.infer<typeof PublicBooked>;

/** The most characters one chat message carries (spec 0041, AC-1503). */
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
 * `POST /api/public/booking/:publicKey/chat` (spec 0041): one turn of the
 * booking chat. `conversationId` is minted by the page once per chat and only
 * scopes a booking's idempotency key; `duration`, `timeZone` and `hour12` are
 * the rail's. The server replays the visitor's lines only (AC-1517); the
 * assistant's travel so a booking can keep the whole conversation (AC-1521).
 */
export const PublicChatInput = z
  .object({
    conversationId: Uuid,
    duration: BookingDuration,
    timeZone: TimeZoneName,
    hour12: z.boolean(),
    messages: z.array(PublicChatLine).min(1).max(CHAT_MESSAGES_MAX, { error: 'This chat is too long. Start again.' }),
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
