// Bookings' week, in the member's own time zone (Settings › Account ›
// Preferences, else the browser's): the Monday a week starts on, its days, the
// range's label, and the bookings and calendar events as the grid's blocks,
// each clipped to the days it covers. Pure: the clock, the zone and the locale
// come in. Day keys are calendar dates and need no zone; an instant becomes a
// day and a minute only through the zone passed in, never the browser's.
import type { BookingListItem, CalendarEventItem } from '@crm/data';
import { memoIntl } from '@crm/ui';

/** The one formatter per zone that reads its whole clock, built once (formatters are slow to build). */
const clockOf = (zone: string): Intl.DateTimeFormat =>
  memoIntl(
    `bookings-clock|${zone}`,
    () =>
      new Intl.DateTimeFormat('en-US', {
        timeZone: zone,
        hourCycle: 'h23',
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
        second: 'numeric',
      }),
  );

/** The wall clock of `zone` at an instant, written down as if it were UTC (to the second). */
function wallClockAt(instant: number, zone: string): number {
  const parts = clockOf(zone).formatToParts(new Date(instant));
  const value = (type: string) => Number(parts.find((each) => each.type === type)?.value ?? '0');
  return Date.UTC(value('year'), value('month') - 1, value('day'), value('hour'), value('minute'), value('second'));
}

/** A day key's midnight in UTC, the zero its wall clock minutes count from. */
function utcMidnight(key: string): number {
  const [year = 1970, month = 1, day = 1] = key.split('-').map(Number);
  return Date.UTC(year, month - 1, day);
}

/** The day an instant falls on in `zone`, as `yyyy-MM-dd`. */
export function dayKeyOf(date: Date, zone: string): string {
  return new Date(wallClockAt(date.getTime(), zone)).toISOString().slice(0, 10);
}

/** The minute of its day `date` shows on the clock in `zone` (the grid's rows are the clock's hours). */
export function minuteOfDay(date: Date, zone: string): number {
  const wall = wallClockAt(date.getTime(), zone);
  return Math.floor((wall - utcMidnight(new Date(wall).toISOString().slice(0, 10))) / 60_000);
}

/** How far `zone`'s clock is ahead of UTC at an instant, in milliseconds. */
const offsetAt = (instant: number, zone: string) => wallClockAt(instant, zone) - (instant - (instant % 1000));

const HALF_DAY = 12 * 3_600_000;

/**
 * The instant the clock in `zone` reads `minute` on day `key` (1440 is the next midnight), tried with the offsets
 * either side of any daylight saving change that day. In an hour the change repeats, the later reading (the
 * earlier for a repeated midnight, so a day starts at its first moment); in an hour it skips, the clock moved on
 * by the jump (02:30 reads 03:30), the same east and west of UTC.
 */
export function instantAt(key: string, minute: number, zone: string): Date {
  const wall = utcMidnight(key) + minute * 60_000;
  const before = wall - offsetAt(wall - HALF_DAY, zone);
  const after = wall - offsetAt(wall + HALF_DAY, zone);
  const reads = [before, after].filter((instant) => wallClockAt(instant, zone) === wall);
  if (reads.length === 0) return new Date(before);
  return new Date(minute === 0 ? Math.min(...reads) : Math.max(...reads));
}

/** The instant a day starts in `zone`: its midnight there (or the first moment after a daylight saving gap). */
export function midnightIn(key: string, zone: string): Date {
  return instantAt(key, 0, zone);
}

/**
 * A calendar day's Date for its weekday and for naming the date (local midnight). Never an instant to place or
 * compare times by: that is `midnightIn`.
 */
export function dayStart(key: string): Date {
  const [year = 1970, month = 1, day = 1] = key.split('-').map(Number);
  return new Date(year, month - 1, day);
}

/** `key` moved by `days`, as calendar dates (no zone). */
export function addDays(key: string, days: number): string {
  const [year = 1970, month = 1, day = 1] = key.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/** The first day of the week holding `key`: Monday unless `firstDay` (0 Sunday to 6 Saturday, the member's week start) says. */
export function weekOf(key: string, firstDay = 1): string {
  const date = dayStart(key);
  return addDays(key, -((date.getDay() - firstDay + 7) % 7));
}

/** True for a `yyyy-MM-dd` key. */
export const isDayKey = (value: unknown): value is string =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(dayStart(value).getTime());

/** The week's seven day keys, Monday first. */
export function weekDays(monday: string): readonly string[] {
  return Array.from({ length: 7 }, (_, index) => addDays(monday, index));
}

/** The week on screen as the small month's tinted band, its first and last day; nothing for an empty week. */
export function shownWeek(days: readonly string[]): {
  readonly shown?: { readonly start: string; readonly end: string };
} {
  const start = days[0];
  const end = days.at(-1);
  return start === undefined || end === undefined ? {} : { shown: { start, end } };
}

/** The range a week reads, as ISO instants: its first day's midnight to the next week's, in `zone`. */
export function weekRange(monday: string, zone: string): { readonly from: string; readonly to: string } {
  return { from: midnightIn(monday, zone).toISOString(), to: midnightIn(addDays(monday, 7), zone).toISOString() };
}

/** The week's range in the locale's own words: "12–18 October 2026" (en-GB), "October 12 – 18, 2026" (en-US). */
export function rangeLabel(monday: string, locale: string): string {
  const start = dayStart(monday);
  const end = dayStart(addDays(monday, 6));
  const sameYear = start.getFullYear() === end.getFullYear();
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: sameYear ? 'long' : 'short',
    year: 'numeric',
  }).formatRange(start, end);
}

/** A day of the week on the grid: its key, and the instants it runs between in the member's zone. */
export interface DayBounds {
  readonly key: string;
  readonly from: number;
  readonly to: number;
}

/** The week's days as the grid reads them in `zone`: their midnights worked out once, not once per block. */
export interface WeekBounds {
  readonly zone: string;
  readonly days: readonly DayBounds[];
}

/** `days` with their midnights in `zone`, for `piecesOf`. */
export function weekBounds(days: readonly string[], zone: string): WeekBounds {
  const midnights = [...days, addDays(days.at(-1) ?? '1970-01-01', 1)].map((key) => midnightIn(key, zone).getTime());
  return {
    zone,
    days: days.map((key, index) => ({ key, from: midnights[index] ?? 0, to: midnights[index + 1] ?? 0 })),
  };
}

/** The clock minute of `instant` on `day` in `zone`, clipped to the day (its next midnight is 1440). */
function minuteIn(day: DayBounds, instant: number, zone: string): number {
  if (instant >= day.to) return 1440;
  const minutes = (wallClockAt(instant, zone) - utcMidnight(day.key)) / 60_000;
  return Math.max(0, Math.min(1440, Math.round(minutes)));
}

/** One piece of a booking or an event on one day of the grid. */
export interface DayPiece {
  readonly id: string;
  /** The booking's or event's own id (a piece of a long event has its own `id`). */
  readonly sourceId: string;
  readonly dayKey: string;
  readonly startMinute: number;
  readonly endMinute: number;
}

/** The pieces of [start, end) on each day of the week it touches, read in the week's zone. */
export function piecesOf(sourceId: string, startsAt: string, endsAt: string, week: WeekBounds): readonly DayPiece[] {
  const start = Date.parse(startsAt);
  const end = Date.parse(endsAt);
  return week.days.flatMap((day) => {
    if (end <= day.from || start >= day.to) return [];
    const first = Math.max(start, day.from);
    const last = Math.min(end, day.to);
    const startMinute = minuteIn(day, first, week.zone);
    // Across the hour a daylight saving change repeats, the clock runs back: the piece keeps its length.
    const clockEnd = minuteIn(day, last, week.zone);
    const endMinute =
      clockEnd > startMinute ? clockEnd : Math.min(1440, startMinute + Math.round((last - first) / 60_000));
    if (endMinute <= startMinute) return [];
    return [{ id: `${sourceId}:${day.key}`, sourceId, dayKey: day.key, startMinute, endMinute }];
  });
}

/** "9:30 – 10:00 AM" in the locale, on the clock of `zone`. */
export function timeRange(startsAt: string, endsAt: string, locale: string, zone: string): string {
  const clock = memoIntl(
    `bookings-time|${locale}|${zone}`,
    () => new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', timeZone: zone }),
  );
  return `${clock.format(new Date(startsAt))} – ${clock.format(new Date(endsAt))}`;
}

/** The working day the grid opens on: 8 AM to 8 PM. */
const DAY_START = 8 * 60;
const DAY_END = 20 * 60;

/**
 * The minute the week opens with at its top, always on the hour so its label shows whole: this week, the hour
 * before now within the working day (8 AM to 8 PM), else the start of the member's day (`startOfDay`, 8 AM unknown);
 * another week, the hour before its first booking or event when that is earlier than the day's start, else the
 * start.
 */
export function scrollMinute(
  days: readonly string[],
  now: Date,
  zone: string,
  pieces: readonly Pick<DayPiece, 'startMinute' | 'endMinute'>[],
  dayBegins: number = DAY_START,
): number {
  const hourBefore = (minute: number) => Math.max(0, Math.floor(minute / 60) * 60 - 60);
  const start = Math.floor(dayBegins / 60) * 60;
  if (days.includes(dayKeyOf(now, zone))) {
    const minute = minuteOfDay(now, zone);
    return minute >= DAY_START && minute < DAY_END ? hourBefore(minute) : start;
  }
  const first = pieces.length === 0 ? start : Math.min(...pieces.map((piece) => piece.startMinute));
  return first < start ? hourBefore(first) : start;
}

/** The bookings of the week a list shows, by day piece, for the grid (cancelled ones too). */
export function bookingPieces(bookings: readonly BookingListItem[], week: WeekBounds): readonly DayPiece[] {
  return bookings.flatMap((booking) => piecesOf(booking.id, booking.startsAt, booking.endsAt, week));
}

/** The member's calendar events of the week, by day piece (all day events are left to the list; the week does not show them). */
export function eventPieces(events: readonly CalendarEventItem[], week: WeekBounds): readonly DayPiece[] {
  return events
    .filter((event) => !event.allDay)
    .flatMap((event) => piecesOf(event.id, event.startsAt, event.endsAt, week));
}
