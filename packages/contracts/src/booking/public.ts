// What a visitor's browser reads and sends on a public booking page (spec
// 0025): plain Zod, no oRPC, so the public bundle and the API's public REST
// routes share one definition. Nothing here carries a member's email, other
// bookings, busy event titles, or an internal id but the page's public key
// (AC-644).
import * as z from 'zod';
import { Timestamp } from '../values/attribute-values.ts';
import { BookingDuration, TimeZoneName } from './settings.ts';

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
  /** The workspace's name, for the page's foot. */
  workspaceName: z.string(),
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
  idempotencyKey: z.uuid(),
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
});
/** The booking as its guest sees it. */
export type PublicManagedBooking = z.infer<typeof PublicManagedBooking>;
