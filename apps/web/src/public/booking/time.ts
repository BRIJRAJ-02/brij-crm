// Dates and times in the visitor's zone for the public booking page (spec
// 0025, AC-630), with the browser's Intl only (the page never loads a date
// library): a day's key, midnight of a day in a zone, a week of days, and
// labels.

/** `YYYY-MM-DD` of an instant in `zone`. */
export function dayKey(instant: number, zone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(instant));
  const part = (type: string) => parts.find((each) => each.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

/** The zone's offset from UTC at an instant, in milliseconds. */
function offsetAt(instant: number, zone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(new Date(instant));
  const value = (type: string) => Number(parts.find((each) => each.type === type)?.value ?? '0');
  const asUtc = Date.UTC(
    value('year'),
    value('month') - 1,
    value('day'),
    value('hour'),
    value('minute'),
    value('second'),
  );
  return asUtc - (instant - (instant % 1000));
}

/** The instant a day (`YYYY-MM-DD`) starts in `zone`: its local midnight (or the first moment after a DST gap). */
export function startOfDay(key: string, zone: string): number {
  const [year = 1970, month = 1, day = 1] = key.split('-').map(Number);
  const guess = Date.UTC(year, month - 1, day);
  const first = guess - offsetAt(guess, zone);
  // Once more at the found instant, for a day whose offset changed since the guess; a midnight a DST gap skips
  // lands on the day before, so the first moment of the day is the first answer.
  const second = guess - offsetAt(first, zone);
  return dayKey(second, zone) === key ? second : first;
}

/** The key of the day `days` after `key`. */
export function addDays(key: string, days: number): string {
  const [year = 1970, month = 1, day = 1] = key.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/** A day's labels in the visitor's language: "Mon", "2", "Monday 2 November". */
export function dayLabels(
  key: string,
  locale: string,
): { readonly weekday: string; readonly day: string; readonly label: string } {
  const [year = 1970, month = 1, day = 1] = key.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  const format = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(locale, { timeZone: 'UTC', ...options }).format(date);
  return {
    weekday: format({ weekday: 'short' }),
    day: format({ day: 'numeric' }),
    label: format({ weekday: 'long', day: 'numeric', month: 'long' }),
  };
}

/** A week's label: "2 Nov to 8 Nov 2026". */
export function weekLabel(first: string, last: string, locale: string): string {
  const [y1 = 1970, m1 = 1, d1 = 1] = first.split('-').map(Number);
  const [y2 = 1970, m2 = 1, d2 = 1] = last.split('-').map(Number);
  return new Intl.DateTimeFormat(locale, {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).formatRange(new Date(Date.UTC(y1, m1 - 1, d1, 12)), new Date(Date.UTC(y2, m2 - 1, d2, 12)));
}

/** A time of day in the zone: "09:30" (or "9:30 AM", by language). */
export function timeLabel(instant: string, zone: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { timeZone: zone, hour: 'numeric', minute: '2-digit' }).format(
    new Date(instant),
  );
}

/** A whole moment in the zone: "Monday 2 November 2026, 09:30". */
export function momentLabel(instant: string, zone: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: zone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(instant));
}
