// A booking page's settings (spec 0025, AC-623, AC-624), as plain Zod with no
// oRPC: the member builder, the API and the public page share them, and the
// browser parses the builder's input with the same schemas the server checks.
import * as z from 'zod';
import { DateValue } from '../values/attribute-values.ts';
import { Uuid } from '../values/ids.ts';

/** The meeting lengths a page may offer, in minutes. */
export const BOOKING_DURATIONS = [15, 30, 45, 60, 90] as const;
/** The slot steps a page may set, in minutes (none: the duration). */
export const BOOKING_SLOT_STEPS = [15, 30, 60] as const;
/** The weekdays as the availability keys them, Monday first. */
export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
/** At most this many ranges on one day. */
export const BOOKING_RANGES_MAX = 6;
/** At most this many date overrides on a page. */
export const BOOKING_OVERRIDES_MAX = 120;
/** The longest minimum notice: 14 days. */
export const BOOKING_NOTICE_MAX = 14 * 24 * 60;

/** One meeting length. */
export const BookingDuration = z.union(
  BOOKING_DURATIONS.map((minutes) => z.literal(minutes)),
  {
    error: 'Pick 15, 30, 45, 60 or 90 minutes.',
  },
);
/** One meeting length. */
export type BookingDuration = z.infer<typeof BookingDuration>;

/** A weekday key. */
export const Weekday = z.enum(WEEKDAYS);
/** A weekday key. */
export type Weekday = z.infer<typeof Weekday>;

/** A local time of day, `HH:MM` from 00:00 to 24:00 (the end of the day). */
export const ClockTime = z
  .string()
  .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$|^24:00$/, { error: 'Give a time such as 09:00.' });
/** A local time of day. */
export type ClockTime = z.infer<typeof ClockTime>;

/** Minutes from midnight of a `ClockTime`. */
export function minutesOf(time: string): number {
  const [hours = '0', minutes = '0'] = time.split(':');
  return Number(hours) * 60 + Number(minutes);
}

/** One range of a day, its end after its start. */
export const TimeRange = z
  .tuple([ClockTime, ClockTime])
  .refine(([start, end]) => minutesOf(end) > minutesOf(start), { error: 'End each range after it starts.' });
/** One range of a day. */
export type TimeRange = z.infer<typeof TimeRange>;

/** A day's ranges, at most six, none overlapping. */
export const DayRanges = z
  .array(TimeRange)
  .max(BOOKING_RANGES_MAX, { error: `A day holds at most ${String(BOOKING_RANGES_MAX)} ranges.` })
  .refine(
    (ranges) => {
      const sorted = [...ranges].sort((a, b) => minutesOf(a[0]) - minutesOf(b[0]));
      return sorted.every(
        (range, index) => index === 0 || minutesOf(range[0]) >= minutesOf(sorted[index - 1]?.[1] ?? '00:00'),
      );
    },
    { error: 'Ranges on one day can’t overlap.' },
  );
/** A day's ranges. */
export type DayRanges = z.infer<typeof DayRanges>;

/** True when `zone` is an IANA time zone this runtime knows. */
export function isTimeZone(zone: string): boolean {
  if (zone === '' || zone.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** An IANA time zone name. */
export const TimeZoneName = z.string().refine(isTimeZone, { error: 'Pick a time zone from the list.' });
/** An IANA time zone name. */
export type TimeZoneName = z.infer<typeof TimeZoneName>;

/** One date's own hours: its ranges replace the week's; none is a day off. */
export const DateOverride = z.object({
  date: DateValue,
  ranges: DayRanges,
  /** Why (a day off's reason), for the member only. */
  note: z.string().trim().max(120, 'Keep the reason to 120 characters.').optional(),
});
/** One date's own hours. */
export type DateOverride = z.infer<typeof DateOverride>;

/** When a page can be booked: weekly hours in a zone, and date overrides (AC-624). */
export const BookingAvailability = z.object({
  timeZone: TimeZoneName,
  weekly: z.object({
    mon: DayRanges,
    tue: DayRanges,
    wed: DayRanges,
    thu: DayRanges,
    fri: DayRanges,
    sat: DayRanges,
    sun: DayRanges,
  }),
  overrides: z
    .array(DateOverride)
    .max(BOOKING_OVERRIDES_MAX, { error: `A page holds at most ${String(BOOKING_OVERRIDES_MAX)} date overrides.` })
    .refine((overrides) => new Set(overrides.map((override) => override.date)).size === overrides.length, {
      error: 'Give each date once.',
    }),
});
/** When a page can be booked. */
export type BookingAvailability = z.infer<typeof BookingAvailability>;

/** Weekdays 09:00 to 17:00 in the zone: the virtual default schedule's hours (spec 0035, AC-963). */
export function defaultAvailability(timeZone: string): BookingAvailability {
  const workday: TimeRange[] = [['09:00', '17:00']];
  return {
    timeZone,
    weekly: { mon: workday, tue: workday, wed: workday, thu: workday, fri: workday, sat: [], sun: [] },
    overrides: [],
  };
}

/** Where the meeting happens: the calendar's video link, a call to the visitor's number, an address, or custom text. */
export const BookingLocation = z.discriminatedUnion('type', [
  z.object({ type: z.literal('video') }),
  z.object({ type: z.literal('phone') }),
  z.object({ type: z.literal('address'), value: z.string().trim().min(1, 'Give the address.').max(500) }),
  z.object({ type: z.literal('custom'), value: z.string().trim().min(1, 'Say where it happens.').max(500) }),
]);
/** Where the meeting happens. */
export type BookingLocation = z.infer<typeof BookingLocation>;

/** A page's web address part: lowercase letters, digits and single hyphens, at most 60. */
export const BookingSlug = z
  .string()
  .trim()
  .min(1, 'Give the page a web address.')
  .max(60, 'Keep the web address to 60 characters.')
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, { error: 'Use lowercase letters, numbers and single hyphens.' });
/** A page's web address part. */
export type BookingSlug = z.infer<typeof BookingSlug>;

/** A slug from a title: lowercase, hyphens for anything else, at most 60. */
export function slugFromTitle(title: string): string {
  const slug = title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  return slug === '' ? 'meeting' : slug;
}

/** Live takes bookings; paused shows the page as not taking bookings. */
export const BookingPageStatus = z.enum(['live', 'paused']);
/** Live or paused. */
export type BookingPageStatus = z.infer<typeof BookingPageStatus>;

/** Every setting a member edits (AC-623, AC-624); the hours are the schedule's (spec 0035). */
export const BookingPageSettings = z.object({
  title: z.string().trim().min(1, 'Give the page a title.').max(120, 'Keep the title to 120 characters.'),
  description: z.string().trim().max(2000, 'Keep the description to 2,000 characters.'),
  slug: BookingSlug,
  durations: z
    .array(BookingDuration)
    .min(1, 'Offer at least one meeting length.')
    .max(BOOKING_DURATIONS.length)
    .refine((durations) => new Set(durations).size === durations.length, { error: 'Offer each length once.' }),
  location: BookingLocation,
  bufferBefore: z.number().int().min(0).max(60, 'Buffers are 0 to 60 minutes.'),
  bufferAfter: z.number().int().min(0).max(60, 'Buffers are 0 to 60 minutes.'),
  minNoticeMinutes: z.number().int().min(0).max(BOOKING_NOTICE_MAX, 'Notice is at most 14 days.'),
  windowDays: z.number().int().min(1, 'Allow at least 1 day ahead.').max(365, 'Allow at most 365 days ahead.'),
  /** At most this many bookings a day; null for no limit. */
  dailyLimit: z.number().int().min(1).max(50, 'A daily limit is 1 to 50.').nullable(),
  /** How often a slot starts; null for the meeting length. */
  slotStep: z
    .union(
      BOOKING_SLOT_STEPS.map((minutes) => z.literal(minutes)),
      { error: 'Pick 15, 30 or 60 minutes.' },
    )
    .nullable(),
  status: BookingPageStatus,
  /**
   * The owner's schedule the page books by (spec 0035, AC-965); null follows whichever schedule is the owner's
   * default at each slot read. A schedule of anyone else is refused `SCHEDULE_NOT_ALLOWED` (AC-966).
   */
  scheduleId: Uuid.nullable(),
  /** A round robin page's reschedule rule (spec 0029, AC-746): keep the host when free, or ask the rotation again. */
  rescheduleHost: z.enum(['same', 'rotation']),
  /** A private page (spec 0027, AC-708): reached by its link, it books inside its host's holds and waives notice. */
  isPrivate: z.boolean(),
});
/** Every setting a member edits. */
export type BookingPageSettings = z.infer<typeof BookingPageSettings>;
