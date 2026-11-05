// Where the Reservations page's day calendar starts (spec 0066 B7 lite, after checklabs' ReservationDayCalendar, which
// draws 10:00 to midnight). Pure, no React, so it is tested in Node.
import type { PlaceHours } from '@crm/data';
import { spanOf, WEEK_DAYS } from '@crm/data/hospitality';

/** Where checklabs' day calendar opens: 10:00. */
export const CALENDAR_FROM = 10 * 60;

/** The place's service windows on `date` (`YYYY-MM-DD`): a dated exception's, else the weekly pattern's. */
function windowsOn(hours: PlaceHours, date: string) {
  const exception = hours.exceptions.find((each) => each.date === date);
  if (exception?.closed === true) return [];
  if (exception?.ranges !== undefined) return exception.ranges;
  // The calendar date's week day at noon UTC, whatever the reader's zone, Monday first as WEEK_DAYS is.
  const weekday = WEEK_DAYS[(new Date(`${date}T12:00:00.000Z`).getUTCDay() + 6) % 7];
  return weekday === undefined ? [] : (hours.weekly[weekday] ?? []);
}

/**
 * The minute the day calendar starts on `date`, on the hour: 10:00, as checklabs' does, or sooner when the day's
 * first service window or one of `starts` (its bookings' starts, minutes from midnight) is earlier, so nothing on the
 * day is ever above the grid.
 */
export function calendarStart(hours: PlaceHours, date: string, starts: readonly number[]): number {
  const windows = windowsOn(hours, date).flatMap((range) => {
    const span = spanOf(range);
    return span === undefined ? [] : [span.start];
  });
  const first = Math.min(CALENDAR_FROM, ...windows, ...starts);
  return Math.max(0, Math.floor(first / 60) * 60);
}
