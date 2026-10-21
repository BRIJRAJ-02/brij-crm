// A schedule's week as words (spec 0035, AC-969), plain TypeScript with no Zod: the browser's Availability rows and
// a page's Hours card print it, and the server can too (spec 0037's notice prints a schedule before and after a
// colleague's change, AC-1444). `@crm/contracts/hours`.
import type { BookingAvailability } from './settings.ts';

const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

/** The words a summary uses, English unless a caller passes its own. */
export interface SummaryWords {
  /** Between a window's start and end: "9:00 AM to 5:00 PM". */
  readonly to: string;
  /** The day's end on a 12 hour clock, where "12:00 AM" would read as its start. */
  readonly midnight: string;
  /** A week with no day open. */
  readonly noDaysOpen: string;
}

/** The summary's English words. */
export const SUMMARY_WORDS: SummaryWords = { to: 'to', midnight: 'Midnight', noDaysOpen: 'No days open' };

/**
 * "9:00 AM" for a stored `HH:MM`, on the 12 hour clock in `locale`'s form, as the week editor reads it (the owner's
 * call, F12), with Midnight for the day's end, `24:00`.
 */
export function clockLabel(time: string, locale: string, words: SummaryWords = SUMMARY_WORDS): string {
  if (time === '24:00') return words.midnight;
  const [hours = 0, minutes = 0] = time.split(':').map(Number);
  return new Intl.DateTimeFormat(locale, {
    hour: 'numeric',
    minute: '2-digit',
    hourCycle: 'h12',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(2000, 0, 1, hours, minutes)));
}

/**
 * A week in a line per set of days with the same hours, Monday first, as timefix prints a page's hours:
 * "Mon – Fri, 9:00 AM to 5:00 PM" over "Sat, 10:00 AM to 1:00 PM". Three or more days in a row read as a run.
 */
export function weekSummary(
  availability: BookingAvailability,
  locale: string,
  words: SummaryWords = SUMMARY_WORDS,
): readonly string[] {
  const day = new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' });
  // 5 January 2026 is a Monday.
  const dayName = (index: number) => day.format(new Date(Date.UTC(2026, 0, 5 + index)));
  const groups = new Map<string, number[]>();
  WEEKDAYS.forEach((weekday, index) => {
    const ranges = availability.weekly[weekday];
    if (ranges.length === 0) return;
    // "to", as the week editor reads a window, so a page's hours read the same here and in its editor.
    const key = ranges
      .map(([start, end]) => `${clockLabel(start, locale, words)} ${words.to} ${clockLabel(end, locale, words)}`)
      .join(', ');
    groups.set(key, [...(groups.get(key) ?? []), index]);
  });
  if (groups.size === 0) return [words.noDaysOpen];
  return [...groups].map(([hours, days]) => `${daysLabel(days, dayName)}, ${hours}`);
}

/** Days as "Mon, Wed – Fri": runs of three or more in a row joined. */
function daysLabel(days: readonly number[], dayName: (index: number) => string): string {
  const runs: number[][] = [];
  for (const index of days) {
    const run = runs.at(-1);
    if (run !== undefined && run.at(-1) === index - 1) run.push(index);
    else runs.push([index]);
  }
  return runs
    .flatMap((run) =>
      run.length >= 3 ? [`${dayName(run[0] ?? 0)} – ${dayName(run.at(-1) ?? 0)}`] : run.map((index) => dayName(index)),
    )
    .join(', ');
}
