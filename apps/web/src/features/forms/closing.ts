// Settings' Closes row (forms fix b2): how a form's closing rule reads as a choice, and a day as the moment it
// closes, in the workspace's time zone (so the same day closes at the same instant whoever sets it). Plain functions,
// so they test in Node.
import type { FormDocument } from '@crm/data';

/** The Closes choice: never, on a day, or after a number of answers. */
export type ClosingKind = 'never' | 'date' | 'count';

/** The choice a stored rule reads as: a day when it names a moment, else a count when it names one, else never. */
export function closingKind(closing: FormDocument['closing']): ClosingKind {
  if (closing?.at !== undefined) return 'date';
  if (closing?.after !== undefined) return 'count';
  return 'never';
}

/** How far `timeZone`'s clock is ahead of UTC at `instant`, in milliseconds. */
function offsetAt(instant: number, timeZone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(new Date(instant))
      .map((part) => [part.type, part.value]),
  );
  const local = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return local - Math.floor(instant / 1000) * 1000;
}

/** The day (`YYYY-MM-DD`) an instant falls on in `timeZone`. */
export function dayIn(instant: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    new Date(instant),
  );
}

/**
 * The moment a form chosen to close on `day` (`YYYY-MM-DD`) closes: the end of that day (midnight after it) in
 * `timeZone`, as an ISO moment.
 */
export function closingOnDay(day: string, timeZone: string): string {
  const [year = 0, month = 1, date = 1] = day.split('-').map((part) => Number.parseInt(part, 10));
  const guess = Date.UTC(year, month - 1, date + 1);
  const first = guess - offsetAt(guess, timeZone);
  // Once more, for a day whose offset changes at midnight (daylight saving).
  return new Date(guess - offsetAt(first, timeZone)).toISOString();
}

/** The day a stored moment closes on, `YYYY-MM-DD` in `timeZone` (the day before the midnight it names). */
export function dayOfClosing(at: string | undefined, timeZone: string): string | null {
  if (at === undefined) return null;
  const moment = Date.parse(at) - 1;
  return Number.isNaN(moment) ? null : dayIn(moment, timeZone);
}
