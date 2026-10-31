// A booking page's settings (spec 0025, AC-623, AC-624), as plain Zod with no
// oRPC: the member builder, the API and the public page share them, and the
// browser parses the builder's input with the same schemas the server checks.
import * as z from 'zod';
import { DateValue } from '../values/attribute-values.ts';
import { Uuid } from '../values/ids.ts';
import { FormQuestion } from '../forms/document.ts';

/** The meeting lengths offered as ready picks, in minutes; any other length in steps of 5 is a custom one. */
export const BOOKING_DURATIONS = [15, 30, 45, 60, 90] as const;
/** The shortest meeting length, in minutes. */
export const BOOKING_DURATION_MIN = 5;
/** The longest meeting length, in minutes: 8 hours. */
export const BOOKING_DURATION_MAX = 480;
/** Every meeting length is a whole multiple of this many minutes. */
export const BOOKING_DURATION_STEP = 5;
/** At most this many lengths on one page: the public page's length switch shows four, so none is ever hidden. */
export const BOOKING_DURATIONS_MAX = 4;
/** The slot steps a page may set, in minutes (none: the duration). */
export const BOOKING_SLOT_STEPS = [15, 30, 60] as const;
/** The weekdays as the availability keys them, Monday first. */
export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
/** At most this many ranges on one day. */
export const BOOKING_RANGES_MAX = 6;
/** At most this many date overrides on a page. */
export const BOOKING_OVERRIDES_MAX = 120;
/**
 * At most this many date overrides on a schedule (spec 0037, AC-1293): above a page's 120, since the Team week writes
 * one a day when someone is rostered week after week. Every schedule write drops overrides older than 8 weeks first.
 */
export const SCHEDULE_OVERRIDES_MAX = 400;
/** What a schedule past `SCHEDULE_OVERRIDES_MAX` is refused with (spec 0037, AC-1293). */
export const SCHEDULE_OVERRIDES_FULL =
  'A schedule holds at most 400 date overrides. Remove some, or set usual hours instead.';
/** The longest minimum notice: 14 days. */
export const BOOKING_NOTICE_MAX = 14 * 24 * 60;

/** One meeting length: 5 to 480 minutes, in steps of 5 (the database's `booking_pages_durations` check). */
export const BookingDuration = z
  .number({ error: 'Give the length in minutes.' })
  .int({ error: 'Give the length in whole minutes.' })
  .min(BOOKING_DURATION_MIN, { error: 'A meeting is at least 5 minutes.' })
  .max(BOOKING_DURATION_MAX, { error: 'A meeting is at most 480 minutes.' })
  .multipleOf(BOOKING_DURATION_STEP, { error: 'Use a length in steps of 5 minutes.' });
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
    // Schedules hold more than a page (AC-1293); a page's own hours are no longer written (spec 0035), so the one
    // shape takes a schedule's limit and a stored schedule with more than 120 still reads.
    .max(SCHEDULE_OVERRIDES_MAX, { error: SCHEDULE_OVERRIDES_FULL })
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
  z.object({
    type: z.literal('address'),
    value: z.string().trim().min(1, 'Give the address.').max(500, 'Keep the address to 500 characters.'),
  }),
  z.object({
    type: z.literal('custom'),
    value: z.string().trim().min(1, 'Say where it happens.').max(500, 'Keep this to 500 characters.'),
  }),
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

/**
 * The way a booking page opens for a visitor: the month calendar, the list of times, or Book by chat (spec 0042).
 * The host picks it; a visitor who has already chosen a view in their own browser keeps theirs.
 */
export const BookingDefaultView = z.enum(['month', 'list', 'chat']);
/** Month, List or Chat. */
export type BookingDefaultView = z.infer<typeof BookingDefaultView>;

/** The most questions one booking page asks beside the name and email (spec 0057, AC-5701). */
export const BOOKING_QUESTIONS_MAX = 20;

/**
 * A booking page's own questions (spec 0057, AC-5701 to AC-5703): spec 0023's `FormQuestion` exactly, so a question
 * means the same on a form and on a booking page. At most 20, each id and key once, each attribute filed on once, and
 * no file question until a booking page takes uploads. Where an answer is filed (People only) is checked on save.
 */
export const BookingQuestions = z
  .array(FormQuestion)
  .max(BOOKING_QUESTIONS_MAX, { error: `A booking page asks at most ${String(BOOKING_QUESTIONS_MAX)} questions.` })
  .superRefine((questions, context) => {
    const seen = { ids: new Set<string>(), keys: new Set<string>(), attributes: new Set<string>() };
    questions.forEach((question, index) => {
      const at = [index];
      if (seen.ids.has(question.id)) {
        context.addIssue({ code: 'custom', path: [...at, 'id'], message: 'Two questions share one id.' });
      }
      if (seen.keys.has(question.key)) {
        context.addIssue({ code: 'custom', path: [...at, 'key'], message: 'Two questions use the same key.' });
      }
      if (question.answerType === 'file') {
        context.addIssue({
          code: 'custom',
          path: [...at, 'answerType'],
          message: 'A booking page can’t ask for a file yet.',
        });
      }
      const attributeId = question.filedOn?.attributeId;
      if (attributeId !== undefined && seen.attributes.has(attributeId)) {
        context.addIssue({
          code: 'custom',
          path: [...at, 'filedOn'],
          message: 'Two questions are filed on one attribute.',
        });
      }
      seen.ids.add(question.id);
      seen.keys.add(question.key);
      if (attributeId !== undefined) seen.attributes.add(attributeId);
    });
  });
/** A booking page's own questions. */
export type BookingQuestions = z.infer<typeof BookingQuestions>;

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
    .max(BOOKING_DURATIONS_MAX, { error: 'A page offers at most 4 lengths.' })
    .refine((durations) => new Set(durations).size === durations.length, { error: 'Offer each length once.' }),
  location: BookingLocation,
  bufferBefore: z.number().int().min(0, 'Buffers are 0 to 60 minutes.').max(60, 'Buffers are 0 to 60 minutes.'),
  bufferAfter: z.number().int().min(0, 'Buffers are 0 to 60 minutes.').max(60, 'Buffers are 0 to 60 minutes.'),
  minNoticeMinutes: z
    .number()
    .int()
    .min(0, 'Notice is 0 minutes to 14 days.')
    .max(BOOKING_NOTICE_MAX, 'Notice is at most 14 days.'),
  windowDays: z.number().int().min(1, 'Allow at least 1 day ahead.').max(365, 'Allow at most 365 days ahead.'),
  /** At most this many bookings a day; null for no limit. */
  dailyLimit: z.number().int().min(1, 'A daily limit is 1 to 50.').max(50, 'A daily limit is 1 to 50.').nullable(),
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
  /**
   * The view the page opens in for a visitor with no remembered choice of their own (owner, 25 Oct 2026): Month,
   * List or Chat. It is the default, never an override: a visitor who has picked a view on that browser keeps it.
   */
  defaultView: BookingDefaultView,
  /** The small heading a Public page sits under on its owner's profile (`/<handle>`); null for none. */
  profileSection: z.string().trim().min(1).max(40, 'Keep the section to 40 characters.').nullable(),
  /** Where a Public page sits on its owner's profile: lower first, then oldest first. */
  profilePosition: z.number().int().min(0, 'Use 0 to 999.').max(999, 'Use 0 to 999.'),
  /**
   * Whether a personal page shows its owner's social links under their name (booking socials, 25 Oct 2026): on by
   * default. The owner's alone to change, as the address is; a team page never shows them (AC-754).
   */
  showSocials: z.boolean(),
  /** The questions a visitor answers beside their name and email (spec 0057, AC-5701); none asks nothing more. */
  questions: BookingQuestions,
  /**
   * The object a booking's answers are filed onto (booking answers parity, 27 Oct 2026): null is the workspace's
   * People, which is what every page did and does by default. Another object needs a unique email attribute, so the
   * visitor's email can find or make their record there the way a form does; one without is refused CONFIG_INVALID.
   * The booking still matches or makes the visitor's Person either way: only the answers move.
   */
  answersObjectId: Uuid.nullable(),
  /**
   * Whether a booking finds or makes the visitor's person and company and files the answers onto the person (spec
   * 0057, AC-5708): on by default, today's behaviour. Off, the booking keeps the answers and touches no record.
   */
  fileToCrm: z.boolean(),
  /**
   * Only through a form (spec 0037, AC-1388): a team page that books only with a form's hand off, so nobody skips a
   * team link's questions by keeping the page's address; without one it answers as a closed page. Off by default, so
   * no page changes behaviour on its own; meaningless on a personal page, whose writes refuse it.
   */
  formOnly: z.boolean(),
});
/** Every setting a member edits. */
export type BookingPageSettings = z.infer<typeof BookingPageSettings>;
