// Every date, number and amount the library shows, formatted in the provider's
// language and time zone (AC-11). Pure functions; components get the settings
// from `useFormatSettings()` and the time from `useNow()`.

import { fromAbsolute, toCalendarDate } from '@internationalized/date';
import { memoIntl } from './intl-memo.ts';

/** A decimal string as `Intl` takes it: formatting a string is exact, where a number would round. */
type DecimalString = Intl.StringNumericLiteral;

/** Formats an exact decimal string in the language, with up to 4 decimals and no rounding beyond them. */
export function formatDecimal(value: string, locale: string, minimumFractionDigits = 0): string {
  return memoIntl(
    `number:${locale}:${String(minimumFractionDigits)}`,
    () => new Intl.NumberFormat(locale, { minimumFractionDigits, maximumFractionDigits: 4 }),
  ).format(value as DecimalString);
}

/** How many minor units a currency shows: 2 for USD, 0 for JPY, 3 for KWD. */
export function minorUnits(currency: string): number {
  return memoIntl(
    `minor:${currency}`,
    () => new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().minimumFractionDigits ?? 2,
  );
}

/** Formats an amount's digits: at least the currency's minor units, at most 4 (`1,234.50` for USD). The code is shown beside it. */
export function formatAmount(amount: string, currency: string, locale: string): string {
  return formatDecimal(amount, locale, Math.min(minorUnits(currency), 4));
}

/** Whether Intl knows the code as a currency: anything else would throw, so it is written as the code and digits. */
function isCurrencyCode(currency: string): boolean {
  try {
    minorUnits(currency);
    return true;
  } catch {
    return false;
  }
}

/** Whether an exact decimal string has a fraction other than zero ("1234.50" yes, "1234.00" and "1234" no). */
function hasFraction(amount: string): boolean {
  const fraction = amount.split('.')[1] ?? '';
  return /[1-9]/u.test(fraction);
}

/**
 * An amount with its currency's symbol, grouped in the language, as Attio and HubSpot show money: "$58,500",
 * "€1.234,50" in de-DE, "CA$12" for Canadian dollars beside US ones. A whole amount shows no decimals; one with
 * a fraction shows at least the currency's minor units and at most 4, exact from the decimal string.
 */
export function formatMoney(amount: string, currency: string, locale: string): string {
  const whole = !hasFraction(amount);
  if (!isCurrencyCode(currency)) return `${currency} ${formatDecimal(amount, locale)}`;
  const minimum = whole ? 0 : Math.min(minorUnits(currency), 4);
  return memoIntl(
    `money:${locale}:${currency}:${whole ? 'w' : 'f'}`,
    () =>
      new Intl.NumberFormat(locale, {
        style: 'currency',
        currency,
        currencyDisplay: 'symbol',
        minimumFractionDigits: minimum,
        maximumFractionDigits: whole ? 0 : 4,
      }),
  ).format(amount as DecimalString);
}

function parts(date: string): readonly [number, number, number] {
  const [year = 0, month = 1, day = 1] = date.split('-').map(Number);
  return [year, month, day];
}

/**
 * How a date is written, as a member chose it (Settings › Account ›
 * Preferences): the language's own (`auto`, "Oct 8, 2026" in en-US), day
 * first (`dmy`, "8 Oct 2026"), month first (`mdy`, "Oct 8, 2026") or ISO
 * (`ymd`, "2026-10-08"). Month names stay in the language.
 */
export type DateFormat = 'auto' | 'dmy' | 'mdy' | 'ymd';

/** An instant's day written in `dateFormat`, read in `timeZone`. */
function writeDay(at: number, locale: string, timeZone: string, dateFormat: DateFormat): string {
  if (dateFormat === 'auto') {
    return memoIntl(
      `day:${locale}:${timeZone}`,
      () => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone }),
    ).format(at);
  }
  const numeric = dateFormat === 'ymd';
  const parts = memoIntl(
    `parts:${locale}:${timeZone}:${numeric ? 'n' : 's'}`,
    () =>
      new Intl.DateTimeFormat(numeric ? 'en' : locale, {
        year: 'numeric',
        month: numeric ? '2-digit' : 'short',
        day: numeric ? '2-digit' : 'numeric',
        timeZone,
      }),
  ).formatToParts(at);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((each) => each.type === type)?.value ?? '';
  if (numeric) return `${part('year')}-${part('month')}-${part('day')}`;
  return dateFormat === 'dmy'
    ? `${part('day')} ${part('month')} ${part('year')}`
    : `${part('month')} ${part('day')}, ${part('year')}`;
}

/** A calendar day (`2026-10-08`) in the date format: "Oct 8, 2026". It has no time zone, so none shifts it. */
export function formatDate(date: string, locale: string, dateFormat: DateFormat = 'auto'): string {
  const [year, month, day] = parts(date);
  return writeDay(Date.UTC(year, month - 1, day), locale, 'UTC', dateFormat);
}

/**
 * A calendar day within the current year, without its year, as lists of dates show them (Linear, Attio): "Oct 24",
 * "24 Oct". The numeric format keeps its year, since "10-24" reads as nothing. The caller decides the year is the
 * current one; a day in another year goes through `formatDate`.
 */
export function formatDateInYear(date: string, locale: string, dateFormat: DateFormat = 'auto'): string {
  const [year, month, day] = parts(date);
  if (dateFormat === 'ymd') return formatDate(date, locale, dateFormat);
  const at = Date.UTC(year, month - 1, day);
  if (dateFormat === 'auto') {
    return memoIntl(
      `dayInYear:${locale}`,
      () => new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', timeZone: 'UTC' }),
    ).format(at);
  }
  const shown = memoIntl(
    `partsInYear:${locale}`,
    () => new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', timeZone: 'UTC' }),
  ).formatToParts(at);
  const part = (type: Intl.DateTimeFormatPartTypes) => shown.find((each) => each.type === type)?.value ?? '';
  return dateFormat === 'dmy' ? `${part('day')} ${part('month')}` : `${part('month')} ${part('day')}`;
}

/** An instant's day in the time zone and date format: "Oct 8, 2026". */
export function formatDay(
  timestamp: string,
  locale: string,
  timeZone: string,
  dateFormat: DateFormat = 'auto',
): string {
  return writeDay(new Date(timestamp).getTime(), locale, timeZone, dateFormat);
}

/** The exact time, for tooltips: "Oct 8, 2026, 3:30 PM BST", with the time zone's name. */
export function formatExactTime(timestamp: string, locale: string, timeZone: string): string {
  return memoIntl(
    `exact:${locale}:${timeZone}`,
    () =>
      new Intl.DateTimeFormat(locale, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        timeZone,
        timeZoneName: 'short',
      }),
  ).format(new Date(timestamp));
}

/**
 * A meeting's span (spec 0024): "Tue, 20 Oct, 09:00 – 09:30" in the time
 * zone, or for an all day meeting its days ("Tue, 20 Oct"), read in UTC (an
 * all day meeting is stored from midnight UTC to midnight UTC the day after).
 */
export function formatTimeRange(start: string, end: string, allDay: boolean, locale: string, timeZone: string): string {
  const from = new Date(start);
  if (allDay) {
    // The end is the next day's start: the meeting's last day is the moment before it.
    const last = new Date(Math.max(from.getTime(), new Date(end).getTime() - 1));
    const days = memoIntl(
      `days:${locale}`,
      () => new Intl.DateTimeFormat(locale, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }),
    );
    return days.formatRange(from, last);
  }
  const span = memoIntl(
    `span:${locale}:${timeZone}`,
    () =>
      new Intl.DateTimeFormat(locale, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        timeZone,
      }),
  );
  return span.formatRange(from, new Date(Math.max(from.getTime(), new Date(end).getTime())));
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * A relative time in the largest whole unit: "now" under a minute, then
 * minutes, hours and days ("3 hours ago", "yesterday"). Days count calendar
 * days in the time zone, as the timeline's headings do, so an entry under
 * "Yesterday" never reads "2 days ago" and one from two dates back never
 * reads "yesterday". Past 7 days it becomes the date in the time zone.
 */
export function formatRelative(
  timestamp: string,
  now: number,
  locale: string,
  timeZone: string,
  dateFormat: DateFormat = 'auto',
): string {
  const elapsed = new Date(timestamp).getTime() - now;
  const size = Math.abs(elapsed);
  const sign = Math.sign(elapsed);
  const relative = memoIntl(`relative:${locale}`, () => new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }));
  if (size < MINUTE) return relative.format(0, 'second');
  if (size < HOUR) return relative.format(sign * Math.floor(size / MINUTE), 'minute');
  if (size < DAY) return relative.format(sign * Math.floor(size / HOUR), 'hour');
  if (size <= 7 * DAY) {
    const days = toCalendarDate(fromAbsolute(now, timeZone)).compare(
      toCalendarDate(fromAbsolute(new Date(timestamp).getTime(), timeZone)),
    );
    return relative.format(-days, 'day');
  }
  return formatDay(timestamp, locale, timeZone, dateFormat);
}
