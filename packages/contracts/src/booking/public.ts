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
  durations: z.array(BookingDuration),
  location: PublicLocation,
  /** The host's zone, for "times shown in …" when the visitor changes theirs. */
  hostTimeZone: z.string(),
  /** How many days ahead a slot may start. */
  windowDays: z.number().int(),
});
/** The page's facts. */
export type PublicBookingPage = z.infer<typeof PublicBookingPage>;

/** The longest range one slots read covers: 14 days. */
export const PUBLIC_SLOTS_MAX_DAYS = 14;

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

/** The slots in the range, chronological. */
export const PublicSlots = z.object({ slots: z.array(PublicSlot) });
/** The slots in the range. */
export type PublicSlots = z.infer<typeof PublicSlots>;

/** The longest a visitor's name may be. */
export const VISITOR_NAME_MAX = 200;

/**
 * `POST /api/public/booking/:publicKey/book`. `idempotencyKey` is minted once
 * per chosen slot, so a retry, a double click or a second tab answers the
 * first booking. `company_url` is the honeypot (spec 0023's name) (a field people never see, which
 * must stay empty) and `startedAt` when the page loaded (advisory, for the
 * minimum fill time).
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
  company_url: z.string().max(200).optional(),
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
