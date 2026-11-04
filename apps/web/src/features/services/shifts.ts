// A staff member's shifts at a place as the Shifts grid reads and writes them (spec 0066 B1, AC-6612): one
// `PlaceHours` document, the weekly pattern plus dated changes. Pure, so the grid, the profile and the tests agree.
// Every change answers the whole document, so a save is always one write: copying a week to every week sets all
// seven days at once (an earlier roster bug saved only the day that was open).
import type { PlaceHours, StaffTimeOffView } from '@crm/data';
import { wallToInstant } from '@crm/data/menu';
import { WEEK_DAYS, type WeekDay } from '@crm/data/services';

/** One range as the HoursEditor holds it: `HH:MM` to `HH:MM`. */
export type Pair = readonly [string, string];

/** The week day of a `YYYY-MM-DD` date. */
export function weekDayOf(date: string): WeekDay {
  const index = (new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7;
  return WEEK_DAYS[index] ?? 'mon';
}

/** `date` moved by `days`. */
export function plusDays(date: string, days: number): string {
  const at = new Date(`${date}T12:00:00Z`);
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}

/** The Monday of the week `date` is in. */
export function mondayOf(date: string): string {
  return plusDays(date, -WEEK_DAYS.indexOf(weekDayOf(date)));
}

/** The seven dates of the week starting `monday`. */
export function weekDates(monday: string): readonly string[] {
  return WEEK_DAYS.map((_, index) => plusDays(monday, index));
}

/** Ranges as pairs, and back. */
export const toPairs = (ranges: readonly { readonly from: string; readonly to: string }[] | undefined): Pair[] =>
  (ranges ?? []).map((range) => [range.from, range.to] as const);
export const fromPairs = (pairs: readonly Pair[]): { from: string; to: string }[] =>
  pairs.map(([from, to]) => ({ from, to }));

/** The usual (weekly) ranges of `date`'s week day. */
export function usualOn(shifts: PlaceHours, date: string): Pair[] {
  return toPairs(shifts.weekly[weekDayOf(date)]);
}

/** What `date` works: its own change when there is one (closed is none), else its week day's. */
export function rangesOn(shifts: PlaceHours, date: string): Pair[] {
  const change = shifts.exceptions.find((each) => each.date === date);
  if (change !== undefined) return change.closed === true ? [] : toPairs(change.ranges);
  return usualOn(shifts, date);
}

/** Whether `date` has a change of its own. */
export function isChanged(shifts: PlaceHours, date: string): boolean {
  return shifts.exceptions.some((each) => each.date === date);
}

const same = (a: readonly Pair[], b: readonly Pair[]) => JSON.stringify(a) === JSON.stringify(b);

/**
 * The shifts with `date` set to `pairs` for that date only, or back to the usual week (`usual`). Setting a date to
 * its usual hours drops the change rather than keeping a copy of them.
 */
export function withDate(shifts: PlaceHours, date: string, pairs: readonly Pair[] | 'usual'): PlaceHours {
  const others = shifts.exceptions.filter((each) => each.date !== date);
  if (pairs === 'usual' || same(pairs, usualOn(shifts, date))) return { ...shifts, exceptions: others };
  const change = pairs.length === 0 ? { date, closed: true } : { date, ranges: fromPairs(pairs) };
  return { ...shifts, exceptions: [...others, change].sort((a, b) => a.date.localeCompare(b.date)) };
}

/** The weekly pattern with every day set at once from `byDay` (a day left out or empty is off). */
export function withWeekly(shifts: PlaceHours, byDay: Partial<Record<WeekDay, readonly Pair[]>>): PlaceHours {
  const weekly: Partial<Record<WeekDay, { from: string; to: string }[]>> = {};
  for (const day of WEEK_DAYS) {
    const pairs = byDay[day] ?? [];
    if (pairs.length > 0) weekly[day] = fromPairs(pairs);
  }
  return { ...shifts, weekly };
}

/**
 * The week of `monday` as every week: all seven days of the weekly pattern become what that week shows (its own
 * changes included), and that week's changes go, since they are the pattern now. Every day is in the one answer.
 */
export function copyWeekToAll(shifts: PlaceHours, monday: string): PlaceHours {
  const dates = weekDates(monday);
  const byDay: Partial<Record<WeekDay, readonly Pair[]>> = {};
  for (const date of dates) byDay[weekDayOf(date)] = rangesOn(shifts, date);
  const kept = shifts.exceptions.filter((each) => !dates.includes(each.date));
  return withWeekly({ ...shifts, exceptions: kept }, byDay);
}

/** Minutes between two `HH:MM`, an end not after its start running to the next day. */
export function pairMinutes([from, to]: Pair): number {
  const minutes = (time: string) => {
    const [h = 0, m = 0] = time.split(':').map(Number);
    return h * 60 + m;
  };
  const span = minutes(to) - minutes(from);
  return span > 0 ? span : span + 24 * 60;
}

/** Minutes worked over `dates`. */
export function minutesOver(shifts: PlaceHours, dates: readonly string[]): number {
  return dates.reduce(
    (total, date) => total + rangesOn(shifts, date).reduce((sum, pair) => sum + pairMinutes(pair), 0),
    0,
  );
}

/** The time off that touches `date` on the place's wall clock (`zone`), at `placeId` or at every place. */
export function awayOn(
  timeOff: readonly StaffTimeOffView[],
  date: string,
  zone: string,
  placeId: string,
): StaffTimeOffView | undefined {
  const start = wallToInstant(date, 0, zone).getTime();
  const end = wallToInstant(plusDays(date, 1), 0, zone).getTime();
  return timeOff.find(
    (off) =>
      (off.placeId === undefined || off.placeId === placeId) &&
      Date.parse(off.start) < end &&
      Date.parse(off.end) > start,
  );
}

/** Today on the zone's wall clock. */
export function todayIn(zone: string, now = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}
