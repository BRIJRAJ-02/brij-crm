// Every date, number and amount the library shows, formatted in the provider's
// language and time zone (AC-11). Pure functions; components get the settings
// from `useFormatSettings()` and the time from `useNow()`.

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

function parts(date: string): readonly [number, number, number] {
  const [year = 0, month = 1, day = 1] = date.split('-').map(Number);
  return [year, month, day];
}

/** A calendar day (`2026-10-08`) as the language writes it: "Oct 8, 2026". It has no time zone, so none shifts it. */
export function formatDate(date: string, locale: string): string {
  const [year, month, day] = parts(date);
  return memoIntl(
    `date:${locale}`,
    () => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }),
  ).format(Date.UTC(year, month - 1, day));
}

/** An instant's day in the time zone: "Oct 8, 2026". */
export function formatDay(timestamp: string, locale: string, timeZone: string): string {
  return memoIntl(
    `day:${locale}:${timeZone}`,
    () => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone }),
  ).format(new Date(timestamp));
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

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * A relative time in the largest whole unit: "now" under a minute, then
 * minutes, hours and days ("3 hours ago", "yesterday"). Past 7 days it becomes
 * the date in the time zone.
 */
export function formatRelative(timestamp: string, now: number, locale: string, timeZone: string): string {
  const elapsed = new Date(timestamp).getTime() - now;
  const size = Math.abs(elapsed);
  const sign = Math.sign(elapsed);
  const relative = memoIntl(`relative:${locale}`, () => new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }));
  if (size < MINUTE) return relative.format(0, 'second');
  if (size < HOUR) return relative.format(sign * Math.floor(size / MINUTE), 'minute');
  if (size < DAY) return relative.format(sign * Math.floor(size / HOUR), 'hour');
  if (size <= 7 * DAY) return relative.format(sign * Math.floor(size / DAY), 'day');
  return formatDay(timestamp, locale, timeZone);
}
