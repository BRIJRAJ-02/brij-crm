// The timeline's period headings: Today, Yesterday, This week, then a month.
// Pure, so the Node tests can check each boundary in any time zone.
import { fromAbsolute, startOfWeek, toCalendarDate } from '@internationalized/date';

/** Which heading an entry falls under: `today`, `yesterday`, `week` (earlier this week), or a month as `YYYY-MM`. */
export type Period = string;

/** The period `at` (ISO 8601, UTC) falls in, seen from `now` in `timeZone`; weeks start on the language's first day. */
export function periodOf(at: string, now: number, timeZone: string, locale: string): Period {
  const day = toCalendarDate(fromAbsolute(Date.parse(at), timeZone));
  const today = toCalendarDate(fromAbsolute(now, timeZone));
  const daysAgo = today.compare(day);
  if (daysAgo <= 0) return 'today';
  if (daysAgo === 1) return 'yesterday';
  if (day.compare(startOfWeek(today, locale)) >= 0) return 'week';
  return `${String(day.year)}-${String(day.month).padStart(2, '0')}`;
}
