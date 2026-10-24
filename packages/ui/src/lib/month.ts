// A month as a grid of day keys (`YYYY-MM-DD`) in the reader's language, for
// MonthTiles: the cells from the locale's first weekday, the weekday names,
// and each day's labels. Calendar dates only, so every format runs in UTC.

/** A day key as a UTC noon Date, for formatting the calendar date alone. */
const noon = (key: string) => {
  const [year = 1970, month = 1, day = 1] = key.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12));
};

/** A day key `days` later (or earlier). */
export function addDays(key: string, days: number): string {
  const [year = 1970, month = 1, day = 1] = key.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/** `YYYY-MM` of a day key. */
export const monthOf = (key: string) => key.slice(0, 7);

/** The month `delta` months after `month`. */
export function shiftMonth(month: string, delta: number): string {
  const [year = 1970, number = 1] = month.split('-').map(Number);
  return new Date(Date.UTC(year, number - 1 + delta, 1)).toISOString().slice(0, 7);
}

/** "October 2026", split so the year can read quieter. */
export function monthParts(month: string, locale: string): { readonly month: string; readonly year: string } {
  const parts = new Intl.DateTimeFormat(locale, { timeZone: 'UTC', month: 'long', year: 'numeric' }).formatToParts(
    noon(`${month}-01`),
  );
  return {
    month: parts.find((part) => part.type === 'month')?.value ?? month,
    year: parts.find((part) => part.type === 'year')?.value ?? '',
  };
}

/** "October 2026". */
export function monthName(month: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { timeZone: 'UTC', month: 'long', year: 'numeric' }).format(
    noon(`${month}-01`),
  );
}

/** The day a week starts on, as a member chose it (Settings › Account › Preferences): `auto` is the language's. */
export type WeekStart = 'auto' | 'monday' | 'sunday' | 'saturday';

const CHOSEN_DAY = { monday: 1, sunday: 0, saturday: 6 } as const;
const DAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

/**
 * The first day of the week, 0 Sunday to 6 Saturday: the member's choice, else
 * the locale's (Monday where the browser can't say).
 */
export function firstDayOfWeek(locale: string, weekStart: WeekStart = 'auto'): number {
  if (weekStart !== 'auto') return CHOSEN_DAY[weekStart];
  try {
    const info = new Intl.Locale(locale) as Intl.Locale & {
      getWeekInfo?: () => { firstDay: number };
      weekInfo?: { firstDay: number };
    };
    const firstDay = info.getWeekInfo?.().firstDay ?? info.weekInfo?.firstDay ?? 1;
    return firstDay % 7;
  } catch {
    return 1;
  }
}

/** The first day of the week as React Aria's calendars and `startOfWeek` take it (`mon`), or the locale's. */
export function weekStartDay(weekStart: WeekStart = 'auto'): (typeof DAY_NAMES)[number] | undefined {
  return weekStart === 'auto' ? undefined : DAY_NAMES[CHOSEN_DAY[weekStart]];
}

/** The cells every month's grid holds: six weeks of seven days. */
const SIX_WEEKS = 42;

/** The month's cells from the first weekday: blanks, then each day key, then blanks to six weeks. */
export function monthCells(
  month: string,
  locale: string,
  weekStart: WeekStart = 'auto',
): readonly (string | undefined)[] {
  const [year = 1970, number = 1] = month.split('-').map(Number);
  const days = new Date(Date.UTC(year, number, 0)).getUTCDate();
  const lead = (new Date(Date.UTC(year, number - 1, 1)).getUTCDay() - firstDayOfWeek(locale, weekStart) + 7) % 7;
  return [
    ...Array.from({ length: lead }, () => undefined),
    ...Array.from({ length: days }, (_, index) => `${month}-${String(index + 1).padStart(2, '0')}`),
    // Always six weeks: a month is then one height whichever month it is, so paging months, or a page jumping to
    // the month of its first time, never moves what stands under it (25 October 2026).
    ...Array.from({ length: SIX_WEEKS - lead - days }, () => undefined),
  ];
}

/** The weekday names in grid order: short ("Mon") and long ("Monday"). */
export function weekdayNames(
  locale: string,
  weekStart: WeekStart = 'auto',
): readonly { readonly short: string; readonly long: string }[] {
  const first = firstDayOfWeek(locale, weekStart);
  // 4 January 2026 is a Sunday.
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(Date.UTC(2026, 0, 4 + ((first + index) % 7), 12));
    const format = (weekday: 'short' | 'long') =>
      new Intl.DateTimeFormat(locale, { timeZone: 'UTC', weekday }).format(date);
    return { short: format('short'), long: format('long') };
  });
}

/** A day's labels: "Tue", "20", "Tuesday 20 October 2026", "Tue 20 Oct". */
export function dayLabels(
  key: string,
  locale: string,
): { readonly weekday: string; readonly day: string; readonly label: string; readonly short: string } {
  const date = noon(key);
  const format = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(locale, { timeZone: 'UTC', ...options }).format(date);
  return {
    weekday: format({ weekday: 'short' }),
    day: format({ day: 'numeric' }),
    label: format({ weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
    short: format({ weekday: 'short', day: 'numeric', month: 'short' }),
  };
}
