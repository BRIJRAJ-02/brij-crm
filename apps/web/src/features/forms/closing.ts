// Settings' Closes row (forms fix b2): how a form's closing rule reads as a choice, and a day as the moment it
// closes. Plain functions, so they test in Node.
import type { FormDocument } from '@crm/data';

/** The Closes choice: never, on a day, or after a number of answers. */
export type ClosingKind = 'never' | 'date' | 'count';

/** The choice a stored rule reads as: a day when it names a moment, else a count when it names one, else never. */
export function closingKind(closing: FormDocument['closing']): ClosingKind {
  if (closing?.at !== undefined) return 'date';
  if (closing?.after !== undefined) return 'count';
  return 'never';
}

/**
 * The moment a form chosen to close on `day` (`YYYY-MM-DD`) closes: the end of that day on the owner's own clock,
 * as an ISO moment with its offset, so the visitor's page closes at the same instant wherever they are.
 */
export function closingOnDay(day: string): string {
  const [year = 0, month = 1, date = 1] = day.split('-').map((part) => Number.parseInt(part, 10));
  return new Date(year, month - 1, date + 1, 0, 0, 0).toISOString();
}

/** The day a stored moment closes on, `YYYY-MM-DD` on the owner's clock (the day before the midnight it names). */
export function dayOfClosing(at: string | undefined): string | null {
  if (at === undefined) return null;
  const moment = new Date(Date.parse(at) - 1);
  if (Number.isNaN(moment.getTime())) return null;
  return `${String(moment.getFullYear())}-${String(moment.getMonth() + 1).padStart(2, '0')}-${String(moment.getDate()).padStart(2, '0')}`;
}
