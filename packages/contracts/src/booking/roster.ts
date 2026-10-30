// `@crm/contracts/roster` (spec 0037, job J6): the Team week's numbers and the pure rules the engine and the browser's
// data layer share, with no Zod, so the browser recounts a row's hours and the footer after a cell's change exactly as
// the server would, without loading the schema library.

/** The Team week's numbers (spec 0037's Numbers table). */
export const TEAM_WEEK = {
  /** Rows a page holds (AC-1289). */
  rowsPerPage: 50,
  /** Weeks the stepper goes back, read only (AC-1293). */
  backWeeks: 8,
  /** Weeks the stepper goes forward (AC-1293). */
  forwardWeeks: 52,
  /** Overrides dated more than this many weeks before today are dropped on every schedule write (AC-1293). */
  keptWeeks: 8,
  /** Members one bulk write names at most (AC-1292). */
  bulkMax: 50,
  /** Ranges one cell takes (spec 0025's `BOOKING_RANGES_MAX`). */
  rangesMax: 6,
} as const;

const DAY_MS = 86_400_000;

/** `date` (`YYYY-MM-DD`) as midnight UTC, or NaN. */
const dayOf = (date: string): number => Date.parse(`${date}T00:00:00Z`);

/** A UTC midnight back to `YYYY-MM-DD`. */
const dateOf = (at: number): string => new Date(at).toISOString().slice(0, 10);

/** Whether `date` (`YYYY-MM-DD`) is a Monday: the week starts on Monday (decision 31). */
export function isMonday(date: string): boolean {
  const at = dayOf(date);
  return Number.isFinite(at) && new Date(at).getUTCDay() === 1;
}

/** The Monday of the week holding `date`, read as a calendar date. */
export function mondayOf(date: string): string {
  const at = dayOf(date);
  if (!Number.isFinite(at)) return date;
  return dateOf(at - ((new Date(at).getUTCDay() + 6) % 7) * DAY_MS);
}

/** `days` days after `date` (before, when negative), as calendar dates. */
export function plusDays(date: string, days: number): string {
  const at = dayOf(date);
  return Number.isFinite(at) ? dateOf(at + days * DAY_MS) : date;
}

/** The seven dates of the week starting `monday`. */
export function weekDates(monday: string): readonly string[] {
  return [0, 1, 2, 3, 4, 5, 6].map((index) => plusDays(monday, index));
}

/** `HH:MM` as minutes since midnight. */
const minutes = (time: string): number => {
  const [hours = '0', mins = '0'] = time.split(':');
  return Number(hours) * 60 + Number(mins);
};

/**
 * A day's minutes once its ranges are merged (AC-1290: merged, not summed): ranges that overlap or touch count once,
 * so hours stored before the overlap check never double a person's day.
 */
export function mergedMinutes(ranges: readonly (readonly [string, string])[]): number {
  const spans = ranges
    .map(([start, end]) => [minutes(start), minutes(end)] as const)
    .filter(([start, end]) => end > start)
    .sort((a, b) => a[0] - b[0]);
  let total = 0;
  let open: number | undefined;
  let close = 0;
  for (const [start, end] of spans) {
    if (open === undefined || start > close) {
      if (open !== undefined) total += close - open;
      open = start;
      close = end;
    } else close = Math.max(close, end);
  }
  if (open !== undefined) total += close - open;
  return total;
}

/** What the counts read of a cell: its ranges, and whether time off covers it. */
export interface RosterDay {
  readonly ranges: readonly (readonly [string, string])[];
  readonly away?: object | undefined;
}

/** A cell's working minutes: none while Away. */
export const workingMinutes = (day: RosterDay): number => (day.away === undefined ? mergedMinutes(day.ranges) : 0);

/** A row's merged working minutes over its week. */
export const weekMinutesOf = (days: readonly RosterDay[]): number =>
  days.reduce((sum, day) => sum + workingMinutes(day), 0);

/**
 * The footer over a page of rows (AC-1294): per day, the people working and their merged minutes added up; and, when
 * the rows say whether the workspace link books them (`inLink`, set only while the workspace has one), how many of
 * those working that day it can book (`linked`).
 */
export function footerOf(
  dates: readonly string[],
  rows: readonly { readonly days: readonly RosterDay[]; readonly inLink?: boolean | undefined }[],
): { readonly date: string; readonly working: number; readonly minutes: number; readonly linked?: number }[] {
  const hasLink = rows.some((row) => row.inLink !== undefined);
  return dates.map((date, index) => {
    let working = 0;
    let total = 0;
    let linked = 0;
    for (const row of rows) {
      const day = row.days[index];
      const worked = day === undefined ? 0 : workingMinutes(day);
      if (worked > 0) {
        working += 1;
        total += worked;
        if (row.inLink === true) linked += 1;
      }
    }
    return { date, working, minutes: total, ...(hasLink ? { linked } : {}) };
  });
}
