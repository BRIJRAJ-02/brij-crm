// Bookings' week, in the member's own time zone (the browser's): the Monday a
// week starts on, its days, the range's label, and the bookings and calendar
// events as the grid's blocks, each clipped to the days it covers. Pure: the
// clock and the locale come in.
import type { BookingListItem, CalendarEventItem } from '@crm/data';

/** A local day as `yyyy-MM-dd`. */
export function dayKeyOf(date: Date): string {
  return `${String(date.getFullYear())}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** The local midnight a `yyyy-MM-dd` key names. */
export function dayStart(key: string): Date {
  const [year = 1970, month = 1, day = 1] = key.split('-').map(Number);
  return new Date(year, month - 1, day);
}

/** `key` moved by `days`. */
export function addDays(key: string, days: number): string {
  const date = dayStart(key);
  date.setDate(date.getDate() + days);
  return dayKeyOf(date);
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

/** The range a week reads, as ISO instants: its Monday's midnight to the next Monday's. */
export function weekRange(monday: string): { readonly from: string; readonly to: string } {
  return { from: dayStart(monday).toISOString(), to: dayStart(addDays(monday, 7)).toISOString() };
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

/** Minutes from the local midnight of `key` to `instant`, clipped to the day. */
function minuteIn(key: string, instant: Date): number {
  const minutes = (instant.getTime() - dayStart(key).getTime()) / 60_000;
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

/** The pieces of [start, end) on each of `days` it touches. */
export function piecesOf(
  sourceId: string,
  startsAt: string,
  endsAt: string,
  days: readonly string[],
): readonly DayPiece[] {
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  return days.flatMap((key) => {
    const from = dayStart(key);
    const to = dayStart(addDays(key, 1));
    if (end <= from || start >= to) return [];
    const startMinute = minuteIn(key, start < from ? from : start);
    const endMinute = minuteIn(key, end > to ? to : end);
    if (endMinute <= startMinute) return [];
    return [{ id: `${sourceId}:${key}`, sourceId, dayKey: key, startMinute, endMinute }];
  });
}

/** "9:30 – 10:00 AM" in the locale. */
export function timeRange(startsAt: string, endsAt: string, locale: string): string {
  const clock = new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' });
  return `${clock.format(new Date(startsAt))} – ${clock.format(new Date(endsAt))}`;
}

/** The working day the grid opens on: 8 AM to 8 PM. */
const DAY_START = 8 * 60;
const DAY_END = 20 * 60;

/**
 * The minute the week opens with at its top: this week, an hour before now
 * within the working day (8 AM to 8 PM), else 8 AM; another week, an hour
 * before its first booking or event when that is earlier than 8 AM, else 8 AM.
 */
export function scrollMinute(
  days: readonly string[],
  now: Date,
  pieces: readonly Pick<DayPiece, 'startMinute' | 'endMinute'>[],
): number {
  if (days.includes(dayKeyOf(now))) {
    const minute = now.getHours() * 60 + now.getMinutes();
    return minute >= DAY_START && minute < DAY_END ? Math.max(0, minute - 60) : DAY_START;
  }
  const first = pieces.length === 0 ? DAY_START : Math.min(...pieces.map((piece) => piece.startMinute));
  return first < DAY_START ? Math.max(0, first - 60) : DAY_START;
}

/** The bookings of the week a list shows, by day piece, for the grid (cancelled ones too). */
export function bookingPieces(bookings: readonly BookingListItem[], days: readonly string[]): readonly DayPiece[] {
  return bookings.flatMap((booking) => piecesOf(booking.id, booking.startsAt, booking.endsAt, days));
}

/** The member's calendar events of the week, by day piece (all day events are left to the list). */
export function eventPieces(events: readonly CalendarEventItem[], days: readonly string[]): readonly DayPiece[] {
  return events
    .filter((event) => !event.allDay)
    .flatMap((event) => piecesOf(event.id, event.startsAt, event.endsAt, days));
}
