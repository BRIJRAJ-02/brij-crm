// Dates and relative ranges for rule checks (spec 0013), worked out the way
// the engine's reference evaluator does (`packages/core/src/engine/query/
// evaluate.ts`), so a condition means the same in the browser, under the
// record lock and in a filter. Pure: the moment and the time zone come in.
import type { RelativeRange } from '../values/filters.ts';

/** The moment a check runs at, the writer's time zone, and the day weeks start on (spec 0006: Monday). */
export interface RuleClock {
  readonly now: string;
  readonly timeZone: string;
  readonly weekStart: 'monday' | 'sunday';
}

function ymd(date: string): [number, number, number] {
  const [y, m, d] = date.split('-').map(Number);
  return [y ?? 0, m ?? 1, d ?? 1];
}

function format(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** A calendar day moved by whole days. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = ymd(date);
  return format(Date.UTC(y, m - 1, d + days));
}

/** Adds months the way Postgres does: the day is clamped to the month's last. */
function addMonths(date: string, months: number): string {
  const [y, m, d] = ymd(date);
  const first = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return format(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(d, last)));
}

function shiftDate(date: string, range: Exclude<RelativeRange, string>, sign: 1 | -1): string {
  const n = range.amount * sign;
  if (range.unit === 'day') return addDays(date, n);
  if (range.unit === 'week') return addDays(date, 7 * n);
  return addMonths(date, range.unit === 'month' ? n : 12 * n);
}

function localDate(ms: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    new Date(ms),
  );
}

/** Today's date in the clock's time zone (`YYYY-MM-DD`); UTC when the zone isn't known. */
export function todayOf(clock: RuleClock): string {
  const ms = Date.parse(clock.now);
  try {
    return localDate(ms, clock.timeZone);
  } catch {
    return localDate(ms, 'UTC');
  }
}

/** The instant a local date's midnight falls at in a time zone. */
function zonedMidnight(date: string, timeZone: string): number {
  const [y, m, d] = ymd(date);
  const guess = Date.UTC(y, m - 1, d);
  const offsetAt = (instant: number) => {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    }).formatToParts(new Date(instant));
    const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
    return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second')) - instant;
  };
  const first = guess - offsetAt(guess);
  return guess - offsetAt(first);
}

/** A relative range as dates: the first day in it, and the first day after it. */
export function dateRange(clock: RuleClock, range: RelativeRange, last: boolean): [string, string] {
  const today = todayOf(clock);
  if (typeof range === 'string') {
    const [y, m] = ymd(today);
    const month = format(Date.UTC(y, m - 1, 1));
    const dow = new Date(`${today}T00:00:00Z`).getUTCDay();
    const week = addDays(today, clock.weekStart === 'sunday' ? -dow : -((dow + 6) % 7));
    switch (range) {
      case 'today':
        return [today, addDays(today, 1)];
      case 'this_week':
        return [week, addDays(week, 7)];
      case 'this_month':
        return [month, addMonths(month, 1)];
      case 'last_month':
        return [addMonths(month, -1), month];
    }
  }
  return last ? [shiftDate(today, range, -1), addDays(today, 1)] : [today, addDays(shiftDate(today, range, 1), 1)];
}

function shiftInstant(ms: number, range: Exclude<RelativeRange, string>, sign: 1 | -1): number {
  const iso = new Date(ms).toISOString();
  const moved = shiftDate(iso.slice(0, 10), range, sign);
  return Date.parse(`${moved}${iso.slice(10)}`);
}

/** A relative range as instants, and whether its end is excluded. */
export function timeRange(clock: RuleClock, range: RelativeRange, last: boolean): [number, number, boolean] {
  if (typeof range === 'string') {
    const [start, end] = dateRange(clock, range, last);
    return [zonedMidnight(start, clock.timeZone), zonedMidnight(end, clock.timeZone), true];
  }
  const now = Date.parse(clock.now);
  return last ? [shiftInstant(now, range, -1), now, false] : [now, shiftInstant(now, range, 1), false];
}

const DAY_FORMAT = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

/** A calendar day as messages write it: "8 October 2026" (spec 0013; the app's copy is English). */
export function formatDay(iso: string): string {
  const ms = Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(ms) ? iso : DAY_FORMAT.format(new Date(ms));
}
