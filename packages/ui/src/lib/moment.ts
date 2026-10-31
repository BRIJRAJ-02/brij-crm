// A moment (a date and time attribute's value: an ISO instant in UTC, `2026-10-08T13:30:00.000Z`) as people read
// and write it: its day and time of day in the provider's time zone, and back, and the words a cell shows. Pure,
// so the editor, the display and the paste share one reading.
import { fromAbsolute, parseDateTime, toCalendarDate, toZoned } from '@internationalized/date';
import { formatDay, formatDayNear, todayIn, type DateFormat } from './format.ts';
import { memoIntl } from './intl-memo.ts';

const pad = (value: number) => String(value).padStart(2, '0');

/** A moment's day (`YYYY-MM-DD`) and time of day (`HH:MM`, 24 hour) in `timeZone`; undefined when it isn't one. */
export function momentParts(
  instant: string,
  timeZone: string,
): { readonly date: string; readonly time: string } | undefined {
  const ms = new Date(instant).getTime();
  if (Number.isNaN(ms)) return undefined;
  const zoned = fromAbsolute(ms, timeZone);
  return { date: toCalendarDate(zoned).toString(), time: `${pad(zoned.hour)}:${pad(zoned.minute)}` };
}

/**
 * The moment a day and a time of day (`HH:MM`) name in `timeZone`, as the value stores it, to the millisecond in
 * UTC; undefined when either doesn't read. A time a clock change skips takes the hour after, as calendars do.
 */
export function momentOf(date: string, time: string, timeZone: string): string | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return undefined;
  try {
    return toZoned(parseDateTime(`${date}T${time}`), timeZone)
      .toDate()
      .toISOString();
  } catch {
    return undefined;
  }
}

/** A time of day in the language: "14:30" (en-GB), "2:30 PM" (en-US). */
export function formatClock(instant: string, locale: string, timeZone: string): string {
  return memoIntl(
    `clock:${locale}:${timeZone}`,
    () => new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', timeZone }),
  ).format(new Date(instant));
}

/** `HH:MM` (24 hour) as a time of day in the language, for a time picker's list. */
export function formatClockOf(time: string, locale: string): string {
  return formatClock(`1970-01-01T${time}:00.000Z`, locale, 'UTC');
}

/**
 * A moment to read (the field types pass, 31 October 2026): "Today 14:30", "Yesterday 09:12" or "Tomorrow 10:00"
 * near today in `timeZone`, else the exact day and time, "8 Oct 2026, 14:30". Never "3 hours ago": a date and time
 * someone set means the time, and the words never move under them.
 */
export function formatMoment(
  instant: string,
  now: number,
  locale: string,
  timeZone: string,
  dateFormat: DateFormat = 'auto',
): string {
  const parts = momentParts(instant, timeZone);
  if (parts === undefined) return instant;
  const clock = formatClock(instant, locale, timeZone);
  const near = formatDayNear(parts.date, todayIn(now, timeZone), locale);
  return near === undefined ? `${formatDay(instant, locale, timeZone, dateFormat)}, ${clock}` : `${near} ${clock}`;
}
