// A span drawn on Bookings' week (spec 0027), in the member's own zone (the
// browser's): its instants, and its name for the card. Pure: the locale comes in.
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
