// Which way round a file's numeric dates are (03/04/2025: 3 April, or March
// 4?). The field set reads a typed date in the browser's own order, so an
// en-IN browser read a US file's dates day first with no word said. The
// columns step asks per date column, defaulting from the file itself. Pure.

/** Day first (03/04/2025 is 3 April) or month first (March 4). */
export type DateOrder = 'day-first' | 'month-first';

/** A date written as three numbers whose first two could be either way round: 3/4/25, 03.04.2025, 3-4-2025. */
const NUMERIC_DATE = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/u;

/** The order a language writes a numeric date in. */
export function browserOrder(locale: string): DateOrder {
  const parts = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'numeric', year: 'numeric' })
    .formatToParts(Date.UTC(2026, 9, 8))
    .map((part) => part.type);
  return parts.indexOf('day') < parts.indexOf('month') ? 'day-first' : 'month-first';
}

/** The values of a column written as day and month numbers, which the order changes. */
export function numericDates(texts: readonly string[]): readonly string[] {
  return texts.filter((text) => NUMERIC_DATE.test(text.trim()));
}

/**
 * The order a column's dates are in: day first when any first number is above 12 (13/04/2025), month first when
 * any second one is (04/13/2025), else the browser's own (every value reads either way).
 */
export function defaultDateOrder(texts: readonly string[], locale: string): DateOrder {
  let firstOver = false;
  let secondOver = false;
  for (const text of texts) {
    const found = NUMERIC_DATE.exec(text.trim());
    if (found === null) continue;
    if (Number(found[1]) > 12) firstOver = true;
    if (Number(found[2]) > 12) secondOver = true;
  }
  if (firstOver && !secondOver) return 'day-first';
  if (secondOver && !firstOver) return 'month-first';
  return browserOrder(locale);
}

/** A language that writes dates in this order, day, month, year or month, day, year, for the field set's reader. */
export function orderLocale(order: DateOrder): string {
  return order === 'day-first' ? 'en-GB' : 'en-US';
}

/** "3 April 2025" for a "YYYY-MM-DD" day, in the browser's language, or undefined when it isn't one. */
export function longDay(iso: unknown, locale: string): string | undefined {
  if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(iso)) return undefined;
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(`${iso}T00:00:00Z`),
  );
}
