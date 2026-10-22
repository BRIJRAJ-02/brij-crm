// A span drawn on Bookings' week (spec 0027), in the member's own zone (the
// browser's): its instants, and its name for the card. Pure: the locale comes in.
import type { BookingAvailability } from '@crm/data';
import { strings } from './strings.ts';
import { dayStart } from './week.ts';

/** A span drawn on one day, in the member's own zone. */
export interface DrawnSpan {
  readonly dayKey: string;
  readonly startMinute: number;
  readonly endMinute: number;
}

/** The minute of a day as an instant in the member's zone (1440 is the next midnight). */
export function instantOf(dayKey: string, minute: number): Date {
  const date = dayStart(dayKey);
  date.setMinutes(minute);
  return date;
}

/** "45 min", "1 hr", "1 hr 30 min". */
export function lengthLabel(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return strings.minutes(rest);
  return rest === 0 ? strings.hours(hours) : `${strings.hours(hours)} ${strings.minutes(rest)}`;
}

/** The span's name: its times, and its day and length. */
export function spanNames(span: DrawnSpan, locale: string): { readonly title: string; readonly meta: string } {
  const clock = new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' });
  const day = new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long' });
  const start = instantOf(span.dayKey, span.startMinute);
  const end = instantOf(span.dayKey, span.endMinute);
  return {
    title: `${clock.format(start)} – ${clock.format(end)}`,
    meta: `${day.format(start)} · ${lengthLabel(span.endMinute - span.startMinute)}`,
  };
}

const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

/** Where the member's day starts (their first range that weekday), for time drawn from the keyboard; else 9:00. */
export function workingStartOf(availability: BookingAvailability | undefined, dayKey: string): number {
  const weekday = WEEKDAY_KEYS[dayStart(dayKey).getDay()] ?? 'mon';
  const first = availability?.weekly[weekday][0]?.[0];
  if (first === undefined) return 9 * 60;
  const [hours = 9, minutes = 0] = first.split(':').map(Number);
  return hours * 60 + minutes;
}

/** "09:30" as minutes from midnight ("24:00" is 1440). */
function minuteOf(clock: string): number {
  const [hours = 0, minutes = 0] = clock.split(':').map(Number);
  return hours * 60 + minutes;
}

/**
 * The member's open hours on a day, for shading the rest of the week grid: that date's override when there is one
 * (no ranges is a day off), else their weekly hours for its weekday. Undefined (no shading) when the hours are
 * unknown, or kept in another zone than the one the week is drawn in, where they would shade the wrong hours.
 */
export function openHoursOf(
  availability: BookingAvailability | undefined,
  dayKey: string,
  zone: string,
): readonly { readonly startMinute: number; readonly endMinute: number }[] | undefined {
  if (availability === undefined || availability.timeZone !== zone) return undefined;
  const weekday = WEEKDAY_KEYS[dayStart(dayKey).getDay()] ?? 'mon';
  const ranges =
    availability.overrides.find((override) => override.date === dayKey)?.ranges ?? availability.weekly[weekday];
  return ranges.map(([start, end]) => ({ startMinute: minuteOf(start), endMinute: minuteOf(end) }));
}
