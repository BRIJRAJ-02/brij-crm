// Time off's pure helpers (spec 0037): its days in words, read as calendar dates (never moved into a zone).

/** "3 Nov", "3 to 7 Nov", "30 Oct to 2 Nov", or with years when they differ from each other or from `thisYear`. */
export function daysLabel(fromDate: string, toDate: string, locale: string, thisYear?: number): string {
  const day = (date: string) => {
    const [year = 0, month = 1, dayOf = 1] = date.split('-').map(Number);
    return { year, at: new Date(Date.UTC(year, month - 1, dayOf)) };
  };
  const from = day(fromDate);
  const to = day(toDate);
  const withYear = from.year !== to.year || (thisYear !== undefined && from.year !== thisYear);
  const options: Intl.DateTimeFormatOptions = {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
    ...(withYear ? { year: 'numeric' } : {}),
  };
  const format = new Intl.DateTimeFormat(locale, options);
  if (fromDate === toDate) return format.format(from.at);
  const parts = new Intl.DateTimeFormat(locale, options).formatRange(from.at, to.at);
  // `formatRange` writes "3–7 Nov"; words read better in a sentence and to a screen reader.
  return parts.replace(/\s?[–-]\s?/, ' to ');
}

/** A member's first name, for "Add time off for Sam". */
export const firstName = (name: string): string => name.trim().split(/\s+/)[0] ?? name;
