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
