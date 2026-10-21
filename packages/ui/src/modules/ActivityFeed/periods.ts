// The timeline's period headings: Upcoming, Today, Yesterday, This week, then a month.
// Pure, so the Node tests can check each boundary in any time zone.
import { fromAbsolute, startOfWeek, toCalendarDate } from '@internationalized/date';
import { weekStartDay, type WeekStart } from '../../lib/month.ts';

/**
 * Which heading an entry falls under: `upcoming` (a meeting still to come),
 * `today`, `yesterday`, `week` (earlier this week), or a month as `YYYY-MM`.
 */
export type Period = string;

/** How far ahead of the clock an entry must be to count as upcoming: a moment just ahead (clock skew) is today. */
export const UPCOMING_AFTER_MS = 5 * 60_000;

/** The period `at` (ISO 8601, UTC) falls in, seen from `now` in `timeZone`; weeks start on the language's first day. */
export function periodOf(at: string, now: number, timeZone: string, locale: string, weekStart?: WeekStart): Period {
  if (Date.parse(at) - now > UPCOMING_AFTER_MS) return 'upcoming';
  const day = toCalendarDate(fromAbsolute(Date.parse(at), timeZone));
  const today = toCalendarDate(fromAbsolute(now, timeZone));
  const daysAgo = today.compare(day);
  if (daysAgo <= 0) return 'today';
  if (daysAgo === 1) return 'yesterday';
  if (day.compare(startOfWeek(today, locale, weekStartDay(weekStart))) >= 0) return 'week';
  return `${String(day.year)}-${String(day.month).padStart(2, '0')}`;
}
